// packages/db-kit/src/audit.ts
//
// withAudit() writes one row to whichever audit_log-shaped table you pass it.
// Each Postgres schema (identity, crm, hr, books) owns its own audit_log
// table (per the spec), so this helper takes the table as a parameter rather
// than importing a single hardcoded schema — keeps db-kit schema-agnostic.

import type { Db } from './client.js';

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  app?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Minimal shape any "audit_log" Drizzle table must satisfy to be usable here.
 * Concrete schemas (identity.audit_log, crm.audit_log, ...) should match this.
 */
export interface AuditLogTable {
  actorUserId: unknown;
  action: unknown;
  resourceType: unknown;
  resourceId: unknown;
  before: unknown;
  after: unknown;
  app?: unknown;
  ip?: unknown;
  userAgent?: unknown;
}

export async function withAudit<TSchema extends Record<string, unknown>>(
  db: Db<TSchema>,
  auditTable: AuditLogTable & { [key: string]: unknown },
  entry: AuditEntry
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table identity varies per schema; values below are validated by entry's own typed shape.
  await (db as any).insert(auditTable).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    app: entry.app ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
  });
}
