import { neon } from '@neondatabase/serverless';
import { gunzipSync } from 'node:zlib';
import { canonicalizeLinkedinUrl, linkedinProfileKey } from '../lib/leadDedup.js';

type SqlRow = Record<string, unknown>;
type DirectChange = {
  table:
    | 'leads'
    | 'contacts'
    | 'linkedin_conversations'
    | 'linkedin_sync_imports'
    | 'linkedin_message_records'
    | 'linkedin_sync_flags'
    | 'linkedin_invitation_snapshot_entries';
  column: string;
  id: string;
  secondaryId?: string;
  before: string;
  after: string | null;
  profileKey?: string | null;
};
type JsonChange = {
  table: 'linkedin_conversations' | 'linkedin_sync_jobs';
  column: 'messages' | 'payload';
  id: string;
  before: unknown;
  after: unknown;
  normalizedValues: number;
};
type Change = DirectChange | JsonChange;

const databaseUrl = process.env.DATABASE_URL ?? '';
const mode = process.env.LINKEDIN_URL_BACKFILL_MODE === 'apply' ? 'apply' : 'dry-run';
const batchSize = 100;
const caseMapPayload = Array.from(
  { length: 10 },
  (_, index) => process.env[`LINKEDIN_URL_CASE_MAP_${String(index + 1).padStart(2, '0')}`] ?? ''
).join('');

if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const sql = neon(databaseUrl);
const caseMap = new Map<string, string>();
if (caseMapPayload) {
  const parsed = JSON.parse(
    gunzipSync(Buffer.from(caseMapPayload, 'base64')).toString('utf8')
  ) as Record<string, unknown>;
  for (const [rawKey, rawUrl] of Object.entries(parsed)) {
    const canonical = canonicalizeLinkedinUrl(rawUrl);
    const profileKey = linkedinProfileKey(canonical);
    if (
      typeof rawUrl !== 'string' ||
      !canonical ||
      canonical !== rawUrl ||
      profileKey !== rawKey.toLowerCase()
    ) {
      throw new Error(`Invalid case-map entry for profile key ${rawKey}.`);
    }
    caseMap.set(profileKey, canonical);
  }
}

function canonicalForBackfill(value: unknown): string | null {
  const canonical = canonicalizeLinkedinUrl(value);
  const profileKey = linkedinProfileKey(canonical);
  return (profileKey && caseMap.get(profileKey)) || canonical;
}

function canonicalChange(value: unknown): { before: string; after: string } | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const after = canonicalForBackfill(value);
  if (!after || value === after) return null;
  return { before: value, after };
}

function normalizeProfileUrlsInJson(
  value: unknown,
  propertyName?: string
): { value: unknown; changed: number } {
  if (typeof value === 'string') {
    if (!propertyName || !/(?:linkedinUrl|profileUrl)$/i.test(propertyName)) {
      return { value, changed: 0 };
    }
    const normalized = canonicalForBackfill(value);
    return normalized && normalized !== value
      ? { value: normalized, changed: 1 }
      : { value, changed: 0 };
  }
  if (Array.isArray(value)) {
    let changed = 0;
    const output = value.map((entry) => {
      const normalized = normalizeProfileUrlsInJson(entry);
      changed += normalized.changed;
      return normalized.value;
    });
    return { value: changed > 0 ? output : value, changed };
  }
  if (value && typeof value === 'object') {
    let changed = 0;
    const output = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
        const normalized = normalizeProfileUrlsInJson(entry, key);
        changed += normalized.changed;
        return [key, normalized.value];
      })
    );
    return { value: changed > 0 ? output : value, changed };
  }
  return { value, changed: 0 };
}

function addDirectChange(
  changes: Change[],
  table: DirectChange['table'],
  column: string,
  id: string,
  value: unknown,
  options?: { secondaryId?: string; profileKey?: string }
): void {
  const normalized = canonicalChange(value);
  if (!normalized) return;
  changes.push({
    table,
    column,
    id,
    secondaryId: options?.secondaryId,
    profileKey: options?.profileKey,
    ...normalized,
  });
}

