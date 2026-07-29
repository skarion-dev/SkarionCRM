import { gunzipSync } from 'node:zlib';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@skarion/db-kit';
import * as schema from '../db/schema.js';
import { formatLeadNumber } from '../lib/leadNumber.js';
import { hasLeadTag, normalizeTagNames, tagSlug } from '../lib/leadJourney.js';

type CuratedCandidate = {
  sourceRow: number;
  firstName: string;
  lastName: string;
  email: string | null;
  linkedinUrl: string;
  notes: string | null;
  tags: string[];
};

type ExistingLead = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  linkedinUrl: string | null;
  notes: string | null;
  tags: unknown;
};

const databaseUrl = process.env.DATABASE_URL ?? '';
const payloadBase64 = process.env.CURATED_LEADS_PAYLOAD_B64 ?? '';
const ownerId = process.env.CURATED_LEADS_OWNER_ID ?? '';
const batchName = process.env.CURATED_LEADS_BATCH_NAME?.trim() || 'Curated Leads';
const mode = process.env.CURATED_LEADS_MODE === 'import' ? 'import' : 'dry-run';

if (!databaseUrl) throw new Error('DATABASE_URL is required.');
if (!payloadBase64) throw new Error('CURATED_LEADS_PAYLOAD_B64 is required.');
if (!/^[0-9a-f-]{36}$/i.test(ownerId)) throw new Error('A valid owner UUID is required.');

const candidates = JSON.parse(
  gunzipSync(Buffer.from(payloadBase64, 'base64')).toString('utf8')
) as CuratedCandidate[];
if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > 500) {
  throw new Error('Curated payload must contain between 1 and 500 candidates.');
}

function canonicalLinkedIn(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0]?.toLowerCase() !== 'in' || !parts[1]) return null;
    return decodeURIComponent(parts[1]).toLowerCase();
  } catch {
    return null;
  }
}

function canonicalName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isGenericName(firstName: string, lastName: string): boolean {
  return /^(linkedin\s+)?(member|candidate)(\s+[a-z0-9]+)?$/i.test(
    `${firstName} ${lastName}`.trim()
  );
}

function pushToMap(map: Map<string, ExistingLead[]>, key: string | null, lead: ExistingLead) {
  if (!key) return;
  const values = map.get(key) ?? [];
  values.push(lead);
  map.set(key, values);
}

function mergedTags(existing: unknown, additions: string[]): string[] {
  return normalizeTagNames([...(Array.isArray(existing) ? existing : []), ...additions]);
}

const db = getDb({ DATABASE_URL: databaseUrl }, schema);
const existingLeads = await db
  .select({
    id: schema.leads.id,
    firstName: schema.leads.firstName,
    lastName: schema.leads.lastName,
    email: schema.leads.email,
    linkedinUrl: schema.leads.linkedinUrl,
    notes: schema.leads.notes,
    tags: schema.leads.tags,
  })
  .from(schema.leads)
  .where(isNull(schema.leads.deletedAt));

const byLinkedIn = new Map<string, ExistingLead[]>();
const byName = new Map<string, ExistingLead[]>();
for (const lead of existingLeads) {
  pushToMap(byLinkedIn, canonicalLinkedIn(lead.linkedinUrl), lead);
  pushToMap(byName, canonicalName(lead.firstName, lead.lastName), lead);
}

const plannedNew: CuratedCandidate[] = [];
const plannedUpdates: Array<{
  lead: ExistingLead;
  candidate: CuratedCandidate;
  matchedBy: 'linkedin' | 'name' | 'both';
}> = [];
let ambiguous = 0;
let existingByLinkedIn = 0;
let existingByName = 0;
let existingByBoth = 0;
const ambiguousCandidates: Array<{
  sourceRow: number;
  name: string;
  linkedinUrl: string;
  linkedinMatches: number;
  nameMatches: number;
}> = [];

