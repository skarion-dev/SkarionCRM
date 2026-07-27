// apps/identity/src/services/api-keys.ts
// Long-lived API keys for non-interactive clients (e.g. the LinkedIn
// profile-capture browser extension) that can't hold a session/JWT.
//
// Hashing note: deliberately PLAIN SHA-256, not the pepper-mixed sha256Hex
// in lib/tokens.ts. Every other opaque-token consumer (refresh, invite,
// reset) is verified inside this same Worker, so the pepper travels with
// it for free. API keys are verified by apps/crm's Worker instead (see its
// resolveExtensionKeyOwner), which has no access to INVITATION_TOKEN_PEPPER
// and shouldn't need a new shared secret just for this - a 256-bit random
// key's hash isn't meaningfully strengthened by a pepper the way a
// low-entropy secret's would be, so skipping it here is a reasonable trade
// for not having to plumb the pepper into a second Worker.

import { and, eq, isNull } from 'drizzle-orm';
import { withAudit } from '@skarion/db-kit';
import * as schema from '../db/schema.js';
import type { IdentityDb } from '../db/types.js';
import { AuthError } from './auth.js';

async function plainSha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateApiKeySecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64url = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `sk_live_${b64url}`;
}

export async function createApiKey(
  db: IdentityDb,
  params: { email: string; label: string; actorUserId: string }
): Promise<{ key: string; id: string }> {
  const user = await db.query.users.findFirst({
    where: (t, { sql }) => sql`lower(${t.email}) = lower(${params.email})`,
  });
  if (!user) throw new AuthError('No user with that email.', 404);
  if (user.disabledAt) throw new AuthError('That user is disabled.', 400);

  const key = generateApiKeySecret();
  const keyHash = await plainSha256Hex(key);

  const [row] = await db
    .insert(schema.apiKeys)
    .values({
      userId: user.id,
      email: user.email,
      label: params.label,
      keyHash,
    })
    .returning();
  if (!row) throw new Error('Failed to create API key.');

  await withAudit(db, schema.auditLog, {
    actorUserId: params.actorUserId,
    action: 'api_key.created',
    resourceType: 'api_key',
    resourceId: row.id,
    after: { email: user.email, label: params.label },
  });

  // Only moment the plaintext key exists - never stored, never logged again.
  return { key, id: row.id };
}

export async function listApiKeys(db: IdentityDb) {
  return db.query.apiKeys.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    columns: {
      id: true,
      email: true,
      label: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });
}

export async function revokeApiKey(
  db: IdentityDb,
  params: { id: string; actorUserId: string }
): Promise<void> {
  const existing = await db.query.apiKeys.findFirst({
    where: and(eq(schema.apiKeys.id, params.id), isNull(schema.apiKeys.revokedAt)),
  });
  if (!existing) throw new AuthError('API key not found or already revoked.', 404);

  await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(schema.apiKeys.id, params.id));

  await withAudit(db, schema.auditLog, {
    actorUserId: params.actorUserId,
    action: 'api_key.revoked',
    resourceType: 'api_key',
    resourceId: params.id,
    before: { email: existing.email, label: existing.label },
  });
}
