// apps/identity/src/services/auth.ts
// Core auth business logic - login, refresh rotation, logout, password
// reset, MFA enroll/verify, /me. Kept framework-agnostic (no Hono Context
// here) so it's testable without spinning up a Worker.

import { and, eq, isNull } from 'drizzle-orm';
import { withAudit } from '@skarion/db-kit';
import * as schema from '../db/schema.js';
import type { IdentityDb } from '../db/types.js';
import { decryptMfaSecret, encryptMfaSecret } from '../lib/mfa-crypto.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
  generateOpaqueToken,
  generateNumericCode,
  sha256Hex,
  signAccessToken,
} from '../lib/tokens.js';
import {
  buildProvisioningUri,
  generateBase32Secret,
  generateRecoveryCodes,
  verifyTotpCode,
} from '../lib/totp.js';
import type { AppMembershipsMap } from '../lib/types.js';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;

export class AuthError extends Error {
  constructor(
    message: string,
    public status: 400 | 401 | 403 | 404 | 409 | 429 = 401
  ) {
    super(message);
  }
}

async function getActiveMemberships(db: IdentityDb, userId: string): Promise<AppMembershipsMap> {
  const rows = await db
    .select({ app: schema.appMemberships.app, role: schema.appMemberships.role })
    .from(schema.appMemberships)
    .where(and(eq(schema.appMemberships.userId, userId), isNull(schema.appMemberships.revokedAt)));

  const map: AppMembershipsMap = {};
  for (const row of rows) map[row.app] = row.role;
  return map;
}

export interface LoginParams {
  email: string;
  password: string;
  mfaCode?: string;
  ip?: string | null;
  userAgent?: string | null;
  jwtSecret: string;
  mfaEncryptionKey: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: {
    id: string;
    email: string;
    displayName: string;
    isSuperadmin: boolean;
    mustChangePassword: boolean;
    apps: AppMembershipsMap;
  };
}