for (const candidate of candidates) {
  const linkMatches = byLinkedIn.get(canonicalLinkedIn(candidate.linkedinUrl) ?? '') ?? [];
  const nameMatches = byName.get(canonicalName(candidate.firstName, candidate.lastName)) ?? [];
  const nameIds = new Set(nameMatches.map((lead) => lead.id));
  const shared = linkMatches.filter((lead) => nameIds.has(lead.id));

  let matchedLead: ExistingLead | null = null;
  let matchedBy: 'linkedin' | 'name' | 'both' | null = null;
  if (shared.length === 1) {
    matchedLead = shared[0] ?? null;
    matchedBy = 'both';
  } else if (linkMatches.length === 1) {
    const linkLead = linkMatches[0] ?? null;
    if (nameMatches.length === 0 || nameIds.has(linkLead?.id ?? '')) {
      matchedLead = linkLead;
      matchedBy = nameMatches.length === 1 ? 'both' : 'linkedin';
    }
  } else if (nameMatches.length === 1 && linkMatches.length === 0) {
    matchedLead = nameMatches[0] ?? null;
    matchedBy = 'name';
  }

  if (!matchedLead || !matchedBy) {
    if (linkMatches.length > 0 || nameMatches.length > 0) {
      ambiguous += 1;
      ambiguousCandidates.push({
        sourceRow: candidate.sourceRow,
        name: `${candidate.firstName} ${candidate.lastName}`,
        linkedinUrl: candidate.linkedinUrl,
        linkedinMatches: linkMatches.length,
        nameMatches: nameMatches.length,
      });
    } else {
      plannedNew.push(candidate);
    }
    continue;
  }

  if (matchedBy === 'linkedin') existingByLinkedIn += 1;
  if (matchedBy === 'name') existingByName += 1;
  if (matchedBy === 'both') existingByBoth += 1;
  plannedUpdates.push({ lead: matchedLead, candidate, matchedBy });
}

const summary = {
  mode,
  inputCandidates: candidates.length,
  newLeads: plannedNew.length,
  existingByLinkedIn,
  existingByName,
  existingByBoth,
  ambiguousSkipped: ambiguous,
  ambiguousCandidates,
  existingToTagOrEnrich: plannedUpdates.length,
  needsProfileCaptureNew: plannedNew.filter((candidate) =>
    candidate.tags.some((tag) => tag.toLowerCase() === 'needs profile capture')
  ).length,
};

if (mode === 'dry-run') {
  console.log(JSON.stringify(summary));
  process.exit(0);
}