async function loadPlans(): Promise<{
  changes: Change[];
  unresolved: Array<{ table: string; column: string; id: string; value: string }>;
  collisions: string[];
  duplicateLeadKeys: string[];
}> {
  const [leads, contacts, conversations, imports, jobs, messages, flags, invitations] =
    await Promise.all([
      sql`select id, workspace_id, deleted_at, linkedin_url, linkedin_profile_key
        from crm.leads where linkedin_url is not null`,
      sql`select id, deleted_at, linkedin_url from crm.contacts where linkedin_url is not null`,
      sql`select id, other_party_profile_url, owner_profile_url, messages
        from crm.linkedin_conversations`,
      sql`select id, owner_profile_url from crm.linkedin_sync_imports
        where owner_profile_url is not null`,
      sql`select id, payload from crm.linkedin_sync_jobs`,
      sql`select id, sender_profile_url from crm.linkedin_message_records
        where sender_profile_url is not null`,
      sql`select id, other_party_profile_url from crm.linkedin_sync_flags
        where other_party_profile_url is not null`,
      sql`select import_id, other_party_profile_url
        from crm.linkedin_invitation_snapshot_entries`,
    ]);

  const changes: Change[] = [];
  const unresolved: Array<{ table: string; column: string; id: string; value: string }> = [];

  const inspectDirectValue = (
    table: DirectChange['table'],
    column: string,
    id: string,
    value: unknown,
    options?: { secondaryId?: string; profileKey?: string }
  ) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const canonical = canonicalForBackfill(value);
    if (!canonical) {
      unresolved.push({ table, column, id, value });
      return;
    }
    addDirectChange(changes, table, column, id, value, options);
  };

  const activeLeadGroups = new Map<string, SqlRow[]>();
  for (const row of leads as SqlRow[]) {
    if (row.deleted_at) continue;
    const profileKey = linkedinProfileKey(row.linkedin_url);
    if (!profileKey) continue;
    const groupKey = `${String(row.workspace_id)}\u0000${profileKey}`;
    activeLeadGroups.set(groupKey, [...(activeLeadGroups.get(groupKey) ?? []), row]);
  }
  const leadKeyOwners = new Map<string, string>();
  const duplicateLeadKeys: string[] = [];
  for (const [groupKey, rows] of activeLeadGroups) {
    const profileKey = groupKey.split('\u0000')[1] ?? '';
    const owner =
      rows.find((row) => row.linkedin_profile_key === profileKey) ??
      rows.find((row) => typeof row.linkedin_profile_key === 'string') ??
      rows[0];
    if (!owner) continue;
    leadKeyOwners.set(groupKey, String(owner.id));
    if (rows.length > 1) {
      duplicateLeadKeys.push(
        `${profileKey}: canonical key kept by ${String(owner.id)}; cleared from ${rows
          .filter((row) => row.id !== owner.id)
          .map((row) => String(row.id))
          .join(', ')}`
      );
    }
  }

  for (const row of leads as SqlRow[]) {
    const rawUrl = typeof row.linkedin_url === 'string' ? row.linkedin_url : '';
    const canonical = canonicalForBackfill(rawUrl);
    if (!canonical) {
      if (!rawUrl.trim() || !/linkedin\.com/i.test(rawUrl)) {
        changes.push({
          table: 'leads',
          column: 'linkedin_url',
          id: String(row.id),
          before: rawUrl,
          after: null,
          profileKey: null,
        });
      } else {
        unresolved.push({
          table: 'leads',
          column: 'linkedin_url',
          id: String(row.id),
          value: rawUrl,
        });
      }
      continue;
    }
    const profileKey = linkedinProfileKey(canonical);
    const groupKey = `${String(row.workspace_id)}\u0000${profileKey ?? ''}`;
    const targetProfileKey =
      !row.deleted_at &&
      leadKeyOwners.has(groupKey) &&
      leadKeyOwners.get(groupKey) !== String(row.id)
        ? null
        : profileKey;
    if (row.linkedin_url !== canonical || row.linkedin_profile_key !== targetProfileKey) {
      changes.push({
        table: 'leads',
        column: 'linkedin_url',
        id: String(row.id),
        before: rawUrl,
        after: canonical,
        profileKey: targetProfileKey,
      });
    }
  }
  for (const row of contacts as SqlRow[]) {
    inspectDirectValue('contacts', 'linkedin_url', String(row.id), row.linkedin_url);
  }
  for (const row of conversations as SqlRow[]) {
    inspectDirectValue(
      'linkedin_conversations',
      'other_party_profile_url',
      String(row.id),
      row.other_party_profile_url
    );
    inspectDirectValue(
      'linkedin_conversations',
      'owner_profile_url',
      String(row.id),
      row.owner_profile_url
    );
    const normalized = normalizeProfileUrlsInJson(row.messages);
    if (normalized.changed > 0) {
      changes.push({
        table: 'linkedin_conversations',
        column: 'messages',
        id: String(row.id),
        before: row.messages,
        after: normalized.value,
        normalizedValues: normalized.changed,
      });
    }
  }
  for (const row of imports as SqlRow[]) {
    inspectDirectValue(
      'linkedin_sync_imports',
      'owner_profile_url',
      String(row.id),
      row.owner_profile_url
    );
  }
  for (const row of jobs as SqlRow[]) {
    const normalized = normalizeProfileUrlsInJson(row.payload);
    if (normalized.changed > 0) {
      changes.push({
        table: 'linkedin_sync_jobs',
        column: 'payload',
        id: String(row.id),
        before: row.payload,
        after: normalized.value,
        normalizedValues: normalized.changed,
      });
    }
  }
  for (const row of messages as SqlRow[]) {
    inspectDirectValue(
      'linkedin_message_records',
      'sender_profile_url',
      String(row.id),
      row.sender_profile_url
    );
  }
  for (const row of flags as SqlRow[]) {
    inspectDirectValue(
      'linkedin_sync_flags',
      'other_party_profile_url',
      String(row.id),
      row.other_party_profile_url
    );
  }
  for (const row of invitations as SqlRow[]) {
    inspectDirectValue(
      'linkedin_invitation_snapshot_entries',
      'other_party_profile_url',
      String(row.import_id),
      row.other_party_profile_url,
      { secondaryId: String(row.other_party_profile_url) }
    );
  }

  const collisions: string[] = [];
  const activeContactTargets = new Map<string, string>();
  for (const row of contacts as SqlRow[]) {
    if (row.deleted_at) continue;
    const canonical = canonicalForBackfill(row.linkedin_url);
    if (!canonical) continue;
    const key = canonical.toLowerCase();
    const prior = activeContactTargets.get(key);
    if (prior && prior !== row.id) {
      collisions.push(`crm.contacts URL ${canonical}: ${prior}, ${String(row.id)}`);
    } else {
      activeContactTargets.set(key, String(row.id));
    }
  }

  const invitationTargets = new Map<string, string>();
  for (const row of invitations as SqlRow[]) {
    const canonical = canonicalForBackfill(row.other_party_profile_url);
    if (!canonical) continue;
    const key = `${String(row.import_id)}\u0000${canonical.toLowerCase()}`;
    const prior = invitationTargets.get(key);
    if (prior && prior !== row.other_party_profile_url) {
      collisions.push(
        `crm.linkedin_invitation_snapshot_entries ${String(row.import_id)}: ${prior}, ${String(row.other_party_profile_url)}`
      );
    } else {
      invitationTargets.set(key, String(row.other_party_profile_url));
    }
  }

  return {
    changes,
    unresolved,
    collisions: [...new Set(collisions)],
    duplicateLeadKeys,
  };
}