export interface LoginStep1Params {
  email: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface LoginStep1Result {
  pendingToken: string;
  code: string;
  expiresAt: Date;
  isSuperadmin: boolean;
}

/** Step 1: verify email+password, generate a 6-digit code, store it hashed
 *  alongside an opaque pending token, return both (plaintext) to the caller.
 *  The route layer owns email I/O — this function returns `code` plaintext
 *  so the route can pass it to sendEmail, exactly how requestPasswordReset
 *  returns a plaintext token for the route layer to embed in a URL. */
export async function loginStep1(
  db: IdentityDb,
  params: LoginStep1Params
): Promise<LoginStep1Result> {
  const found = await db.query.users.findFirst({
    where: (t, { sql }) => sql`lower(${t.email}) = lower(${params.email})`,
  });
  if (!found || !found.passwordHash || found.disabledAt) {
    throw new AuthError('Invalid email or password.', 401);
  }
  const validPassword = await verifyPassword(params.password, found.passwordHash);
  if (!validPassword) throw new AuthError('Invalid email or password.', 401);

  const pendingToken = generateOpaqueToken();
  const pendingTokenHash = await sha256Hex(pendingToken);
  const code = generateNumericCode(6);
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await db.insert(schema.loginOtpCodes).values({
    userId: found.id,
    codeHash,
    pendingTokenHash,
    expiresAt,
  });

  return { pendingToken, code, expiresAt, isSuperadmin: found.isSuperadmin };
}

export interface LoginStep2Params {
  pendingToken: string;
  code: string;
  ip?: string | null;
  userAgent?: string | null;
  jwtSecret: string;
}

/** Step 2: verify the emailed code against the pending token, issue the real session. */
export async function loginStep2(db: IdentityDb, params: LoginStep2Params): Promise<LoginResult> {
  const pendingTokenHash = await sha256Hex(params.pendingToken);
  const otp = await db.query.loginOtpCodes.findFirst({
    where: eq(schema.loginOtpCodes.pendingTokenHash, pendingTokenHash),
  });
  if (!otp || otp.consumedAt || otp.expiresAt < new Date()) {
    throw new AuthError('Code expired or invalid. Please sign in again.', 401);
  }
  if (otp.attemptCount >= OTP_MAX_ATTEMPTS) {
    throw new AuthError('Too many incorrect code attempts. Please sign in again.', 429);
  }

  const codeHash = await sha256Hex(params.code);
  if (codeHash !== otp.codeHash) {
    await db
      .update(schema.loginOtpCodes)
      .set({ attemptCount: otp.attemptCount + 1 })
      .where(eq(schema.loginOtpCodes.id, otp.id));
    throw new AuthError('Incorrect code.', 401);
  }

  await db
    .update(schema.loginOtpCodes)
    .set({ consumedAt: new Date() })
    .where(eq(schema.loginOtpCodes.id, otp.id));

  const found = await db.query.users.findFirst({ where: eq(schema.users.id, otp.userId) });
  if (!found || found.disabledAt) throw new AuthError('Account disabled.', 401);

  return issueSession(db, found, params.jwtSecret, params.ip, params.userAgent);
}

/** Lookup a user by email (case-insensitive). Returns null if not found. */
export async function findUserByEmail(
  db: IdentityDb,
  email: string
): Promise<{
  id: string;
  email: string;
  displayName: string;
  isSuperadmin: boolean;
  mustChangePassword: boolean;
  tokenVersion: number;
  disabledAt: Date | null;
} | null> {
  const found = await db.query.users.findFirst({
    where: (t, { sql }) => sql`lower(${t.email}) = lower(${email})`,
  });
  return found ?? null;
}

/** Verifies a superadmin's password before the caller skips the OTP step.
 *  A prior version of this code path issued a session for any account
 *  with isSuperadmin=true without checking the password at all - a full
 *  auth bypass for the (predictable) admin email. Never remove this check;
 *  the OTP step is what's optional for superadmins, not the password. */
export async function authenticateSuperadmin(
  db: IdentityDb,
  params: { email: string; password: string }
): Promise<{
  id: string;
  email: string;
  displayName: string;
  isSuperadmin: boolean;
  mustChangePassword: boolean;
  tokenVersion: number;
} | null> {
  const found = await db.query.users.findFirst({
    where: (t, { sql }) => sql`lower(${t.email}) = lower(${params.email})`,
  });
  if (!found || !found.isSuperadmin || !found.passwordHash || found.disabledAt) return null;
  const validPassword = await verifyPassword(params.password, found.passwordHash);
  if (!validPassword) return null;
  return found;
}

/** Issue a real access+refresh token session for a user, updating lastLoginAt.
 *  Refactored out of the old login() tail — used by both loginStep2 (public
 *  OTP flow) and loginInternal (invite-accept auto-sign-in, which skips OTP
 *  because the user just proved ownership of the invite-link email). */
export async function issueSession(
  db: IdentityDb,
  found: {
    id: string;
    email: string;
    displayName: string;
    isSuperadmin: boolean;
    mustChangePassword: boolean;
    tokenVersion: number;
  },
  jwtSecret: string,
  ip?: string | null,
  userAgent?: string | null
): Promise<LoginResult> {
  const apps = await getActiveMemberships(db, found.id);
  const accessToken = await signAccessToken(
    {
      userId: found.id,
      email: found.email,
      apps,
      isSuperadmin: found.isSuperadmin,
      mustChangePassword: found.mustChangePassword,
      tokenVersion: found.tokenVersion,
    },
    jwtSecret
  );
  const refreshToken = generateOpaqueToken();
  const refreshTokenHash = await sha256Hex(refreshToken);
  const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  await db.insert(schema.sessions).values({
    userId: found.id,
    refreshTokenHash,
    userAgent: userAgent ?? null,
    ip: ip ?? null,
    expiresAt: refreshTokenExpiresAt,
  });
  await db
    .update(schema.users)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.users.id, found.id));
  return {
    accessToken,
    refreshToken,
    refreshTokenExpiresAt,
    user: {
      id: found.id,
      email: found.email,
      displayName: found.displayName,
      isSuperadmin: found.isSuperadmin,
      mustChangePassword: found.mustChangePassword,
      apps,
    },
  };
}

/** Internal-only login used by invite-accept auto-sign-in — skips OTP because
 *  the user just proved they own the invite-link email. The public /auth/login
 *  route must use loginStep1/loginStep2, never this function. */