// neon-http intentionally has no interactive transaction support. Every write
// below is idempotent, so a failed run can be safely retried without creating
// duplicate leads.
const result = await (async (tx: typeof db) => {
  const tagNames = normalizeTagNames([
    batchName,
    ...candidates.flatMap((candidate) => candidate.tags),
  ]);
  for (const name of tagNames) {
    const needsCapture = name.toLowerCase() === 'needs profile capture';
    await tx
      .insert(schema.tagDefinitions)
      .values({
        name,
        slug: tagSlug(name),
        color: needsCapture ? 'amber' : 'violet',
        description: needsCapture
          ? 'The LinkedIn profile still needs a full capture before outreach.'
          : `Imported from the ${batchName} recruiting list.`,
        isSystem: false,
        createdBy: ownerId,
      })
      .onConflictDoNothing({ target: schema.tagDefinitions.slug });
  }

  let enrichedExisting = 0;
  let taggedExisting = 0;
  for (const { lead, candidate } of plannedUpdates) {
    const tags = mergedTags(lead.tags, [
      batchName,
      ...candidate.tags.filter((tag) => tag.toLowerCase() !== 'needs profile capture'),
    ]);
    const update: Partial<typeof schema.leads.$inferInsert> = {
      tags,
      updatedAt: new Date(),
    };
    let enriched = false;

    if (!lead.linkedinUrl && candidate.linkedinUrl) {
      update.linkedinUrl = candidate.linkedinUrl;
      enriched = true;
    }
    if (candidate.email && (!lead.email || lead.email.includes('@placeholder.skarion'))) {
      update.email = candidate.email;
      enriched = true;
    }
    if (
      isGenericName(lead.firstName, lead.lastName) &&
      !isGenericName(candidate.firstName, candidate.lastName)
    ) {
      update.firstName = candidate.firstName;
      update.lastName = candidate.lastName;
      enriched = true;
    }
    if (candidate.notes && !lead.notes?.includes(candidate.notes)) {
      update.notes = [lead.notes, candidate.notes].filter(Boolean).join('\n');
      enriched = true;
    }

    await tx.update(schema.leads).set(update).where(eq(schema.leads.id, lead.id));
    taggedExisting += 1;
    if (enriched) enrichedExisting += 1;
  }

  const [batch] = await tx
    .insert(schema.importBatches)
    .values({
      name: batchName,
      importedByUserId: ownerId,
      source: 'linkedin',
      totalRows: candidates.length,
      importedCount: plannedNew.length,
      duplicatesSkipped: plannedUpdates.length + ambiguous,
      defaultTags: normalizeTagNames([batchName, 'needs profile capture']),
    })
    .returning({ id: schema.importBatches.id });
  if (!batch) throw new Error('Could not create import batch.');

  const leadValues: Array<typeof schema.leads.$inferInsert> = [];
  if (plannedNew.length > 0) {
    const sequenceResult = await tx.execute(
      sql`SELECT nextval('crm.lead_number_seq') AS seq
          FROM generate_series(1, ${plannedNew.length}::integer)`
    );
    const sequenceRows =
      (sequenceResult as unknown as { rows?: Array<{ seq?: string | number }> }).rows ?? [];
    if (sequenceRows.length !== plannedNew.length) {
      throw new Error('Lead number sequence returned an unexpected row count.');
    }
    for (let index = 0; index < plannedNew.length; index += 1) {
      const candidate = plannedNew[index];
      const sequence = sequenceRows[index]?.seq;
      if (!candidate || sequence === undefined) {
        throw new Error('Lead number sequence returned no value.');
      }
      const tags = mergedTags([], [batchName, ...candidate.tags]);
      const journeyStage = hasLeadTag(tags, 'future') ? 'future' : 'new';
      leadValues.push({
        leadNumber: formatLeadNumber(typeof sequence === 'string' ? BigInt(sequence) : sequence),
        leadSequence:
          typeof sequence === 'string' ? Number.parseInt(sequence, 10) : Number(sequence),
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        email: candidate.email,
        linkedinUrl: candidate.linkedinUrl,
        linkedinProfileKey: canonicalLinkedIn(candidate.linkedinUrl),
        source: 'linkedin',
        status: 'new',
        journeyStage,
        outreachStatus: 'not_approached',
        notes: candidate.notes,
        sourceSheet: batchName,
        originalRowNumber: candidate.sourceRow,
        tags,
        ownerId,
        batchId: batch.id,
        idempotencyKey: `curated:${tagSlug(batchName)}:${canonicalLinkedIn(candidate.linkedinUrl)}`,
      });
    }
  }

  const createdLeads =
    leadValues.length > 0
      ? await tx
          .insert(schema.leads)
          .values(leadValues)
          .onConflictDoNothing()
          .returning({ id: schema.leads.id, journeyStage: schema.leads.journeyStage })
      : [];
  const createdLeadIds = createdLeads.map((lead) => lead.id);
  const activatedLeadIds = createdLeads
    .filter((lead) => lead.journeyStage !== 'future')
    .map((lead) => lead.id);

  if (activatedLeadIds.length > 0) {
    await tx.insert(schema.leadChannels).values(
      activatedLeadIds.map((leadId) => ({
        leadId,
        channel: 'linkedin' as const,
        stage: 'not_started' as const,
        sequence: 1,
        ownerId,
      }))
    );
  }

  await tx
    .update(schema.importBatches)
    .set({ importedCount: createdLeadIds.length })
    .where(eq(schema.importBatches.id, batch.id));

  const [verification] = await tx
    .select({
      imported: sql<number>`count(*)`,
      queued: sql<number>`count(${schema.leadScoreJobs.id})`,
    })
    .from(schema.leads)
    .leftJoin(schema.leadScoreJobs, eq(schema.leadScoreJobs.leadId, schema.leads.id))
    .where(and(eq(schema.leads.batchId, batch.id), isNull(schema.leads.deletedAt)));

  return {
    batchId: batch.id,
    created: createdLeadIds.length,
    taggedExisting,
    enrichedExisting,
    verifiedImported: Number(verification?.imported ?? 0),
    verifiedQueued: Number(verification?.queued ?? 0),
  };
})(db);

console.log(JSON.stringify({ ...summary, ...result }));
