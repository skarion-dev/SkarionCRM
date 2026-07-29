import { gunzipSync } from 'node:zlib';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@skarion/db-kit';
import * as schema from '../db/schema.js';
import { linkedinProfileKey } from '../lib/leadDedup.js';
import { formatLeadNumber } from '../lib/leadNumber.js';
import { normalizeTagNames, tagSlug } from '../lib/leadJourney.js';

type CuratedCandidate = {
  sourceRow: number;
  firstName: string;
  lastName: string;
  email: string | null;
  linkedinUrl: string;
  linkedinProfileKey: string;
  companyName: string | null;
  headline: string | null;
  location: string | null;
  experience: string | null;
  education: string | null;
  skills: string | null;
  currentRole: string | null;
  currentRoleDates: string | null;
  openToWork: boolean | null;
  yearsExperience: string | null;
  connectionDegree: string | null;
  sourceContext: Record<string, string | null>;
  notes: string | null;
  tags: string[];
};

type ExistingLead = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  linkedinUrl: string | null;
  linkedinProfileKey: string | null;
  companyName: string | null;
  headline: string | null;
  location: string | null;
  experience: string | null;
  education: string | null;
  skills: string | null;
  currentRole: string | null;
  currentRoleDates: string | null;
  openToWork: boolean | null;
  yearsExperience: string | null;
  connectionDegree: string | null;
  prospectSourceContext: unknown;
  profileCaptureStatus: string;
  notes: string | null;
  tags: unknown;
};

const databaseUrl = process.env.DATABASE_URL ?? '';
const payloadBase64 =
  process.env.CURATED_LEADS_PAYLOAD_B64 ||
  Array.from(
    { length: 30 },
    (_, index) => process.env[`CURATED_LEADS_PAYLOAD_${String(index + 1).padStart(2, '0')}`] ?? ''
  ).join('');
const ownerId = process.env.CURATED_LEADS_OWNER_ID ?? '';
const batchName = process.env.CURATED_LEADS_BATCH_NAME?.trim() || 'Curated Leads';
const mode = process.env.CURATED_LEADS_MODE === 'import' ? 'import' : 'dry-run';

if (!databaseUrl) throw new Error('DATABASE_URL is required.');
if (!payloadBase64) throw new Error('CURATED_LEADS_PAYLOAD_B64 is required.');
if (!/^[0-9a-f-]{36}$/i.test(ownerId)) throw new Error('A valid owner UUID is required.');

