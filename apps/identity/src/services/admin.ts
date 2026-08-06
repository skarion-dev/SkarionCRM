// apps/identity/src/services/admin.ts

import { and, desc, eq, isNull } from 'drizzle-orm';
import { withAudit } from '@skarion/db-kit';
import * as schema from '../db/schema.js';
import type { IdentityDb } from '../db/types.js';
import type { AppName } from '../lib/types.js';
import { AuthError } from './auth.js';
import { hashPassword } from '../lib/password.js';

export async function listUsers(db: IdentityDb) {
  const users = await db.query.users.findMany({
    columns: {
      id: true,
      email: true,
      displayName: true,
      avatarUrl: true,
      lastLoginAt: true,
      disabledAt: true,
      createdAt: true,
    },
    with: {
      appMemberships: {
        where: isNull(schema.appMemberships.revokedAt),
        columns: { app: true, role: true, grantedAt: true },
      },
    },
  });
  return users;
}

export async function updateMemberships(
  db: IdentityDb,
  params: {
    targetUserId: string;
    actorUserId: string;
    memberships: { app: AppName; role: string | null }[]; // role: null => revoke
  }
) {
  for (const m of params.memberships) {
    if (m.role === null) {
      await db
        .update(schema.appMemberships)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.appMemberships.userId, params.targetUserId),
            eq(schema.appMemberships.app, m.app)
          )
        );
    } else {
      await db
        .insert(schema.appMemberships)
        .values({
          userId: params.targetUserId,
          app: m.app,
          role: m.role,
          grantedBy: params.actorUserId,
        })
        .onConflictDoUpdate({
          target: [schema.appMemberships.userId, schema.appMemberships.app],
          set: {
            role: m.role,
            revokedAt: null,
            grantedAt: new Date(),
            grantedBy: params.actorUserId,
          },
        });
    }
  }

  // Bump token_version so already-issued JWTs reflect the new memberships on next refresh.
  await bumpTokenVersion(db, params.targetUserId);

  await withAudit(db, schema.auditLog, {
    actorUserId: params.actorUserId,
    action: 'user.memberships_updated',
    resourceType: 'user',
    resourceId: params.targetUserId,
    after: { memberships: params.memberships },
  });
}

export async function disableUser(
  db: IdentityDb,
  params: { targetUserId: string; actorUserId: string }
) {
  const target = await db.query.users.findFirst({
    where: eq(schema.users.id, params.targetUserId),
  });
  if (!target) throw new AuthError('User not found.', 404);

  await db
    .update(schema.users)
    .set({ disabledAt: new Date() })
    .where(eq(schema.users.id, params.targetUserId));

  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.sessions.userId, params.targetUserId));

  await withAudit(db, schema.auditLog, {
    actorUserId: params.actorUserId,
    action: 'user.disabled',
    resourceType: 'user',
    resourceId: params.targetUserId,
    before: { disabledAt: null },
    after: { disabledAt: new Date().toISOString() },
  });
}

export async function enableUser(
  db: IdentityDb,
  params: { targetUserId: string; actorUserId: string }
) {
  const target = await db.query.users.findFirst({
    where: eq(schema.users.id, params.targetUserId),
  });
  if (!target) throw new AuthError('User not found.', 404);

  await db
    .update(schema.users)
    .set({ disabledAt: null })
    .where(eq(schema.users.id, params.targetUserId));

  await withAudit(db, schema.auditLog, {
    actorUserId: params.actorUserId,
    action: 'user.enabled',
    resourceType: 'user',
    resourceId: params.targetUserId,
    before: { disabledAt: target.disabledAt?.toISOString() ?? null },
    after: { disabledAt: null },
  });
}

/** Set a one-time temporary password. The plaintext is returned only to the
 * superadmin who initiated the reset; it is never stored or audited. */
export async function forcePasswordReset(
  db: IdentityDb,
  params: { targetUserId: string; actorUserId: string; temporaryPassword: string }
): Promise<{ email: string; displayName: string; temporaryPassword: string }> {
  const target = await db.query.users.findFirst({
    where: eq(schema.users.id, params.targetUserId),
  });
  if (!target) throw new AuthError('User not found.', 404);

  const passwordHash = await hashPassword(params.temporaryPassword);
  await db
    .update(schema.users)
    .set({
      passwordHash,
      mustChangePassword: true,
      tokenVersion: target.tokenVersion + 1,
    })
    .where(eq(schema.users.id, target.id));
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.sessions.userId, target.id));

  await withAudit(db, schema.auditLog, {
    actorUserId: params.actorUserId,
    action: 'user.force_password_reset',
    resourceType: 'user',
    resourceId: params.targetUserId,
  });

  return {
    email: target.email,
    displayName: target.displayName,
    temporaryPassword: params.temporaryPassword,
  };
}

export async function listAuditLog(
  db: IdentityDb,
  params: { limit?: number; offset?: number } = {}
) {
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;
  return db.query.auditLog.findMany({
    orderBy: [desc(schema.auditLog.createdAt)],
    limit,
    offset,
  });
}

async function bumpTokenVersion(db: IdentityDb, userId: string): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) return;
  await db
    .update(schema.users)
    .set({ tokenVersion: user.tokenVersion + 1 })
    .where(eq(schema.users.id, userId));
}