export async function loginInternal(db: IdentityDb, params: LoginParams): Promise<LoginResult> {
  // Case-insensitive lookup; the unique index is on lower(email).
  const found = await db.query.users.findFirst({
    where: (t, { sql }) => sql`lower(${t.email}) = lower(${params.email})`,
  });

  if (!found || !found.passwordHash || found.disabledAt) {
    throw new AuthError('Invalid email or password.', 401);
  }

  const validPassword = await verifyPassword(params.password, found.passwordHash);
  if (!validPassword) throw new AuthError('Invalid email or password.', 401);

  const mfa = await db.query.mfaSecrets.findFirst({
    where: eq(schema.mfaSecrets.userId, found.id),
  });
  if (mfa?.enrolledAt) {
    if (!params.mfaCode) throw new AuthError('MFA code required.', 401);
    const secretBase32 = await decryptMfaSecret(mfa.totpSecretEncrypted, params.mfaEncryptionKey);
    const ok = await verifyTotpCode(secretBase32, params.mfaCode);
    if (!ok) throw new AuthError('Invalid MFA code.', 401);
  }

  return issueSession(db, found, params.jwtSecret, params.ip, params.userAgent);
}

export interface RefreshParams {
  refreshToken: string;
  jwtSecret: string;
}

export async function refresh(db: IdentityDb, params: RefreshParams): Promise<LoginResult> {
  const tokenHash = await sha256Hex(params.refreshToken);
  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.refreshTokenHash, tokenHash),
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new AuthError('Session expired or revoked. Please log in again.', 401);
  }

  const user = await db.query.users.findFirst({ where: eq(schema.users.id, session.userId) });
  if (!user || user.disabledAt) throw new AuthError('Account disabled.', 401);

  const apps = await getActiveMemberships(db, user.id);
  const accessToken = await signAccessToken(
    {
      userId: user.id,
      email: user.email,
      apps,
      isSuperadmin: user.isSuperadmin,
      mustChangePassword: user.mustChangePassword,
      tokenVersion: user.tokenVersion,
    },
    params.jwtSecret
  );

  // Rotate the refresh token: old one is now dead, regardless of whether the
  // caller actually uses the new one - prevents replay of a stolen old token.
  const newRefreshToken = generateOpaqueToken();
  const newRefreshTokenHash = await sha256Hex(newRefreshToken);
  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await db
    .update(schema.sessions)
    .set({ refreshTokenHash: newRefreshTokenHash, lastUsedAt: new Date(), expiresAt: newExpiresAt })
    .where(eq(schema.sessions.id, session.id));

  return {
    accessToken,
    refreshToken: newRefreshToken,
    refreshTokenExpiresAt: newExpiresAt,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isSuperadmin: user.isSuperadmin,
      mustChangePassword: user.mustChangePassword,
      apps,
    },
  };
}

export async function logout(db: IdentityDb, refreshToken: string): Promise<void> {
  const tokenHash = await sha256Hex(refreshToken);
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.sessions.refreshTokenHash, tokenHash));
}

export async function requestPasswordReset(
  db: IdentityDb,
  email: string
): Promise<{ token: string; user: { id: string; email: string; displayName: string } } | null> {
  const user = await db.query.users.findFirst({
    where: (t, { sql }) => sql`lower(${t.email}) = lower(${email})`,
  });
  // Caller (route) always returns a generic success response regardless of
  // whether the user exists, to avoid leaking which emails are registered.
  if (!user || user.disabledAt) return null;

  const token = generateOpaqueToken();
  const tokenHash = await sha256Hex(token);
  await db.insert(schema.passwordResetTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
  });

  return { token, user: { id: user.id, email: user.email, displayName: user.displayName } };
}

export async function resetPassword(
  db: IdentityDb,
  params: { token: string; newPassword: string }
): Promise<void> {
  const tokenHash = await sha256Hex(params.token);
  const resetToken = await db.query.passwordResetTokens.findFirst({
    where: eq(schema.passwordResetTokens.tokenHash, tokenHash),
  });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    throw new AuthError('Reset link is invalid or has expired.', 400);
  }

  const passwordHash = await hashPassword(params.newPassword);

  await db
    .update(schema.users)
    .set({
      passwordHash,
      mustChangePassword: false,
      tokenVersion: (await currentTokenVersion(db, resetToken.userId)) + 1,
    })
    .where(eq(schema.users.id, resetToken.userId));

  await db
    .update(schema.passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(schema.passwordResetTokens.id, resetToken.id));

  // Force logout everywhere: revoke all existing sessions.
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.sessions.userId, resetToken.userId));

  await withAudit(db, schema.auditLog, {
    actorUserId: resetToken.userId,
    action: 'auth.password_reset',
    resourceType: 'user',
    resourceId: resetToken.userId,
  });
}