const candidates = JSON.parse(
  gunzipSync(Buffer.from(payloadBase64, 'base64')).toString('utf8')
) as CuratedCandidate[];
if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > 2_500) {
  throw new Error('Curated payload must contain between 1 and 2,500 candidates.');
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

function chunksOf<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

const db = getDb({ DATABASE_URL: databaseUrl }, schema);
const existingLeads = await db
  .select({
    id: schema.leads.id,
    firstName: schema.leads.firstName,
    lastName: schema.leads.lastName,
    email: schema.leads.email,
    linkedinUrl: schema.leads.linkedinUrl,
    linkedinProfileKey: schema.leads.linkedinProfileKey,
    companyName: schema.leads.companyName,
    headline: schema.leads.headline,
    location: schema.leads.location,
    experience: schema.leads.experience,
    education: schema.leads.education,
    skills: schema.leads.skills,
    currentRole: schema.leads.currentRole,
    currentRoleDates: schema.leads.currentRoleDates,
    openToWork: schema.leads.openToWork,
    yearsExperience: schema.leads.yearsExperience,
    connectionDegree: schema.leads.connectionDegree,
    prospectSourceContext: schema.leads.prospectSourceContext,
    profileCaptureStatus: schema.leads.profileCaptureStatus,
    notes: schema.leads.notes,
    tags: schema.leads.tags,
  })
  .from(schema.leads)
  .where(isNull(schema.leads.deletedAt));

const byLinkedIn = new Map<string, ExistingLead[]>();
const byName = new Map<string, ExistingLead[]>();
for (const lead of existingLeads) {
  pushToMap(byLinkedIn, lead.linkedinProfileKey ?? linkedinProfileKey(lead.linkedinUrl), lead);
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
  const linkMatches =
    byLinkedIn.get(
      candidate.linkedinProfileKey || linkedinProfileKey(candidate.linkedinUrl) || ''
    ) ?? [];
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
      ...candidate.tags.filter(
        (tag) =>
          tag.toLowerCase() !== 'needs profile capture' || lead.profileCaptureStatus !== 'captured'
      ),
    ]);
    const update: Partial<typeof schema.leads.$inferInsert> = {
      tags,
      updatedAt: new Date(),
    };
    let enriched = false;

    if (!lead.linkedinUrl && candidate.linkedinUrl) {
      update.linkedinUrl = candidate.linkedinUrl;
      update.linkedinProfileKey = candidate.linkedinProfileKey;
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
    const fill = <K extends keyof CuratedCandidate & keyof ExistingLead>(field: K) => {
      const existingValue = lead[field];
      const candidateValue = candidate[field];
      if (
        (existingValue === null || existingValue === undefined || existingValue === '') &&
        candidateValue !== null &&
        candidateValue !== undefined &&
        candidateValue !== ''
      ) {
        (update as Record<string, unknown>)[field] = candidateValue;
        enriched = true;
      }
    };
    fill('companyName');
    fill('headline');
    fill('location');
    fill('experience');
    fill('education');
    fill('skills');
    fill('currentRole');
    fill('currentRoleDates');
    fill('openToWork');
    fill('yearsExperience');
    fill('connectionDegree');
    if (!lead.prospectSourceContext && candidate.sourceContext) {
      update.prospectSourceContext = candidate.sourceContext;
      enriched = true;
    }
    if (enriched) {
      update.profileNormalizationStatus = 'pending';
    }

    await tx.update(schema.leads).set(update).where(eq(schema.leads.id, lead.id));
    if (enriched) {
      await tx
        .insert(schema.leadProfileJobs)
        .values({ leadId: lead.id })
        .onConflictDoUpdate({
          target: schema.leadProfileJobs.leadId,
          set: {
            status: 'pending',
            nextAttemptAt: new Date(),
            lockedAt: null,
            completedAt: null,
            lastError: null,
            updatedAt: new Date(),
          },
        });
    }
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
      leadValues.push({
        leadNumber: formatLeadNumber(typeof sequence === 'string' ? BigInt(sequence) : sequence),
        leadSequence:
          typeof sequence === 'string' ? Number.parseInt(sequence, 10) : Number(sequence),
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        email: candidate.email,
        companyName: candidate.companyName,
        headline: candidate.headline,
        location: candidate.location,
        experience: candidate.experience,
        education: candidate.education,
        skills: candidate.skills,
        currentRole: candidate.currentRole,
        currentRoleDates: candidate.currentRoleDates,
        openToWork: candidate.openToWork,
        yearsExperience: candidate.yearsExperience,
        connectionDegree: candidate.connectionDegree,
        prospectSourceContext: candidate.sourceContext,
        linkedinUrl: candidate.linkedinUrl,
        linkedinProfileKey: candidate.linkedinProfileKey,
        source: 'linkedin',
        status: 'new',
        journeyStage: 'new',
        outreachStatus: 'not_approached',
        reviewState: 'pending',
        profileCaptureStatus: 'partial',
        profileNormalizationStatus: 'pending',
        notes: candidate.notes,
        sourceSheet: batchName,
        originalRowNumber: candidate.sourceRow,
        tags,
        ownerId,
        batchId: batch.id,
        idempotencyKey: `curated:${tagSlug(batchName)}:${candidate.linkedinProfileKey}`,
      });
    }
  }

  const createdLeads: Array<{ id: string }> = [];
  for (const leadChunk of chunksOf(leadValues, 150)) {
    const inserted = await tx
      .insert(schema.leads)
      .values(leadChunk)
      .onConflictDoNothing()
      .returning({ id: schema.leads.id });
    createdLeads.push(...inserted);
  }
  const createdLeadIds = createdLeads.map((lead) => lead.id);

  for (const leadIdChunk of chunksOf(createdLeadIds, 300)) {
    await tx
      .insert(schema.leadProfileJobs)
      .values(leadIdChunk.map((leadId) => ({ leadId })))
      .onConflictDoNothing({ target: schema.leadProfileJobs.leadId });
  }

  await tx
    .update(schema.importBatches)
    .set({ importedCount: createdLeadIds.length })
    .where(eq(schema.importBatches.id, batch.id));

  const [verification] = await tx
    .select({
      imported: sql<number>`count(*)`,
      queued: sql<number>`count(${schema.leadProfileJobs.id})`,
    })
    .from(schema.leads)
    .leftJoin(schema.leadProfileJobs, eq(schema.leadProfileJobs.leadId, schema.leads.id))
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
