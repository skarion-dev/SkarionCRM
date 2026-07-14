// apps/identity/src/services/invitations.ts

import { and, desc, eq, isNull } from 'drizzle-orm';
import { withAudit } from '@skarion/db-kit';
import * as schema from '../db/schema.js';
import type { IdentityDb } from '../db/types.js';
import { hashPassword } from '../lib/password.js';
import { generateOpaqueToken, sha256Hex } from '../lib/tokens.js';
import type { AppName } from '../lib/types.js';
import { AuthError } from './auth.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function parseDomains(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedInviteDomain(email: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true; // no allowlist = open
  const domain = email.split('@')[1]?.toLowerCase();
  return !!domain && allowedDomains.includes(domain);
}

export async function createInvitation(
  db: IdentityDb,
  params: { email: string; app: AppName; role: string; invitedBy: string; allowedDomains?: string }
): Promise<{ token: string; invitationId: string }> {
  const domains = parseDomains(params.allowedDomains);
  if (!isAllowedInviteDomain(params.email, domains)) {
    throw new AuthError(
      `Invitations are only allowed for these domains: ${domains.join(', ') || 'any'}`,
      400
    );
  }
  const existingActive = await db.query.invitations.findFirst({
    where: and(
      eq(schema.invitations.email, params.email),
      eq(schema.invitations.app, params.app),
      isNull(schema.invitations.acceptedAt),
      isNull(schema.invitations.revokedAt)
    ),
  });
  if (existingActive) {
    throw new AuthError('An active invitation already exists for this email and app.', 409);
  }

  const token = generateOpaqueToken();
  const tokenHash = await sha256Hex(token);

  const [invitation] = await db
    .insert(schema.invitations)
    .values({
      email: params.email,
      app: params.app,
      role: params.role,
      invitedBy: params.invitedBy,
      tokenHash,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    })
    .returning();

  await withAudit(db, schema.auditLog, {
    actorUserId: params.invitedBy,
    app: params.app,
    action: 'invitation.created',
    resourceType: 'invitation',
    resourceId: invitation!.id,
    after: { email: params.email, app: params.app, role: params.role },
  });

  return { token, invitationId: invitation!.id };
}

export async function acceptInvitation(
  db: IdentityDb,
  params: { token: string; password: string; displayName: string }
): Promise<{ userId: string; app: AppName }> {
  const tokenHash = await sha256Hex(params.token);
  const invitation = await db.query.invitations.findFirst({
    where: eq(schema.invitations.tokenHash, tokenHash),
  });

  if (!invitation || invitation.revokedAt || invitation.acceptedAt) {
    throw new AuthError('Invitation is invalid or has already been used.', 400);
  }
  if (invitation.expiresAt < new Date()) {
    throw new AuthError('Invitation has expired.', 400);
  }

  let user = await db.query.users.findFirst({
    where: (t, { sql }) => sql`lower(${t.email}) = lower(${invitation.email})`,
  });

  if (!user) {
    const passwordHash = await hashPassword(params.password);
    const [created] = await db
      .insert(schema.users)
      .values({ email: invitation.email, displayName: params.displayName, passwordHash })
      .returning();
    user = created!;
  }

  await db
    .insert(schema.appMemberships)
    .values({
      userId: user.id,
      app: invitation.app,
      role: invitation.role,
      grantedBy: invitation.invitedBy,
    })
    .onConflictDoUpdate({
      target: [schema.appMemberships.userId, schema.appMemberships.app],
      set: {
        role: invitation.role,
        revokedAt: null,
        grantedAt: new Date(),
        grantedBy: invitation.invitedBy,
      },
    });

  await db
    .update(schema.invitations)
    .set({ acceptedAt: new Date() })
    .where(eq(schema.invitations.id, invitation.id));

  await withAudit(db, schema.auditLog, {
    actorUserId: user.id,
    app: invitation.app,
    action: 'invitation.accepted',
    resourceType: 'invitation',
    resourceId: invitation.id,
  });

  return { userId: user.id, app: invitation.app };
}

export async function revokeInvitation(
  db: IdentityDb,
  params: { invitationId: string; actorUserId: string }
): Promise<void> {
  const invitation = await db.query.invitations.findFirst({
    where: eq(schema.invitations.id, params.invitationId),
  });
  if (!invitation) throw new AuthError('Invitation not found.', 404);

  await db
    .update(schema.invitations)
    .set({ revokedAt: new Date() })
    .where(eq(schema.invitations.id, params.invitationId));

  await withAudit(db, schema.auditLog, {
    actorUserId: params.actorUserId,
    app: invitation.app,
    action: 'invitation.revoked',
    resourceType: 'invitation',
    resourceId: params.invitationId,
  });
}

/** Resend = mint a fresh token + expiry on the same invitation row. */
export async function resendInvitation(
  db: IdentityDb,
  params: { invitationId: string; actorUserId: string }
): Promise<{ token: string; email: string; app: AppName }> {
  const invitation = await db.query.invitations.findFirst({
    where: eq(schema.invitations.id, params.invitationId),
  });
  if (!invitation || invitation.revokedAt || invitation.acceptedAt) {
    throw new AuthError('Invitation is invalid or already used.', 400);
  }

  const token = generateOpaqueToken();
  const tokenHash = await sha256Hex(token);

  await db
    .update(schema.invitations)
    .set({ tokenHash, expiresAt: new Date(Date.now() + INVITATION_TTL_MS) })
    .where(eq(schema.invitations.id, params.invitationId));

  await withAudit(db, schema.auditLog, {
    actorUserId: params.actorUserId,
    app: invitation.app,
    action: 'invitation.resent',
    resourceType: 'invitation',
    resourceId: params.invitationId,
  });

  return { token, email: invitation.email, app: invitation.app };
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

function computeStatus(row: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): InvitationStatus {
  if (row.revokedAt) return 'revoked';
  if (row.acceptedAt) return 'accepted';
  if (row.expiresAt < new Date()) return 'expired';
  return 'pending';
}

export async function listInvitations(db: IdentityDb, params: { status?: InvitationStatus } = {}) {
  const rows = await db.query.invitations.findMany({
    orderBy: [desc(schema.invitations.createdAt)],
    limit: 200,
  });
  const withStatus = rows.map((row) => ({ ...row, status: computeStatus(row) }));
  if (!params.status) return withStatus;
  return withStatus.filter((row) => row.status === params.status);
}