export async function changeTemporaryPassword(
  db: IdentityDb,
  params: { email: string; currentPassword: string; newPassword: string }
): Promise<void> {
  const user = await db.query.users.findFirst({
    where: (t, { sql }) => sql`lower(${t.email}) = lower(${params.email})`,
  });
  if (!user || !user.passwordHash || !user.mustChangePassword || user.disabledAt) {
    throw new AuthError('Temporary password is invalid or no longer required.', 401);
  }
  if (!(await verifyPassword(params.currentPassword, user.passwordHash))) {
    throw new AuthError('Temporary password is invalid or no longer required.', 401);
  }
  const passwordHash = await hashPassword(params.newPassword);
  await db
    .update(schema.users)
    .set({ passwordHash, mustChangePassword: false, tokenVersion: user.tokenVersion + 1 })
    .where(eq(schema.users.id, user.id));
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.sessions.userId, user.id));
  await withAudit(db, schema.auditLog, {
    actorUserId: user.id,
    action: 'auth.temporary_password_changed',
    resourceType: 'user',
    resourceId: user.id,
  });
}

async function currentTokenVersion(db: IdentityDb, userId: string): Promise<number> {
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  return user?.tokenVersion ?? 1;
}

export async function enrollMfa(
  db: IdentityDb,
  params: { userId: string; userEmail: string; mfaEncryptionKey: string }
): Promise<{ secretBase32: string; provisioningUri: string }> {
  const secretBase32 = generateBase32Secret();
  const provisioningUri = buildProvisioningUri({
    secretBase32,
    accountEmail: params.userEmail,
    issuer: 'Skarion',
  });
  const encrypted = await encryptMfaSecret(secretBase32, params.mfaEncryptionKey);

  // Not yet "enrolled" until verified - upsert without setting enrolledAt.
  await db
    .insert(schema.mfaSecrets)
    .values({ userId: params.userId, totpSecretEncrypted: encrypted })
    .onConflictDoUpdate({
      target: schema.mfaSecrets.userId,
      set: { totpSecretEncrypted: encrypted, enrolledAt: null, recoveryCodesHashes: null },
    });

  // Returned once for the QR code / manual entry - never persisted in plaintext.
  return { secretBase32, provisioningUri };
}

export async function verifyMfaEnrollment(
  db: IdentityDb,
  params: { userId: string; code: string; mfaEncryptionKey: string }
): Promise<{ recoveryCodes: string[] }> {
  const mfa = await db.query.mfaSecrets.findFirst({
    where: eq(schema.mfaSecrets.userId, params.userId),
  });
  if (!mfa) throw new AuthError('No MFA enrollment in progress.', 400);

  const secretBase32 = await decryptMfaSecret(mfa.totpSecretEncrypted, params.mfaEncryptionKey);
  const ok = await verifyTotpCode(secretBase32, params.code);
  if (!ok) throw new AuthError('Invalid code.', 401);

  const recoveryCodes = generateRecoveryCodes();
  const hashes = await Promise.all(recoveryCodes.map((c) => sha256Hex(c)));

  await db
    .update(schema.mfaSecrets)
    .set({ enrolledAt: new Date(), recoveryCodesHashes: hashes })
    .where(eq(schema.mfaSecrets.userId, params.userId));

  await withAudit(db, schema.auditLog, {
    actorUserId: params.userId,
    action: 'auth.mfa_enrolled',
    resourceType: 'user',
    resourceId: params.userId,
  });

  return { recoveryCodes };
}

export async function getMe(
  db: IdentityDb,
  userId: string
): Promise<{
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  apps: AppMembershipsMap;
  isSuperadmin: boolean;
  mustChangePassword: boolean;
  mfaEnrolled: boolean;
}> {
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) throw new AuthError('User not found.', 404);

  const apps = await getActiveMemberships(db, userId);
  const mfa = await db.query.mfaSecrets.findFirst({ where: eq(schema.mfaSecrets.userId, userId) });

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    apps,
    isSuperadmin: user.isSuperadmin,
    mustChangePassword: user.mustChangePassword,
    mfaEnrolled: !!mfa?.enrolledAt,
  };
}