function describeChanges(changes: Change[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const change of changes) {
    const key = `${change.table}.${change.column}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function applyChanges(changes: Change[]): Promise<void> {
  for (let offset = 0; offset < changes.length; offset += batchSize) {
    const batch = changes.slice(offset, offset + batchSize);
    await sql.transaction((tx) =>
      batch.map((change) => {
        if (change.table === 'leads') {
          return tx`update crm.leads
                    set linkedin_url = ${change.after},
                        linkedin_profile_key = ${change.profileKey ?? null},
                        updated_at = now()
                    where id = ${change.id}::uuid`;
        }
        if (change.table === 'contacts') {
          return tx`update crm.contacts
                    set linkedin_url = ${change.after}, updated_at = now()
                    where id = ${change.id}::uuid`;
        }
        if (change.table === 'linkedin_conversations' && change.column === 'messages') {
          return tx`update crm.linkedin_conversations
                    set messages = ${JSON.stringify(change.after)}::jsonb, updated_at = now()
                    where id = ${change.id}::uuid`;
        }
        if (change.table === 'linkedin_conversations') {
          return change.column === 'owner_profile_url'
            ? tx`update crm.linkedin_conversations
                 set owner_profile_url = ${change.after}, updated_at = now()
                 where id = ${change.id}::uuid`
            : tx`update crm.linkedin_conversations
                 set other_party_profile_url = ${change.after}, updated_at = now()
                 where id = ${change.id}::uuid`;
        }
        if (change.table === 'linkedin_sync_imports') {
          return tx`update crm.linkedin_sync_imports
                    set owner_profile_url = ${change.after}, updated_at = now()
                    where id = ${change.id}::uuid`;
        }
        if (change.table === 'linkedin_sync_jobs') {
          return tx`update crm.linkedin_sync_jobs
                    set payload = ${JSON.stringify(change.after)}::jsonb, updated_at = now()
                    where id = ${change.id}::uuid`;
        }
        if (change.table === 'linkedin_message_records') {
          return tx`update crm.linkedin_message_records
                    set sender_profile_url = ${change.after}
                    where id = ${change.id}::uuid`;
        }
        if (change.table === 'linkedin_sync_flags') {
          return tx`update crm.linkedin_sync_flags
                    set other_party_profile_url = ${change.after}, updated_at = now()
                    where id = ${change.id}::uuid`;
        }
        return tx`update crm.linkedin_invitation_snapshot_entries
                  set other_party_profile_url = ${change.after}
                  where import_id = ${change.id}::uuid
                    and other_party_profile_url = ${
                      'secondaryId' in change ? (change.secondaryId ?? '') : ''
                    }`;
      })
    );
    console.log(`Applied ${Math.min(offset + batch.length, changes.length)}/${changes.length}`);
  }
}

const plan = await loadPlans();
console.log(
  JSON.stringify(
    {
      mode,
      caseMapEntries: caseMap.size,
      totalRowsToUpdate: plan.changes.length,
      byField: describeChanges(plan.changes),
      unresolvedCount: plan.unresolved.length,
      unresolvedSample: plan.unresolved.slice(0, 20),
      collisionCount: plan.collisions.length,
      collisionSample: plan.collisions.slice(0, 20),
      duplicateLeadKeyCount: plan.duplicateLeadKeys.length,
      duplicateLeadKeyRepairs: plan.duplicateLeadKeys.slice(0, 20),
      sampleChanges: plan.changes.slice(0, 20).map((change) => ({
        field: `${change.table}.${change.column}`,
        id: change.id,
        before:
          typeof change.before === 'string' ? change.before.slice(0, 180) : `[structured value]`,
        after:
          typeof change.after === 'string'
            ? change.after.slice(0, 180)
            : change.after === null
              ? null
              : `[structured value]`,
      })),
    },
    null,
    2
  )
);

if (mode === 'dry-run') {
  console.log('Dry run complete. No database rows were changed.');
  process.exit(0);
}
if (plan.collisions.length > 0) {
  throw new Error('Apply aborted: canonical URL collisions must be resolved before backfill.');
}
if (plan.unresolved.length > 0) {
  throw new Error('Apply aborted: unrecognized stored LinkedIn profile URLs remain.');
}

await applyChanges(plan.changes);

const verification = await loadPlans();
if (
  verification.changes.length > 0 ||
  verification.unresolved.length > 0 ||
  verification.collisions.length > 0
) {
  throw new Error(
    `Verification failed: ${verification.changes.length} changes, ` +
      `${verification.unresolved.length} unresolved, ${verification.collisions.length} collisions remain.`
  );
}
console.log(`Backfill verified: ${plan.changes.length} rows updated; 0 noncanonical URLs remain.`);
