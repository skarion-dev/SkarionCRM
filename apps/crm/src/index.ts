import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getDb, withAudit } from '@skarion/db-kit';
import { requireAuth, requireSuperadmin, type AuthedVariables } from '@skarion/auth-client';
import {
  AI_AGENTS,
  AI_MODELS,
  AI_PRICING_UPDATED_AT,
  DEFAULT_AI_MODELS,
  type AiAgentId,
  type AiGatewayEnv,
} from '@skarion/ai-toolkit';
import { can, canList } from '@skarion/permissions';
import { parseContactsCsv, parseCompaniesCsv, parseLeadsCsv } from '@skarion/importers';
import Papa from 'papaparse';
import readXlsxFile from 'read-excel-file/web-worker';
import * as schema from './db/schema.js';
import {
  eq,
  and,
  isNull,
  isNotNull,
  like,
  sql,
  desc,
  asc,
  or,
  ne,
  inArray,
  gte,
  lte,
  getTableColumns,
} from 'drizzle-orm';
import type { CrmDb } from './db/types.js';

// --- Rate Limiting (per-Worker instance, in-memory) ---
// For production scale, replace with Cloudflare KV or Durable Objects.
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimits = new Map<string, RateLimitEntry>();

function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (entry.count >= maxRequests) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count++;
  return { allowed: true };
}

import * as ai from './lib/ai-service.js';
import * as docConv from './lib/document-converter.js';
import { cleanMarkdownForAi, estimateTokens } from './lib/markdown-utils.js';
import {
  canonicalizeLinkedinUrl,
  linkedinProfileKey,
  normalizePhoneKey,
  isRealEmail,
  findExactMatch,
  buildLeadEnrichmentPatch,
  findNameEnrichmentCandidate,
} from './lib/leadDedup.js';
import { formatLeadNumber, nextLeadIdentity } from './lib/leadNumber.js';
import { buildLeadConditions, parseCommaList, resolveLeadSortColumn } from './lib/leadFilters.js';
import { shouldAutoGenerateLinkedinConnectionNote } from './lib/leadAutomation.js';
import {
  detectLinkedInExportKind,
  spreadsheetRowsToRecords,
  splitLinkedInDisplayName,
  summarizeLinkedInConversations,
  summarizeLinkedInInvitations,
  type LinkedInExportRow,
} from './lib/linkedinExport.js';
import {
  buildCeoSystemInstruction,
  parseCeoQuestion,
  type CeoReportingSnapshot,
  type ReportingSeriesItem,
} from './lib/ceo-reporting.js';
import {
  formatBatchTag,
  isLeadActivationStage,
  isLeadHoldingStage,
  isLeadJourneyStage,
  journeyStageForTags,
  journeyStageFromLegacy,
  LEAD_JOURNEY_STAGES,
  legacyFieldsForJourney,
  mergeJourneyWithChannelStages,
  normalizeTagNames,
  syncHoldingTagsForJourney,
  tagSlug,
  type LeadJourneyStage,
} from './lib/leadJourney.js';
import {
  ACTIVE_CONVERSATION_JOURNEY_STAGES,
  calculateLeadCompleteness,
  deriveProspectName,
  dispositionTag,
  findActiveLeadIdentityDuplicate,
  isProspectDisposition,
  normalizeProspectCsvRecord,
  type ProspectDisposition,
  type ProspectCsvRow,
} from './lib/prospects.js';
import {
  hasPhdProfileEvidence,
  phdZeroScoreAssessment,
  PHD_ZERO_SCORE_REASON,
} from './lib/leadQualificationPolicy.js';

async function ensureTagDefinitions(
  db: CrmDb,
  values: unknown,
  actorUserId: string,
  isSystem = false
): Promise<string[]> {
  const names = normalizeTagNames(values);
  for (const name of names) {
    const slug = tagSlug(name);
    if (!slug) continue;
    await db
      .insert(schema.tagDefinitions)
      .values({ name, slug, createdBy: actorUserId, isSystem })
      .onConflictDoNothing({ target: schema.tagDefinitions.slug });
  }
  return names;
}

async function unknownTagNames(db: CrmDb, values: unknown): Promise<string[]> {
  const names = normalizeTagNames(values);
  if (names.length === 0) return [];
  const definitions = await db
    .select({ name: schema.tagDefinitions.name })
    .from(schema.tagDefinitions);
  const known = new Set(definitions.map((tag) => tag.name.toLowerCase()));
  return names.filter((name) => !known.has(name.toLowerCase()));
}

const DEFAULT_WORKSPACE_ID = schema.DEFAULT_WORKSPACE_ID;

async function publishLeadEvent(
  db: CrmDb,
  eventType: string,
  actorUserId: string | null,
  lead: typeof schema.leads.$inferSelect
): Promise<void> {
  await db.insert(schema.leadEventOutbox).values({
    workspaceId: lead.workspaceId,
    leadId: lead.id,
    eventType,
    actorUserId,
    payload: {
      lead,
      occurredAt: new Date().toISOString(),
    },
  });
}

function profileString(profile: Record<string, unknown>, key: string): string | null {
  const value = profile[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function profileBoolean(profile: Record<string, unknown>, key: string): boolean | null {
  const value = profile[key];
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  if (/^(yes|true|1)$/i.test(value.trim())) return true;
  if (/^(no|false|0)$/i.test(value.trim())) return false;
  return null;
}

const PROFILE_NORMALIZATION_VERSION = 1;

function hasLeadProfileEvidence(lead: {
  source?: string | null;
  headline?: string | null;
  location?: string | null;
  about?: string | null;
  experience?: string | null;
  education?: string | null;
  skills?: string | null;
  currentRole?: string | null;
  currentRoleDates?: string | null;
  notes?: string | null;
}): boolean {
  return Boolean(
    hasPhdProfileEvidence(lead) ||
    lead.headline?.trim() ||
    lead.location?.trim() ||
    lead.about?.trim() ||
    lead.experience?.trim() ||
    lead.education?.trim() ||
    lead.skills?.trim() ||
    lead.currentRole?.trim() ||
    lead.currentRoleDates?.trim() ||
    (lead.source === 'linkedin' && lead.notes?.trim())
  );
}

function prospectHasPhdSql() {
  const document = sql<string>`lower(concat_ws(
    ' ',
    ${schema.leads.firstName},
    ${schema.leads.lastName},
    ${schema.leads.headline},
    ${schema.leads.about},
    ${schema.leads.experience},
    ${schema.leads.education},
    ${schema.leads.skills},
    ${schema.leads.currentRole},
    ${schema.leads.currentRoleDates},
    ${schema.leads.profileSummary},
    ${schema.leads.educationEntries}::text,
    ${schema.leads.experienceEntries}::text,
    ${schema.leads.notes}
  ))`;
  return sql<boolean>`(
    ${document} ~ '(^|[^[:alpha:]])ph[.]?[[:space:]]*d[.]?([^[:alpha:]]|$)'
    OR ${document} LIKE '%doctor of philosophy%'
  )`;
}

async function enqueueLeadScoring(db: CrmDb, leadId: string): Promise<void> {
  const now = new Date();
  await db
    .insert(schema.leadScoreJobs)
    .values({ leadId, status: 'pending', nextAttemptAt: now })
    .onConflictDoUpdate({
      target: schema.leadScoreJobs.leadId,
      set: {
        status: 'pending',
        nextAttemptAt: now,
        lockedAt: null,
        completedAt: null,
        lastError: null,
        updatedAt: now,
      },
    });
}

async function enqueueLeadProfileCleanup(db: CrmDb, leadId: string): Promise<void> {
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, leadId), isNull(schema.leads.deletedAt)))
    .limit(1);
  if (lead && hasPhdProfileEvidence(lead)) {
    await enforcePhdAutoDisqualification(db, lead, null);
    return;
  }

  const now = new Date();
  await db
    .insert(schema.leadProfileJobs)
    .values({ leadId, status: 'pending', nextAttemptAt: now })
    .onConflictDoUpdate({
      target: schema.leadProfileJobs.leadId,
      set: {
        status: 'pending',
        nextAttemptAt: now,
        lockedAt: null,
        completedAt: null,
        lastError: null,
        updatedAt: now,
      },
    });
  await db
    .update(schema.leads)
    .set({
      profileNormalizationStatus: 'pending',
      updatedAt: now,
    })
    .where(eq(schema.leads.id, leadId));
}

function structuredLeadQualificationInput(
  lead: typeof schema.leads.$inferSelect
): ai.LeadQualificationInput {
  return {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    companyName: lead.companyName,
    title: lead.headline,
    status: lead.journeyStage,
    source: lead.source,
    profileSummary: lead.profileSummary,
    education: Array.isArray(lead.educationEntries)
      ? (lead.educationEntries as ai.NormalizedEducationEntry[])
      : null,
    experience: Array.isArray(lead.experienceEntries)
      ? (lead.experienceEntries as ai.NormalizedExperienceEntry[])
      : null,
    skills: Array.isArray(lead.skillNames) ? (lead.skillNames as string[]) : null,
    currentRole: lead.currentRole,
    currentRoleDates: lead.currentRoleDates,
    openToWork: lead.openToWork,
    yearsExperience: lead.yearsExperience,
    connectionDegree: lead.connectionDegree,
    sourceContext:
      lead.prospectSourceContext && typeof lead.prospectSourceContext === 'object'
        ? (lead.prospectSourceContext as Record<string, unknown>)
        : null,
    notes: [
      lead.notes,
      !lead.profileSummary && lead.headline ? `Headline: ${lead.headline}` : null,
      !lead.profileSummary && lead.location ? `Location: ${lead.location}` : null,
      !lead.profileSummary && lead.about ? `About: ${lead.about}` : null,
      !lead.profileSummary && lead.experience ? `Experience: ${lead.experience}` : null,
      !lead.profileSummary && lead.education ? `Education: ${lead.education}` : null,
      !lead.profileSummary && lead.skills ? `Skills: ${lead.skills}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

async function normalizeAndSaveLeadProfile(
  db: CrmDb,
  lead: typeof schema.leads.$inferSelect,
  env: Env
): Promise<typeof schema.leads.$inferSelect> {
  if (!hasLeadProfileEvidence(lead)) return lead;
  if (hasPhdProfileEvidence(lead)) {
    return (await enforcePhdAutoDisqualification(db, lead, null)) ?? lead;
  }
  const current =
    lead.profileNormalizationStatus === 'completed' &&
    lead.profileNormalizationVersion >= PROFILE_NORMALIZATION_VERSION &&
    (!lead.lastCapturedAt ||
      (lead.profileNormalizedAt && lead.profileNormalizedAt >= lead.lastCapturedAt));
  if (current) return lead;

  await db
    .update(schema.leads)
    .set({ profileNormalizationStatus: 'processing', updatedAt: new Date() })
    .where(eq(schema.leads.id, lead.id));
  const aiEnv = await getConfiguredAiEnv(db, env, lead.ownerId);
  const normalized = await ai.normalizeLeadProfile(
    {
      name: `${lead.firstName} ${lead.lastName}`.trim(),
      headline: lead.headline,
      location: lead.location,
      about: lead.about,
      experience: lead.experience,
      education: lead.education,
      skills: lead.skills,
      currentRole: lead.currentRole,
      currentRoleDates: lead.currentRoleDates,
      openToWork: lead.openToWork,
      yearsExperience: lead.yearsExperience,
      legacyNotes: lead.source === 'linkedin' ? lead.notes : null,
    },
    aiEnv
  );
  if (!normalized) throw new Error(ai.AI_NOT_CONFIGURED_MSG);

  const now = new Date();
  const [updated] = await db
    .update(schema.leads)
    .set({
      profileSummary: normalized.summary,
      educationEntries: normalized.education,
      experienceEntries: normalized.experience,
      skillNames: normalized.skills,
      profileNormalizationWarnings: normalized.warnings,
      profileNormalizationStatus: 'completed',
      profileNormalizationVersion: PROFILE_NORMALIZATION_VERSION,
      profileNormalizedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.leads.id, lead.id))
    .returning();
  if (!updated) return lead;
  await publishLeadEvent(db, 'lead.profile_normalized', null, updated);
  // Profile cleanup and qualification are intentionally separate agents.
  // A completed cleanup hands the freshest structured profile to the scorer.
  await enqueueLeadScoring(db, updated.id);
  return updated;
}

function mergeLeadTags(existing: unknown, additions: string[], removals: string[] = []): string[] {
  const remove = new Set(removals.map((tag) => tag.toLowerCase()));
  return normalizeTagNames([
    ...(Array.isArray(existing) ? existing : []).filter(
      (tag): tag is string => typeof tag === 'string' && !remove.has(tag.toLowerCase())
    ),
    ...additions,
  ]);
}

async function reviewProspect(
  db: CrmDb,
  lead: typeof schema.leads.$inferSelect,
  actorUserId: string,
  disposition: ProspectDisposition,
  profile: Record<string, unknown> | null,
  expectedVersion?: number
): Promise<typeof schema.leads.$inferSelect> {
  if (expectedVersion && lead.rowVersion !== expectedVersion) {
    throw new Error('PROSPECT_VERSION_CONFLICT');
  }
  if (lead.reviewState !== 'pending' && lead.reviewDisposition === disposition && !profile) {
    return lead;
  }

  const now = new Date();
  const profileName = profileString(profile ?? {}, 'name');
  const name = profileName ? deriveProspectName(profileName, lead.linkedinUrl ?? '') : null;
  const companyName =
    profileString(profile ?? {}, 'companyName') ??
    profileString(profile ?? {}, 'currentCompanies')
      ?.split(',')[0]
      ?.trim() ??
    null;
  const headline = profileString(profile ?? {}, 'headline');
  const location = profileString(profile ?? {}, 'location');
  const about = profileString(profile ?? {}, 'about');
  const experience = profileString(profile ?? {}, 'experience');
  const education = profileString(profile ?? {}, 'education');
  const skills = profileString(profile ?? {}, 'skills');
  const currentRole = profileString(profile ?? {}, 'currentRole');
  const currentRoleDates = profileString(profile ?? {}, 'currentRoleDates');
  const openToWork = profileBoolean(profile ?? {}, 'openToWork');
  const yearsExperience = profileString(profile ?? {}, 'yearsExperience');
  const connectionDegree = profileString(profile ?? {}, 'connectionDegree');
  const phdDetected = hasPhdProfileEvidence({
    ...lead,
    firstName: name?.firstName ?? lead.firstName,
    lastName: name?.lastName ?? lead.lastName,
    headline: headline ?? lead.headline,
    about: about ?? lead.about,
    experience: experience ?? lead.experience,
    education: education ?? lead.education,
    skills: skills ?? lead.skills,
    currentRole: currentRole ?? lead.currentRole,
    currentRoleDates: currentRoleDates ?? lead.currentRoleDates,
  });
  const effectiveDisposition: ProspectDisposition = phdDetected ? 'disqualified' : disposition;
  const accepted = effectiveDisposition !== 'disqualified';
  const journeyStage: LeadJourneyStage =
    effectiveDisposition === 'disqualified'
      ? 'disqualified'
      : effectiveDisposition === 'future'
        ? 'future'
        : effectiveDisposition === 'foreign_national'
          ? 'foreign_national'
          : 'new';
  const legacy = legacyFieldsForJourney(journeyStage);
  const profileEvidence = Boolean(
    phdDetected ||
    headline ||
    location ||
    about ||
    experience ||
    education ||
    skills ||
    currentRole ||
    lead.notes
  );
  const linkedinUrl =
    canonicalizeLinkedinUrl(profileString(profile ?? {}, 'profileUrl')) ?? lead.linkedinUrl;
  const captureReceived = Boolean(profile);
  const tags = await ensureTagDefinitions(
    db,
    mergeLeadTags(
      lead.tags,
      [dispositionTag(effectiveDisposition)],
      [
        'Excellent Fit',
        'Worth Trying',
        'Maybe',
        'Future',
        'Foreign National',
        'Disqualified',
        ...(captureReceived ? ['needs profile capture'] : []),
      ]
    ),
    actorUserId
  );
  const completeness = calculateLeadCompleteness({
    firstName: name?.firstName ?? lead.firstName,
    lastName: name?.lastName ?? lead.lastName,
    linkedinUrl,
    companyName: companyName ?? lead.companyName,
    email: lead.email,
    phone: lead.phone,
    headline: headline ?? lead.headline,
    location: location ?? lead.location,
    about: about ?? lead.about,
  });

  if (profile) {
    const payloadText = JSON.stringify(profile);
    await db.insert(schema.leadProfileCaptures).values({
      workspaceId: lead.workspaceId,
      leadId: lead.id,
      capturedBy: actorUserId,
      payload: profile,
      payloadHash: await sha256Hex(payloadText),
    });
  }

  const [updated] = await db
    .update(schema.leads)
    .set({
      firstName: name?.firstName ?? lead.firstName,
      lastName: name?.lastName ?? lead.lastName,
      linkedinUrl,
      linkedinProfileKey: linkedinProfileKey(linkedinUrl),
      headline: headline ?? lead.headline,
      location: location ?? lead.location,
      about: about ?? lead.about,
      experience: experience ?? lead.experience,
      education: education ?? lead.education,
      skills: skills ?? lead.skills,
      currentRole: currentRole ?? lead.currentRole,
      currentRoleDates: currentRoleDates ?? lead.currentRoleDates,
      openToWork: openToWork ?? lead.openToWork,
      yearsExperience: yearsExperience ?? lead.yearsExperience,
      connectionDegree: connectionDegree ?? lead.connectionDegree,
      companyName: companyName ?? lead.companyName,
      reviewState: accepted ? 'accepted' : 'rejected',
      reviewDisposition: effectiveDisposition,
      reviewedAt: now,
      reviewedBy: actorUserId,
      profileCaptureStatus: captureReceived ? 'captured' : lead.profileCaptureStatus,
      lastCapturedAt: captureReceived ? now : lead.lastCapturedAt,
      profileNormalizationStatus: phdDetected
        ? 'not_queued'
        : captureReceived && profileEvidence
          ? 'pending'
          : lead.profileNormalizationStatus,
      profileNormalizationWarnings: phdDetected
        ? [PHD_ZERO_SCORE_REASON]
        : lead.profileNormalizationWarnings,
      dataCompleteness: completeness,
      rowVersion: sql`${schema.leads.rowVersion} + 1`,
      journeyStage,
      status: legacy.status,
      outreachStatus: legacy.outreachStatus,
      tags,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.leads.id, lead.id),
        expectedVersion ? eq(schema.leads.rowVersion, expectedVersion) : sql`true`
      )
    )
    .returning();
  if (!updated) throw new Error('PROSPECT_VERSION_CONFLICT');
  if (phdDetected) {
    await enforcePhdAutoDisqualification(db, updated, actorUserId);
  } else if (captureReceived && profileEvidence) {
    await enqueueLeadProfileCleanup(db, lead.id);
  }

  await db
    .delete(schema.prospectReviewClaims)
    .where(eq(schema.prospectReviewClaims.leadId, lead.id));
  if (accepted && !isLeadHoldingStage(journeyStage)) {
    await db
      .insert(schema.leadScoreJobs)
      .values({ leadId: lead.id })
      .onConflictDoNothing({ target: schema.leadScoreJobs.leadId });
    await autoCreateLeadChannels(db, updated);
  } else if (isLeadHoldingStage(journeyStage)) {
    await db
      .delete(schema.leadScoreJobs)
      .where(
        and(
          eq(schema.leadScoreJobs.leadId, lead.id),
          inArray(schema.leadScoreJobs.status, ['pending', 'failed'])
        )
      );
  }
  await withAudit(db, schema.auditLog, {
    actorUserId,
    action: accepted ? 'accept_prospect' : 'disqualify_prospect',
    resourceType: 'lead',
    resourceId: lead.id,
    before: lead,
    after: updated,
    app: 'crm',
  });
  await publishLeadEvent(db, 'prospect.reviewed', actorUserId, updated);
  return updated;
}

function chunksOf<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function processProspectImport(
  db: CrmDb,
  jobId: string,
  batch: typeof schema.importBatches.$inferSelect,
  actorUserId: string,
  candidates: ProspectCsvRow[],
  invalidRows: Array<{ row: number; error: string }>
): Promise<void> {
  try {
    await db
      .update(schema.prospectImportJobs)
      .set({ status: 'processing', processedRows: 0, updatedAt: new Date() })
      .where(eq(schema.prospectImportJobs.id, jobId));

    const existingByKey = new Map<
      string,
      {
        id: string;
        workspaceId: string;
        headline: string | null;
        location: string | null;
        about: string | null;
        experience: string | null;
        education: string | null;
        skills: string | null;
        currentRole: string | null;
        currentRoleDates: string | null;
        openToWork: boolean | null;
        yearsExperience: string | null;
        connectionDegree: string | null;
        prospectSourceContext: unknown;
        journeyStage: string;
      }
    >();
    for (const keyChunk of chunksOf(
      candidates.map((candidate) => candidate.linkedinProfileKey),
      400
    )) {
      const rows = await db
        .select({
          id: schema.leads.id,
          workspaceId: schema.leads.workspaceId,
          linkedinProfileKey: schema.leads.linkedinProfileKey,
          headline: schema.leads.headline,
          location: schema.leads.location,
          about: schema.leads.about,
          experience: schema.leads.experience,
          education: schema.leads.education,
          skills: schema.leads.skills,
          currentRole: schema.leads.currentRole,
          currentRoleDates: schema.leads.currentRoleDates,
          openToWork: schema.leads.openToWork,
          yearsExperience: schema.leads.yearsExperience,
          connectionDegree: schema.leads.connectionDegree,
          prospectSourceContext: schema.leads.prospectSourceContext,
          journeyStage: schema.leads.journeyStage,
        })
        .from(schema.leads)
        .where(
          and(
            eq(schema.leads.workspaceId, batch.workspaceId),
            inArray(schema.leads.linkedinProfileKey, keyChunk),
            isNull(schema.leads.deletedAt)
          )
        );
      for (const row of rows) {
        if (row.linkedinProfileKey) existingByKey.set(row.linkedinProfileKey, row);
      }
    }

    const activeConversationLeads = await db
      .select({
        id: schema.leads.id,
        firstName: schema.leads.firstName,
        lastName: schema.leads.lastName,
        email: schema.leads.email,
        phone: schema.leads.phone,
        companyName: schema.leads.companyName,
        linkedinProfileKey: schema.leads.linkedinProfileKey,
      })
      .from(schema.leads)
      .where(
        and(
          eq(schema.leads.workspaceId, batch.workspaceId),
          inArray(schema.leads.journeyStage, [...ACTIVE_CONVERSATION_JOURNEY_STAGES]),
          isNull(schema.leads.deletedAt)
        )
      );
    const discardedActiveDuplicateKeys = new Map<string, { leadId: string; reason: string }>();
    for (const candidate of candidates) {
      const exactExisting = existingByKey.get(candidate.linkedinProfileKey);
      if (
        exactExisting &&
        ACTIVE_CONVERSATION_JOURNEY_STAGES.includes(
          exactExisting.journeyStage as (typeof ACTIVE_CONVERSATION_JOURNEY_STAGES)[number]
        )
      ) {
        discardedActiveDuplicateKeys.set(candidate.linkedinProfileKey, {
          leadId: exactExisting.id,
          reason: 'linkedin',
        });
        continue;
      }
      if (exactExisting) continue;
      const identityDuplicate = findActiveLeadIdentityDuplicate(candidate, activeConversationLeads);
      if (identityDuplicate) {
        discardedActiveDuplicateKeys.set(candidate.linkedinProfileKey, {
          leadId: identityDuplicate.lead.id,
          reason: identityDuplicate.reason,
        });
      }
    }

    const newCandidates = candidates.filter(
      (candidate) =>
        !existingByKey.has(candidate.linkedinProfileKey) &&
        !discardedActiveDuplicateKeys.has(candidate.linkedinProfileKey)
    );
    const tagNames = await ensureTagDefinitions(db, [batch.name], actorUserId);
    const needsCaptureTag = await ensureTagDefinitions(
      db,
      ['needs profile capture'],
      actorUserId,
      true
    );
    const leadValues: Array<typeof schema.leads.$inferInsert> = [];
    if (newCandidates.length > 0) {
      const sequenceResult = await db.execute(
        sql`SELECT nextval('crm.lead_number_seq') AS seq
            FROM generate_series(1, ${newCandidates.length}::integer)`
      );
      const sequenceRows =
        (sequenceResult as unknown as { rows?: Array<{ seq?: string | number }> }).rows ?? [];
      if (sequenceRows.length !== newCandidates.length) {
        throw new Error('Lead number sequence returned an unexpected row count.');
      }
      for (let index = 0; index < newCandidates.length; index += 1) {
        const candidate = newCandidates[index];
        const rawSequence = sequenceRows[index]?.seq;
        if (!candidate || rawSequence === undefined) throw new Error('Missing lead sequence.');
        const sequence =
          typeof rawSequence === 'string' ? Number.parseInt(rawSequence, 10) : rawSequence;
        const hasProfile = hasLeadProfileEvidence({ source: 'linkedin', ...candidate });
        leadValues.push({
          workspaceId: batch.workspaceId,
          leadNumber: formatLeadNumber(sequence),
          leadSequence: sequence,
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          email: candidate.email,
          phone: candidate.phone,
          companyName: candidate.companyName,
          headline: candidate.headline,
          location: candidate.location,
          about: candidate.about,
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
          profileCaptureStatus: hasProfile ? 'partial' : 'not_captured',
          profileNormalizationStatus: hasProfile ? 'pending' : 'not_queued',
          dataCompleteness: calculateLeadCompleteness(candidate),
          notes: candidate.notes,
          sourceSheet: batch.name,
          originalRowNumber: candidate.sourceRow,
          tags: normalizeTagNames([...tagNames, ...(hasProfile ? [] : needsCaptureTag)]),
          ownerId: actorUserId,
          batchId: batch.id,
          idempotencyKey: `prospect-import:${batch.id}:${candidate.linkedinProfileKey}`,
        });
      }
    }

    const created: Array<{ id: string; linkedinProfileKey: string | null }> = [];
    for (const valueChunk of chunksOf(leadValues, 200)) {
      const rows = await db
        .insert(schema.leads)
        .values(valueChunk)
        .onConflictDoNothing()
        .returning({
          id: schema.leads.id,
          linkedinProfileKey: schema.leads.linkedinProfileKey,
          headline: schema.leads.headline,
          location: schema.leads.location,
          about: schema.leads.about,
          experience: schema.leads.experience,
          education: schema.leads.education,
          skills: schema.leads.skills,
          currentRole: schema.leads.currentRole,
          currentRoleDates: schema.leads.currentRoleDates,
          openToWork: schema.leads.openToWork,
          yearsExperience: schema.leads.yearsExperience,
          connectionDegree: schema.leads.connectionDegree,
          prospectSourceContext: schema.leads.prospectSourceContext,
        });
      created.push(...rows);
    }
    const createdByKey = new Map(
      created
        .filter((row): row is { id: string; linkedinProfileKey: string } =>
          Boolean(row.linkedinProfileKey)
        )
        .map((row) => [row.linkedinProfileKey, row.id])
    );
    const unresolvedKeys = candidates
      .map((candidate) => candidate.linkedinProfileKey)
      .filter(
        (key) =>
          !existingByKey.has(key) &&
          !createdByKey.has(key) &&
          !discardedActiveDuplicateKeys.has(key)
      );
    for (const keyChunk of chunksOf(unresolvedKeys, 400)) {
      if (keyChunk.length === 0) continue;
      const racedRows = await db
        .select({
          id: schema.leads.id,
          workspaceId: schema.leads.workspaceId,
          linkedinProfileKey: schema.leads.linkedinProfileKey,
          headline: schema.leads.headline,
          location: schema.leads.location,
          about: schema.leads.about,
          experience: schema.leads.experience,
          education: schema.leads.education,
          skills: schema.leads.skills,
          currentRole: schema.leads.currentRole,
          currentRoleDates: schema.leads.currentRoleDates,
          openToWork: schema.leads.openToWork,
          yearsExperience: schema.leads.yearsExperience,
          connectionDegree: schema.leads.connectionDegree,
          prospectSourceContext: schema.leads.prospectSourceContext,
          journeyStage: schema.leads.journeyStage,
        })
        .from(schema.leads)
        .where(
          and(
            eq(schema.leads.workspaceId, batch.workspaceId),
            inArray(schema.leads.linkedinProfileKey, keyChunk),
            isNull(schema.leads.deletedAt)
          )
        );
      for (const row of racedRows) {
        if (row.linkedinProfileKey) existingByKey.set(row.linkedinProfileKey, row);
      }
    }

    const candidateByKey = new Map(
      candidates.map((candidate) => [candidate.linkedinProfileKey, candidate])
    );
    const cleanupLeadIds = new Set<string>();
    for (const [profileKey, existing] of existingByKey) {
      if (discardedActiveDuplicateKeys.has(profileKey)) continue;
      const candidate = candidateByKey.get(profileKey);
      if (!candidate || !hasLeadProfileEvidence({ source: 'linkedin', ...candidate })) continue;
      const [enriched] = await db
        .update(schema.leads)
        .set({
          headline: existing.headline || candidate.headline,
          location: existing.location || candidate.location,
          about: existing.about || candidate.about,
          experience: existing.experience || candidate.experience,
          education: existing.education || candidate.education,
          skills: existing.skills || candidate.skills,
          currentRole: existing.currentRole || candidate.currentRole,
          currentRoleDates: existing.currentRoleDates || candidate.currentRoleDates,
          openToWork: existing.openToWork ?? candidate.openToWork,
          yearsExperience: existing.yearsExperience || candidate.yearsExperience,
          connectionDegree: existing.connectionDegree || candidate.connectionDegree,
          prospectSourceContext: existing.prospectSourceContext ?? candidate.sourceContext,
          profileCaptureStatus: 'partial',
          profileNormalizationStatus: 'pending',
          updatedAt: new Date(),
        })
        .where(eq(schema.leads.id, existing.id))
        .returning({ id: schema.leads.id });
      if (enriched) cleanupLeadIds.add(enriched.id);
    }
    for (const candidate of newCandidates) {
      if (!hasLeadProfileEvidence({ source: 'linkedin', ...candidate })) continue;
      const leadId = createdByKey.get(candidate.linkedinProfileKey);
      if (leadId) cleanupLeadIds.add(leadId);
    }
    for (const leadId of cleanupLeadIds) {
      await enqueueLeadProfileCleanup(db, leadId);
    }
    const memberships = candidates
      .map((candidate) => {
        if (discardedActiveDuplicateKeys.has(candidate.linkedinProfileKey)) return null;
        const leadId =
          existingByKey.get(candidate.linkedinProfileKey)?.id ??
          createdByKey.get(candidate.linkedinProfileKey);
        return leadId
          ? {
              workspaceId: batch.workspaceId,
              leadId,
              batchId: batch.id,
              sourceRow: candidate.sourceRow,
            }
          : null;
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    for (const membershipChunk of chunksOf(memberships, 300)) {
      await db.insert(schema.leadImportMemberships).values(membershipChunk).onConflictDoNothing();
    }

    const duplicateCount = candidates.length - created.length;
    await db
      .update(schema.importBatches)
      .set({ importedCount: created.length, duplicatesSkipped: duplicateCount })
      .where(eq(schema.importBatches.id, batch.id));
    await db
      .update(schema.prospectImportJobs)
      .set({
        status: 'completed',
        processedRows: candidates.length + invalidRows.length,
        createdCount: created.length,
        duplicateCount,
        invalidCount: invalidRows.length,
        errorRows: [
          ...invalidRows,
          ...candidates
            .filter((candidate) => discardedActiveDuplicateKeys.has(candidate.linkedinProfileKey))
            .map((candidate) => {
              const duplicate = discardedActiveDuplicateKeys.get(candidate.linkedinProfileKey);
              return {
                row: candidate.sourceRow,
                error: `Discarded: already active in CRM (${duplicate?.reason ?? 'duplicate'}, lead ${duplicate?.leadId ?? 'unknown'}).`,
              };
            }),
        ],
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.prospectImportJobs.id, jobId));
    await db.insert(schema.leadEventOutbox).values({
      workspaceId: batch.workspaceId,
      eventType: 'prospect.import.completed',
      actorUserId,
      payload: {
        jobId,
        batchId: batch.id,
        createdCount: created.length,
        duplicateCount,
        discardedActiveDuplicateCount: discardedActiveDuplicateKeys.size,
        invalidCount: invalidRows.length,
      },
    });
  } catch (error) {
    await db
      .update(schema.prospectImportJobs)
      .set({
        status: 'failed',
        errorRows: [
          ...invalidRows,
          { row: 0, error: error instanceof Error ? error.message : 'Import failed.' },
        ],
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.prospectImportJobs.id, jobId));
    throw error;
  }
}

// --- Outreach status summary ---
// Ranks a lead's channel stages and maps the "best" one back to the legacy
// leads.outreachStatus value that the UI tabs depend on.

const LEAD_CHANNEL_STAGE_RANK: Record<string, number> = {
  not_started: 0,
  warm_up_needed: 1,
  connection_request_sent: 2,
  connection_accepted: 3,
  message_sent: 4,
  awaiting_reply: 5,
  in_conversation: 6,
  replied: 7,
  booked_call: 8,
  no_response: -1,
};

const STAGE_TO_OUTREACH_STATUS: Record<string, string> = {
  not_started: 'not_approached',
  warm_up_needed: 'not_approached',
  connection_request_sent: 'connection_request_sent',
  connection_accepted: 'approached',
  message_sent: 'approached',
  awaiting_reply: 'approached',
  in_conversation: 'connected',
  replied: 'replied',
  booked_call: 'booked_call',
  no_response: 'not_interested',
};

/**
 * Compute the best (highest-ranked non-`no_response`) stage across a lead's
 * channels and map it to a legacy `outreachStatus` value. If every channel is
 * `no_response`, returns `not_interested`.
 */
export function computeOutreachSummary(channels: { stage: string }[]): string {
  if (channels.length === 0) return 'not_approached';
  let bestStage: string | null = null;
  let bestRank = -Infinity;
  let allNoResponse = true;
  for (const ch of channels) {
    if (ch.stage !== 'no_response') allNoResponse = false;
    if (ch.stage === 'no_response') continue;
    const rank = LEAD_CHANNEL_STAGE_RANK[ch.stage] ?? -1;
    if (rank > bestRank) {
      bestRank = rank;
      bestStage = ch.stage;
    }
  }
  if (bestStage === null) {
    return allNoResponse ? 'not_interested' : 'not_approached';
  }
  return STAGE_TO_OUTREACH_STATUS[bestStage] ?? 'not_approached';
}
interface Env extends AiGatewayEnv {
  DATABASE_URL: string;
  JWT_SECRET: string;
  APP_URL: string;
  RESEND_API_KEY?: string;
  WORKFLOW_RUNNER_URL?: string;
  WORKFLOW_RUNNER_SECRET?: string;
  AI_PROVIDER?: string;
  AI_GATEWAY_BASE_URL?: string;
  AI_GATEWAY_API_KEY?: string;
  AI_MODEL_DEFAULT?: string;
  AI_MODEL_REASONING?: string;
  AI_MODEL_CHEAP?: string;
  AI_MODEL_FALLBACK?: string;
  AI_EMBEDDING_MODEL?: string;
  AI_AGENT_MODELS?: string;
  GOOGLE_API_KEY?: string;
  GOOGLE_MODEL?: string;
  GOOGLE_FALLBACK_MODEL?: string;
  GOOGLE_CHAT_MODEL?: string;
  GOOGLE_EMBEDDING_MODEL?: string;
  /** External document converter service (MarkItDown-based). Optional — falls back to local PDF text extractor if not set. */
  DOCUMENT_CONVERTER_URL?: string;
  /** Shared secret for converter auth. Optional — if not set, converter calls are unauthenticated (dev only). */
  DOCUMENT_CONVERTER_SECRET?: string;
  /** Max chars to send to AI from converted documents. Default 50000. */
  DOCUMENT_AI_MAX_CHARS?: string;
  /** Git branch name, set by deploy workflow. Optional for debug endpoints. */
  GIT_BRANCH?: string;
  /** Git commit SHA, set by deploy workflow. Optional for debug endpoints. */
  GIT_COMMIT_SHA?: string;
  /** Comma-separated list of allowed CORS origins. */
  ALLOWED_ORIGINS?: string;
  /** R2 bucket for lead attachments (resumes, screenshots, etc.). */
  ATTACHMENTS_BUCKET?: R2Bucket;
}

/** Send email via Resend API (if configured, otherwise log to console). */
async function sendEmail(env: Env, to: string, subject: string, html: string) {
  if (!env.RESEND_API_KEY) {
    console.log(`[EMAIL_STUB] to=${to} subject="${subject}" — not sent (Resend not configured)`);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({ from: 'Skarion CRM <noreply@skarion.com>', to, subject, html }),
    });
    if (!res.ok) {
      console.error('Resend email failed:', await res.text());
    } else {
      console.log(`[EMAIL_SENT] to=${to} subject="${subject}"`);
    }
  } catch (err) {
    console.error('Email send error:', err);
  }
}

/** Create a notification for a user. */
async function createNotification(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  userId: string,
  type: string,
  title: string,
  message: string,
  resourceType?: string,
  resourceId?: string
) {
  try {
    await db.insert(schema.notifications).values({
      userId,
      type,
      title,
      message,
      resourceType: resourceType ?? null,
      resourceId: resourceId ?? null,
    });
  } catch (err) {
    console.error('Notification creation failed:', err);
  }
}

/** Trigger workflow event evaluation (stub if WORKFLOW_RUNNER_URL not set). */
async function triggerWorkflowEvent(env: Env, trigger: string, payload: Record<string, unknown>) {
  if (!env.WORKFLOW_RUNNER_URL) {
    console.log(`[WORKFLOW_STUB] trigger=${trigger} payload=${JSON.stringify(payload)}`);
    return;
  }
  try {
    await fetch(`${env.WORKFLOW_RUNNER_URL}/evaluate-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger, payload }),
    });
  } catch (err) {
    console.error('Workflow event trigger failed:', err);
  }
}

function isAllowedOrigin(origin: string, appUrl: string, allowedOriginsEnv?: string): boolean {
  if (!origin) return false;
  if (origin === appUrl) return true;
  if (origin.endsWith('.skarion.com')) return true;
  // Allow known Cloudflare Pages/Workers origins (shared-domain stopgap until custom domains)
  const knownCloudflareOrigins = new Set([
    'https://skarion-crm-cv9.pages.dev',
    'https://skarion-identity-login-4hu.pages.dev',
    'https://skarion-identity-admin-dx5.pages.dev',
    'https://skarion-identity.skarion-talentos.workers.dev',
    'https://skarion-crm-platform.skarion-talentos.workers.dev',
  ]);
  if (knownCloudflareOrigins.has(origin)) return true;
  if (origin.startsWith('http://localhost:')) return true;
  if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://'))
    return true;
  if (allowedOriginsEnv) {
    const origins = allowedOriginsEnv.split(',').map((o) => o.trim());
    if (origins.includes(origin)) return true;
  }
  return false;
}

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

app.use(
  '*',
  cors({
    origin: (origin, c) =>
      isAllowedOrigin(origin, c.env.APP_URL, c.env.ALLOWED_ORIGINS) ? origin : '',
    credentials: true,
  })
);

app.use('*', async (c, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (origin && !isAllowedOrigin(origin, c.env.APP_URL, c.env.ALLOWED_ORIGINS)) {
      return c.json({ error: 'CSRF: Invalid origin.' }, 403);
    }
  }
  await next();
});

app.get('/health', (c) => c.json({ status: 'ok', service: 'skarion-crm-platform' }));

app.get('/api/debug/version', (c) => {
  const branch = c.env.GIT_BRANCH ?? 'cloudflare-platform-rewrite';
  const commit = c.env.GIT_COMMIT_SHA ?? 'unknown';
  return c.json({
    app: 'crm',
    branch,
    commit,
    deployedAt: new Date().toISOString(),
    environment: 'production',
  });
});

// ─────────────────────────────────────────────────────────
// EXTENSION INGEST — LinkedIn profile-capture browser extension
//
// Deliberately mounted outside /api/* so the `requireAuth` JWT middleware
// below does not apply: the extension has no session, it authenticates with
// a long-lived key from identity.api_keys (issued via the identity admin
// UI's API Keys page, apps/identity/admin/src/pages/ApiKeysList.tsx).
//
// Key checking is enforced (requireKey = true below) - a missing or
// unrecognised key is rejected outright, no anonymous-write fallback.
// ─────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Reads the extension's key from either `Authorization: Bearer …` or `X-Api-Key`. */
function readExtensionKey(c: { req: { header: (name: string) => string | undefined } }): string {
  const header = c.req.header('Authorization');
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return (c.req.header('X-Api-Key') ?? '').trim();
}

/**
 * Maps an extension API key to the identity user it was issued to, bumping
 * last_used_at on a hit. Returns null when the key is absent, unknown, or
 * revoked — the caller decides whether to fall back or reject.
 *
 * Uses raw SQL because identity.api_keys lives in the identity schema, which
 * this Worker's Drizzle client isn't bound to.
 */
async function resolveExtensionKeyOwner(
  db: CrmDb,
  key: string
): Promise<{ userId: string; email: string } | null> {
  if (!key) return null;
  const keyHash = await sha256Hex(key);
  const res = await db.execute(sql`
    SELECT id, user_id, email
    FROM identity.api_keys
    WHERE key_hash = ${keyHash} AND revoked_at IS NULL
    LIMIT 1
  `);
  const rows = (res as unknown as { rows?: Record<string, unknown>[] }).rows ?? [];
  const row = rows[0];
  if (!row) return null;
  await db.execute(sql`
    UPDATE identity.api_keys SET last_used_at = now() WHERE id = ${row.id as string}
  `);
  return { userId: row.user_id as string, email: row.email as string };
}

async function enrichExtensionLead(
  db: CrmDb,
  existing: typeof schema.leads.$inferSelect,
  body: Record<string, unknown>,
  linkedinUrl: string | null,
  actorUserId: string
): Promise<{
  lead: typeof schema.leads.$inferSelect;
  enrichedFields: string[];
}> {
  const { patch, enrichedFields } = buildLeadEnrichmentPatch(existing, {
    firstName: typeof body.firstName === 'string' ? body.firstName : undefined,
    lastName: typeof body.lastName === 'string' ? body.lastName : undefined,
    email: typeof body.email === 'string' ? body.email : null,
    phone: typeof body.phone === 'string' ? body.phone : null,
    companyName: typeof body.companyName === 'string' ? body.companyName : null,
    companyDomain: typeof body.companyDomain === 'string' ? body.companyDomain : null,
    linkedinUrl,
    notes: typeof body.notes === 'string' ? body.notes : null,
    tags: body.tags,
  });
  if (enrichedFields.length === 0) {
    await linkImportedLinkedInConversationsToLead(db, existing);
    return { lead: existing, enrichedFields };
  }
  const databasePatch = {
    ...patch,
    ...(typeof patch.linkedinUrl === 'string'
      ? { linkedinProfileKey: linkedinProfileKey(patch.linkedinUrl) }
      : {}),
  };

  const [lead] = await db
    .update(schema.leads)
    .set({ ...databasePatch, updatedAt: new Date() })
    .where(eq(schema.leads.id, existing.id))
    .returning();
  if (!lead) return { lead: existing, enrichedFields: [] };

  let finalLead = lead;
  if (hasPhdProfileEvidence(lead)) {
    finalLead = (await enforcePhdAutoDisqualification(db, lead, actorUserId)) ?? lead;
  } else if (hasLeadProfileEvidence(lead)) {
    await enqueueLeadProfileCleanup(db, lead.id);
  }
  await linkImportedLinkedInConversationsToLead(db, finalLead);
  await withAudit(db, schema.auditLog, {
    actorUserId,
    action: 'enrich',
    resourceType: 'lead',
    resourceId: lead.id,
    before: existing,
    after: { ...finalLead, enrichedFields, source: 'linkedin-extension' },
    app: 'crm',
  });
  return { lead: finalLead, enrichedFields };
}

async function linkImportedLinkedInConversationsToLead(
  db: CrmDb,
  lead: typeof schema.leads.$inferSelect
): Promise<void> {
  const linkedinUrl = canonicalizeLinkedinUrl(lead.linkedinUrl);
  if (!linkedinUrl) return;

  await db
    .update(schema.linkedinConversations)
    .set({ leadId: lead.id, updatedAt: new Date() })
    .where(
      and(
        isNull(schema.linkedinConversations.leadId),
        eq(sql`lower(${schema.linkedinConversations.otherPartyProfileUrl})`, linkedinUrl)
      )
    );
}

/**
 * Preflight check the extension calls before showing its send button as
 * live — lets the user see "already exists" and back out instead of finding
 * out only after (or never, since the old flow never surfaced it) sending.
 */
app.post('/extension/leads/check', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const key = readExtensionKey(c);
  const resolved = await resolveExtensionKeyOwner(db, key);
  if (!resolved) {
    return c.json({ error: 'Invalid or missing API key.' }, 401);
  }

  const body = await c.req.json();
  const linkedinUrl = canonicalizeLinkedinUrl(body.linkedinUrl);
  const email = isRealEmail(body.email) ? body.email.trim().toLowerCase() : null;
  const phone = normalizePhoneKey(body.phone);

  const exact = await findExactMatch(db, { linkedinUrl, email, phone });
  if (exact) {
    if (exact.entityType === 'lead') {
      const { enrichedFields } = buildLeadEnrichmentPatch(exact.record, {
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: body.phone,
        companyName: body.companyName,
        companyDomain: body.companyDomain,
        linkedinUrl,
        notes: body.notes,
        tags: body.tags,
      });
      return c.json({
        status: 'exact_duplicate',
        matchType: exact.matchType,
        entityType: exact.entityType,
        record: exact.record,
        enrichmentAvailable: enrichedFields.length > 0,
        enrichedFields,
      });
    }
    return c.json({
      status: 'exact_duplicate',
      matchType: exact.matchType,
      entityType: exact.entityType,
      record: exact.record,
    });
  }

  const enrichmentCandidate = await findNameEnrichmentCandidate(db, {
    firstName: String(body.firstName ?? ''),
    lastName: String(body.lastName ?? ''),
    companyName: typeof body.companyName === 'string' ? body.companyName : null,
    linkedinUrl,
  });
  if (enrichmentCandidate) {
    const { enrichedFields } = buildLeadEnrichmentPatch(enrichmentCandidate, {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone,
      companyName: body.companyName,
      companyDomain: body.companyDomain,
      linkedinUrl,
      notes: body.notes,
      tags: body.tags,
    });
    return c.json({
      status: 'enrichment_available',
      matchType: 'name',
      entityType: 'lead',
      record: enrichmentCandidate,
      enrichedFields,
    });
  }

  // Same name at the same company is a warning, not a block — a human
  // decides, since names collide and company names are scraped/free-typed.
  let possibleMatches: unknown[] = [];
  if (body.firstName && body.lastName && body.companyName) {
    possibleMatches = await db
      .select()
      .from(schema.leads)
      .where(
        and(
          eq(sql`lower(${schema.leads.firstName})`, String(body.firstName).trim().toLowerCase()),
          eq(sql`lower(${schema.leads.lastName})`, String(body.lastName).trim().toLowerCase()),
          eq(
            sql`lower(${schema.leads.companyName})`,
            String(body.companyName).trim().toLowerCase()
          ),
          isNull(schema.leads.deletedAt)
        )
      )
      .limit(5);
  }
  if (possibleMatches.length > 0) {
    return c.json({ status: 'possible_duplicate', matches: possibleMatches });
  }

  return c.json({ status: 'new' });
});

app.post('/extension/leads', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;

  const key = readExtensionKey(c);
  const resolved = await resolveExtensionKeyOwner(db, key);

  if (!resolved) {
    return c.json({ error: 'Invalid or missing API key.' }, 401);
  }
  const ownerId = resolved.userId;

  const body = await c.req.json();
  const displayName = `${body.firstName ?? ''} ${body.lastName ?? ''}`.trim();
  const linkedinUrl = canonicalizeLinkedinUrl(body.linkedinUrl);
  if (!displayName || (!linkedinUrl && !isRealEmail(body.email))) {
    return c.json(
      { error: 'A name plus at least a LinkedIn URL or a real email is required.' },
      400
    );
  }

  // Idempotency: a retried POST (e.g. after a client-side network timeout)
  // carries the same key as the original attempt — replay that lead instead
  // of creating a second one, independent of whether the dedup checks below
  // would have caught it (they may not, if the retry's payload differs
  // slightly from what actually got committed).
  const idempotencyKey = c.req.header('X-Idempotency-Key')?.trim() || null;
  if (idempotencyKey) {
    const [prior] = await db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.idempotencyKey, idempotencyKey))
      .limit(1);
    if (prior) {
      const enriched = await enrichExtensionLead(db, prior, body, linkedinUrl, ownerId);
      const [aiAssessment] = await db
        .select()
        .from(schema.leadAiAssessments)
        .where(eq(schema.leadAiAssessments.leadId, prior.id));
      return c.json(
        {
          lead: enriched.lead,
          aiAssessment: aiAssessment ?? null,
          ownerId: enriched.lead.ownerId,
          duplicate: true,
          replayed: true,
          enriched: enriched.enrichedFields.length > 0,
          enrichedFields: enriched.enrichedFields,
        },
        200
      );
    }
  }

  const email = isRealEmail(body.email) ? body.email.trim().toLowerCase() : null;
  const phone = normalizePhoneKey(body.phone);

  const exact = await findExactMatch(db, { linkedinUrl, email, phone });
  if (exact) {
    if (exact.entityType === 'contact') {
      return c.json(
        {
          duplicate: true,
          entityType: 'contact',
          contact: exact.record,
          matchType: exact.matchType,
        },
        200
      );
    }
    const enriched = await enrichExtensionLead(db, exact.record, body, linkedinUrl, ownerId);
    const [aiAssessment] = await db
      .select()
      .from(schema.leadAiAssessments)
      .where(eq(schema.leadAiAssessments.leadId, exact.record.id));
    return c.json(
      {
        lead: enriched.lead,
        aiAssessment: aiAssessment ?? null,
        ownerId: enriched.lead.ownerId,
        duplicate: true,
        enriched: enriched.enrichedFields.length > 0,
        enrichedFields: enriched.enrichedFields,
      },
      200
    );
  }

  const enrichmentCandidate = await findNameEnrichmentCandidate(db, {
    firstName: String(body.firstName ?? ''),
    lastName: String(body.lastName ?? ''),
    companyName: typeof body.companyName === 'string' ? body.companyName : null,
    linkedinUrl,
  });
  if (enrichmentCandidate) {
    const enriched = await enrichExtensionLead(db, enrichmentCandidate, body, linkedinUrl, ownerId);
    const [aiAssessment] = await db
      .select()
      .from(schema.leadAiAssessments)
      .where(eq(schema.leadAiAssessments.leadId, enrichmentCandidate.id));
    return c.json(
      {
        lead: enriched.lead,
        aiAssessment: aiAssessment ?? null,
        ownerId: enriched.lead.ownerId,
        duplicate: true,
        matchedBy: 'name',
        enriched: enriched.enrichedFields.length > 0,
        enrichedFields: enriched.enrichedFields,
      },
      200
    );
  }

  const extensionBaseJourneyStage = journeyStageFromLegacy({
    status: typeof body.status === 'string' ? body.status : 'new',
    outreachStatus:
      typeof body.outreachStatus === 'string' ? body.outreachStatus : 'not_approached',
  });
  const extensionTags = await ensureTagDefinitions(db, body.tags, ownerId);
  const extensionJourneyStage = journeyStageForTags(extensionBaseJourneyStage, extensionTags);
  const extensionLegacy = legacyFieldsForJourney(extensionJourneyStage);
  const extensionIdentity = await nextLeadIdentity(db);
  const data = {
    ...extensionIdentity,
    workspaceId: DEFAULT_WORKSPACE_ID,
    firstName: String(body.firstName ?? '').trim() || displayName,
    lastName: String(body.lastName ?? '').trim(),
    email,
    phone: body.phone ? String(body.phone) : null,
    companyName: body.companyName ?? null,
    companyDomain: body.companyDomain ?? null,
    linkedinUrl,
    linkedinProfileKey: linkedinProfileKey(linkedinUrl),
    outreachStatus: extensionLegacy.outreachStatus,
    tags: extensionTags.length > 0 ? extensionTags : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    source: (body.source ?? 'linkedin') as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: extensionLegacy.status as any,
    journeyStage: extensionJourneyStage,
    notes: body.notes ?? null,
    ownerId,
    idempotencyKey,
  };

  let result;
  try {
    [result] = await db.insert(schema.leads).values(data).returning();
  } catch (err) {
    // Unique-constraint safety net for the SELECT-then-INSERT race: two
    // near-simultaneous captures of the same profile can both pass the
    // findExactMatch check above before either commits. If the DB rejects
    // this insert as a duplicate, the other request won — fetch and return
    // what it created instead of surfacing a 500.
    const code =
      (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
      (err as { code?: string })?.code;
    if (code === '23505') {
      const raced = await findExactMatch(db, { linkedinUrl, email, phone });
      if (raced && raced.entityType === 'lead') {
        const enriched = await enrichExtensionLead(db, raced.record, body, linkedinUrl, ownerId);
        const [aiAssessment] = await db
          .select()
          .from(schema.leadAiAssessments)
          .where(eq(schema.leadAiAssessments.leadId, raced.record.id));
        return c.json(
          {
            lead: enriched.lead,
            aiAssessment: aiAssessment ?? null,
            ownerId: enriched.lead.ownerId,
            duplicate: true,
            enriched: enriched.enrichedFields.length > 0,
            enrichedFields: enriched.enrichedFields,
          },
          200
        );
      }
    }
    throw err;
  }
  if (!result) return c.json({ error: 'Internal error' }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: ownerId,
    action: 'create',
    resourceType: 'lead',
    resourceId: result.id,
    after: { ...data, capturedVia: 'linkedin-extension', keyAttributed: !!resolved },
    app: 'crm',
  });
  let finalResult = result;
  if (hasPhdProfileEvidence(result)) {
    finalResult = (await enforcePhdAutoDisqualification(db, result, ownerId)) ?? result;
  }
  await linkImportedLinkedInConversationsToLead(db, finalResult);

  // Keep lead_channels in step with the lead — the Leads UI derives its
  // outreach tabs from these rows.
  if (finalResult.reviewState !== 'rejected' && !isLeadHoldingStage(finalResult.journeyStage)) {
    c.executionCtx.waitUntil(autoCreateLeadChannels(db, finalResult).catch(() => {}));
  }

  let aiAssessment = null;
  if (shouldAutoGenerateLinkedinConnectionNote(finalResult)) {
    try {
      aiAssessment = await generateAndSaveLeadAiAssessment(db, finalResult, c.env);
    } catch (error) {
      console.error('LinkedIn lead AI assessment failed:', error);
    }
  }

  return c.json(
    {
      lead: finalResult,
      aiAssessment,
      ownerId,
      keyAttributed: !!resolved,
      ownerEmail: resolved?.email ?? null,
    },
    201
  );
});

app.post('/extension/prospects/resolve', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const resolved = await resolveExtensionKeyOwner(db, readExtensionKey(c));
  if (!resolved) return c.json({ error: 'Invalid or missing API key.' }, 401);
  const rateLimit = checkRateLimit(`extension:prospects:resolve:${resolved.userId}`, 180, 60_000);
  if (!rateLimit.allowed) {
    c.header('Retry-After', String(rateLimit.retryAfter));
    return c.json({ error: 'Too many extension requests. Please wait and retry.' }, 429);
  }
  const body = await c.req.json();
  const profileKey = linkedinProfileKey(body.linkedinUrl);
  if (!profileKey) return c.json({ error: 'A valid LinkedIn profile URL is required.' }, 400);

  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(
      and(
        eq(schema.leads.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(schema.leads.linkedinProfileKey, profileKey),
        isNull(schema.leads.deletedAt)
      )
    )
    .limit(1);
  return c.json({ lead: lead ?? null, found: Boolean(lead) });
});

app.post('/extension/prospects/review', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const resolved = await resolveExtensionKeyOwner(db, readExtensionKey(c));
  if (!resolved) return c.json({ error: 'Invalid or missing API key.' }, 401);
  const rateLimit = checkRateLimit(`extension:prospects:review:${resolved.userId}`, 120, 60_000);
  if (!rateLimit.allowed) {
    c.header('Retry-After', String(rateLimit.retryAfter));
    return c.json({ error: 'Too many extension reviews. Please wait and retry.' }, 429);
  }
  const body = (await c.req.json()) as Record<string, unknown>;
  if (!isProspectDisposition(body.disposition)) {
    return c.json({ error: 'Choose a valid review decision.' }, 400);
  }
  const profile =
    body.profile && typeof body.profile === 'object'
      ? (body.profile as Record<string, unknown>)
      : null;
  const linkedinUrl = canonicalizeLinkedinUrl(
    profileString(profile ?? {}, 'profileUrl') ?? body.linkedinUrl
  );
  const profileKey = linkedinProfileKey(linkedinUrl);
  if (!linkedinUrl || !profileKey) {
    return c.json({ error: 'A valid LinkedIn profile URL is required.' }, 400);
  }

  let [lead] = await db
    .select()
    .from(schema.leads)
    .where(
      and(
        eq(schema.leads.workspaceId, DEFAULT_WORKSPACE_ID),
        eq(schema.leads.linkedinProfileKey, profileKey),
        isNull(schema.leads.deletedAt)
      )
    )
    .limit(1);
  let createdFromExtension = false;
  if (!lead) {
    const identity = await nextLeadIdentity(db);
    const name = deriveProspectName(profileString(profile ?? {}, 'name'), linkedinUrl);
    const initialTags = await ensureTagDefinitions(db, ['needs profile capture'], resolved.userId);
    [lead] = await db
      .insert(schema.leads)
      .values({
        workspaceId: DEFAULT_WORKSPACE_ID,
        ...identity,
        firstName: name.firstName,
        lastName: name.lastName,
        linkedinUrl,
        linkedinProfileKey: profileKey,
        source: 'linkedin',
        ownerId: resolved.userId,
        reviewState: 'pending',
        profileCaptureStatus: 'processing',
        tags: initialTags,
        status: 'new',
        journeyStage: 'new',
        outreachStatus: 'not_approached',
      })
      .returning();
    if (!lead) return c.json({ error: 'Could not create prospect.' }, 500);
    createdFromExtension = true;
  }

  try {
    const reviewed = await reviewProspect(
      db,
      lead,
      resolved.userId,
      body.disposition,
      profile,
      typeof body.rowVersion === 'number' ? body.rowVersion : undefined
    );
    if (reviewed.reviewState === 'accepted' && !isLeadHoldingStage(reviewed.journeyStage)) {
      c.executionCtx.waitUntil(
        generateAndSaveLeadAiAssessment(db, reviewed, c.env).catch((error) =>
          console.error('Accepted prospect AI assessment failed:', error)
        )
      );
    }
    return c.json({ lead: reviewed, createdFromExtension });
  } catch (error) {
    if (error instanceof Error && error.message === 'PROSPECT_VERSION_CONFLICT') {
      return c.json({ error: 'This prospect changed in another session. Refresh and retry.' }, 409);
    }
    throw error;
  }
});

app.post('/internal/lead-score-queue/drain', async (c) => {
  const configuredSecret = c.env.WORKFLOW_RUNNER_SECRET;
  const authorization = c.req.header('Authorization');
  if (!configuredSecret || authorization !== `Bearer ${configuredSecret}`) {
    return c.json({ error: 'Unauthorized.' }, 401);
  }

  const requestedLimit = Number(c.req.query('limit') ?? 10);
  const limit = Math.min(10, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 10));
  const db = getDb(c.env, schema) as CrmDb;
  const result = await drainLeadScoreQueue(db, c.env, limit);
  return c.json(result);
});

app.post('/internal/lead-profile-queue/drain', async (c) => {
  const configuredSecret = c.env.WORKFLOW_RUNNER_SECRET;
  const authorization = c.req.header('Authorization');
  if (!configuredSecret || authorization !== `Bearer ${configuredSecret}`) {
    return c.json({ error: 'Unauthorized.' }, 401);
  }

  const requestedLimit = Number(c.req.query('limit') ?? 10);
  const limit = Math.min(10, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 10));
  const db = getDb(c.env, schema) as CrmDb;
  return c.json(await drainLeadProfileQueue(db, c.env, limit));
});

app.use('/api/*', requireAuth);
app.use('/api/admin/*', requireSuperadmin());

function getRole(c: unknown): string {
  const apps = (c as { get: (key: string) => unknown }).get('apps');
  return (apps as { crm?: string } | undefined)?.crm ?? '';
}

type AiRuntimeSettings = {
  defaultProvider: 'vertex_proxy' | 'google_ai';
  tierModels: {
    reasoning: string;
    fast: string;
    cheap: string;
    embedding: string;
  };
  agentModels: Partial<Record<AiAgentId, string>>;
};

const DEFAULT_AI_RUNTIME_SETTINGS: AiRuntimeSettings = {
  defaultProvider: 'vertex_proxy',
  tierModels: {
    reasoning: DEFAULT_AI_MODELS.reasoning,
    fast: DEFAULT_AI_MODELS.fast,
    cheap: DEFAULT_AI_MODELS.cheap,
    embedding: DEFAULT_AI_MODELS.embedding,
  },
  agentModels: {},
};

function readAiRuntimeSettings(value: unknown): AiRuntimeSettings {
  const input = (value ?? {}) as Partial<AiRuntimeSettings>;
  return {
    defaultProvider: input.defaultProvider === 'google_ai' ? 'google_ai' : 'vertex_proxy',
    tierModels: {
      ...DEFAULT_AI_RUNTIME_SETTINGS.tierModels,
      ...(input.tierModels ?? {}),
    },
    agentModels: input.agentModels ?? {},
  };
}

async function getAiRuntimeSettings(db: CrmDb): Promise<AiRuntimeSettings> {
  const [row] = await db
    .select({ settings: schema.integrationConfigs.settings })
    .from(schema.integrationConfigs)
    .where(eq(schema.integrationConfigs.provider, 'ai_runtime'))
    .limit(1);
  return readAiRuntimeSettings(row?.settings);
}

async function getConfiguredAiEnv(db: CrmDb, env: Env, actorUserId?: string | null): Promise<Env> {
  const settings = await getAiRuntimeSettings(db);
  const useVertex = settings.defaultProvider === 'vertex_proxy';
  return {
    ...env,
    AI_PROVIDER: settings.defaultProvider,
    AI_GATEWAY_BASE_URL: useVertex ? env.AI_GATEWAY_BASE_URL : undefined,
    AI_GATEWAY_API_KEY: useVertex ? env.AI_GATEWAY_API_KEY : undefined,
    GOOGLE_API_KEY: env.GOOGLE_API_KEY,
    AI_MODEL_REASONING: settings.tierModels.reasoning,
    AI_MODEL_DEFAULT: settings.tierModels.fast,
    AI_MODEL_CHEAP: settings.tierModels.cheap,
    AI_MODEL_FALLBACK: settings.tierModels.cheap,
    AI_EMBEDDING_MODEL: settings.tierModels.embedding,
    AI_AGENT_MODELS: JSON.stringify({
      ...settings.agentModels,
      // Lead scoring is intentionally pinned to the cheapest Flash route.
      'lead-scorer': DEFAULT_AI_MODELS.cheap,
      'prospect-profile': DEFAULT_AI_MODELS.cheap,
      'profile-normalizer': DEFAULT_AI_MODELS.cheap,
      'linkedin-connection-writer': DEFAULT_AI_MODELS.cheap,
    }),
    AI_USAGE_RECORDER: async (record) => {
      await db.insert(schema.aiUsageEvents).values({
        actorUserId: actorUserId ?? null,
        provider: record.provider,
        model: record.model,
        backingModel: record.backingModel,
        agentId: record.agentId ?? null,
        requestType: record.requestType,
        status: record.status,
        inputTokens: record.usage.inputTokens,
        outputTokens: record.usage.outputTokens,
        totalTokens: record.usage.totalTokens,
        cachedInputTokens: record.usage.cachedInputTokens ?? 0,
        estimatedCostUsd: record.estimatedCostUsd.toFixed(8),
        latencyMs: record.latencyMs,
        usageSource: record.usageSource,
      });
    },
  };
}

function leadQualificationValues(leadId: string, assessment: ai.LeadQualificationAssessment) {
  return {
    leadId,
    overallScore: assessment.overallScore,
    rawScore: assessment.rawScore,
    classification: assessment.classification,
    confidenceLevel: assessment.confidenceLevel,
    profileEvidenceQuality: assessment.profileEvidenceQuality,
    marketEntryTiming: assessment.marketEntryTiming,
    candidateNeedEvidence: assessment.candidateNeedEvidence,
    scoreBreakdown: assessment.scoreBreakdown,
    verifiedPositiveSignals: assessment.verifiedPositiveSignals,
    risksOrMissingInformation: assessment.risksOrMissingInformation,
    hardDisqualifier: assessment.hardDisqualifier,
    hardDisqualifierReason: assessment.hardDisqualifierReason,
    campaignMatches: assessment.campaignMatches,
    recommendedAction: assessment.recommendedAction,
    bestOutreachAngle: assessment.bestOutreachAngle,
    qualificationQuestions: assessment.qualificationQuestions,
    reasoningSummary: assessment.reasoningSummary,
    updatedAt: new Date(),
  };
}

async function saveLeadQualificationAssessment(
  db: CrmDb,
  lead: typeof schema.leads.$inferSelect,
  assessment: ai.LeadQualificationAssessment
) {
  const scoreValues = leadQualificationValues(lead.id, assessment);
  const [saved] = await db
    .insert(schema.leadAiAssessments)
    .values({
      ...scoreValues,
      connectionNote: null,
      connectionNoteCharacterCount: 0,
    })
    .onConflictDoUpdate({
      target: schema.leadAiAssessments.leadId,
      // Preserve any human-edited/generated connection note when re-scoring.
      set: scoreValues,
    })
    .returning();
  if (saved) {
    await db.insert(schema.leadEventOutbox).values({
      workspaceId: lead.workspaceId,
      leadId: lead.id,
      eventType: 'lead.scored',
      actorUserId: null,
      payload: {
        lead: {
          ...lead,
          aiScore: saved.overallScore,
          aiClassification: saved.classification,
          aiReasoningSummary: saved.reasoningSummary,
          aiRecommendedAction: saved.recommendedAction,
          isPhd: hasPhdProfileEvidence(lead),
          scoreJobStatus: 'completed',
        },
        occurredAt: new Date().toISOString(),
      },
    });
  }
  return saved ?? null;
}

async function enforcePhdAutoDisqualification(
  db: CrmDb,
  lead: typeof schema.leads.$inferSelect,
  actorUserId: string | null
): Promise<typeof schema.leads.$inferSelect | null> {
  if (!hasPhdProfileEvidence(lead)) return null;
  await ensureTagDefinitions(db, ['Disqualified'], actorUserId ?? lead.ownerId, true);

  const alreadyApplied =
    lead.reviewState === 'rejected' &&
    lead.reviewDisposition === 'disqualified' &&
    lead.journeyStage === 'disqualified' &&
    lead.profileNormalizationStatus === 'not_queued';
  let disqualifiedLead = lead;
  if (!alreadyApplied) {
    const now = new Date();
    const legacy = legacyFieldsForJourney('disqualified');
    const [updated] = await db
      .update(schema.leads)
      .set({
        reviewState: 'rejected',
        reviewDisposition: 'disqualified',
        reviewedAt: now,
        reviewedBy: actorUserId,
        journeyStage: 'disqualified',
        status: legacy.status,
        outreachStatus: legacy.outreachStatus,
        tags: mergeLeadTags(
          lead.tags,
          ['Disqualified'],
          [
            'Excellent Fit',
            'Worth Trying',
            'Maybe',
            'Future',
            'Foreign National',
            'needs profile capture',
          ]
        ),
        profileNormalizationStatus: 'not_queued',
        profileNormalizationWarnings: [PHD_ZERO_SCORE_REASON],
        rowVersion: sql`${schema.leads.rowVersion} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.leads.id, lead.id))
      .returning();
    if (updated) {
      disqualifiedLead = updated;
      await withAudit(db, schema.auditLog, {
        actorUserId: actorUserId ?? lead.ownerId,
        action: 'auto_disqualify_phd',
        resourceType: 'lead',
        resourceId: lead.id,
        before: lead,
        after: updated,
        app: 'crm',
      });
      await publishLeadEvent(db, 'prospect.reviewed', actorUserId, updated);
    }
  }

  await saveLeadQualificationAssessment(db, disqualifiedLead, phdZeroScoreAssessment());
  const now = new Date();
  await Promise.all([
    db
      .update(schema.leadProfileJobs)
      .set({
        status: 'completed',
        completedAt: now,
        lockedAt: null,
        lastError: PHD_ZERO_SCORE_REASON,
        updatedAt: now,
      })
      .where(eq(schema.leadProfileJobs.leadId, lead.id)),
    db
      .update(schema.leadScoreJobs)
      .set({
        status: 'completed',
        completedAt: now,
        lockedAt: null,
        lastError: PHD_ZERO_SCORE_REASON,
        updatedAt: now,
      })
      .where(eq(schema.leadScoreJobs.leadId, lead.id)),
    db.delete(schema.prospectReviewClaims).where(eq(schema.prospectReviewClaims.leadId, lead.id)),
  ]);
  return disqualifiedLead;
}

async function generateAndSaveLeadScore(
  db: CrmDb,
  lead: typeof schema.leads.$inferSelect,
  env: Env
) {
  // This is deliberately independent from the Profile Cleanup Agent. Queue
  // orchestration ensures the scorer receives the structured profile after
  // cleanup; the PhD exclusion is a deterministic CRM policy and costs no AI
  // tokens.
  if (hasPhdProfileEvidence(lead)) {
    await enforcePhdAutoDisqualification(db, lead, null);
    const [saved] = await db
      .select()
      .from(schema.leadAiAssessments)
      .where(eq(schema.leadAiAssessments.leadId, lead.id))
      .limit(1);
    return saved ?? null;
  }
  const aiEnv = await getConfiguredAiEnv(db, env, lead.ownerId);
  if (!ai.isAiConfigured(aiEnv)) return null;
  const assessment = await ai.qualifyLead(structuredLeadQualificationInput(lead), aiEnv);
  if (!assessment) return null;
  return saveLeadQualificationAssessment(db, lead, assessment);
}

async function drainLeadProfileQueue(db: CrmDb, env: Env, limit: number) {
  const now = new Date();
  await db.update(schema.leadProfileJobs).set({
    status: 'completed',
    completedAt: now,
    lockedAt: null,
    lastError: 'Cleanup cancelled because the lead was deleted or rejected.',
    updatedAt: now,
  }).where(sql`
      ${schema.leadProfileJobs.status} in ('pending', 'processing', 'failed')
      and exists (
        select 1
        from "crm"."leads" stale_lead
        where stale_lead."id" = ${schema.leadProfileJobs.leadId}
          and (stale_lead."deleted_at" is not null or stale_lead."review_state" = 'rejected')
      )
    `);
  await db
    .update(schema.leadProfileJobs)
    .set({
      status: 'failed',
      lockedAt: null,
      nextAttemptAt: now,
      lastError: 'Recovered stale profile cleanup lock.',
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.leadProfileJobs.status, 'processing'),
        sql`${schema.leadProfileJobs.lockedAt} < now() - interval '30 minutes'`
      )
    );

  const jobs = await db
    .select({
      id: schema.leadProfileJobs.id,
      leadId: schema.leadProfileJobs.leadId,
      status: schema.leadProfileJobs.status,
      attempts: schema.leadProfileJobs.attempts,
      nextAttemptAt: schema.leadProfileJobs.nextAttemptAt,
      lockedAt: schema.leadProfileJobs.lockedAt,
      completedAt: schema.leadProfileJobs.completedAt,
      lastError: schema.leadProfileJobs.lastError,
      createdAt: schema.leadProfileJobs.createdAt,
      updatedAt: schema.leadProfileJobs.updatedAt,
    })
    .from(schema.leadProfileJobs)
    .innerJoin(schema.leads, eq(schema.leadProfileJobs.leadId, schema.leads.id))
    .where(
      and(
        inArray(schema.leadProfileJobs.status, ['pending', 'failed']),
        lte(schema.leadProfileJobs.nextAttemptAt, now),
        isNull(schema.leads.deletedAt),
        ne(schema.leads.reviewState, 'rejected')
      )
    )
    .orderBy(
      sql`case when ${schema.leads.reviewState} = 'pending' then 0 else 1 end`,
      asc(schema.leadProfileJobs.nextAttemptAt)
    )
    .limit(limit);

  const result = { claimed: 0, normalized: 0, skipped: 0, failed: 0 };
  for (const job of jobs) {
    const [claimed] = await db
      .update(schema.leadProfileJobs)
      .set({
        status: 'processing',
        attempts: sql`${schema.leadProfileJobs.attempts} + 1`,
        lockedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.leadProfileJobs.id, job.id),
          inArray(schema.leadProfileJobs.status, ['pending', 'failed']),
          lte(schema.leadProfileJobs.nextAttemptAt, now)
        )
      )
      .returning();
    if (!claimed) continue;
    result.claimed += 1;

    try {
      const [lead] = await db
        .select()
        .from(schema.leads)
        .where(and(eq(schema.leads.id, job.leadId), isNull(schema.leads.deletedAt)))
        .limit(1);
      if (!lead || !hasLeadProfileEvidence(lead)) {
        if (lead) {
          await db
            .update(schema.leads)
            .set({ profileNormalizationStatus: 'not_queued', updatedAt: new Date() })
            .where(eq(schema.leads.id, lead.id));
        }
        result.skipped += 1;
      } else {
        await normalizeAndSaveLeadProfile(db, lead, env);
        result.normalized += 1;
      }
      await db
        .update(schema.leadProfileJobs)
        .set({
          status: 'completed',
          completedAt: new Date(),
          lockedAt: null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.leadProfileJobs.id, job.id));
    } catch (error) {
      const message = (error instanceof Error ? error.message : 'Unknown cleanup failure').slice(
        0,
        1000
      );
      const backoffMinutes = Math.min(360, 5 * 2 ** Math.max(0, claimed.attempts - 1));
      await Promise.all([
        db
          .update(schema.leadProfileJobs)
          .set({
            status: 'failed',
            nextAttemptAt: new Date(Date.now() + backoffMinutes * 60_000),
            lockedAt: null,
            lastError: message,
            updatedAt: new Date(),
          })
          .where(eq(schema.leadProfileJobs.id, job.id)),
        db
          .update(schema.leads)
          .set({
            profileNormalizationStatus: 'failed',
            profileNormalizationWarnings: [message],
            updatedAt: new Date(),
          })
          .where(eq(schema.leads.id, job.leadId)),
      ]);
      result.failed += 1;
    }
  }
  return result;
}

async function drainLeadScoreQueue(db: CrmDb, env: Env, limit: number) {
  const now = new Date();
  await db.update(schema.leadScoreJobs).set({
    status: 'completed',
    completedAt: now,
    lockedAt: null,
    lastError: 'Scoring cancelled because the lead was deleted or rejected.',
    updatedAt: now,
  }).where(sql`
      ${schema.leadScoreJobs.status} in ('pending', 'processing', 'failed')
      and exists (
        select 1
        from "crm"."leads" stale_lead
        where stale_lead."id" = ${schema.leadScoreJobs.leadId}
          and (stale_lead."deleted_at" is not null or stale_lead."review_state" = 'rejected')
      )
    `);
  await db
    .update(schema.leadScoreJobs)
    .set({
      status: 'failed',
      lockedAt: null,
      nextAttemptAt: now,
      lastError: 'Recovered stale scoring lock.',
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.leadScoreJobs.status, 'processing'),
        sql`${schema.leadScoreJobs.lockedAt} < now() - interval '30 minutes'`
      )
    );

  const jobs = await db
    .select({
      id: schema.leadScoreJobs.id,
      leadId: schema.leadScoreJobs.leadId,
      status: schema.leadScoreJobs.status,
      attempts: schema.leadScoreJobs.attempts,
      nextAttemptAt: schema.leadScoreJobs.nextAttemptAt,
      lockedAt: schema.leadScoreJobs.lockedAt,
      completedAt: schema.leadScoreJobs.completedAt,
      lastError: schema.leadScoreJobs.lastError,
      createdAt: schema.leadScoreJobs.createdAt,
      updatedAt: schema.leadScoreJobs.updatedAt,
    })
    .from(schema.leadScoreJobs)
    .innerJoin(schema.leads, eq(schema.leadScoreJobs.leadId, schema.leads.id))
    .where(
      and(
        inArray(schema.leadScoreJobs.status, ['pending', 'failed']),
        lte(schema.leadScoreJobs.nextAttemptAt, now),
        isNull(schema.leads.deletedAt),
        ne(schema.leads.reviewState, 'rejected')
      )
    )
    .orderBy(
      sql`case when ${schema.leads.reviewState} = 'pending' then 0 else 1 end`,
      asc(schema.leadScoreJobs.nextAttemptAt)
    )
    .limit(limit);

  const result = { claimed: 0, scored: 0, deferred: 0, skipped: 0, failed: 0 };
  for (const job of jobs) {
    const [claimed] = await db
      .update(schema.leadScoreJobs)
      .set({
        status: 'processing',
        attempts: sql`${schema.leadScoreJobs.attempts} + 1`,
        lockedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.leadScoreJobs.id, job.id),
          inArray(schema.leadScoreJobs.status, ['pending', 'failed']),
          lte(schema.leadScoreJobs.nextAttemptAt, now)
        )
      )
      .returning();
    if (!claimed) continue;
    result.claimed += 1;

    try {
      const [lead] = await db
        .select()
        .from(schema.leads)
        .where(and(eq(schema.leads.id, job.leadId), isNull(schema.leads.deletedAt)))
        .limit(1);

      if (!lead || lead.reviewState === 'rejected') {
        await db
          .update(schema.leadScoreJobs)
          .set({
            status: 'completed',
            completedAt: new Date(),
            lockedAt: null,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.leadScoreJobs.id, job.id));
        result.skipped += 1;
        continue;
      }

      const phdProfile = hasPhdProfileEvidence(lead);
      if (!phdProfile && lead.profileNormalizationStatus !== 'completed') {
        const hasProfile = hasLeadProfileEvidence(lead);
        if (hasProfile && lead.profileNormalizationStatus === 'not_queued') {
          await enqueueLeadProfileCleanup(db, lead.id);
        }
        await db
          .update(schema.leadScoreJobs)
          .set({
            status: 'pending',
            nextAttemptAt: new Date(Date.now() + (hasProfile ? 5 * 60_000 : 24 * 60 * 60_000)),
            lockedAt: null,
            lastError: hasProfile
              ? 'Waiting for the separate Profile Cleanup Agent.'
              : 'Waiting for a LinkedIn profile capture.',
            updatedAt: new Date(),
          })
          .where(eq(schema.leadScoreJobs.id, job.id));
        result.deferred += 1;
        continue;
      }

      const assessment = await generateAndSaveLeadScore(db, lead, env);
      if (!assessment) throw new Error(ai.AI_NOT_CONFIGURED_MSG);

      await db
        .update(schema.leadScoreJobs)
        .set({
          status: 'completed',
          completedAt: new Date(),
          lockedAt: null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.leadScoreJobs.id, job.id));
      result.scored += 1;
    } catch (error) {
      const message = (error instanceof Error ? error.message : 'Unknown scoring failure').slice(
        0,
        1000
      );
      const backoffMinutes = Math.min(360, 5 * 2 ** Math.max(0, claimed.attempts - 1));
      await db
        .update(schema.leadScoreJobs)
        .set({
          // Keep retrying with a capped backoff so temporary provider failures
          // never strand a lead permanently.
          status: 'failed',
          nextAttemptAt: new Date(Date.now() + backoffMinutes * 60_000),
          lockedAt: null,
          lastError: message,
          updatedAt: new Date(),
        })
        .where(eq(schema.leadScoreJobs.id, job.id));
      result.failed += 1;
    }
  }
  return result;
}

async function generateAndSaveLeadAiAssessment(
  db: CrmDb,
  lead: typeof schema.leads.$inferSelect,
  env: Env
) {
  const normalizedLead = await normalizeAndSaveLeadProfile(db, lead, env);
  if (hasPhdProfileEvidence(normalizedLead)) {
    return generateAndSaveLeadScore(db, normalizedLead, env);
  }
  const aiEnv = await getConfiguredAiEnv(db, env, normalizedLead.ownerId);
  if (!ai.isAiConfigured(aiEnv)) return null;

  const input = structuredLeadQualificationInput(normalizedLead);
  const [assessment, connectionNote] = await Promise.all([
    ai.qualifyLead(input, aiEnv),
    ai.draftLinkedinConnectionNote(input, aiEnv),
  ]);
  if (!assessment || !connectionNote) return null;

  const values = {
    ...leadQualificationValues(lead.id, assessment),
    connectionNote,
    connectionNoteCharacterCount: [...connectionNote].length,
  };
  const [saved] = await db
    .insert(schema.leadAiAssessments)
    .values(values)
    .onConflictDoUpdate({
      target: schema.leadAiAssessments.leadId,
      set: values,
    })
    .returning();
  if (saved && lead.journeyStage === 'new') {
    const legacy = legacyFieldsForJourney('ready_to_reach_out');
    await db
      .update(schema.leads)
      .set({
        journeyStage: 'ready_to_reach_out',
        status: legacy.status,
        outreachStatus: legacy.outreachStatus,
        updatedAt: new Date(),
      })
      .where(eq(schema.leads.id, lead.id));
  }
  return saved ?? null;
}

// --- COMPANIES ---

app.get('/api/companies', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { search, industry, owner } = c.req.query();
  const conditions = [isNull(schema.companies.deletedAt)];

  if (!isSuperadmin) {
    conditions.push(eq(schema.companies.ownerId, caller.userId));
  }
  if (search) {
    conditions.push(like(sql`lower(${schema.companies.name})`, `%${search.toLowerCase()}%`));
  }
  if (industry) conditions.push(eq(schema.companies.industry, industry));
  if (owner) conditions.push(eq(schema.companies.ownerId, owner));

  const rows = await db
    .select()
    .from(schema.companies)
    .where(and(...conditions))
    .orderBy(desc(schema.companies.updatedAt))
    .limit(100);

  return c.json({ companies: rows });
});

app.post('/api/companies', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const data = {
    name: body.name,
    domain: body.domain ?? null,
    industry: body.industry ?? null,
    size: body.size ?? null,
    address: body.address ?? null,
    ownerId: caller.userId,
  };

  const [result] = await db.insert(schema.companies).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'company',
    resourceId: result.id,
    after: data,
    app: 'crm',
  });

  // Auto-embed for RAG chatbot
  c.executionCtx.waitUntil(
    ai
      .autoEmbed(
        db,
        schema,
        'company',
        result.id,
        `${result.name} ${result.domain ?? ''} ${result.industry ?? ''} ${result.address ?? ''}`,
        caller.userId,
        c.env
      )
      .catch(() => {})
  );

  return c.json({ company: result }, 201);
});

app.get('/api/companies/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.id, id), isNull(schema.companies.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  return c.json({ company: row });
});

app.put('/api/companies/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.id, id), isNull(schema.companies.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.domain !== undefined) update.domain = body.domain;
  if (body.industry !== undefined) update.industry = body.industry;
  if (body.size !== undefined) update.size = body.size;
  if (body.address !== undefined) update.address = body.address;
  if (body.ownerId !== undefined && isSuperadmin) update.ownerId = body.ownerId;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.companies)
    .set(update)
    .where(eq(schema.companies.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'company',
    resourceId: id,
    before: existing,
    after: result,
    app: 'crm',
  });

  // Auto-embed for RAG chatbot
  c.executionCtx.waitUntil(
    ai
      .autoEmbed(
        db,
        schema,
        'company',
        result.id,
        `${result.name} ${result.domain ?? ''} ${result.industry ?? ''} ${result.address ?? ''}`,
        caller.userId,
        c.env
      )
      .catch(() => {})
  );

  return c.json({ company: result });
});

app.delete('/api/companies/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.id, id), isNull(schema.companies.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'delete', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db
    .update(schema.companies)
    .set({
      deletedAt: new Date(),
      deletedBy: caller.userId,
    })
    .where(eq(schema.companies.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'company',
    resourceId: id,
    before: existing,
    app: 'crm',
  });

  return c.json({ success: true });
});

// --- CONTACTS ---

app.get('/api/contacts', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { search, companyId, owner } = c.req.query();
  const conditions = [isNull(schema.contacts.deletedAt)];

  if (!isSuperadmin) {
    conditions.push(eq(schema.contacts.ownerId, caller.userId));
  }
  if (search) {
    conditions.push(like(sql`lower(${schema.contacts.email})`, `%${search.toLowerCase()}%`));
  }
  if (companyId) conditions.push(eq(schema.contacts.companyId, companyId));
  if (owner) conditions.push(eq(schema.contacts.ownerId, owner));

  const rows = await db
    .select()
    .from(schema.contacts)
    .where(and(...conditions))
    .orderBy(desc(schema.contacts.updatedAt))
    .limit(100);

  return c.json({ contacts: rows });
});

app.post('/api/contacts', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const data = {
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone ?? null,
    headline: body.headline ?? null,
    location: body.location ?? null,
    about: body.about ?? null,
    experience: body.experience ?? null,
    education: body.education ?? null,
    skills: body.skills ?? null,
    currentRole: body.currentRole ?? null,
    currentRoleDates: body.currentRoleDates ?? null,
    openToWork: typeof body.openToWork === 'boolean' ? body.openToWork : null,
    yearsExperience: body.yearsExperience ?? null,
    connectionDegree: body.connectionDegree ?? null,
    prospectSourceContext: body.prospectSourceContext ?? null,
    title: body.title ?? null,
    companyId: body.companyId ?? null,
    ownerId: caller.userId,
  };

  const [result] = await db.insert(schema.contacts).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'contact',
    resourceId: result.id,
    after: data,
    app: 'crm',
  });

  // Auto-embed for RAG chatbot
  c.executionCtx.waitUntil(
    ai
      .autoEmbed(
        db,
        schema,
        'contact',
        result.id,
        `${result.firstName} ${result.lastName} ${result.email} ${result.title ?? ''}`,
        caller.userId,
        c.env
      )
      .catch(() => {})
  );

  return c.json({ contact: result }, 201);
});

app.get('/api/contacts/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), isNull(schema.contacts.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  return c.json({ contact: row });
});

app.put('/api/contacts/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), isNull(schema.contacts.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.firstName !== undefined) update.firstName = body.firstName;
  if (body.lastName !== undefined) update.lastName = body.lastName;
  if (body.email !== undefined) update.email = body.email;
  if (body.phone !== undefined) update.phone = body.phone;
  if (body.title !== undefined) update.title = body.title;
  if (body.companyId !== undefined) update.companyId = body.companyId;
  if (body.ownerId !== undefined && isSuperadmin) update.ownerId = body.ownerId;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.contacts)
    .set(update)
    .where(eq(schema.contacts.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'contact',
    resourceId: id,
    before: existing,
    after: result,
    app: 'crm',
  });

  // Auto-embed for RAG chatbot
  c.executionCtx.waitUntil(
    ai
      .autoEmbed(
        db,
        schema,
        'contact',
        result.id,
        `${result.firstName} ${result.lastName} ${result.email} ${result.title ?? ''}`,
        caller.userId,
        c.env
      )
      .catch(() => {})
  );

  return c.json({ contact: result });
});

app.delete('/api/contacts/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), isNull(schema.contacts.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'delete', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db
    .update(schema.contacts)
    .set({
      deletedAt: new Date(),
      deletedBy: caller.userId,
    })
    .where(eq(schema.contacts.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'contact',
    resourceId: id,
    before: existing,
    app: 'crm',
  });

  return c.json({ success: true });
});

// --- TAGS ---

app.get('/api/tags', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  if (!getRole(c) && !c.get('isSuperadmin')) return c.json({ error: 'Forbidden.' }, 403);

  const tags = await db
    .select()
    .from(schema.tagDefinitions)
    .orderBy(asc(schema.tagDefinitions.name));
  return c.json({ tags });
});

app.post('/api/tags', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const userId = c.get('userId');
  if (!isSuperadmin && role !== 'manager') {
    return c.json({ error: 'Manager or superadmin access is required to create tags.' }, 403);
  }

  const body = await c.req.json();
  const names = normalizeTagNames([body.name]);
  const name = names[0];
  if (!name) return c.json({ error: 'Enter a tag name between 1 and 60 characters.' }, 400);
  const slug = tagSlug(name);
  const color =
    typeof body.color === 'string' &&
    ['slate', 'blue', 'green', 'emerald', 'amber', 'red', 'violet', 'cyan', 'pink'].includes(
      body.color
    )
      ? body.color
      : 'slate';

  const [existing] = await db
    .select()
    .from(schema.tagDefinitions)
    .where(eq(schema.tagDefinitions.slug, slug))
    .limit(1);
  if (existing) return c.json({ tag: existing, created: false });

  const [tag] = await db
    .insert(schema.tagDefinitions)
    .values({
      name,
      slug,
      color,
      description: typeof body.description === 'string' ? body.description.trim() || null : null,
      createdBy: userId,
    })
    .returning();
  if (!tag) return c.json({ error: 'Internal error.' }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: userId,
    action: 'create',
    resourceType: 'tag_definition',
    resourceId: tag.id,
    after: tag,
    app: 'crm',
  });
  return c.json({ tag, created: true }, 201);
});

// --- PROSPECT REVIEW ---

app.get('/api/prospects/profile-cleanup-status', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  if (!getRole(c)) return c.json({ error: 'Forbidden.' }, 403);

  const activeLead = and(
    eq(schema.leads.workspaceId, DEFAULT_WORKSPACE_ID),
    isNull(schema.leads.deletedAt)
  );
  const pendingProspect = and(activeLead, eq(schema.leads.reviewState, 'pending'));
  const [summaryRows, allCrmActiveRows, queue] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`,
        waiting: sql<number>`count(*) filter (
          where ${schema.leadProfileJobs.status} = 'pending'
        )`,
        processing: sql<number>`count(*) filter (
          where ${schema.leadProfileJobs.status} = 'processing'
        )`,
        retrying: sql<number>`count(*) filter (
          where ${schema.leadProfileJobs.status} = 'failed'
        )`,
        completed: sql<number>`count(*) filter (
          where ${schema.leadProfileJobs.status} = 'completed'
        )`,
        completedToday: sql<number>`count(*) filter (
          where ${schema.leadProfileJobs.status} = 'completed'
            and ${schema.leadProfileJobs.completedAt} >= now() - interval '24 hours'
        )`,
        oldestQueuedAt: sql<Date | null>`min(${schema.leadProfileJobs.createdAt}) filter (
          where ${schema.leadProfileJobs.status} in ('pending', 'failed')
        )`,
        latestCompletedAt: sql<Date | null>`max(${schema.leadProfileJobs.completedAt})`,
      })
      .from(schema.leadProfileJobs)
      .innerJoin(schema.leads, eq(schema.leadProfileJobs.leadId, schema.leads.id))
      .where(pendingProspect),
    db
      .select({
        active: sql<number>`count(*) filter (
          where ${schema.leadProfileJobs.status} in ('pending', 'processing', 'failed')
        )`,
      })
      .from(schema.leadProfileJobs)
      .innerJoin(schema.leads, eq(schema.leadProfileJobs.leadId, schema.leads.id))
      .where(and(activeLead, ne(schema.leads.reviewState, 'rejected'))),
    db
      .select({
        id: schema.leadProfileJobs.id,
        leadId: schema.leadProfileJobs.leadId,
        leadNumber: schema.leads.leadNumber,
        firstName: schema.leads.firstName,
        lastName: schema.leads.lastName,
        status: schema.leadProfileJobs.status,
        attempts: schema.leadProfileJobs.attempts,
        nextAttemptAt: schema.leadProfileJobs.nextAttemptAt,
        lockedAt: schema.leadProfileJobs.lockedAt,
        lastError: schema.leadProfileJobs.lastError,
        createdAt: schema.leadProfileJobs.createdAt,
        updatedAt: schema.leadProfileJobs.updatedAt,
      })
      .from(schema.leadProfileJobs)
      .innerJoin(schema.leads, eq(schema.leadProfileJobs.leadId, schema.leads.id))
      .where(
        and(
          pendingProspect,
          inArray(schema.leadProfileJobs.status, ['processing', 'pending', 'failed'])
        )
      )
      .orderBy(
        sql`case ${schema.leadProfileJobs.status}
          when 'processing' then 0
          when 'pending' then 1
          else 2
        end`,
        asc(schema.leadProfileJobs.nextAttemptAt)
      )
      .limit(8),
  ]);

  const row = summaryRows[0];
  const total = Number(row?.total ?? 0);
  const waiting = Number(row?.waiting ?? 0);
  const processing = Number(row?.processing ?? 0);
  const retrying = Number(row?.retrying ?? 0);
  const completed = Number(row?.completed ?? 0);
  const active = waiting + processing + retrying;
  const allCrmActive = Number(allCrmActiveRows[0]?.active ?? 0);
  const cadenceMinutes = 1;
  const batchSize = 10;
  const now = Date.now();
  const nextScheduledRunAt = new Date(
    Math.ceil(now / (cadenceMinutes * 60_000)) * cadenceMinutes * 60_000
  );

  return c.json({
    summary: {
      total,
      active,
      waiting,
      processing,
      retrying,
      completed,
      completedToday: Number(row?.completedToday ?? 0),
      progressPercent: total ? Math.round((completed / total) * 100) : 100,
      oldestQueuedAt: row?.oldestQueuedAt ?? null,
      latestCompletedAt: row?.latestCompletedAt ?? null,
      estimatedMinutes: active ? Math.ceil(active / batchSize) * cadenceMinutes : 0,
      otherCrmActive: Math.max(0, allCrmActive - active),
    },
    queue,
    cadence: {
      batchSize,
      cadenceMinutes,
      nextScheduledRunAt,
    },
    observedAt: new Date(),
  });
});

app.get('/api/prospects', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  if (!getRole(c)) return c.json({ error: 'Forbidden.' }, 403);
  const page = Math.max(1, Number.parseInt(c.req.query('page') || '1', 10));
  const pageSize = Math.min(
    500,
    Math.max(1, Number.parseInt(c.req.query('pageSize') || '100', 10))
  );
  const search = c.req.query('search')?.trim().toLowerCase();
  const batchId = c.req.query('batchId');
  const captureStatus = c.req.query('captureStatus');
  const claimed = c.req.query('claimed');
  const requestedReviewState = c.req.query('reviewState');
  const reviewState = requestedReviewState === 'rejected' ? 'rejected' : 'pending';
  const leadFrom = Number.parseInt(c.req.query('leadFrom') || '', 10);
  const leadTo = Number.parseInt(c.req.query('leadTo') || '', 10);
  const userId = c.get('userId');
  const commonConditions = [
    eq(schema.leads.workspaceId, DEFAULT_WORKSPACE_ID),
    isNull(schema.leads.deletedAt),
  ];
  if (search) {
    const searchCondition = or(
      like(sql`lower(${schema.leads.firstName})`, `%${search}%`),
      like(sql`lower(${schema.leads.lastName})`, `%${search}%`),
      like(sql`lower(${schema.leads.companyName})`, `%${search}%`),
      like(sql`lower(${schema.leads.linkedinUrl})`, `%${search}%`),
      like(sql`lower(${schema.leads.leadNumber})`, `%${search}%`)
    );
    if (searchCondition) commonConditions.push(searchCondition);
  }
  if (Number.isFinite(leadFrom)) commonConditions.push(gte(schema.leads.leadSequence, leadFrom));
  if (Number.isFinite(leadTo)) commonConditions.push(lte(schema.leads.leadSequence, leadTo));
  if (batchId) {
    commonConditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${schema.leadImportMemberships} membership
        WHERE membership.lead_id = ${schema.leads.id}
          AND membership.batch_id = ${batchId}::uuid
      )`
    );
  }
  if (
    captureStatus &&
    ['not_captured', 'processing', 'captured', 'partial', 'failed'].includes(captureStatus)
  ) {
    commonConditions.push(eq(schema.leads.profileCaptureStatus, captureStatus as never));
  }
  const matchingConditions = [...commonConditions, eq(schema.leads.reviewState, reviewState)];
  const conditions = [...matchingConditions];
  if (claimed === 'mine') {
    conditions.push(
      sql`${schema.prospectReviewClaims.claimedBy} = ${userId}
          AND ${schema.prospectReviewClaims.expiresAt} > now()`
    );
  } else if (claimed === 'unclaimed') {
    conditions.push(
      sql`(${schema.prospectReviewClaims.leadId} IS NULL
          OR ${schema.prospectReviewClaims.expiresAt} <= now())`
    );
  }

  const sortBy = c.req.query('sortBy') || 'leadSequence';
  const sortOrder = c.req.query('sortOrder') === 'desc' ? 'desc' : 'asc';
  const phdProfile = prospectHasPhdSql();
  const displayedScore = sql<number>`CASE
    WHEN ${phdProfile} THEN 0
    ELSE ${schema.leadAiAssessments.overallScore}
  END`;
  const displayedRemark = sql<string>`CASE
    WHEN ${phdProfile} THEN ${PHD_ZERO_SCORE_REASON}
    ELSE ${schema.leadAiAssessments.reasoningSummary}
  END`;
  const sortColumns: Record<string, unknown> = {
    leadSequence: schema.leads.leadSequence,
    aiScore: displayedScore,
    aiRemark: sql`lower(${displayedRemark})`,
    name: sql`lower(${schema.leads.firstName} || ' ' || ${schema.leads.lastName})`,
    createdAt: schema.leads.createdAt,
    updatedAt: schema.leads.updatedAt,
    companyName: schema.leads.companyName,
    profileCaptureStatus: schema.leads.profileCaptureStatus,
    dataCompleteness: schema.leads.dataCompleteness,
  };
  const sortColumn = sortColumns[sortBy] ?? schema.leads.leadSequence;
  const ordering =
    sortOrder === 'desc'
      ? sql`${sortColumn as never} desc nulls last`
      : sql`${sortColumn as never} asc nulls last`;

  const availableConditions = [
    ...commonConditions,
    eq(schema.leads.reviewState, 'pending'),
    isNotNull(schema.leads.linkedinUrl),
    sql`(${schema.prospectReviewClaims.leadId} IS NULL
      OR ${schema.prospectReviewClaims.expiresAt} <= now())`,
  ];
  const [filteredCountRows, matchingCountRows, availableCountRows, awaitingCountRows, prospects] =
    await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.leads)
        .leftJoin(
          schema.prospectReviewClaims,
          eq(schema.prospectReviewClaims.leadId, schema.leads.id)
        )
        .where(and(...conditions)),
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.leads)
        .leftJoin(
          schema.prospectReviewClaims,
          eq(schema.prospectReviewClaims.leadId, schema.leads.id)
        )
        .where(and(...matchingConditions)),
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.leads)
        .leftJoin(
          schema.prospectReviewClaims,
          eq(schema.prospectReviewClaims.leadId, schema.leads.id)
        )
        .where(and(...availableConditions)),
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.leads)
        .where(
          and(
            eq(schema.leads.workspaceId, DEFAULT_WORKSPACE_ID),
            eq(schema.leads.reviewState, 'pending'),
            isNull(schema.leads.deletedAt)
          )
        ),
      db
        .select({
          ...getTableColumns(schema.leads),
          claimedBy: schema.prospectReviewClaims.claimedBy,
          claimExpiresAt: schema.prospectReviewClaims.expiresAt,
          aiScore: displayedScore,
          aiClassification: sql<string>`CASE
            WHEN ${phdProfile} THEN 'REJECT OR LOW PRIORITY'
            ELSE ${schema.leadAiAssessments.classification}
          END`,
          aiReasoningSummary: displayedRemark,
          aiRecommendedAction: schema.leadAiAssessments.recommendedAction,
          scoreJobStatus: schema.leadScoreJobs.status,
          scoreJobError: schema.leadScoreJobs.lastError,
          isPhd: phdProfile,
        })
        .from(schema.leads)
        .leftJoin(
          schema.prospectReviewClaims,
          eq(schema.prospectReviewClaims.leadId, schema.leads.id)
        )
        .leftJoin(schema.leadAiAssessments, eq(schema.leadAiAssessments.leadId, schema.leads.id))
        .leftJoin(schema.leadScoreJobs, eq(schema.leadScoreJobs.leadId, schema.leads.id))
        .where(and(...conditions))
        .orderBy(ordering)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);
  const count = Number(filteredCountRows[0]?.count ?? 0);
  return c.json({
    prospects,
    page,
    pageSize,
    total: count,
    totalPages: Math.ceil(count / pageSize),
    matchingTotal: Number(matchingCountRows[0]?.count ?? 0),
    availableTotal: Number(availableCountRows[0]?.count ?? 0),
    awaitingReviewTotal: Number(awaitingCountRows[0]?.count ?? 0),
  });
});

app.post('/api/prospects/import', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  if (!role) return c.json({ error: 'Forbidden.' }, 403);
  const userId = c.get('userId');
  const rateLimit = checkRateLimit(`prospects:import:${userId}`, 5, 60_000);
  if (!rateLimit.allowed) {
    c.header('Retry-After', String(rateLimit.retryAfter));
    return c.json(
      { error: `Too many prospect imports. Try again in ${rateLimit.retryAfter} seconds.` },
      429
    );
  }
  const body = await c.req.json();
  const csv = typeof body.csv === 'string' ? body.csv : '';
  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 120)
      : `Prospect import ${new Date().toISOString()}`;
  if (!csv) return c.json({ error: 'Upload a CSV file.' }, 400);
  if (new TextEncoder().encode(csv).byteLength > 8_000_000) {
    return c.json({ error: 'CSV is too large. Maximum size is 8 MB.' }, 413);
  }
  const parsed = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    skipEmptyLines: 'greedy',
  });
  if (parsed.data.length === 0) return c.json({ error: 'The CSV has no data rows.' }, 400);
  if (parsed.data.length > 10_000) {
    return c.json({ error: 'Maximum 10,000 rows per import.' }, 413);
  }

  const invalidRows: Array<{ row: number; error: string }> = [];
  const byProfileKey = new Map<string, ProspectCsvRow>();
  for (let index = 0; index < parsed.data.length; index += 1) {
    const normalized = normalizeProspectCsvRecord(parsed.data[index] ?? {}, index + 2);
    if (!normalized.row) {
      invalidRows.push({ row: index + 2, error: normalized.error ?? 'Invalid row.' });
      continue;
    }
    if (!byProfileKey.has(normalized.row.linkedinProfileKey)) {
      byProfileKey.set(normalized.row.linkedinProfileKey, normalized.row);
    } else {
      invalidRows.push({ row: index + 2, error: 'Duplicate LinkedIn URL inside this CSV.' });
    }
  }
  const candidates = [...byProfileKey.values()];
  if (candidates.length === 0) {
    return c.json({ error: 'No valid LinkedIn profile URLs were found.', invalidRows }, 400);
  }

  const [batch] = await db
    .insert(schema.importBatches)
    .values({
      workspaceId: DEFAULT_WORKSPACE_ID,
      name,
      importedByUserId: userId,
      source: 'linkedin',
      totalRows: parsed.data.length,
      defaultTags: [name, 'needs profile capture'],
    })
    .returning();
  if (!batch) return c.json({ error: 'Could not create import batch.' }, 500);
  const [job] = await db
    .insert(schema.prospectImportJobs)
    .values({
      workspaceId: DEFAULT_WORKSPACE_ID,
      batchId: batch.id,
      createdBy: userId,
      name,
      status: 'pending',
      totalRows: parsed.data.length,
      invalidCount: invalidRows.length,
      errorRows: invalidRows,
    })
    .returning();
  if (!job) return c.json({ error: 'Could not create import job.' }, 500);
  c.executionCtx.waitUntil(
    processProspectImport(db, job.id, batch, userId, candidates, invalidRows).catch((error) =>
      console.error('Prospect import failed:', error)
    )
  );
  return c.json({ job, batchId: batch.id, validRows: candidates.length, invalidRows }, 202);
});

app.get('/api/prospects/imports/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  if (!getRole(c)) return c.json({ error: 'Forbidden.' }, 403);
  const [job] = await db
    .select()
    .from(schema.prospectImportJobs)
    .where(
      and(
        eq(schema.prospectImportJobs.id, c.req.param('id')),
        eq(schema.prospectImportJobs.workspaceId, DEFAULT_WORKSPACE_ID)
      )
    )
    .limit(1);
  return job ? c.json({ job }) : c.json({ error: 'Import job not found.' }, 404);
});

app.post('/api/prospects/claim-next', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  if (!getRole(c)) return c.json({ error: 'Forbidden.' }, 403);
  const userId = c.get('userId');
  const rateLimit = checkRateLimit(`prospects:claim:${userId}`, 30, 60_000);
  if (!rateLimit.allowed) {
    c.header('Retry-After', String(rateLimit.retryAfter));
    return c.json(
      { error: `Too many claim requests. Try again in ${rateLimit.retryAfter} seconds.` },
      429
    );
  }
  const body = await c.req.json();
  const requested = Number(body.limit ?? 5);
  const limit = Math.min(5, Math.max(1, Number.isFinite(requested) ? requested : 5));
  const leadFrom = Number(body.leadFrom);
  const leadTo = Number(body.leadTo);
  const search = typeof body.search === 'string' ? body.search.trim().toLowerCase() : '';
  const batchId =
    typeof body.batchId === 'string' && /^[0-9a-f-]{36}$/i.test(body.batchId) ? body.batchId : '';
  const captureStatus =
    typeof body.captureStatus === 'string' &&
    ['not_captured', 'processing', 'captured', 'partial', 'failed'].includes(body.captureStatus)
      ? body.captureStatus
      : '';
  const sortBy =
    typeof body.sortBy === 'string' &&
    [
      'leadSequence',
      'aiScore',
      'aiRemark',
      'name',
      'createdAt',
      'updatedAt',
      'companyName',
      'profileCaptureStatus',
      'dataCompleteness',
    ].includes(body.sortBy)
      ? body.sortBy
      : 'leadSequence';
  const sortOrder = body.sortOrder === 'desc' ? 'desc' : 'asc';
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT lead.id
      FROM crm.leads lead
      LEFT JOIN crm.prospect_review_claims claim ON claim.lead_id = lead.id
      LEFT JOIN crm.lead_ai_assessments assessment ON assessment.lead_id = lead.id
      WHERE lead.workspace_id = ${DEFAULT_WORKSPACE_ID}::uuid
        AND lead.review_state = 'pending'
        AND lead.deleted_at IS NULL
        AND lead.linkedin_url IS NOT NULL
        AND (${Number.isFinite(leadFrom) ? leadFrom : null}::bigint IS NULL
          OR lead.lead_sequence >= ${Number.isFinite(leadFrom) ? leadFrom : null})
        AND (${Number.isFinite(leadTo) ? leadTo : null}::bigint IS NULL
          OR lead.lead_sequence <= ${Number.isFinite(leadTo) ? leadTo : null})
        AND (${search || null}::text IS NULL OR
          lower(
            coalesce(lead.first_name, '') || ' ' ||
            coalesce(lead.last_name, '') || ' ' ||
            coalesce(lead.company_name, '') || ' ' ||
            coalesce(lead.linkedin_url, '') || ' ' ||
            coalesce(lead.lead_number, '')
          ) LIKE ${search ? `%${search}%` : null})
        AND (${captureStatus || null}::text IS NULL
          OR lead.profile_capture_status::text = ${captureStatus || null})
        AND (${batchId || null}::uuid IS NULL OR EXISTS (
          SELECT 1 FROM crm.lead_import_memberships membership
          WHERE membership.lead_id = lead.id
            AND membership.batch_id = ${batchId || null}::uuid
        ))
        AND (claim.lead_id IS NULL OR claim.expires_at <= now() OR claim.claimed_by = ${userId}::uuid)
      ORDER BY
        CASE WHEN ${sortBy} = 'leadSequence' AND ${sortOrder} = 'asc'
          THEN lead.lead_sequence END ASC NULLS LAST,
        CASE WHEN ${sortBy} = 'leadSequence' AND ${sortOrder} = 'desc'
          THEN lead.lead_sequence END DESC NULLS LAST,
        CASE WHEN ${sortBy} = 'aiScore' AND ${sortOrder} = 'asc' THEN
          CASE
            WHEN (
              lower(concat_ws(
                ' ', lead.first_name, lead.last_name, lead.headline, lead.about,
                lead.experience, lead.education, lead.skills, lead.current_role,
                lead.current_role_dates, lead.profile_summary,
                lead.education_entries::text, lead.experience_entries::text, lead.notes
              )) ~ '(^|[^[:alpha:]])ph[.]?[[:space:]]*d[.]?([^[:alpha:]]|$)'
              OR lower(concat_ws(
                ' ', lead.first_name, lead.last_name, lead.headline, lead.about,
                lead.experience, lead.education, lead.skills, lead.current_role,
                lead.current_role_dates, lead.profile_summary,
                lead.education_entries::text, lead.experience_entries::text, lead.notes
              )) LIKE '%doctor of philosophy%'
            ) THEN 0
            ELSE assessment.overall_score
          END
        END ASC NULLS LAST,
        CASE WHEN ${sortBy} = 'aiScore' AND ${sortOrder} = 'desc' THEN
          CASE
            WHEN (
              lower(concat_ws(
                ' ', lead.first_name, lead.last_name, lead.headline, lead.about,
                lead.experience, lead.education, lead.skills, lead.current_role,
                lead.current_role_dates, lead.profile_summary,
                lead.education_entries::text, lead.experience_entries::text, lead.notes
              )) ~ '(^|[^[:alpha:]])ph[.]?[[:space:]]*d[.]?([^[:alpha:]]|$)'
              OR lower(concat_ws(
                ' ', lead.first_name, lead.last_name, lead.headline, lead.about,
                lead.experience, lead.education, lead.skills, lead.current_role,
                lead.current_role_dates, lead.profile_summary,
                lead.education_entries::text, lead.experience_entries::text, lead.notes
              )) LIKE '%doctor of philosophy%'
            ) THEN 0
            ELSE assessment.overall_score
          END
        END DESC NULLS LAST,
        CASE WHEN ${sortBy} = 'aiRemark' AND ${sortOrder} = 'asc'
          THEN lower(assessment.reasoning_summary) END ASC NULLS LAST,
        CASE WHEN ${sortBy} = 'aiRemark' AND ${sortOrder} = 'desc'
          THEN lower(assessment.reasoning_summary) END DESC NULLS LAST,
        CASE WHEN ${sortBy} = 'name' AND ${sortOrder} = 'asc'
          THEN lower(lead.first_name || ' ' || lead.last_name) END ASC NULLS LAST,
        CASE WHEN ${sortBy} = 'name' AND ${sortOrder} = 'desc'
          THEN lower(lead.first_name || ' ' || lead.last_name) END DESC NULLS LAST,
        CASE WHEN ${sortBy} = 'createdAt' AND ${sortOrder} = 'asc'
          THEN lead.created_at END ASC NULLS LAST,
        CASE WHEN ${sortBy} = 'createdAt' AND ${sortOrder} = 'desc'
          THEN lead.created_at END DESC NULLS LAST,
        CASE WHEN ${sortBy} = 'updatedAt' AND ${sortOrder} = 'asc'
          THEN lead.updated_at END ASC NULLS LAST,
        CASE WHEN ${sortBy} = 'updatedAt' AND ${sortOrder} = 'desc'
          THEN lead.updated_at END DESC NULLS LAST,
        CASE WHEN ${sortBy} = 'companyName' AND ${sortOrder} = 'asc'
          THEN lower(lead.company_name) END ASC NULLS LAST,
        CASE WHEN ${sortBy} = 'companyName' AND ${sortOrder} = 'desc'
          THEN lower(lead.company_name) END DESC NULLS LAST,
        CASE WHEN ${sortBy} = 'profileCaptureStatus' AND ${sortOrder} = 'asc'
          THEN lead.profile_capture_status::text END ASC NULLS LAST,
        CASE WHEN ${sortBy} = 'profileCaptureStatus' AND ${sortOrder} = 'desc'
          THEN lead.profile_capture_status::text END DESC NULLS LAST,
        CASE WHEN ${sortBy} = 'dataCompleteness' AND ${sortOrder} = 'asc'
          THEN lead.data_completeness END ASC NULLS LAST,
        CASE WHEN ${sortBy} = 'dataCompleteness' AND ${sortOrder} = 'desc'
          THEN lead.data_completeness END DESC NULLS LAST,
        lead.lead_sequence ASC NULLS LAST,
        lead.created_at ASC
      LIMIT ${limit}
      FOR UPDATE OF lead SKIP LOCKED
    )
    INSERT INTO crm.prospect_review_claims
      (lead_id, workspace_id, claimed_by, claimed_at, expires_at)
    SELECT id, ${DEFAULT_WORKSPACE_ID}::uuid, ${userId}::uuid, now(), now() + interval '15 minutes'
    FROM candidates
    ON CONFLICT (lead_id) DO UPDATE SET
      claimed_by = EXCLUDED.claimed_by,
      claimed_at = EXCLUDED.claimed_at,
      expires_at = EXCLUDED.expires_at
    WHERE crm.prospect_review_claims.expires_at <= now()
       OR crm.prospect_review_claims.claimed_by = EXCLUDED.claimed_by
    RETURNING lead_id
  `);
  const claimedIds = ((result as unknown as { rows?: Array<{ lead_id: string }> }).rows ?? []).map(
    (row) => row.lead_id
  );
  const prospects =
    claimedIds.length > 0
      ? await db
          .select()
          .from(schema.leads)
          .where(inArray(schema.leads.id, claimedIds))
          .orderBy(asc(schema.leads.leadSequence))
      : [];
  for (const lead of prospects) {
    await db.insert(schema.leadEventOutbox).values({
      workspaceId: lead.workspaceId,
      leadId: lead.id,
      eventType: 'prospect.claimed',
      actorUserId: userId,
      payload: {
        lead: {
          ...lead,
          claimedBy: userId,
          claimExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        },
        occurredAt: new Date().toISOString(),
      },
    });
  }
  return c.json({ prospects, leaseMinutes: 15 });
});

app.put('/api/prospects/:id/review', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  if (!getRole(c)) return c.json({ error: 'Forbidden.' }, 403);
  const userId = c.get('userId');
  const rateLimit = checkRateLimit(`prospects:review:${userId}`, 120, 60_000);
  if (!rateLimit.allowed) {
    c.header('Retry-After', String(rateLimit.retryAfter));
    return c.json(
      { error: `Too many review updates. Try again in ${rateLimit.retryAfter} seconds.` },
      429
    );
  }
  const body = await c.req.json();
  if (!isProspectDisposition(body.disposition)) {
    return c.json({ error: 'Choose a valid review decision.' }, 400);
  }
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(
      and(
        eq(schema.leads.id, c.req.param('id')),
        eq(schema.leads.workspaceId, DEFAULT_WORKSPACE_ID),
        isNull(schema.leads.deletedAt)
      )
    )
    .limit(1);
  if (!lead) return c.json({ error: 'Prospect not found.' }, 404);
  try {
    const updated = await reviewProspect(
      db,
      lead,
      userId,
      body.disposition,
      null,
      typeof body.rowVersion === 'number' ? body.rowVersion : undefined
    );
    if (updated.reviewState === 'accepted' && !isLeadHoldingStage(updated.journeyStage)) {
      c.executionCtx.waitUntil(
        generateAndSaveLeadAiAssessment(db, updated, c.env).catch((error) =>
          console.error('Accepted prospect AI assessment failed:', error)
        )
      );
    }
    return c.json({ lead: updated });
  } catch (error) {
    if (error instanceof Error && error.message === 'PROSPECT_VERSION_CONFLICT') {
      return c.json({ error: 'This prospect changed in another session. Refresh and retry.' }, 409);
    }
    throw error;
  }
});

app.get('/api/prospect-events', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  if (!getRole(c)) return c.json({ error: 'Forbidden.' }, 403);
  const after = Math.max(0, Number.parseInt(c.req.query('after') || '0', 10) || 0);
  const events = await db
    .select()
    .from(schema.leadEventOutbox)
    .where(
      and(
        eq(schema.leadEventOutbox.workspaceId, DEFAULT_WORKSPACE_ID),
        sql`${schema.leadEventOutbox.sequence} > ${after}`
      )
    )
    .orderBy(asc(schema.leadEventOutbox.sequence))
    .limit(200);
  return c.json({
    events,
    cursor: events.at(-1)?.sequence ?? after,
  });
});

// --- LEADS ---

app.get('/api/leads', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  // Parse query params
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(c.req.query('pageSize') || '50', 10)));
  const {
    status,
    source,
    search,
    owner,
    outreachStatus,
    batchId,
    tag,
    include,
    statuses,
    outreachStatuses,
    owners,
    tags,
    createdFrom,
    createdTo,
  } = c.req.query();
  const sortBy = c.req.query('sortBy') || 'createdAt';
  const sortOrder = c.req.query('sortOrder') || 'desc';

  const conditions = buildLeadConditions({
    isSuperadmin,
    ownerId: caller.userId,
    status,
    statuses: parseCommaList(statuses),
    source,
    search,
    owner,
    owners: parseCommaList(owners),
    outreachStatus,
    outreachStatuses: parseCommaList(outreachStatuses),
    batchId,
    tag,
    tags: parseCommaList(tags),
    createdFrom,
    createdTo,
  });

  const sortColumn = resolveLeadSortColumn(sortBy);
  const orderByClause =
    sortOrder === 'asc' ? sql`${sortColumn} asc nulls last` : sql`${sortColumn} desc nulls last`;

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.leads)
    .where(and(...conditions));
  const total = countResult[0]?.count ?? 0;

  // Get paginated rows
  const rows = await db
    .select({
      ...getTableColumns(schema.leads),
      aiScore: schema.leadAiAssessments.overallScore,
      aiClassification: schema.leadAiAssessments.classification,
      scoreJobStatus: schema.leadScoreJobs.status,
    })
    .from(schema.leads)
    .leftJoin(schema.leadAiAssessments, eq(schema.leadAiAssessments.leadId, schema.leads.id))
    .leftJoin(schema.leadScoreJobs, eq(schema.leadScoreJobs.leadId, schema.leads.id))
    .where(and(...conditions))
    .orderBy(orderByClause)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Get status counts (for filters)
  const statusCountsRaw = await db
    .select({ status: schema.leads.journeyStage, count: sql<number>`count(*)` })
    .from(schema.leads)
    .where(
      and(
        isNull(schema.leads.deletedAt),
        eq(schema.leads.reviewState, 'accepted'),
        ...(!isSuperadmin ? [eq(schema.leads.ownerId, caller.userId)] : [])
      )
    )
    .groupBy(schema.leads.journeyStage);

  const statusCounts = Object.fromEntries(LEAD_JOURNEY_STAGES.map((stage) => [stage, 0])) as Record<
    LeadJourneyStage,
    number
  >;
  statusCountsRaw.forEach((s) => {
    statusCounts[s.status as keyof typeof statusCounts] = s.count;
  });

  // Optionally include channels for each lead (detail view)
  let leadsWithChannels: unknown[] = rows;
  if (include === 'channels' && rows.length > 0) {
    const leadIds = rows.map((r) => r.id);
    const allChannels = await db
      .select()
      .from(schema.leadChannels)
      .where(sql`${schema.leadChannels.leadId} = any(${leadIds}::uuid[])`)
      .orderBy(asc(schema.leadChannels.sequence));
    leadsWithChannels = rows.map((r) => ({
      ...r,
      channels: allChannels.filter((ch) => ch.leadId === r.id),
    }));
  }

  return c.json({
    leads: leadsWithChannels,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    statusCounts,
  });
});

app.post('/api/leads', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const requestedTags = normalizeTagNames(body.tags);
  const baseJourneyStage = isLeadJourneyStage(body.journeyStage)
    ? body.journeyStage
    : journeyStageFromLegacy({
        status: body.status,
        outreachStatus: body.outreachStatus,
      });
  const journeyStage = journeyStageForTags(baseJourneyStage, requestedTags);
  const legacy = legacyFieldsForJourney(journeyStage);
  if (!isSuperadmin && role !== 'manager') {
    const unknownTags = await unknownTagNames(db, requestedTags);
    if (unknownTags.length > 0) {
      return c.json(
        { error: `Members can only assign existing tags: ${unknownTags.join(', ')}` },
        400
      );
    }
  }
  const tags =
    isSuperadmin || role === 'manager'
      ? await ensureTagDefinitions(db, requestedTags, caller.userId)
      : requestedTags;
  const leadIdentity = await nextLeadIdentity(db);
  const normalizedLinkedInUrl = canonicalizeLinkedinUrl(body.linkedinUrl);
  const data = {
    ...leadIdentity,
    workspaceId: DEFAULT_WORKSPACE_ID,
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone ?? null,
    companyName: body.companyName ?? null,
    companyDomain: body.companyDomain ?? null,
    linkedinUrl: normalizedLinkedInUrl,
    linkedinProfileKey: linkedinProfileKey(normalizedLinkedInUrl),
    outreachStatus: legacy.outreachStatus,
    approachedAt: body.approachedAt ? new Date(body.approachedAt) : null,
    connectionStatus: body.connectionStatus ?? null,
    sourceSheet: body.sourceSheet ?? null,
    originalRowNumber: body.originalRowNumber ?? null,
    tags: tags.length > 0 ? tags : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    source: (body.source ?? 'other') as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: legacy.status as any,
    journeyStage,
    notes: body.notes ?? null,
    ownerId: caller.userId,
  };

  const [result] = await db.insert(schema.leads).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  let finalResult = result;
  if (hasPhdProfileEvidence(result)) {
    finalResult = (await enforcePhdAutoDisqualification(db, result, caller.userId)) ?? result;
  } else if (hasLeadProfileEvidence(result)) {
    await enqueueLeadProfileCleanup(db, result.id);
  }
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'lead',
    resourceId: result.id,
    after: data,
    app: 'crm',
  });

  // Auto-create lead_channels rows for the standard channels present on the lead
  if (finalResult.reviewState !== 'rejected' && !isLeadHoldingStage(finalResult.journeyStage)) {
    c.executionCtx.waitUntil(autoCreateLeadChannels(db, finalResult).catch(() => {}));
  }

  // Trigger workflow event for lead_created rules
  if (finalResult.reviewState !== 'rejected' && !isLeadHoldingStage(finalResult.journeyStage)) {
    c.executionCtx.waitUntil(
      triggerWorkflowEvent(c.env, 'lead_created', {
        id: finalResult.id,
        source: finalResult.source,
        ownerId: finalResult.ownerId,
      })
    );
  }

  // Basic email stub — will be wired to Resend in a future ticket
  if (finalResult.email && finalResult.reviewState !== 'rejected') {
    sendEmail(c.env, finalResult.email, 'New lead in Skarion CRM', 'Welcome to Skarion CRM');
  }

  // Auto-embed for RAG chatbot
  c.executionCtx.waitUntil(
    ai
      .autoEmbed(
        db,
        schema,
        'lead',
        finalResult.id,
        `${finalResult.firstName} ${finalResult.lastName} ${finalResult.email ?? ''} ${finalResult.companyName ?? ''} ${finalResult.notes ?? ''}`,
        caller.userId,
        c.env
      )
      .catch(() => {})
  );

  // Notification
  c.executionCtx.waitUntil(
    createNotification(
      db,
      schema,
      caller.userId,
      'lead_created',
      'New lead created',
      `${finalResult.firstName} ${finalResult.lastName} was added to the CRM.`,
      'lead',
      finalResult.id
    ).catch(() => {})
  );

  let aiAssessment = null;
  if (shouldAutoGenerateLinkedinConnectionNote(finalResult)) {
    try {
      aiAssessment = await generateAndSaveLeadAiAssessment(db, finalResult, c.env);
    } catch (error) {
      console.error('LinkedIn lead AI assessment failed:', error);
    }
  }

  return c.json({ lead: finalResult, aiAssessment }, 201);
});

function escapeCsv(val: unknown): string {
  const s = val === null || val === undefined ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

app.get('/api/leads/export.csv', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const {
    status,
    source,
    search,
    outreachStatus,
    owner,
    batchId,
    tag,
    statuses,
    outreachStatuses,
    owners,
    tags,
    createdFrom,
    createdTo,
  } = c.req.query();
  const sortBy = c.req.query('sortBy');
  const sortOrder = c.req.query('sortOrder') || 'desc';

  const conditions = buildLeadConditions({
    isSuperadmin,
    ownerId: caller.userId,
    status,
    statuses: parseCommaList(statuses),
    source,
    search,
    owner,
    owners: parseCommaList(owners),
    outreachStatus,
    outreachStatuses: parseCommaList(outreachStatuses),
    batchId,
    tag,
    tags: parseCommaList(tags),
    createdFrom,
    createdTo,
  });
  const sortColumn = resolveLeadSortColumn(sortBy);
  const orderByClause =
    sortOrder === 'asc' ? sql`${sortColumn} asc nulls last` : sql`${sortColumn} desc nulls last`;

  const rows = await db
    .select({
      ...getTableColumns(schema.leads),
      aiScore: schema.leadAiAssessments.overallScore,
      aiClassification: schema.leadAiAssessments.classification,
    })
    .from(schema.leads)
    .leftJoin(schema.leadAiAssessments, eq(schema.leadAiAssessments.leadId, schema.leads.id))
    .where(and(...conditions))
    .orderBy(orderByClause);

  const headers = [
    'leadNumber',
    'firstName',
    'lastName',
    'email',
    'phone',
    'companyName',
    'companyDomain',
    'linkedinUrl',
    'journeyStage',
    'aiScore',
    'aiClassification',
    'source',
    'tags',
    'notes',
    'createdAt',
    'updatedAt',
  ];

  let csv = headers.map(escapeCsv).join(',') + '\n';
  for (const row of rows) {
    csv +=
      [
        row.leadNumber,
        row.firstName,
        row.lastName,
        row.email,
        row.phone,
        row.companyName,
        row.companyDomain,
        row.linkedinUrl,
        row.journeyStage,
        row.aiScore,
        row.aiClassification,
        row.source,
        normalizeTagNames(row.tags).join(' | '),
        row.notes,
        row.createdAt ? new Date(row.createdAt).toISOString() : '',
        row.updatedAt ? new Date(row.updatedAt).toISOString() : '',
      ]
        .map(escapeCsv)
        .join(',') + '\n';
  }

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="skarion-leads.csv"');

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'export',
    resourceType: 'leads',
    resourceId: 'bulk',
    after: {
      count: rows.length,
      filters: {
        status,
        statuses,
        source,
        search,
        owner,
        owners,
        outreachStatus,
        outreachStatuses,
        batchId,
        tag,
        tags,
        createdFrom,
        createdTo,
      },
    },
    app: 'crm',
  });

  return c.body(csv);
});

// ─────────────────────────────────────────────────────────
// SAVED SEARCHES — own-only (no superadmin override, matches the brief's
// own call for simplicity here). Registered before /api/leads/:id so
// "saved-searches" is never swallowed as a lead id.
// ─────────────────────────────────────────────────────────

app.get('/api/leads/saved-searches', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const caller = { userId: c.get('userId') };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const rows = await db
    .select()
    .from(schema.leadSavedSearches)
    .where(eq(schema.leadSavedSearches.ownerId, caller.userId))
    .orderBy(desc(schema.leadSavedSearches.updatedAt));

  return c.json({ savedSearches: rows });
});

app.post('/api/leads/saved-searches', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const caller = { userId: c.get('userId') };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const body = await c.req.json();
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name is required.' }, 400);
  }
  if (body.filters === undefined) {
    return c.json({ error: 'filters is required.' }, 400);
  }

  try {
    const [result] = await db
      .insert(schema.leadSavedSearches)
      .values({
        ownerId: caller.userId,
        name: body.name.trim(),
        filters: body.filters,
        sortBy: body.sortBy ?? null,
        sortOrder: body.sortOrder ?? null,
      })
      .returning();
    return c.json({ savedSearch: result }, 201);
  } catch (err) {
    const code =
      (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
      (err as { code?: string })?.code;
    if (code === '23505') {
      return c.json({ error: `A saved search named "${body.name.trim()}" already exists.` }, 409);
    }
    throw err;
  }
});

app.delete('/api/leads/saved-searches/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const id = c.req.param('id');
  const caller = { userId: c.get('userId') };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const [existing] = await db
    .select()
    .from(schema.leadSavedSearches)
    .where(
      and(eq(schema.leadSavedSearches.id, id), eq(schema.leadSavedSearches.ownerId, caller.userId))
    );
  // 404 rather than 403 for a search owned by someone else — don't confirm
  // whether it exists at all.
  if (!existing) return c.json({ error: 'Not found.' }, 404);

  await db.delete(schema.leadSavedSearches).where(eq(schema.leadSavedSearches.id, id));
  return c.json({ success: true });
});

app.get('/api/leads/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  return c.json({ lead: row });
});

app.put('/api/leads/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  let updatedTags: string[] | undefined;
  if (body.firstName !== undefined) update.firstName = body.firstName;
  if (body.lastName !== undefined) update.lastName = body.lastName;
  if (body.email !== undefined) update.email = body.email;
  if (body.phone !== undefined) update.phone = body.phone;
  if (body.headline !== undefined) update.headline = body.headline;
  if (body.location !== undefined) update.location = body.location;
  if (body.about !== undefined) update.about = body.about;
  if (body.experience !== undefined) update.experience = body.experience;
  if (body.education !== undefined) update.education = body.education;
  if (body.skills !== undefined) update.skills = body.skills;
  if (body.currentRole !== undefined) update.currentRole = body.currentRole;
  if (body.currentRoleDates !== undefined) update.currentRoleDates = body.currentRoleDates;
  if (body.openToWork !== undefined) update.openToWork = body.openToWork;
  if (body.yearsExperience !== undefined) update.yearsExperience = body.yearsExperience;
  if (body.connectionDegree !== undefined) update.connectionDegree = body.connectionDegree;
  if (body.companyName !== undefined) update.companyName = body.companyName;
  if (body.companyDomain !== undefined) update.companyDomain = body.companyDomain;
  if (body.linkedinUrl !== undefined) update.linkedinUrl = body.linkedinUrl;
  if (body.outreachStatus !== undefined) update.outreachStatus = body.outreachStatus;
  if (body.approachedAt !== undefined)
    update.approachedAt = body.approachedAt ? new Date(body.approachedAt) : null;
  if (body.connectionStatus !== undefined) update.connectionStatus = body.connectionStatus;
  if (body.sourceSheet !== undefined) update.sourceSheet = body.sourceSheet;
  if (body.originalRowNumber !== undefined) update.originalRowNumber = body.originalRowNumber;
  if (body.tags !== undefined) {
    const tags = normalizeTagNames(body.tags);
    if (isSuperadmin || role === 'manager') {
      await ensureTagDefinitions(db, tags, caller.userId);
      update.tags = tags;
      updatedTags = tags;
    } else {
      const definitions = await db
        .select({ name: schema.tagDefinitions.name })
        .from(schema.tagDefinitions);
      const known = new Set(definitions.map((tag) => tag.name.toLowerCase()));
      if (tags.some((tag) => !known.has(tag.toLowerCase()))) {
        return c.json({ error: 'Members can only assign existing tags.' }, 400);
      }
      update.tags = tags;
      updatedTags = tags;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (body.source !== undefined) update.source = body.source as any;
  if (body.journeyStage !== undefined || body.status !== undefined) {
    const journeyStage = isLeadJourneyStage(body.journeyStage)
      ? body.journeyStage
      : journeyStageFromLegacy({
          status: body.status,
          outreachStatus: body.outreachStatus ?? existing.outreachStatus,
        });
    const legacy = legacyFieldsForJourney(journeyStage);
    update.journeyStage = journeyStage;
    update.status = legacy.status;
    update.outreachStatus = legacy.outreachStatus;
    const syncedTags = syncHoldingTagsForJourney(updatedTags ?? existing.tags, journeyStage);
    if (isLeadHoldingStage(journeyStage)) {
      await ensureTagDefinitions(
        db,
        [journeyStage === 'future' ? 'Future' : 'Foreign National'],
        caller.userId,
        true
      );
    }
    update.tags = syncedTags;
    updatedTags = syncedTags;
  } else if (updatedTags) {
    const baseJourneyStage = isLeadHoldingStage(existing.journeyStage)
      ? 'new'
      : existing.journeyStage;
    const journeyStage = journeyStageForTags(baseJourneyStage, updatedTags);
    if (journeyStage !== existing.journeyStage) {
      const legacy = legacyFieldsForJourney(journeyStage);
      update.journeyStage = journeyStage;
      update.status = legacy.status;
      update.outreachStatus = legacy.outreachStatus;
    }
  }
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.ownerId !== undefined && isSuperadmin) update.ownerId = body.ownerId;
  // batchId is server-controlled; only superadmins may reassign it.
  if (body.batchId !== undefined && isSuperadmin) update.batchId = body.batchId;
  // leadNumber is server-controlled and never writable via PUT.
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.leads)
    .set(update)
    .where(eq(schema.leads.id, id))
    .returning();
  if (
    result &&
    [
      'headline',
      'location',
      'about',
      'experience',
      'education',
      'skills',
      'currentRole',
      'currentRoleDates',
      'openToWork',
      'yearsExperience',
    ].some((field) => body[field] !== undefined) &&
    hasLeadProfileEvidence(result)
  ) {
    await enqueueLeadProfileCleanup(db, result.id);
  }
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'lead',
    resourceId: id,
    before: existing,
    after: result,
    app: 'crm',
  });

  if (isLeadHoldingStage(result.journeyStage) && !isLeadHoldingStage(existing.journeyStage)) {
    await db
      .delete(schema.leadScoreJobs)
      .where(
        and(
          eq(schema.leadScoreJobs.leadId, result.id),
          inArray(schema.leadScoreJobs.status, ['pending', 'failed'])
        )
      );
  } else if (
    isLeadHoldingStage(existing.journeyStage) &&
    isLeadActivationStage(result.journeyStage)
  ) {
    await db
      .insert(schema.leadScoreJobs)
      .values({ leadId: result.id })
      .onConflictDoNothing({ target: schema.leadScoreJobs.leadId });
    c.executionCtx.waitUntil(
      Promise.all([
        autoCreateLeadChannels(db, result),
        triggerWorkflowEvent(c.env, 'lead_created', {
          id: result.id,
          source: result.source,
          ownerId: result.ownerId,
        }),
        result.source === 'linkedin'
          ? generateAndSaveLeadAiAssessment(db, result, c.env).catch((error) => {
              console.error('Holding-stage lead activation AI assessment failed:', error);
              return null;
            })
          : Promise.resolve(null),
      ]).then(() => undefined)
    );
  }

  // Auto-embed for RAG chatbot
  c.executionCtx.waitUntil(
    ai
      .autoEmbed(
        db,
        schema,
        'lead',
        result.id,
        `${result.firstName} ${result.lastName} ${result.email ?? ''} ${result.companyName ?? ''} ${result.notes ?? ''}`,
        caller.userId,
        c.env
      )
      .catch(() => {})
  );

  return c.json({ lead: result });
});

app.delete('/api/leads/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  if (!isSuperadmin) {
    return c.json({ error: 'Forbidden. Superadmin access is required to delete leads.' }, 403);
  }

  const [existing] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'delete', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db
    .update(schema.leads)
    .set({
      deletedAt: new Date(),
      deletedBy: caller.userId,
    })
    .where(eq(schema.leads.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'lead',
    resourceId: id,
    before: existing,
    app: 'crm',
  });

  return c.json({ success: true });
});

// ─── LEAD CHANNELS / OUTREACH / ATTACHMENTS ─────────────────────────────────

const OUTREACH_CHANNELS = [
  'linkedin',
  'instagram',
  'facebook',
  'whatsapp',
  'email',
  'phone',
] as const;
const LEAD_CHANNEL_STAGES = [
  'not_started',
  'connection_request_sent',
  'connection_accepted',
  'message_sent',
  'awaiting_reply',
  'in_conversation',
  'warm_up_needed',
  'replied',
  'booked_call',
  'no_response',
] as const;
const CHANNEL_ACTIVITY_TYPE: Record<string, string> = {
  linkedin: 'linkedin_outreach',
  instagram: 'instagram_outreach',
  facebook: 'facebook_outreach',
  whatsapp: 'whatsapp_outreach',
  email: 'email',
  phone: 'phone_outreach',
};

/** Auto-create lead_channels rows for the standard channels present on a lead. */
async function autoCreateLeadChannels(
  db: CrmDb,
  lead: {
    id: string;
    ownerId: string;
    linkedinUrl: string | null;
    email: string | null;
    phone: string | null;
  }
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = [];
  if (lead.linkedinUrl) {
    rows.push({
      leadId: lead.id,
      channel: 'linkedin',
      stage: 'not_started',
      sequence: 1,
      ownerId: lead.ownerId,
    });
  }
  if (lead.email && !lead.email.includes('@placeholder.skarion')) {
    rows.push({
      leadId: lead.id,
      channel: 'email',
      stage: 'not_started',
      sequence: 2,
      ownerId: lead.ownerId,
    });
  }
  if (lead.phone) {
    rows.push({
      leadId: lead.id,
      channel: 'phone',
      stage: 'not_started',
      sequence: 3,
      ownerId: lead.ownerId,
    });
  }
  if (rows.length > 0) {
    await db.insert(schema.leadChannels).values(rows);
  }
}

/** Keep legacy outreach metadata and the authoritative journey in sync with channels. */
async function recomputeLeadOutreachStatus(
  db: CrmDb,
  leadId: string
): Promise<{ outreachStatus: string; journeyStage: LeadJourneyStage }> {
  const channels = await db
    .select({ stage: schema.leadChannels.stage })
    .from(schema.leadChannels)
    .where(eq(schema.leadChannels.leadId, leadId));
  const outreachStatus = computeOutreachSummary(channels.map((c) => ({ stage: c.stage })));
  const [lead] = await db
    .select({ journeyStage: schema.leads.journeyStage })
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1);
  const journeyStage = mergeJourneyWithChannelStages(
    lead?.journeyStage ?? 'new',
    channels.map((channel) => channel.stage)
  );
  const legacy = legacyFieldsForJourney(journeyStage);
  await db
    .update(schema.leads)
    .set({
      journeyStage,
      status: legacy.status,
      outreachStatus,
      updatedAt: new Date(),
    })
    .where(eq(schema.leads.id, leadId));
  return { outreachStatus, journeyStage };
}

app.post('/api/leads/:id/outreach-actions', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!lead) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const channel = body.channel as string;
  if (!channel || !OUTREACH_CHANNELS.includes(channel as (typeof OUTREACH_CHANNELS)[number])) {
    return c.json({ error: 'Invalid channel.' }, 400);
  }
  const action = body.action as 'log_attempt' | 'set_stage' | undefined;
  const stage = body.stage as string | undefined;

  // Find existing channel row
  const [existingChannel] = await db
    .select()
    .from(schema.leadChannels)
    .where(
      and(eq(schema.leadChannels.leadId, id), eq(schema.leadChannels.channel, channel as never))
    );

  let updatedRow: typeof schema.leadChannels.$inferSelect | null = null;
  let subject = '';

  if (action === 'log_attempt') {
    const now = new Date();
    if (existingChannel) {
      const [row] = await db
        .update(schema.leadChannels)
        .set({
          attemptCount: (existingChannel.attemptCount ?? 0) + 1,
          lastAttemptAt: now,
          updatedAt: now,
        })
        .where(eq(schema.leadChannels.id, existingChannel.id))
        .returning();
      updatedRow = row ?? null;
    } else {
      const maxSeqRows = await db
        .select({ seq: schema.leadChannels.sequence })
        .from(schema.leadChannels)
        .where(eq(schema.leadChannels.leadId, id));
      const maxSeq = maxSeqRows.reduce((m, r) => Math.max(m, r.seq), 0);
      const [row] = await db
        .insert(schema.leadChannels)
        .values({
          leadId: id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          channel: channel as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stage: (stage ?? 'message_sent') as any,
          sequence: maxSeq + 1,
          ownerId: lead.ownerId,
        })
        .returning();
      updatedRow = row ?? null;
    }
    subject = `Outreach logged on ${channel}`;
  } else {
    // set_stage (also trigger when stage provided without action)
    const finalStage = (stage ?? action === 'set_stage') ? stage : undefined;
    if (
      !finalStage ||
      !LEAD_CHANNEL_STAGES.includes(finalStage as (typeof LEAD_CHANNEL_STAGES)[number])
    ) {
      return c.json({ error: 'Invalid stage.' }, 400);
    }
    if (existingChannel) {
      const [row] = await db
        .update(schema.leadChannels)
        .set({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stage: finalStage as any,
          updatedAt: new Date(),
        })
        .where(eq(schema.leadChannels.id, existingChannel.id))
        .returning();
      updatedRow = row ?? null;
    } else {
      const maxSeqRows = await db
        .select({ seq: schema.leadChannels.sequence })
        .from(schema.leadChannels)
        .where(eq(schema.leadChannels.leadId, id));
      const maxSeq = maxSeqRows.reduce((m, r) => Math.max(m, r.seq), 0);
      const [row] = await db
        .insert(schema.leadChannels)
        .values({
          leadId: id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          channel: channel as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stage: finalStage as any,
          sequence: maxSeq + 1,
          ownerId: lead.ownerId,
        })
        .returning();
      updatedRow = row ?? null;
    }
    subject = `Stage set to ${finalStage}`;
  }

  if (!updatedRow) return c.json({ error: 'Internal error' }, 500);

  // Recompute leads.outreachStatus from all channels
  const journey = await recomputeLeadOutreachStatus(db, id);

  // Activity row referencing the lead via content JSON (no leadId FK on activities)
  await db.insert(schema.activities).values({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type: (CHANNEL_ACTIVITY_TYPE[channel] ?? 'note') as any,
    subject,
    content: JSON.stringify({ leadId: id }),
    contactId: null,
    companyId: null,
    opportunityId: null,
    actorId: caller.userId,
    happenedAt: new Date(),
  });

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'lead_channel',
    resourceId: updatedRow.id,
    before: existingChannel ?? null,
    after: updatedRow,
    app: 'crm',
  });

  return c.json({ channel: updatedRow, lead: journey });
});

app.get('/api/leads/:id/channels', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!lead) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const channels = await db
    .select()
    .from(schema.leadChannels)
    .where(eq(schema.leadChannels.leadId, id))
    .orderBy(asc(schema.leadChannels.sequence));
  return c.json({ channels });
});

app.get('/api/leads/:id/attachments', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!lead) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const attachments = await db
    .select()
    .from(schema.leadAttachments)
    .where(eq(schema.leadAttachments.leadId, id))
    .orderBy(desc(schema.leadAttachments.createdAt));
  return c.json({ attachments });
});

app.post('/api/leads/:id/attachments', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!lead) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const formData = await c.req.formData();
  const rawFile = formData.get('file');
  if (typeof rawFile === 'string' || rawFile === null) {
    return c.json({ error: "Missing 'file' field." }, 400);
  }
  const file = rawFile as {
    name: string;
    type: string;
    size: number;
    arrayBuffer: () => Promise<ArrayBuffer>;
  };
  const maxBytes = 25 * 1024 * 1024;
  if (file.size > maxBytes) {
    return c.json({ error: 'File too large (max 25MB).' }, 413);
  }

  const filename = file.name || 'attachment';
  const mimeType = file.type || 'application/octet-stream';
  const r2Key = `${id}/${crypto.randomUUID()}/${filename}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const bucket = c.env.ATTACHMENTS_BUCKET;
  if (bucket) {
    await bucket.put(r2Key, bytes, { httpMetadata: { contentType: mimeType } });
  } else {
    console.warn(`[ATTACHMENTS] R2 binding not available; metadata-only insert for ${r2Key}`);
  }

  const [attachment] = await db
    .insert(schema.leadAttachments)
    .values({
      leadId: id,
      filename,
      mimeType,
      size: file.size,
      r2Key,
      uploadedBy: caller.userId,
    })
    .returning();
  if (!attachment) return c.json({ error: 'Internal error' }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'lead_attachment',
    resourceId: attachment.id,
    after: attachment,
    app: 'crm',
  });

  return c.json({ attachment }, 201);
});

app.get('/api/leads/attachments/:id/download', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [attachment] = await db
    .select()
    .from(schema.leadAttachments)
    .where(eq(schema.leadAttachments.id, id));
  if (!attachment) return c.json({ error: 'Not found.' }, 404);

  const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, attachment.leadId));
  if (!lead) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const bucket = c.env.ATTACHMENTS_BUCKET;
  if (!bucket) return c.json({ error: 'Attachment storage not configured.' }, 503);

  const r2Object = await bucket.get(attachment.r2Key);
  if (!r2Object || !r2Object.body) return c.json({ error: 'File not found in storage.' }, 404);

  return c.body(r2Object.body, 200, {
    'Content-Type': attachment.mimeType,
    'Content-Disposition': `attachment; filename="${attachment.filename.replace(/"/g, "'")}"`,
  });
});

app.delete('/api/leads/attachments/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [attachment] = await db
    .select()
    .from(schema.leadAttachments)
    .where(eq(schema.leadAttachments.id, id));
  if (!attachment) return c.json({ error: 'Not found.' }, 404);

  const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, attachment.leadId));
  if (!lead) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const bucket = c.env.ATTACHMENTS_BUCKET;
  if (bucket) {
    await bucket.delete(attachment.r2Key);
  }

  await db.delete(schema.leadAttachments).where(eq(schema.leadAttachments.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'lead_attachment',
    resourceId: id,
    before: attachment,
    app: 'crm',
  });

  return c.json({ success: true });
});

// ─── LEAD BULK ACTIONS ─────────────────────────────────────────────

app.post('/api/leads/bulk', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const body = await c.req.json();
  const ids = body.ids as string[];
  const action = body.action as
    | 'delete'
    | 'update_status'
    | 'update_journey_stage'
    | 'update_outreach_status'
    | 'update_tags'
    | 'assign_owner';

  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: 'No IDs provided.' }, 400);
  }
  if (ids.length > 500) {
    return c.json({ error: 'Maximum 500 items per bulk action.' }, 413);
  }
  if (
    ![
      'delete',
      'update_status',
      'update_journey_stage',
      'update_outreach_status',
      'update_tags',
      'assign_owner',
    ].includes(action)
  ) {
    return c.json({ error: 'Invalid action.' }, 400);
  }

  // Lead deletion is deliberately stricter than ordinary editing. Other users
  // keep records auditable by moving them to Disqualified or Lost.
  if (action === 'delete' && !isSuperadmin) {
    return c.json({ error: 'Forbidden. Superadmin access is required to delete leads.' }, 403);
  }

  // update_tags requires manager or superadmin; assign_owner requires superadmin only.
  if (action === 'update_tags' && !isSuperadmin && role !== 'manager') {
    return c.json({ error: 'Forbidden. Manager role required to bulk-update tags.' }, 403);
  }
  if (action === 'assign_owner' && !isSuperadmin) {
    return c.json({ error: 'Forbidden. Superadmin role required to reassign owners.' }, 403);
  }

  // Rate limit: 10 bulk actions per minute per user
  const rl = checkRateLimit(`bulk:leads:${caller.userId}`, 10, 60000);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return c.json({ error: `Rate limit exceeded. Try again in ${rl.retryAfter} seconds.` }, 429);
  }

  // Verify all leads exist and caller has permission
  // Safe approach: fetch all accessible non-deleted leads, then filter by ID in JS
  const accessConditions = [isNull(schema.leads.deletedAt)];
  if (!isSuperadmin) {
    accessConditions.push(eq(schema.leads.ownerId, caller.userId));
  }
  const allAccessibleLeads = await db
    .select()
    .from(schema.leads)
    .where(and(...accessConditions));
  const allLeads = allAccessibleLeads.filter((l) => ids.includes(l.id));

  if (allLeads.length === 0) {
    return c.json({ error: 'No leads found.' }, 404);
  }

  const notFound = ids.filter((id) => !allLeads.find((l) => l.id === id));
  if (notFound.length > 0) {
    return c.json({ error: `Some leads not found: ${notFound.join(', ')}` }, 404);
  }

  for (const lead of allLeads) {
    if (
      !can(
        isSuperadmin,
        role,
        action === 'delete' ? 'delete' : 'edit',
        { ownerId: lead.ownerId },
        caller
      )
    ) {
      return c.json({ error: `Forbidden on lead ${lead.id}.` }, 403);
    }
  }

  let updatedCount = 0;
  let deletedCount = 0;

  if (action === 'delete') {
    const now = new Date();
    for (const lead of allLeads) {
      await db
        .update(schema.leads)
        .set({
          deletedAt: now,
          deletedBy: caller.userId,
        })
        .where(eq(schema.leads.id, lead.id));
      await withAudit(db, schema.auditLog, {
        actorUserId: caller.userId,
        action: 'delete',
        resourceType: 'lead',
        resourceId: lead.id,
        before: lead,
        app: 'crm',
      });
      deletedCount++;
    }
  } else if (action === 'update_status' || action === 'update_journey_stage') {
    const requestedStage =
      action === 'update_journey_stage'
        ? body.journeyStage
        : journeyStageFromLegacy({ status: body.status });
    if (!isLeadJourneyStage(requestedStage)) {
      return c.json({ error: 'Invalid lead journey stage.' }, 400);
    }
    const legacy = legacyFieldsForJourney(requestedStage);
    if (isLeadHoldingStage(requestedStage)) {
      await ensureTagDefinitions(
        db,
        [requestedStage === 'future' ? 'Future' : 'Foreign National'],
        caller.userId,
        true
      );
    }
    const now = new Date();
    for (const lead of allLeads) {
      const nextTags = syncHoldingTagsForJourney(lead.tags, requestedStage);
      await db
        .update(schema.leads)
        .set({
          journeyStage: requestedStage,
          status: legacy.status,
          outreachStatus: legacy.outreachStatus,
          tags: nextTags,
          updatedAt: now,
        })
        .where(eq(schema.leads.id, lead.id));
      await withAudit(db, schema.auditLog, {
        actorUserId: caller.userId,
        action: 'edit',
        resourceType: 'lead',
        resourceId: lead.id,
        before: lead,
        after: {
          ...lead,
          journeyStage: requestedStage,
          status: legacy.status,
          outreachStatus: legacy.outreachStatus,
          tags: nextTags,
          updatedAt: now,
        },
        app: 'crm',
      });
      if (isLeadHoldingStage(lead.journeyStage) && isLeadActivationStage(requestedStage)) {
        await db
          .insert(schema.leadScoreJobs)
          .values({ leadId: lead.id })
          .onConflictDoNothing({ target: schema.leadScoreJobs.leadId });
        await autoCreateLeadChannels(db, lead);
        await triggerWorkflowEvent(c.env, 'lead_created', {
          id: lead.id,
          source: lead.source,
          ownerId: lead.ownerId,
        });
      } else if (!isLeadHoldingStage(lead.journeyStage) && isLeadHoldingStage(requestedStage)) {
        await db
          .delete(schema.leadScoreJobs)
          .where(
            and(
              eq(schema.leadScoreJobs.leadId, lead.id),
              inArray(schema.leadScoreJobs.status, ['pending', 'failed'])
            )
          );
      }
      updatedCount++;
    }
  } else if (action === 'update_outreach_status') {
    const outreachStatus = body.outreachStatus as string;
    if (!outreachStatus) return c.json({ error: "Missing 'outreachStatus' field." }, 400);
    const now = new Date();
    for (const lead of allLeads) {
      await db
        .update(schema.leads)
        .set({
          outreachStatus: outreachStatus as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          updatedAt: now,
        })
        .where(eq(schema.leads.id, lead.id));
      await withAudit(db, schema.auditLog, {
        actorUserId: caller.userId,
        action: 'edit',
        resourceType: 'lead',
        resourceId: lead.id,
        before: lead,
        after: { ...lead, outreachStatus, updatedAt: now },
        app: 'crm',
      });
      updatedCount++;
    }
  } else if (action === 'update_tags') {
    const requestedTags = normalizeTagNames(body.tags);
    if (!isSuperadmin && role !== 'manager') {
      const unknownTags = await unknownTagNames(db, requestedTags);
      if (unknownTags.length > 0) {
        return c.json(
          { error: `Members can only assign existing tags: ${unknownTags.join(', ')}` },
          400
        );
      }
    }
    const tags =
      isSuperadmin || role === 'manager'
        ? await ensureTagDefinitions(db, requestedTags, caller.userId)
        : requestedTags;
    const mode = body.mode === 'replace' || body.tagMode === 'replace' ? 'replace' : 'merge';
    if (tags.length === 0) return c.json({ error: "Missing 'tags' field." }, 400);
    const now = new Date();
    for (const lead of allLeads) {
      let nextTags: string[];
      if (mode === 'replace') {
        nextTags = [...tags];
      } else {
        const existing = Array.isArray(lead.tags) ? (lead.tags as string[]) : [];
        nextTags = [...new Set([...existing, ...tags])];
      }
      const baseJourneyStage = isLeadHoldingStage(lead.journeyStage) ? 'new' : lead.journeyStage;
      const nextJourneyStage = journeyStageForTags(baseJourneyStage, nextTags);
      const nextLegacy = legacyFieldsForJourney(nextJourneyStage);
      await db
        .update(schema.leads)
        .set({
          tags: nextTags,
          journeyStage: nextJourneyStage,
          status: nextLegacy.status,
          outreachStatus: nextLegacy.outreachStatus,
          updatedAt: now,
        })
        .where(eq(schema.leads.id, lead.id));
      await withAudit(db, schema.auditLog, {
        actorUserId: caller.userId,
        action: 'edit',
        resourceType: 'lead',
        resourceId: lead.id,
        before: lead,
        after: {
          ...lead,
          tags: nextTags,
          journeyStage: nextJourneyStage,
          status: nextLegacy.status,
          outreachStatus: nextLegacy.outreachStatus,
          updatedAt: now,
        },
        app: 'crm',
      });
      if (isLeadHoldingStage(lead.journeyStage) && isLeadActivationStage(nextJourneyStage)) {
        await db
          .insert(schema.leadScoreJobs)
          .values({ leadId: lead.id })
          .onConflictDoNothing({ target: schema.leadScoreJobs.leadId });
        await autoCreateLeadChannels(db, lead);
        await triggerWorkflowEvent(c.env, 'lead_created', {
          id: lead.id,
          source: lead.source,
          ownerId: lead.ownerId,
        });
      } else if (!isLeadHoldingStage(lead.journeyStage) && isLeadHoldingStage(nextJourneyStage)) {
        await db
          .delete(schema.leadScoreJobs)
          .where(
            and(
              eq(schema.leadScoreJobs.leadId, lead.id),
              inArray(schema.leadScoreJobs.status, ['pending', 'failed'])
            )
          );
      }
      updatedCount++;
    }
  } else if (action === 'assign_owner') {
    const ownerId = body.ownerId as string;
    if (!ownerId) return c.json({ error: "Missing 'ownerId' field." }, 400);
    const now = new Date();
    for (const lead of allLeads) {
      await db
        .update(schema.leads)
        .set({
          ownerId,
          updatedAt: now,
        })
        .where(eq(schema.leads.id, lead.id));
      await withAudit(db, schema.auditLog, {
        actorUserId: caller.userId,
        action: 'reassign',
        resourceType: 'lead',
        resourceId: lead.id,
        before: lead,
        after: { ...lead, ownerId, updatedAt: now },
        app: 'crm',
      });
      updatedCount++;
    }
  }

  return c.json({
    success: true,
    action,
    processed: action === 'delete' ? deletedCount : updatedCount,
    total: ids.length,
  });
});

app.post('/api/leads/:id/convert', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!lead) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }
  if (lead.status === 'converted') {
    return c.json({ error: 'Lead already converted.' }, 400);
  }

  let companyId: string | null = null;
  if (lead.companyDomain) {
    const [existingCompany] = await db
      .select()
      .from(schema.companies)
      .where(
        and(
          eq(sql`lower(${schema.companies.domain})`, lead.companyDomain.toLowerCase()),
          isNull(schema.companies.deletedAt)
        )
      );
    if (existingCompany) {
      companyId = existingCompany.id;
    } else {
      const [newCompany] = await db
        .insert(schema.companies)
        .values({
          name: lead.companyName || lead.companyDomain,
          domain: lead.companyDomain,
          ownerId: caller.userId,
        })
        .returning();
      if (!newCompany) return c.json({ error: 'Internal error' }, 500);
      companyId = newCompany.id;
      await withAudit(db, schema.auditLog, {
        actorUserId: caller.userId,
        action: 'create',
        resourceType: 'company',
        resourceId: newCompany.id,
        after: newCompany,
        app: 'crm',
      });
    }
  }

  // contacts.email is required — a LinkedIn-only capture may have none yet.
  if (!lead.email) {
    return c.json(
      { error: 'This lead has no email yet. Add one before converting to a contact.' },
      400
    );
  }

  const [contact] = await db
    .insert(schema.contacts)
    .values({
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      linkedinUrl: lead.linkedinUrl,
      companyId,
      ownerId: caller.userId,
    })
    .returning();
  if (!contact) return c.json({ error: 'Internal error' }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'contact',
    resourceId: contact.id,
    after: contact,
    app: 'crm',
  });

  const [updatedLead] = await db
    .update(schema.leads)
    .set({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      status: 'converted' as any,
      journeyStage: 'converted',
      convertedToContactId: contact.id,
      convertedToCompanyId: companyId,
      convertedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.leads.id, id))
    .returning();
  if (!updatedLead) return c.json({ error: 'Internal error' }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'convert',
    resourceType: 'lead',
    resourceId: id,
    before: lead,
    after: updatedLead,
    app: 'crm',
  });

  return c.json({ lead: updatedLead, contact, companyId });
});

// --- OPPORTUNITIES ---

app.get('/api/opportunities', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { stage, search, owner } = c.req.query();
  const conditions = [isNull(schema.opportunities.deletedAt)];

  if (!isSuperadmin) {
    conditions.push(eq(schema.opportunities.ownerId, caller.userId));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (stage) conditions.push(eq(schema.opportunities.stage, stage as any));
  if (search) {
    conditions.push(like(sql`lower(${schema.opportunities.name})`, `%${search.toLowerCase()}%`));
  }
  if (owner) conditions.push(eq(schema.opportunities.ownerId, owner));

  const rows = await db
    .select()
    .from(schema.opportunities)
    .where(and(...conditions))
    .orderBy(desc(schema.opportunities.updatedAt))
    .limit(100);

  return c.json({ opportunities: rows });
});

app.post('/api/opportunities', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const data = {
    name: body.name,
    companyId: body.companyId ?? null,
    contactId: body.contactId ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stage: (body.stage ?? 'prospecting') as any,
    amount: body.amount ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    currency: (body.currency ?? 'USD') as any,
    expectedCloseDate: body.expectedCloseDate ?? null,
    probability: body.probability ?? null,
    notes: body.notes ?? null,
    ownerId: caller.userId,
  };

  const [result] = await db.insert(schema.opportunities).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'opportunity',
    resourceId: result.id,
    after: data,
    app: 'crm',
  });

  return c.json({ opportunity: result }, 201);
});

app.get('/api/opportunities/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.opportunities)
    .where(and(eq(schema.opportunities.id, id), isNull(schema.opportunities.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  return c.json({ opportunity: row });
});

app.put('/api/opportunities/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.opportunities)
    .where(and(eq(schema.opportunities.id, id), isNull(schema.opportunities.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.companyId !== undefined) update.companyId = body.companyId;
  if (body.contactId !== undefined) update.contactId = body.contactId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (body.stage !== undefined) update.stage = body.stage as any;
  if (body.amount !== undefined) update.amount = body.amount;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (body.currency !== undefined) update.currency = body.currency as any;
  if (body.expectedCloseDate !== undefined) update.expectedCloseDate = body.expectedCloseDate;
  if (body.probability !== undefined) update.probability = body.probability;
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.ownerId !== undefined && isSuperadmin) update.ownerId = body.ownerId;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.opportunities)
    .set(update)
    .where(eq(schema.opportunities.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'opportunity',
    resourceId: id,
    before: existing,
    after: result,
    app: 'crm',
  });

  // Email notification on stage change
  if (body.stage !== undefined && body.stage !== existing.stage) {
    sendEmail(
      c.env,
      caller.userId,
      `Opportunity stage changed: ${result.name} → ${result.stage}`,
      `Opportunity ${result.name} moved from ${existing.stage} to ${result.stage}`
    );
  }

  return c.json({ opportunity: result });
});

app.delete('/api/opportunities/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.opportunities)
    .where(and(eq(schema.opportunities.id, id), isNull(schema.opportunities.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'delete', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db
    .update(schema.opportunities)
    .set({
      deletedAt: new Date(),
      deletedBy: caller.userId,
    })
    .where(eq(schema.opportunities.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'opportunity',
    resourceId: id,
    before: existing,
    app: 'crm',
  });

  return c.json({ success: true });
});

// --- ACTIVITIES ---

app.get('/api/activities', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { contactId, companyId, opportunityId, type } = c.req.query();
  const conditions: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

  // If a specific parent resource is provided, verify the caller can access it
  if (companyId) {
    const [company] = await db
      .select()
      .from(schema.companies)
      .where(and(eq(schema.companies.id, companyId), isNull(schema.companies.deletedAt)));
    if (!company) return c.json({ error: 'Not found.' }, 404);
    if (!can(isSuperadmin, role, 'view', { ownerId: company.ownerId }, caller)) {
      return c.json({ error: 'Forbidden.' }, 403);
    }
    conditions.push(eq(schema.activities.companyId, companyId));
  }
  if (contactId) {
    const [contact] = await db
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.id, contactId), isNull(schema.contacts.deletedAt)));
    if (!contact) return c.json({ error: 'Not found.' }, 404);
    if (!can(isSuperadmin, role, 'view', { ownerId: contact.ownerId }, caller)) {
      return c.json({ error: 'Forbidden.' }, 403);
    }
    conditions.push(eq(schema.activities.contactId, contactId));
  }
  if (opportunityId) {
    const [opportunity] = await db
      .select()
      .from(schema.opportunities)
      .where(
        and(eq(schema.opportunities.id, opportunityId), isNull(schema.opportunities.deletedAt))
      );
    if (!opportunity) return c.json({ error: 'Not found.' }, 404);
    if (!can(isSuperadmin, role, 'view', { ownerId: opportunity.ownerId }, caller)) {
      return c.json({ error: 'Forbidden.' }, 403);
    }
    conditions.push(eq(schema.activities.opportunityId, opportunityId));
  }
  if (type) conditions.push(eq(schema.activities.type, type as any)); // eslint-disable-line @typescript-eslint/no-explicit-any

  if (conditions.length === 0) {
    return c.json(
      { error: 'Provide at least one filter: contactId, companyId, opportunityId, or type.' },
      400
    );
  }

  const rows = await db
    .select()
    .from(schema.activities)
    .where(and(...conditions))
    .orderBy(desc(schema.activities.happenedAt))
    .limit(100);

  return c.json({ activities: rows });
});

app.post('/api/activities', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const data = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type: body.type as any,
    subject: body.subject,
    content: body.content ?? null,
    contactId: body.contactId ?? null,
    companyId: body.companyId ?? null,
    opportunityId: body.opportunityId ?? null,
    actorId: caller.userId,
    happenedAt: body.happenedAt ? new Date(body.happenedAt) : new Date(),
  };

  const [result] = await db.insert(schema.activities).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'activity',
    resourceId: result.id,
    after: data,
    app: 'crm',
  });

  return c.json({ activity: result }, 201);
});

app.get('/api/activities/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId') };

  const [row] = await db.select().from(schema.activities).where(eq(schema.activities.id, id));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!isSuperadmin && row.actorId !== caller.userId) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  return c.json({ activity: row });
});

app.put('/api/activities/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId') };

  const [existing] = await db.select().from(schema.activities).where(eq(schema.activities.id, id));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!isSuperadmin && existing.actorId !== caller.userId) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (body.type !== undefined) update.type = body.type as any;
  if (body.subject !== undefined) update.subject = body.subject;
  if (body.content !== undefined) update.content = body.content;
  if (body.contactId !== undefined) update.contactId = body.contactId;
  if (body.companyId !== undefined) update.companyId = body.companyId;
  if (body.opportunityId !== undefined) update.opportunityId = body.opportunityId;
  if (body.happenedAt !== undefined) update.happenedAt = new Date(body.happenedAt);
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.activities)
    .set(update)
    .where(eq(schema.activities.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'activity',
    resourceId: id,
    before: existing,
    after: result,
    app: 'crm',
  });

  return c.json({ activity: result });
});

app.delete('/api/activities/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId') };

  const [existing] = await db.select().from(schema.activities).where(eq(schema.activities.id, id));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!isSuperadmin && existing.actorId !== caller.userId) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db.delete(schema.activities).where(eq(schema.activities.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'activity',
    resourceId: id,
    before: existing,
    app: 'crm',
  });

  return c.json({ success: true });
});

// --- TASKS ---

app.get('/api/tasks', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { assigneeId, contactId, companyId, opportunityId, completed, priority, type, unassigned } =
    c.req.query();
  const conditions = [isNull(schema.tasks.deletedAt)];

  // Unclaimed tasks (assigneeId null) are visible to everyone with role
  // access — that's the open-claim pool the task board is built on. A
  // non-superadmin otherwise only sees their own assigned tasks.
  if (!isSuperadmin) {
    conditions.push(
      or(eq(schema.tasks.assigneeId, caller.userId), isNull(schema.tasks.assigneeId))!
    );
  }
  if (unassigned === 'true') conditions.push(isNull(schema.tasks.assigneeId));
  if (assigneeId) conditions.push(eq(schema.tasks.assigneeId, assigneeId));
  if (contactId) conditions.push(eq(schema.tasks.contactId, contactId));
  if (companyId) conditions.push(eq(schema.tasks.companyId, companyId));
  if (opportunityId) conditions.push(eq(schema.tasks.opportunityId, opportunityId));
  if (priority) conditions.push(eq(schema.tasks.priority, priority));
  if (type) conditions.push(eq(schema.tasks.type, type));
  if (completed === 'true') conditions.push(sql`${schema.tasks.completedAt} IS NOT NULL`);
  if (completed === 'false') conditions.push(sql`${schema.tasks.completedAt} IS NULL`);

  const rows = await db
    .select()
    .from(schema.tasks)
    .where(and(...conditions))
    .orderBy(asc(schema.tasks.dueDate))
    .limit(100);

  return c.json({ tasks: rows });
});

app.post('/api/tasks', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const data = {
    title: body.title,
    description: body.description ?? null,
    dueDate: body.dueDate ? new Date(body.dueDate) : null,
    assigneeId: body.assigneeId ?? caller.userId,
    contactId: body.contactId ?? null,
    companyId: body.companyId ?? null,
    opportunityId: body.opportunityId ?? null,
    priority: body.priority ?? 'medium',
  };

  const [result] = await db.insert(schema.tasks).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'task',
    resourceId: result.id,
    after: data,
    app: 'crm',
  });

  // Email notification on task assignment
  if (result.assigneeId && result.assigneeId !== caller.userId) {
    sendEmail(
      c.env,
      result.assigneeId,
      `New task assigned: ${result.title}`,
      `You have been assigned a new task: ${result.title}`
    );
  }

  return c.json({ task: result }, 201);
});

app.get('/api/tasks/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  // An unclaimed task (assigneeId null) is visible to anyone with role
  // access — visibility of the open-claim pool is the point of the board.
  const canViewTask =
    row.assigneeId === null || can(isSuperadmin, role, 'view', { ownerId: row.assigneeId }, caller);
  if (!canViewTask) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  return c.json({ task: row });
});

app.put('/api/tasks/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  // Unassigned tasks (ownerId '') aren't editable until claimed — a
  // teammate claims first (PUT /api/tasks/:id/claim), then edits normally.
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.assigneeId ?? '' }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.title !== undefined) update.title = body.title;
  if (body.description !== undefined) update.description = body.description;
  if (body.dueDate !== undefined) update.dueDate = body.dueDate ? new Date(body.dueDate) : null;
  if (body.assigneeId !== undefined) update.assigneeId = body.assigneeId;
  if (body.contactId !== undefined) update.contactId = body.contactId;
  if (body.companyId !== undefined) update.companyId = body.companyId;
  if (body.opportunityId !== undefined) update.opportunityId = body.opportunityId;
  if (body.priority !== undefined) update.priority = body.priority;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.tasks)
    .set(update)
    .where(eq(schema.tasks.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'task',
    resourceId: id,
    before: existing,
    after: result,
    app: 'crm',
  });

  return c.json({ task: result });
});

app.put('/api/tasks/:id/complete', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  // Unassigned tasks (ownerId '') aren't editable until claimed — a
  // teammate claims first (PUT /api/tasks/:id/claim), then edits normally.
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.assigneeId ?? '' }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const [result] = await db
    .update(schema.tasks)
    .set({
      completedAt: new Date(),
      completedBy: caller.userId,
      updatedAt: new Date(),
    })
    .where(eq(schema.tasks.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'complete',
    resourceType: 'task',
    resourceId: id,
    before: existing,
    after: result,
    app: 'crm',
  });

  return c.json({ task: result });
});

app.put('/api/tasks/:id/reopen', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  // Unassigned tasks (ownerId '') aren't editable until claimed — a
  // teammate claims first (PUT /api/tasks/:id/claim), then edits normally.
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.assigneeId ?? '' }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const [result] = await db
    .update(schema.tasks)
    .set({
      completedAt: null,
      completedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.tasks.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'reopen',
    resourceType: 'task',
    resourceId: id,
    before: existing,
    after: result,
    app: 'crm',
  });

  return c.json({ task: result });
});

// Self-claim an unassigned task off the open-claim board. Any role with
// access to the app may claim — there's no owner yet, so the usual
// ownerId-based `can()` check doesn't apply. 409 if someone else claimed it
// first (a plain UPDATE ... WHERE assignee_id IS NULL makes this atomic —
// no separate read-then-write race).
app.put('/api/tasks/:id/claim', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const caller = { userId: c.get('userId') };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const [existing] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);

  const [result] = await db
    .update(schema.tasks)
    .set({ assigneeId: caller.userId, updatedAt: new Date() })
    .where(
      and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt), isNull(schema.tasks.assigneeId))
    )
    .returning();

  if (!result) {
    return c.json({ error: 'Already claimed by someone else.' }, 409);
  }

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'claim',
    resourceType: 'task',
    resourceId: id,
    before: existing,
    after: result,
    app: 'crm',
  });

  return c.json({ task: result });
});

app.delete('/api/tasks/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'delete', { ownerId: existing.assigneeId ?? '' }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db
    .update(schema.tasks)
    .set({
      deletedAt: new Date(),
      deletedBy: caller.userId,
    })
    .where(eq(schema.tasks.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'task',
    resourceId: id,
    before: existing,
    app: 'crm',
  });

  return c.json({ success: true });
});

// --- IMPORT ---

app.get('/api/import-batches', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const conditions = [];
  if (!isSuperadmin) {
    conditions.push(eq(schema.importBatches.importedByUserId, caller.userId));
  }

  const batches = await db
    .select()
    .from(schema.importBatches)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.importBatches.createdAt))
    .limit(50);

  return c.json({ batches });
});

app.post('/api/import/companies', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const csvText = body.csv;
  if (!csvText || typeof csvText !== 'string') {
    return c.json({ error: "Missing or invalid 'csv' field." }, 400);
  }

  const parsed = parseCompaniesCsv(csvText);
  const created: (typeof schema.companies.$inferInsert)[] = [];
  for (const row of parsed.success) {
    const [result] = await db
      .insert(schema.companies)
      .values({
        name: row.name,
        domain: row.domain ?? null,
        industry: row.industry ?? null,
        size: row.size ?? null,
        ownerId: caller.userId,
      })
      .returning();
    if (!result) return c.json({ error: 'Internal error' }, 500);
    created.push(result);
  }

  return c.json({ imported: created.length, errors: parsed.errors, duplicates: parsed.duplicates });
});

app.post('/api/import/contacts', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const csvText = body.csv;
  if (!csvText || typeof csvText !== 'string') {
    return c.json({ error: "Missing or invalid 'csv' field." }, 400);
  }

  const parsed = parseContactsCsv(csvText);
  const created: (typeof schema.contacts.$inferInsert)[] = [];
  for (const row of parsed.success) {
    let companyId: string | null = null;
    if (row.companyName) {
      const [company] = await db
        .select()
        .from(schema.companies)
        .where(
          and(
            like(sql`lower(${schema.companies.name})`, `%${row.companyName.toLowerCase()}%`),
            isNull(schema.companies.deletedAt)
          )
        );
      if (company) companyId = company.id;
    }
    const [result] = await db
      .insert(schema.contacts)
      .values({
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        phone: row.phone ?? null,
        title: row.title ?? null,
        companyId,
        ownerId: caller.userId,
      })
      .returning();
    if (!result) return c.json({ error: 'Internal error' }, 500);
    created.push(result);
  }

  return c.json({ imported: created.length, errors: parsed.errors, duplicates: parsed.duplicates });
});

app.post('/api/import/leads/preview', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  // Rate limit: 30 previews per minute per user
  const rl = checkRateLimit(`import:leads:preview:${caller.userId}`, 30, 60000);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return c.json({ error: `Rate limit exceeded. Try again in ${rl.retryAfter} seconds.` }, 429);
  }

  const body = await c.req.json();
  const csvText = body.csv;
  if (!csvText || typeof csvText !== 'string') {
    return c.json({ error: "Missing or invalid 'csv' field." }, 400);
  }
  const batchName = typeof body.batchName === 'string' ? body.batchName : '';
  const batchNumber =
    formatBatchTag(body.batchNumber) ||
    (/^(?:batch|set)[\s#:_-]*.+/i.test(batchName) ? formatBatchTag(batchName) : null);
  const tags = normalizeTagNames([
    ...(Array.isArray(body.tags) ? body.tags : []),
    ...(batchNumber ? [batchNumber] : []),
  ]);

  const parsed = parseLeadsCsv(csvText);
  if (parsed.success.length > 500) {
    return c.json({ error: 'CSV too large. Maximum 500 rows allowed per import.' }, 413);
  }
  // Check DB for existing duplicates (email, LinkedIn URL, and name+company)
  const enriched = await Promise.all(
    parsed.success.map(async (row) => {
      const conflicts: string[] = [];
      if (row.email && !row.email.includes('@placeholder.skarion')) {
        const existing = await db
          .select({ id: schema.leads.id })
          .from(schema.leads)
          .where(
            and(
              eq(sql`lower(${schema.leads.email})`, row.email.toLowerCase()),
              isNull(schema.leads.deletedAt)
            )
          )
          .limit(1);
        if (existing.length > 0) conflicts.push('email exists');
      }
      if (row.linkedinUrl) {
        const normalizedLi = row.linkedinUrl.toLowerCase().replace(/\/+$/, '');
        const existingLi = await db
          .select({ id: schema.leads.id })
          .from(schema.leads)
          .where(
            and(
              eq(sql`lower(${schema.leads.linkedinUrl})`, normalizedLi),
              isNull(schema.leads.deletedAt)
            )
          )
          .limit(1);
        if (existingLi.length > 0) conflicts.push('linkedin exists');
      }
      if (row.firstName && row.lastName && row.companyName) {
        const existingName = await db
          .select({ id: schema.leads.id })
          .from(schema.leads)
          .where(
            and(
              eq(sql`lower(${schema.leads.firstName})`, row.firstName.toLowerCase()),
              eq(sql`lower(${schema.leads.lastName})`, row.lastName.toLowerCase()),
              eq(sql`lower(${schema.leads.companyName})`, row.companyName.toLowerCase()),
              isNull(schema.leads.deletedAt)
            )
          )
          .limit(1);
        if (existingName.length > 0) conflicts.push('name+company exists');
      }
      return { ...row, conflicts, canImport: conflicts.length === 0 };
    })
  );

  const dbDuplicates = enriched.filter((r) => !r.canImport).length;
  const importable = enriched.filter((r) => r.canImport);

  return c.json({
    preview: importable.slice(0, 50),
    totalRows: parsed.success.length,
    importableCount: importable.length,
    dbDuplicates,
    errors: parsed.errors,
    duplicates: parsed.duplicates,
    warnings: parsed.warnings,
    allRows: enriched.slice(0, 100),
    // Echo back batch metadata for UI display (batch is not created on preview)
    batchName,
    batchNumber,
    tags,
  });
});

app.post('/api/import/leads', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  // Rate limit: 10 imports per minute per user, max 500 rows per CSV
  const rl = checkRateLimit(`import:leads:${caller.userId}`, 10, 60000);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return c.json({ error: `Rate limit exceeded. Try again in ${rl.retryAfter} seconds.` }, 429);
  }

  const body = await c.req.json();
  const csvText = body.csv;
  if (!csvText || typeof csvText !== 'string') {
    return c.json({ error: "Missing or invalid 'csv' field." }, 400);
  }
  const batchName = typeof body.batchName === 'string' ? body.batchName : '';
  const requestedBatchTag =
    formatBatchTag(body.batchNumber) ||
    (/^(?:batch|set)[\s#:_-]*.+/i.test(batchName) ? formatBatchTag(batchName) : null);
  const parsed = parseLeadsCsv(csvText);
  if (parsed.success.length > 500) {
    return c.json({ error: 'CSV too large. Maximum 500 rows allowed per import.' }, 413);
  }
  if (!isSuperadmin && role !== 'manager') {
    const unknownTags = await unknownTagNames(db, [
      ...(Array.isArray(body.tags) ? body.tags : []),
      ...parsed.success.flatMap((row) => (Array.isArray(row.tags) ? row.tags : [])),
    ]);
    if (unknownTags.length > 0) {
      return c.json(
        { error: `Members can only import existing tags: ${unknownTags.join(', ')}` },
        400
      );
    }
  }
  const userDefaultTags = await ensureTagDefinitions(
    db,
    Array.isArray(body.tags) ? body.tags : [],
    caller.userId,
    false
  );
  const systemBatchTags = requestedBatchTag
    ? await ensureTagDefinitions(db, [requestedBatchTag], caller.userId, true)
    : [];
  const batchTags = normalizeTagNames([...userDefaultTags, ...systemBatchTags]);
  const assigneeId =
    typeof body.assigneeId === 'string' && body.assigneeId ? body.assigneeId : caller.userId;

  // Insert the import_batches row first; counts are finalized after processing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const batchSource = (parsed.success[0]?.source ?? 'other') as any;
  const [batch] = await db
    .insert(schema.importBatches)
    .values({
      name: batchName || requestedBatchTag || `Import ${new Date().toISOString()}`,
      importedByUserId: caller.userId,
      source: batchSource,
      totalRows: parsed.success.length,
      importedCount: 0,
      duplicatesSkipped: 0,
      defaultTags: batchTags.length > 0 ? batchTags : null,
    })
    .returning();
  if (!batch) return c.json({ error: 'Internal error' }, 500);

  const created: (typeof schema.leads.$inferInsert)[] = [];
  const dbDuplicates: { row: number; reason: string }[] = [];
  for (const row of parsed.success) {
    // 1. Dedup by email (skip placeholders)
    const [emailDup, linkedinDup, nameCompanyDup] = await Promise.all([
      row.email && !row.email.includes('@placeholder.skarion')
        ? db
            .select({ id: schema.leads.id })
            .from(schema.leads)
            .where(
              and(
                eq(sql`lower(${schema.leads.email})`, row.email.toLowerCase()),
                isNull(schema.leads.deletedAt)
              )
            )
            .limit(1)
        : Promise.resolve([]),
      row.linkedinUrl
        ? db
            .select({ id: schema.leads.id })
            .from(schema.leads)
            .where(
              and(
                eq(
                  sql`lower(${schema.leads.linkedinUrl})`,
                  row.linkedinUrl.toLowerCase().replace(/\/+$/, '')
                ),
                isNull(schema.leads.deletedAt)
              )
            )
            .limit(1)
        : Promise.resolve([]),
      row.firstName && row.lastName && row.companyName
        ? db
            .select({ id: schema.leads.id })
            .from(schema.leads)
            .where(
              and(
                eq(sql`lower(${schema.leads.firstName})`, row.firstName.toLowerCase()),
                eq(sql`lower(${schema.leads.lastName})`, row.lastName.toLowerCase()),
                eq(sql`lower(${schema.leads.companyName})`, row.companyName.toLowerCase()),
                isNull(schema.leads.deletedAt)
              )
            )
            .limit(1)
        : Promise.resolve([]),
    ]);

    if (emailDup.length > 0) {
      dbDuplicates.push({
        row: row.originalRowNumber ?? 0,
        reason: `Email already exists: ${row.email}`,
      });
      continue;
    }
    if (linkedinDup.length > 0) {
      dbDuplicates.push({
        row: row.originalRowNumber ?? 0,
        reason: `LinkedIn already exists: ${row.linkedinUrl}`,
      });
      continue;
    }
    if (nameCompanyDup.length > 0) {
      dbDuplicates.push({
        row: row.originalRowNumber ?? 0,
        reason: `Name + company already exists: ${row.firstName} ${row.lastName} @ ${row.companyName}`,
      });
      continue;
    }

    const rowBatchTag = formatBatchTag(row.batchNumber);
    const rowUserTags = await ensureTagDefinitions(
      db,
      normalizeTagNames([...batchTags, ...(Array.isArray(row.tags) ? row.tags : [])]),
      caller.userId,
      false
    );
    const rowBatchTags = rowBatchTag
      ? await ensureTagDefinitions(db, [rowBatchTag], caller.userId, true)
      : [];
    const finalTags = normalizeTagNames([...rowUserTags, ...rowBatchTags]);
    const baseJourneyStage = journeyStageFromLegacy({
      status: row.status,
      outreachStatus: row.outreachStatus,
    });
    const journeyStage = journeyStageForTags(baseJourneyStage, finalTags);
    const legacy = legacyFieldsForJourney(journeyStage);
    const importIdentity = await nextLeadIdentity(db);
    const importLinkedInUrl = canonicalizeLinkedinUrl(row.linkedinUrl);
    const [result] = await db
      .insert(schema.leads)
      .values({
        workspaceId: DEFAULT_WORKSPACE_ID,
        ...importIdentity,
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        phone: row.phone ?? null,
        companyName: row.companyName ?? null,
        companyDomain: row.companyDomain ?? null,
        headline: row.headline ?? row.title ?? null,
        location: row.location ?? null,
        about: row.about ?? null,
        experience: row.experience ?? null,
        education: row.education ?? null,
        skills: row.skills ?? null,
        linkedinUrl: importLinkedInUrl,
        linkedinProfileKey: linkedinProfileKey(importLinkedInUrl),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        source: (row.source ?? 'other') as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        status: legacy.status as any,
        journeyStage,
        notes: row.notes ?? null,
        outreachStatus: legacy.outreachStatus,
        approachedAt: row.approachedAt ? new Date(row.approachedAt) : null,
        connectionStatus: row.connectionStatus ?? null,
        sourceSheet: row.sourceSheet ?? null,
        originalRowNumber: row.originalRowNumber ?? null,
        tags: finalTags.length > 0 ? finalTags : null,
        ownerId: assigneeId,
        batchId: batch.id,
      })
      .returning();
    if (!result) return c.json({ error: 'Internal error' }, 500);
    let finalResult = result;
    if (hasPhdProfileEvidence(result)) {
      finalResult = (await enforcePhdAutoDisqualification(db, result, caller.userId)) ?? result;
    } else if (hasLeadProfileEvidence(result)) {
      await enqueueLeadProfileCleanup(db, result.id);
    }
    created.push(finalResult);

    // Holding-stage leads intentionally have no outreach channels until activated.
    if (finalResult.reviewState !== 'rejected' && !isLeadHoldingStage(finalResult.journeyStage)) {
      await autoCreateLeadChannels(db, finalResult);
    }
  }

  // Finalize batch counts
  await db
    .update(schema.importBatches)
    .set({
      importedCount: created.length,
      duplicatesSkipped: dbDuplicates.length,
    })
    .where(eq(schema.importBatches.id, batch.id));

  return c.json({
    imported: created.length,
    errors: parsed.errors,
    duplicates: [...parsed.duplicates, ...dbDuplicates],
    warnings: parsed.warnings,
    batchId: batch.id,
  });
});

// --- ADMIN ---

app.get('/api/admin/audit-log', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const rows = await db
    .select()
    .from(schema.auditLog)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(200);
  return c.json({ auditLog: rows });
});

// --- WORKFLOW RULES ---

app.get('/api/workflow-rules', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  if (!role) return c.json({ error: 'Forbidden.' }, 403);
  // Only managers and superadmins can view workflow rules
  if (!isSuperadmin && role !== 'manager') {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const rows = await db
    .select()
    .from(schema.workflowRules)
    .orderBy(desc(schema.workflowRules.updatedAt))
    .limit(100);
  return c.json({ workflowRules: rows });
});

app.post('/api/workflow-rules', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const data = {
    name: body.name,
    trigger: body.trigger,
    conditions: body.conditions ?? {},
    actions: body.actions ?? {},
    enabled: body.enabled ?? true,
  };

  const [result] = await db.insert(schema.workflowRules).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  return c.json({ workflowRule: result }, 201);
});

app.put('/api/workflow-rules/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.workflowRules)
    .where(eq(schema.workflowRules.id, id));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (body.trigger !== undefined) update.trigger = body.trigger as any;
  if (body.conditions !== undefined) update.conditions = body.conditions;
  if (body.actions !== undefined) update.actions = body.actions;
  if (body.enabled !== undefined) update.enabled = body.enabled;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.workflowRules)
    .set(update)
    .where(eq(schema.workflowRules.id, id))
    .returning();
  return c.json({ workflowRule: result });
});

app.delete('/api/workflow-rules/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.workflowRules)
    .where(eq(schema.workflowRules.id, id));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'delete', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db.delete(schema.workflowRules).where(eq(schema.workflowRules.id, id));
  return c.json({ success: true });
});

// --- INTEGRATIONS ---

app.get('/api/integrations', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  if (!role) return c.json({ error: 'Forbidden.' }, 403);
  // Only managers and superadmins can view integrations
  if (!isSuperadmin && role !== 'manager') {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const rows = await db
    .select()
    .from(schema.integrationConfigs)
    .orderBy(desc(schema.integrationConfigs.updatedAt));
  return c.json({ integrations: rows });
});

app.post('/api/integrations', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const isSuperadmin = c.get('isSuperadmin');
  if (!isSuperadmin) return c.json({ error: 'Forbidden.' }, 403);

  const body = await c.req.json();
  const data = {
    provider: body.provider,
    label: body.label,
    status: body.status ?? 'disconnected',
    settings: body.settings ?? {},
  };

  const [result] = await db.insert(schema.integrationConfigs).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  return c.json({ integration: result }, 201);
});

app.put('/api/integrations/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const isSuperadmin = c.get('isSuperadmin');
  if (!isSuperadmin) return c.json({ error: 'Forbidden.' }, 403);

  const [existing] = await db
    .select()
    .from(schema.integrationConfigs)
    .where(eq(schema.integrationConfigs.id, id));
  if (!existing) return c.json({ error: 'Not found.' }, 404);

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.label !== undefined) update.label = body.label;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (body.status !== undefined) update.status = body.status as any;
  if (body.settings !== undefined) update.settings = body.settings;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.integrationConfigs)
    .set(update)
    .where(eq(schema.integrationConfigs.id, id))
    .returning();
  return c.json({ integration: result });
});

app.delete('/api/integrations/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const isSuperadmin = c.get('isSuperadmin');
  if (!isSuperadmin) return c.json({ error: 'Forbidden.' }, 403);

  await db.delete(schema.integrationConfigs).where(eq(schema.integrationConfigs.id, id));
  return c.json({ success: true });
});

// --- AI CONTROL PLANE ---

app.get('/api/ai/config', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  if (!isSuperadmin && role !== 'manager') return c.json({ error: 'Forbidden.' }, 403);

  const settings = await getAiRuntimeSettings(db);
  const env = c.env as Env;
  const selectedModels = Object.fromEntries(
    AI_AGENTS.map((agent) => [
      agent.id,
      settings.agentModels[agent.id] ??
        (agent.tier === 'embedding'
          ? settings.tierModels.embedding
          : settings.tierModels[agent.tier]),
    ])
  );

  return c.json({
    credentials: [
      {
        id: 'vertex_proxy',
        name: 'Vertex AI Proxy',
        configured: Boolean(env.AI_GATEWAY_BASE_URL && env.AI_GATEWAY_API_KEY),
        isDefault: settings.defaultProvider === 'vertex_proxy',
        source: 'Deployment secret',
        maskedKey: env.AI_GATEWAY_API_KEY ? '••••••••••••••••' : null,
        baseUrl: env.AI_GATEWAY_BASE_URL ?? null,
      },
      {
        id: 'google_ai',
        name: 'Google AI fallback',
        configured: Boolean(env.GOOGLE_API_KEY),
        isDefault: settings.defaultProvider === 'google_ai',
        source: 'Deployment secret',
        maskedKey: env.GOOGLE_API_KEY ? '••••••••••••••••' : null,
        baseUrl: null,
      },
    ],
    models: AI_MODELS,
    agents: AI_AGENTS,
    settings,
    selectedModels,
  });
});

type AiUsagePeriod = 'day' | 'week' | 'month';

const AI_USAGE_PERIODS: Record<
  AiUsagePeriod,
  { label: string; durationMs: number; bucketMs: number }
> = {
  day: {
    label: 'Last 24 hours',
    durationMs: 24 * 60 * 60 * 1000,
    bucketMs: 60 * 60 * 1000,
  },
  week: {
    label: 'Last 7 days',
    durationMs: 7 * 24 * 60 * 60 * 1000,
    bucketMs: 24 * 60 * 60 * 1000,
  },
  month: {
    label: 'Last 30 days',
    durationMs: 30 * 24 * 60 * 60 * 1000,
    bucketMs: 24 * 60 * 60 * 1000,
  },
};

function roundedUsageCost(value: number): number {
  return Number(value.toFixed(6));
}

app.get('/api/ai/usage', async (c) => {
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  if (!isSuperadmin && role !== 'manager') return c.json({ error: 'Forbidden.' }, 403);

  const requestedPeriod = c.req.query('period');
  const period: AiUsagePeriod =
    requestedPeriod === 'day' || requestedPeriod === 'month' ? requestedPeriod : 'week';
  const periodConfig = AI_USAGE_PERIODS[period];
  const end = new Date();
  const start = new Date(end.getTime() - periodConfig.durationMs);
  const db = getDb(c.env, schema) as CrmDb;
  const rows = await db
    .select({
      provider: schema.aiUsageEvents.provider,
      model: schema.aiUsageEvents.model,
      backingModel: schema.aiUsageEvents.backingModel,
      agentId: schema.aiUsageEvents.agentId,
      requestType: schema.aiUsageEvents.requestType,
      status: schema.aiUsageEvents.status,
      inputTokens: schema.aiUsageEvents.inputTokens,
      outputTokens: schema.aiUsageEvents.outputTokens,
      totalTokens: schema.aiUsageEvents.totalTokens,
      cachedInputTokens: schema.aiUsageEvents.cachedInputTokens,
      estimatedCostUsd: schema.aiUsageEvents.estimatedCostUsd,
      latencyMs: schema.aiUsageEvents.latencyMs,
      usageSource: schema.aiUsageEvents.usageSource,
      createdAt: schema.aiUsageEvents.createdAt,
    })
    .from(schema.aiUsageEvents)
    .where(gte(schema.aiUsageEvents.createdAt, start))
    .orderBy(asc(schema.aiUsageEvents.createdAt));

  type UsageAggregate = {
    id: string;
    label: string;
    requests: number;
    successfulRequests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
    estimatedCostUsd: number;
  };

  const makeAggregate = (id: string, label: string): UsageAggregate => ({
    id,
    label,
    requests: 0,
    successfulRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    estimatedCostUsd: 0,
  });
  const total = makeAggregate('total', periodConfig.label);
  let failedRequests = 0;
  let latencyTotal = 0;
  let latencySamples = 0;
  let providerMeasuredRequests = 0;
  const byModel = new Map<string, UsageAggregate>();
  const byAgent = new Map<string, UsageAggregate>();
  const series = new Map<
    number,
    { timestamp: string; requests: number; tokens: number; estimatedCostUsd: number }
  >();

  for (
    let bucket = Math.floor(start.getTime() / periodConfig.bucketMs) * periodConfig.bucketMs;
    bucket <= end.getTime();
    bucket += periodConfig.bucketMs
  ) {
    series.set(bucket, {
      timestamp: new Date(bucket).toISOString(),
      requests: 0,
      tokens: 0,
      estimatedCostUsd: 0,
    });
  }

  const addRow = (aggregate: UsageAggregate, row: (typeof rows)[number], cost: number) => {
    aggregate.requests += 1;
    if (row.status === 'success') aggregate.successfulRequests += 1;
    aggregate.inputTokens += row.inputTokens;
    aggregate.outputTokens += row.outputTokens;
    aggregate.totalTokens += row.totalTokens;
    aggregate.cachedInputTokens += row.cachedInputTokens;
    aggregate.estimatedCostUsd += cost;
  };

  for (const row of rows) {
    const cost = Number(row.estimatedCostUsd);
    addRow(total, row, cost);
    if (row.status !== 'success') failedRequests += 1;
    if (row.latencyMs > 0) {
      latencyTotal += row.latencyMs;
      latencySamples += 1;
    }
    if (row.usageSource === 'provider') providerMeasuredRequests += 1;

    const modelId = row.backingModel || row.model;
    const modelOption =
      AI_MODELS.find((candidate) => candidate.id === modelId) ??
      AI_MODELS.find((candidate) => candidate.backingModel === modelId);
    const modelAggregate =
      byModel.get(modelId) ?? makeAggregate(modelId, modelOption?.label ?? modelId);
    addRow(modelAggregate, row, cost);
    byModel.set(modelId, modelAggregate);

    const agentId = row.agentId || 'unattributed';
    const agent = AI_AGENTS.find((candidate) => candidate.id === row.agentId);
    const agentAggregate =
      byAgent.get(agentId) ??
      makeAggregate(agentId, agent?.name ?? (row.agentId || 'Unattributed / historical'));
    addRow(agentAggregate, row, cost);
    byAgent.set(agentId, agentAggregate);

    const bucket =
      Math.floor(row.createdAt.getTime() / periodConfig.bucketMs) * periodConfig.bucketMs;
    const point = series.get(bucket);
    if (point) {
      point.requests += 1;
      point.tokens += row.totalTokens;
      point.estimatedCostUsd += cost;
    }
  }

  const finishAggregate = (aggregate: UsageAggregate) => ({
    ...aggregate,
    estimatedCostUsd: roundedUsageCost(aggregate.estimatedCostUsd),
  });

  return c.json({
    period,
    label: periodConfig.label,
    range: { start: start.toISOString(), end: end.toISOString() },
    pricingUpdatedAt: AI_PRICING_UPDATED_AT,
    totals: {
      ...finishAggregate(total),
      failedRequests,
      averageLatencyMs: latencySamples ? Math.round(latencyTotal / latencySamples) : 0,
      providerMeasuredRequests,
      estimatedRequests: Math.max(0, rows.length - providerMeasuredRequests),
    },
    series: Array.from(series.values()).map((point) => ({
      ...point,
      estimatedCostUsd: roundedUsageCost(point.estimatedCostUsd),
    })),
    byModel: Array.from(byModel.values())
      .map(finishAggregate)
      .sort((left, right) => right.estimatedCostUsd - left.estimatedCostUsd),
    byAgent: Array.from(byAgent.values())
      .map(finishAggregate)
      .sort((left, right) => right.estimatedCostUsd - left.estimatedCostUsd),
  });
});

app.put('/api/ai/config', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  if (!isSuperadmin && role !== 'manager') return c.json({ error: 'Forbidden.' }, 403);

  const body = (await c.req.json()) as Partial<AiRuntimeSettings>;
  const allowedModels = new Set(AI_MODELS.map((model) => model.id as string));
  const allowedAgents = new Set(AI_AGENTS.map((agent) => agent.id));
  const current = await getAiRuntimeSettings(db);
  const next = readAiRuntimeSettings({
    ...current,
    ...body,
    tierModels: { ...current.tierModels, ...(body.tierModels ?? {}) },
    agentModels: body.agentModels ?? current.agentModels,
  });

  if (!['vertex_proxy', 'google_ai'].includes(next.defaultProvider)) {
    return c.json({ error: 'Unsupported AI provider.' }, 400);
  }
  for (const [tier, model] of Object.entries(next.tierModels)) {
    if (tier === 'embedding') {
      if (model !== 'embedding')
        return c.json({ error: 'Embedding model must be embedding.' }, 400);
    } else if (!allowedModels.has(model)) {
      return c.json({ error: `Unsupported model: ${model}` }, 400);
    }
  }
  for (const [agentId, model] of Object.entries(next.agentModels)) {
    if (!allowedAgents.has(agentId as AiAgentId)) {
      return c.json({ error: `Unknown AI agent: ${agentId}` }, 400);
    }
    const agent = AI_AGENTS.find((candidate) => candidate.id === agentId);
    if (agent?.tier === 'embedding') {
      if (model !== 'embedding') {
        return c.json({ error: `${agent.name} requires the embedding model.` }, 400);
      }
    } else if (!allowedModels.has(model)) {
      return c.json({ error: `Unsupported model: ${model}` }, 400);
    }
  }

  const [existing] = await db
    .select({ id: schema.integrationConfigs.id })
    .from(schema.integrationConfigs)
    .where(eq(schema.integrationConfigs.provider, 'ai_runtime'))
    .limit(1);
  if (existing) {
    await db
      .update(schema.integrationConfigs)
      .set({
        label: 'AI runtime and model routing',
        status: 'connected',
        settings: next,
        updatedAt: new Date(),
      })
      .where(eq(schema.integrationConfigs.id, existing.id));
  } else {
    await db.insert(schema.integrationConfigs).values({
      provider: 'ai_runtime',
      label: 'AI runtime and model routing',
      status: 'connected',
      settings: next,
    });
  }

  return c.json({ settings: next });
});

function reportingSeries(
  rows: Array<{ label: string | null; count: number | string }>
): ReportingSeriesItem[] {
  return rows
    .map((row) => ({
      label: row.label || 'unknown',
      value: Number(row.count) || 0,
    }))
    .sort((a, b) => b.value - a.value);
}

async function buildCeoReportingSnapshot(db: CrmDb): Promise<CeoReportingSnapshot> {
  const reportingWindowDays = 30;
  const [
    [leadTotal],
    [contactTotal],
    [companyTotal],
    [opportunityTotal],
    [taskSummary],
    [activitySummary],
    [leadWindowSummary],
    [scoreSummary],
    [linkedinSummary],
    leadStatusRows,
    leadSourceRows,
    classificationRows,
    opportunityRows,
    taskPriorityRows,
    recentLeadRows,
    recentLinkedinRows,
    upcomingOpportunityRows,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.leads)
      .where(and(isNull(schema.leads.deletedAt), eq(schema.leads.reviewState, 'accepted'))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.contacts)
      .where(isNull(schema.contacts.deletedAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.companies)
      .where(isNull(schema.companies.deletedAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.opportunities)
      .where(isNull(schema.opportunities.deletedAt)),
    db
      .select({
        open: sql<number>`count(*) filter (where ${schema.tasks.completedAt} is null)::int`,
        overdue: sql<number>`count(*) filter (
          where ${schema.tasks.completedAt} is null
          and ${schema.tasks.dueDate} is not null
          and ${schema.tasks.dueDate} < now()
        )::int`,
      })
      .from(schema.tasks)
      .where(isNull(schema.tasks.deletedAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.activities)
      .where(
        sql`${schema.activities.happenedAt} >= now() - (${reportingWindowDays} * interval '1 day')`
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.leads)
      .where(
        and(
          isNull(schema.leads.deletedAt),
          eq(schema.leads.reviewState, 'accepted'),
          sql`${schema.leads.createdAt} >= now() - (${reportingWindowDays} * interval '1 day')`
        )
      ),
    db
      .select({
        average: sql<string | null>`round(avg(${schema.leadAiAssessments.overallScore}), 1)::text`,
      })
      .from(schema.leadAiAssessments),
    db
      .select({
        conversations: sql<number>`count(*)::int`,
        messages: sql<number>`coalesce(sum(${schema.linkedinConversations.messageCount}), 0)::int`,
        leads: sql<number>`count(distinct ${schema.linkedinConversations.leadId})::int`,
        lastMessageAt: sql<Date | null>`max(${schema.linkedinConversations.lastMessageAt})`,
      })
      .from(schema.linkedinConversations),
    db
      .select({
        label: schema.leads.journeyStage,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.leads)
      .where(and(isNull(schema.leads.deletedAt), eq(schema.leads.reviewState, 'accepted')))
      .groupBy(schema.leads.journeyStage),
    db
      .select({
        label: schema.leads.source,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.leads)
      .where(and(isNull(schema.leads.deletedAt), eq(schema.leads.reviewState, 'accepted')))
      .groupBy(schema.leads.source),
    db
      .select({
        label: schema.leadAiAssessments.classification,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.leadAiAssessments)
      .groupBy(schema.leadAiAssessments.classification),
    db
      .select({
        stage: schema.opportunities.stage,
        currency: schema.opportunities.currency,
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${schema.opportunities.amount}), 0)::text`,
      })
      .from(schema.opportunities)
      .where(isNull(schema.opportunities.deletedAt))
      .groupBy(schema.opportunities.stage, schema.opportunities.currency),
    db
      .select({
        label: schema.tasks.priority,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.tasks)
      .where(and(isNull(schema.tasks.deletedAt), isNull(schema.tasks.completedAt)))
      .groupBy(schema.tasks.priority),
    db
      .select({
        firstName: schema.leads.firstName,
        lastName: schema.leads.lastName,
        company: schema.leads.companyName,
        status: schema.leads.journeyStage,
        source: schema.leads.source,
        createdAt: schema.leads.createdAt,
      })
      .from(schema.leads)
      .where(and(isNull(schema.leads.deletedAt), eq(schema.leads.reviewState, 'accepted')))
      .orderBy(desc(schema.leads.createdAt))
      .limit(10),
    db
      .select({
        leadFirstName: schema.leads.firstName,
        leadLastName: schema.leads.lastName,
        otherPartyName: schema.linkedinConversations.otherPartyName,
        messageCount: schema.linkedinConversations.messageCount,
        outboundCount: schema.linkedinConversations.outboundCount,
        lastMessageAt: schema.linkedinConversations.lastMessageAt,
        lastMessageFromUs: schema.linkedinConversations.lastMessageFromUs,
        messages: schema.linkedinConversations.messages,
      })
      .from(schema.linkedinConversations)
      .leftJoin(schema.leads, eq(schema.linkedinConversations.leadId, schema.leads.id))
      .orderBy(desc(schema.linkedinConversations.lastMessageAt))
      .limit(10),
    db
      .select({
        name: schema.opportunities.name,
        stage: schema.opportunities.stage,
        amount: schema.opportunities.amount,
        currency: schema.opportunities.currency,
        probability: schema.opportunities.probability,
        expectedCloseDate: schema.opportunities.expectedCloseDate,
      })
      .from(schema.opportunities)
      .where(
        and(
          isNull(schema.opportunities.deletedAt),
          sql`${schema.opportunities.stage} not in ('closed_won', 'closed_lost')`
        )
      )
      .orderBy(sql`${schema.opportunities.expectedCloseDate} asc nulls last`)
      .limit(10),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    reportingWindowDays,
    totals: {
      leads: Number(leadTotal?.count) || 0,
      contacts: Number(contactTotal?.count) || 0,
      companies: Number(companyTotal?.count) || 0,
      opportunities: Number(opportunityTotal?.count) || 0,
      openTasks: Number(taskSummary?.open) || 0,
      overdueTasks: Number(taskSummary?.overdue) || 0,
      activitiesInWindow: Number(activitySummary?.count) || 0,
      leadsCreatedInWindow: Number(leadWindowSummary?.count) || 0,
      averageLeadScore:
        scoreSummary?.average === null || scoreSummary?.average === undefined
          ? null
          : Number(scoreSummary.average),
      linkedinConversations: Number(linkedinSummary?.conversations) || 0,
      linkedinMessages: Number(linkedinSummary?.messages) || 0,
      leadsWithLinkedinConversations: Number(linkedinSummary?.leads) || 0,
      lastLinkedinMessageAt: linkedinSummary?.lastMessageAt?.toISOString() ?? null,
    },
    leadsByStatus: reportingSeries(leadStatusRows),
    leadsBySource: reportingSeries(leadSourceRows),
    leadClassifications: reportingSeries(classificationRows),
    opportunitiesByStage: opportunityRows
      .map((row) => ({
        label: row.stage,
        value: Number(row.count) || 0,
        secondaryValue: Number(row.amount) || 0,
        currency: row.currency,
      }))
      .sort((a, b) => b.secondaryValue - a.secondaryValue),
    tasksByPriority: reportingSeries(taskPriorityRows),
    recentLeads: recentLeadRows.map((row) => ({
      name: `${row.firstName} ${row.lastName}`.trim(),
      company: row.company,
      status: row.status,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
    })),
    recentLinkedinConversations: recentLinkedinRows.map((row) => ({
      leadName: `${row.leadFirstName ?? ''} ${row.leadLastName ?? ''}`.trim() || row.otherPartyName,
      messageCount: row.messageCount,
      outboundCount: row.outboundCount,
      lastMessageAt: row.lastMessageAt.toISOString(),
      lastMessageFromUs: row.lastMessageFromUs,
      lastMessagePreview: (() => {
        const messages = Array.isArray(row.messages)
          ? (row.messages as Array<{ content?: unknown }>)
          : [];
        const content = messages[messages.length - 1]?.content;
        return typeof content === 'string' ? content.slice(0, 500) : '';
      })(),
    })),
    upcomingOpportunities: upcomingOpportunityRows.map((row) => ({
      name: row.name,
      stage: row.stage,
      amount: row.amount === null ? null : Number(row.amount),
      currency: row.currency,
      probability: row.probability,
      expectedCloseDate: row.expectedCloseDate,
    })),
  };
}

// ─── CHAT ────────────────────────────────────────────────────────────────

app.get('/api/chat/history', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const userId = c.get('userId');
  const rows = await db
    .select()
    .from(schema.chatMessages)
    .where(
      and(
        eq(schema.chatMessages.userId, userId),
        inArray(schema.chatMessages.role, ['user', 'assistant'])
      )
    )
    .orderBy(asc(schema.chatMessages.createdAt))
    .limit(100);
  return c.json({ messages: rows });
});

app.post('/api/chat', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const userId = c.get('userId');
  const aiEnv = await getConfiguredAiEnv(db, c.env, userId);
  const isSuperadmin = c.get('isSuperadmin') ?? false;
  const role = c.get('apps')?.crm ?? 'member';

  const body = await c.req.json();
  const message = body.message?.trim();
  if (!message) return c.json({ error: 'Message is required.' }, 400);

  // Retrieval and conversation history are independent, so run them together.
  // A chat turn now remembers the prior six exchanges instead of treating every
  // message as a brand-new conversation.
  const [queryEmbedding, allEmbeddings, recentHistoryRows] = await Promise.all([
    ai.getEmbedding(message, aiEnv),
    db.select().from(schema.embeddings),
    db
      .select({
        role: schema.chatMessages.role,
        content: schema.chatMessages.content,
      })
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.userId, userId),
          inArray(schema.chatMessages.role, ['user', 'assistant'])
        )
      )
      .orderBy(desc(schema.chatMessages.createdAt))
      .limit(12),
  ]);

  // Score by similarity and filter by permission using canList().
  const scored = allEmbeddings
    .map((e) => ({
      ...e,
      score:
        queryEmbedding && Array.isArray(e.embedding)
          ? ai.cosineSimilarity(queryEmbedding, e.embedding as number[])
          : 0,
    }))
    .filter((e) => canList(isSuperadmin, role, { userId: userId, isSuperadmin }, e.ownerId))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // Build a permission-filtered context block for only this turn.
  const context = scored
    .map((e, i) => `\n[${i + 1}] ${e.resourceType} ${e.resourceId}:\n${e.content}`)
    .join('');
  const prompt = `Relevant CRM context:${
    context || '\nNo matching CRM records were found.'
  }\n\nCurrent question: ${message}`;

  // Persist the user message before generation so a failed turn is still
  // visible and can be retried.
  await db.insert(schema.chatMessages).values({
    userId,
    role: 'user',
    content: message,
  });

  const conversation: ai.ChatMessage[] = recentHistoryRows
    .reverse()
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .map((row) => ({
      role: row.role === 'assistant' ? 'model' : 'user',
      text: row.content,
    }));
  conversation.push({ role: 'user', text: prompt });

  const answer = await ai.chatCompletion(conversation, aiEnv, {
    tier: 'fast',
    agent: 'crm-copilot',
    systemInstruction: `You are Skarion CRM Copilot. Answer the user's current
question directly and concisely. Use the supplied CRM context when it is
relevant, and never invent CRM records or facts. If the requested CRM fact is
not in the context, say that you could not find it. You may answer general CRM
usage questions from your own knowledge. Do not claim that you changed or sent
anything unless the application explicitly confirms that action.`,
  });
  if (!answer) {
    return c.json({ error: 'The AI assistant is temporarily unavailable. Please try again.' }, 503);
  }

  // Persist the assistant response.
  const contextIds = scored.map((e) => ({
    resourceType: e.resourceType,
    resourceId: e.resourceId,
  }));
  const [assistantMessage] = await db
    .insert(schema.chatMessages)
    .values({
      userId,
      role: 'assistant',
      content: answer,
      contextIds,
    })
    .returning();

  return c.json({ answer, context: scored, message: assistantMessage });
});

type LinkedInUploadFile = {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function isLinkedInUploadFile(value: unknown): value is LinkedInUploadFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<LinkedInUploadFile>;
  return (
    typeof file.name === 'string' &&
    typeof file.type === 'string' &&
    typeof file.size === 'number' &&
    typeof file.arrayBuffer === 'function'
  );
}

async function parseLinkedInExportUpload(
  file: LinkedInUploadFile
): Promise<Array<{ label: string; rows: LinkedInExportRow[] }>> {
  const extension = file.name.toLowerCase().split('.').pop();
  const bytes = await file.arrayBuffer();
  if (extension === 'csv' || file.type === 'text/csv') {
    const text = new TextDecoder('utf-8').decode(bytes);
    const parsed = Papa.parse<LinkedInExportRow>(text, {
      header: true,
      skipEmptyLines: true,
    });
    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      const firstError = parsed.errors[0] as { message?: unknown } | undefined;
      throw new Error(
        `${file.name}: ${
          typeof firstError?.message === 'string' ? firstError.message : 'Invalid CSV file.'
        }`
      );
    }
    return [{ label: file.name, rows: parsed.data }];
  }

  if (extension === 'xlsx') {
    const sheets = await readXlsxFile(bytes);
    return sheets.map((sheet) => ({
      label: `${file.name} · ${sheet.sheet}`,
      rows: spreadsheetRowsToRecords(sheet.data),
    }));
  }

  throw new Error(`${file.name}: upload a CSV or XLSX file.`);
}

function normalizedLeadName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function upsertImportedLinkedInChannel(
  db: CrmDb,
  lead: typeof schema.leads.$inferSelect,
  patch: {
    stage: 'awaiting_reply' | 'replied' | 'connection_request_sent';
    lastAttemptAt: Date;
    attemptCount: number;
  }
): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.leadChannels)
    .where(
      and(eq(schema.leadChannels.leadId, lead.id), eq(schema.leadChannels.channel, 'linkedin'))
    );
  if (existing) {
    const useIncomingState =
      !existing.lastAttemptAt || existing.lastAttemptAt <= patch.lastAttemptAt;
    await db
      .update(schema.leadChannels)
      .set({
        stage: useIncomingState ? patch.stage : existing.stage,
        lastAttemptAt: useIncomingState ? patch.lastAttemptAt : existing.lastAttemptAt,
        attemptCount: Math.max(existing.attemptCount, patch.attemptCount),
        updatedAt: new Date(),
      })
      .where(eq(schema.leadChannels.id, existing.id));
  } else {
    await db.insert(schema.leadChannels).values({
      leadId: lead.id,
      channel: 'linkedin',
      stage: patch.stage,
      lastAttemptAt: patch.lastAttemptAt,
      attemptCount: patch.attemptCount,
      sequence: 1,
      ownerId: lead.ownerId,
    });
  }
  await recomputeLeadOutreachStatus(db, lead.id);
}

app.get('/api/ceo-chat/history', async (c) => {
  if (!c.get('isSuperadmin')) return c.json({ error: 'Forbidden.' }, 403);

  const db = getDb(c.env, schema) as CrmDb;
  const rows = await db
    .select({
      id: schema.chatMessages.id,
      role: schema.chatMessages.role,
      content: schema.chatMessages.content,
      createdAt: schema.chatMessages.createdAt,
    })
    .from(schema.chatMessages)
    .where(
      and(
        eq(schema.chatMessages.userId, c.get('userId')),
        inArray(schema.chatMessages.role, ['ceo_user', 'ceo_assistant'])
      )
    )
    .orderBy(asc(schema.chatMessages.createdAt))
    .limit(100);

  return c.json({
    messages: rows.map((row) => ({
      ...row,
      role: row.role === 'ceo_user' ? 'user' : 'assistant',
    })),
  });
});

app.delete('/api/ceo-chat/history', async (c) => {
  if (!c.get('isSuperadmin')) return c.json({ error: 'Forbidden.' }, 403);

  const db = getDb(c.env, schema) as CrmDb;
  const userId = c.get('userId');
  await db
    .delete(schema.chatMessages)
    .where(
      and(
        eq(schema.chatMessages.userId, userId),
        inArray(schema.chatMessages.role, ['ceo_user', 'ceo_assistant'])
      )
    );
  await withAudit(db, schema.auditLog, {
    actorUserId: userId,
    action: 'delete',
    resourceType: 'ceo_chat_history',
    resourceId: userId,
    app: 'crm',
  });
  return c.json({ success: true });
});

app.post('/api/ceo-chat/import-linkedin', async (c) => {
  if (!c.get('isSuperadmin')) return c.json({ error: 'Forbidden.' }, 403);

  const userId = c.get('userId');
  const rateLimit = checkRateLimit(`ceo-linkedin-import:${userId}`, 6, 10 * 60 * 1000);
  if (!rateLimit.allowed) {
    c.header('Retry-After', String(rateLimit.retryAfter ?? 60));
    return c.json({ error: 'Too many LinkedIn imports. Please wait and try again.' }, 429);
  }

  const formData = await c.req.formData();
  const files = (formData.getAll('files') as unknown[]).filter(isLinkedInUploadFile);
  if (files.length < 1 || files.length > 4) {
    return c.json({ error: 'Upload between one and four LinkedIn export files.' }, 400);
  }
  if (files.some((file) => file.size > 20 * 1024 * 1024)) {
    return c.json({ error: 'Each LinkedIn export file must be 20 MB or smaller.' }, 413);
  }

  const suppliedOwnerProfileUrl = canonicalizeLinkedinUrl(formData.get('ownerProfileUrl'));
  const messageRows: LinkedInExportRow[] = [];
  const invitationRows: LinkedInExportRow[] = [];
  const detectedFiles: Array<{ name: string; kind: 'messages' | 'invitations'; rows: number }> = [];
  const ignoredSheets: string[] = [];

  try {
    for (const file of files) {
      const sheets = await parseLinkedInExportUpload(file);
      for (const sheet of sheets) {
        const kind = detectLinkedInExportKind(sheet.rows);
        if (!kind) {
          ignoredSheets.push(sheet.label);
          continue;
        }
        detectedFiles.push({ name: sheet.label, kind, rows: sheet.rows.length });
        if (kind === 'messages') messageRows.push(...sheet.rows);
        else invitationRows.push(...sheet.rows);
      }
    }
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Could not parse the uploaded files.' },
      400
    );
  }

  if (messageRows.length === 0 && invitationRows.length === 0) {
    return c.json(
      {
        error:
          'No LinkedIn Messages or Invitations worksheet was detected. Upload the original LinkedIn export CSV/XLSX files.',
      },
      400
    );
  }

  const conversationResult = summarizeLinkedInConversations(messageRows, suppliedOwnerProfileUrl);
  if (messageRows.length > 0 && !conversationResult.ownerProfileUrl) {
    return c.json(
      {
        error:
          'Could not identify your LinkedIn profile URL from Messages. Enter your LinkedIn profile URL and try again.',
      },
      400
    );
  }
  const invitationResult = summarizeLinkedInInvitations(invitationRows);
  const db = getDb(c.env, schema) as CrmDb;
  const leads = await db.select().from(schema.leads).where(isNull(schema.leads.deletedAt));
  const leadsByProfileUrl = new Map<string, typeof schema.leads.$inferSelect>();
  const leadsByName = new Map<string, Array<typeof schema.leads.$inferSelect>>();
  for (const lead of leads) {
    const profileUrl = canonicalizeLinkedinUrl(lead.linkedinUrl);
    if (profileUrl) leadsByProfileUrl.set(profileUrl, lead);
    const name = normalizedLeadName(lead.firstName, lead.lastName);
    const matches = leadsByName.get(name) ?? [];
    matches.push(lead);
    leadsByName.set(name, matches);
  }

  let matchedConversations = 0;
  let storedConversations = 0;
  let matchedInvitations = 0;
  let enrichedLeads = 0;
  let unmatched = 0;
  const handledProfileUrls = new Set<string>();
  const enrichedLeadIds = new Set<string>();

  const resolveLead = async (
    profileUrl: string | null,
    displayName: string
  ): Promise<typeof schema.leads.$inferSelect | null> => {
    if (profileUrl) {
      const byUrl = leadsByProfileUrl.get(profileUrl);
      if (byUrl) return byUrl;
    }

    const { firstName, lastName } = splitLinkedInDisplayName(displayName);
    const nameMatches = leadsByName.get(normalizedLeadName(firstName, lastName)) ?? [];
    const safeMatches = nameMatches.filter((lead) => !canonicalizeLinkedinUrl(lead.linkedinUrl));
    if (safeMatches.length !== 1) return null;

    const candidate = safeMatches[0]!;
    if (!profileUrl) return candidate;

    const [updated] = await db
      .update(schema.leads)
      .set({ linkedinUrl: profileUrl, updatedAt: new Date() })
      .where(eq(schema.leads.id, candidate.id))
      .returning();
    if (!updated) return candidate;
    leadsByProfileUrl.set(profileUrl, updated);
    enrichedLeadIds.add(updated.id);
    return updated;
  };

  for (const conversation of conversationResult.conversations) {
    const lead = await resolveLead(conversation.otherPartyProfileUrl, conversation.otherPartyName);
    if (lead) {
      matchedConversations += 1;
      if (conversation.otherPartyProfileUrl) {
        handledProfileUrls.add(conversation.otherPartyProfileUrl);
      }
      await upsertImportedLinkedInChannel(db, lead, {
        stage: conversation.lastMessageFromUs ? 'awaiting_reply' : 'replied',
        lastAttemptAt: conversation.lastMessageAt,
        attemptCount: conversation.outboundCount,
      });
    } else {
      unmatched += 1;
    }

    const values = {
      externalConversationId: conversation.conversationId,
      leadId: lead?.id ?? null,
      otherPartyName: conversation.otherPartyName,
      otherPartyProfileUrl: conversation.otherPartyProfileUrl,
      ownerProfileUrl: conversationResult.ownerProfileUrl!,
      messageCount: conversation.messages.length,
      outboundCount: conversation.outboundCount,
      lastMessageAt: conversation.lastMessageAt,
      lastMessageFromUs: conversation.lastMessageFromUs,
      messages: conversation.messages,
      importedBy: userId,
      updatedAt: new Date(),
    };
    await db
      .insert(schema.linkedinConversations)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.linkedinConversations.importedBy,
          schema.linkedinConversations.externalConversationId,
        ],
        set: values,
      });
    storedConversations += 1;
  }

  for (const invitation of invitationResult.invitations) {
    if (handledProfileUrls.has(invitation.otherPartyProfileUrl)) continue;
    const lead = await resolveLead(invitation.otherPartyProfileUrl, invitation.otherPartyName);
    if (!lead) {
      unmatched += 1;
      continue;
    }
    await upsertImportedLinkedInChannel(db, lead, {
      stage: 'connection_request_sent',
      lastAttemptAt: invitation.sentAt,
      attemptCount: 1,
    });
    handledProfileUrls.add(invitation.otherPartyProfileUrl);
    matchedInvitations += 1;
  }
  enrichedLeads = enrichedLeadIds.size;

  const totalMessages = conversationResult.conversations.reduce(
    (total, conversation) => total + conversation.messages.length,
    0
  );
  const skippedRows = conversationResult.skippedRows + invitationResult.skippedRows;
  const summary = [
    '### LinkedIn export imported',
    '',
    `- **Files/worksheets recognized:** ${detectedFiles.length}`,
    `- **Conversations stored:** ${storedConversations}`,
    `- **Messages stored:** ${totalMessages}`,
    `- **Conversations matched to leads:** ${matchedConversations}`,
    `- **Pending invitations matched:** ${matchedInvitations}`,
    `- **Name-only leads enriched with LinkedIn URLs:** ${enrichedLeads}`,
    `- **Unmatched profiles:** ${unmatched}`,
    `- **Skipped invalid rows:** ${skippedRows}`,
    ignoredSheets.length > 0
      ? `- **Ignored worksheets:** ${ignoredSheets.map((name) => `\`${name}\``).join(', ')}`
      : '',
    '',
    'The Reporting CEO snapshot now includes the imported LinkedIn conversation totals and outreach state.',
  ]
    .filter(Boolean)
    .join('\n');

  const [historyMessage] = await db
    .insert(schema.chatMessages)
    .values({
      userId,
      role: 'ceo_assistant',
      content: summary,
      contextIds: detectedFiles.map((file) => ({
        resourceType: `linkedin_${file.kind}_import`,
        resourceId: file.name,
      })),
    })
    .returning({
      id: schema.chatMessages.id,
      createdAt: schema.chatMessages.createdAt,
    });

  await withAudit(db, schema.auditLog, {
    actorUserId: userId,
    action: 'import',
    resourceType: 'linkedin_export',
    resourceId: historyMessage?.id ?? crypto.randomUUID(),
    after: {
      detectedFiles,
      storedConversations,
      totalMessages,
      matchedConversations,
      matchedInvitations,
      enrichedLeads,
      unmatched,
      skippedRows,
    },
    app: 'crm',
  });

  return c.json({
    success: true,
    summary,
    historyMessage: historyMessage
      ? {
          id: historyMessage.id,
          role: 'assistant',
          content: summary,
          createdAt: historyMessage.createdAt.toISOString(),
        }
      : null,
    detectedFiles,
    storedConversations,
    totalMessages,
    matchedConversations,
    matchedInvitations,
    enrichedLeads,
    unmatched,
    skippedRows,
    ownerProfileUrl: conversationResult.ownerProfileUrl,
  });
});

app.post('/api/ceo-chat', async (c) => {
  const isSuperadmin = c.get('isSuperadmin') ?? false;
  if (!isSuperadmin) return c.json({ error: 'Forbidden.' }, 403);

  const userId = c.get('userId');
  const rateLimit = checkRateLimit(`ceo-chat:${userId}`, 20, 5 * 60 * 1000);
  if (!rateLimit.allowed) {
    c.header('Retry-After', String(rateLimit.retryAfter ?? 60));
    return c.json({ error: 'Too many CEO report requests. Please wait and try again.' }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const question = parseCeoQuestion((body as { message?: unknown } | null)?.message);
  if (!question) {
    return c.json({ error: 'A message between 1 and 8,000 characters is required.' }, 400);
  }

  const db = getDb(c.env, schema) as CrmDb;
  const aiEnv = await getConfiguredAiEnv(db, c.env, userId);
  if (!ai.isAiConfigured(aiEnv)) return c.json({ error: ai.AI_NOT_CONFIGURED_MSG }, 503);

  const [snapshot, recentHistoryRows] = await Promise.all([
    buildCeoReportingSnapshot(db),
    db
      .select({
        role: schema.chatMessages.role,
        content: schema.chatMessages.content,
      })
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.userId, userId),
          inArray(schema.chatMessages.role, ['ceo_user', 'ceo_assistant'])
        )
      )
      .orderBy(desc(schema.chatMessages.createdAt))
      .limit(12),
  ]);

  await db.insert(schema.chatMessages).values({
    userId,
    role: 'ceo_user',
    content: question,
  });

  const conversation: ai.ChatMessage[] = recentHistoryRows.reverse().map((row) => ({
    role: row.role === 'ceo_assistant' ? 'model' : 'user',
    text: row.content,
  }));
  conversation.push({ role: 'user', text: question });

  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  let clientConnected = true;
  const writeEvent = async (event: Record<string, unknown>) => {
    if (!clientConnected) return false;
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      return true;
    } catch {
      clientConnected = false;
      return false;
    }
  };

  const generate = async () => {
    let answer = '';
    let streamInterrupted = false;
    try {
      await writeEvent({ type: 'ready', generatedAt: snapshot.generatedAt });
      for await (const delta of ai.chatCompletionStream(conversation, aiEnv, {
        tier: 'reasoning',
        agent: 'reporting-ceo',
        temperature: 0.2,
        maxTokens: 4_000,
        systemInstruction: buildCeoSystemInstruction(snapshot),
      })) {
        if (!delta) continue;
        const remaining = 40_000 - answer.length;
        if (remaining <= 0) break;
        const safeDelta = delta.slice(0, remaining);
        answer += safeDelta;
        if (!(await writeEvent({ type: 'delta', delta: safeDelta }))) {
          streamInterrupted = true;
          break;
        }
      }

      if (streamInterrupted) return;
      if (!answer.trim()) throw new Error('The reporting model returned an empty response.');

      const [saved] = await db
        .insert(schema.chatMessages)
        .values({
          userId,
          role: 'ceo_assistant',
          content: answer,
          contextIds: [{ resourceType: 'reporting_snapshot', resourceId: snapshot.generatedAt }],
        })
        .returning({
          id: schema.chatMessages.id,
          createdAt: schema.chatMessages.createdAt,
        });

      await withAudit(db, schema.auditLog, {
        actorUserId: userId,
        action: 'generate',
        resourceType: 'ceo_report',
        resourceId: saved?.id ?? 'streamed',
        after: {
          snapshotGeneratedAt: snapshot.generatedAt,
          questionCharacters: question.length,
          answerCharacters: answer.length,
        },
        app: 'crm',
      });

      await writeEvent({
        type: 'done',
        id: saved?.id ?? crypto.randomUUID(),
        createdAt: saved?.createdAt?.toISOString() ?? new Date().toISOString(),
      });
    } catch (error) {
      console.error('Reporting CEO generation failed:', error);
      await writeEvent({
        type: 'error',
        error: 'The Reporting CEO could not complete this report. Please try again.',
      });
    } finally {
      try {
        await writer.close();
      } catch {
        // The browser may have closed the stream.
      }
    }
  };
  c.executionCtx.waitUntil(generate());

  return new Response(stream.readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

// ─── AI SUMMARY / OUTREACH / SCORE ─────────────────────────────────────────

app.post('/api/leads/:id/summarize', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const summary = await ai.summarizeLead(row, await getConfiguredAiEnv(db, c.env));
  if (!summary) return c.json({ error: ai.AI_NOT_CONFIGURED_MSG }, 503);
  return c.json({ summary });
});

app.post('/api/leads/:id/outreach', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const draft = await ai.draftOutreach(
    {
      leadType: row.source ?? 'other',
      leadSource: row.source ?? 'other',
      firstName: row.firstName,
      lastName: row.lastName,
      companyName: row.companyName,
      title: null,
      notes: row.notes,
      pdfSummary: null,
      tone: body.tone ?? 'professional',
      channel: body.channel ?? 'email',
    },
    await getConfiguredAiEnv(db, c.env)
  );
  if (!draft) return c.json({ error: ai.AI_NOT_CONFIGURED_MSG }, 503);

  // Save as activity
  await db.insert(schema.activities).values({
    type: 'note',
    subject: `AI outreach draft (${body.channel ?? 'email'})`,
    content: draft,
    contactId: null,
    companyId: null,
    opportunityId: null,
    actorId: caller.userId,
    happenedAt: new Date(),
  });

  return c.json({ draft });
});

app.post('/api/leads/:id/score', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const assessment = await generateAndSaveLeadScore(db, row, c.env);
  if (!assessment) return c.json({ error: ai.AI_NOT_CONFIGURED_MSG }, 503);
  await db
    .update(schema.leadScoreJobs)
    .set({
      status: 'completed',
      completedAt: new Date(),
      lockedAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.leadScoreJobs.leadId, row.id));
  return c.json({ score: assessment.overallScore, reasoning: assessment.reasoningSummary });
});

app.get('/api/leads/:id/ai-assessment', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!lead) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }
  const [assessment] = await db
    .select()
    .from(schema.leadAiAssessments)
    .where(eq(schema.leadAiAssessments.leadId, id));
  return c.json({ assessment: assessment ?? null });
});

app.post('/api/leads/:id/ai-assessment', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!lead) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }
  const assessment = await generateAndSaveLeadAiAssessment(db, lead, c.env);
  if (!assessment) return c.json({ error: ai.AI_NOT_CONFIGURED_MSG }, 503);
  return c.json({ assessment });
});

app.patch('/api/leads/:id/ai-assessment/connection-note', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!lead) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const connectionNote = typeof body.connectionNote === 'string' ? body.connectionNote.trim() : '';
  const characterCount = [...connectionNote].length;
  if (!connectionNote) return c.json({ error: 'Connection note cannot be empty.' }, 400);
  if (characterCount > 300) {
    return c.json({ error: 'LinkedIn connection notes cannot exceed 300 characters.' }, 400);
  }

  const [existing] = await db
    .select()
    .from(schema.leadAiAssessments)
    .where(eq(schema.leadAiAssessments.leadId, id));
  if (!existing) {
    return c.json({ error: 'Generate a connection note before editing it.' }, 404);
  }

  const [assessment] = await db
    .update(schema.leadAiAssessments)
    .set({
      connectionNote,
      connectionNoteCharacterCount: characterCount,
      updatedAt: new Date(),
    })
    .where(eq(schema.leadAiAssessments.leadId, id))
    .returning();
  if (!assessment) return c.json({ error: 'Internal error' }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'lead_ai_assessment',
    resourceId: id,
    before: existing,
    after: assessment,
    app: 'crm',
  });

  return c.json({ assessment });
});

app.post('/api/leads/:id/suggest-next-action', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const suggestion = await ai.suggestNextAction(row, await getConfiguredAiEnv(db, c.env));
  if (!suggestion) return c.json({ error: ai.AI_NOT_CONFIGURED_MSG }, 503);
  return c.json({ suggestion });
});

app.post('/api/companies/:id/summarize', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.id, id), isNull(schema.companies.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const summary = await ai.summarizeCompany(row, await getConfiguredAiEnv(db, c.env));
  if (!summary) return c.json({ error: ai.AI_NOT_CONFIGURED_MSG }, 503);
  return c.json({ summary });
});

app.post('/api/contacts/:id/summarize', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), isNull(schema.contacts.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const [company] = row.companyId
    ? await db.select().from(schema.companies).where(eq(schema.companies.id, row.companyId))
    : [null];

  const summary = await ai.summarizeContact(
    {
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      title: row.title,
      companyName: company?.name ?? null,
    },
    await getConfiguredAiEnv(db, c.env)
  );
  if (!summary) return c.json({ error: ai.AI_NOT_CONFIGURED_MSG }, 503);
  return c.json({ summary });
});

// ─── PDF LEAD IMPORT ───────────────────────────────────────────────────────

app.post('/api/leads/import/document', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.parseBody();
  const file = body['file'] as File | undefined;
  const leadType = (body['leadType'] as string) ?? 'other';

  if (!file) return c.json({ error: 'Missing file.' }, 400);
  if (file.size > 10 * 1024 * 1024) return c.json({ error: 'File too large. Max 10MB.' }, 400);

  // Expanded MIME type support: PDF, DOCX, PPTX, XLSX, CSV, TXT
  const allowedTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
  ];
  const isPdf = file.type === 'application/pdf';
  const isKnownType = allowedTypes.includes(file.type);
  if (!isKnownType && !isPdf) {
    return c.json(
      { error: `Unsupported file type: ${file.type}. Allowed: PDF, DOCX, PPTX, XLSX, CSV, TXT.` },
      415
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // ── Step 1: Try external document converter (MarkItDown) ────────────────
  let rawText = '';
  let markdownPreview = '';
  let conversionWarnings: string[] = [];
  let estimatedTokens = 0;
  let usedFallback = false;
  let fallbackReason = '';
  let charCount = 0;
  let fileHash = '';

  const convResult = await docConv.convertDocument(bytes, file.name, file.type, c.env, leadType);

  if ('usedFallback' in convResult && convResult.usedFallback) {
    // ── Fallback: local text extraction ───────────────────────────────────
    usedFallback = true;
    fallbackReason = convResult.fallbackReason;

    if (isPdf) {
      rawText = extractTextFromPdf(bytes);
      if (!rawText || rawText.trim().length === 0) {
        return c.json(
          {
            error:
              'No selectable text found in PDF. OCR is not implemented yet. Please upload a text-based PDF.',
          },
          422
        );
      }
    } else if (
      file.type === 'text/plain' ||
      file.type === 'text/csv' ||
      file.name.endsWith('.txt') ||
      file.name.endsWith('.csv')
    ) {
      rawText = extractTextFromPlainText(bytes);
      if (!rawText || rawText.trim().length === 0) {
        return c.json({ error: 'No text found in file. The file may be empty or binary.' }, 422);
      }
    } else {
      return c.json(
        {
          error: `Document converter not available for ${file.type}. Supported without converter: PDF, TXT, CSV.`,
        },
        503
      );
    }
  } else {
    // ── Converter succeeded ──────────────────────────────────────────────
    const result = convResult as docConv.ConverterResult;
    rawText = result.markdown;
    markdownPreview = result.markdownPreview;
    conversionWarnings = result.warnings;
    estimatedTokens = result.estimatedTokens;
    charCount = result.charCount;
    fileHash = result.sha256;
  }

  // Clean markdown for AI (strip base64, cap length, etc.)
  const maxChars = parseInt(c.env.DOCUMENT_AI_MAX_CHARS ?? '50000', 10);
  const cleanedText = cleanMarkdownForAi(rawText, maxChars);

  // ── Step 2: Regex extraction ──────────────────────────────────────────
  const regexResult = regexExtractFromText(cleanedText);

  // ── Step 3: AI extraction ─────────────────────────────────────────────
  let aiResult: ai.ExtractedLeadDraft | null = null;
  const aiEnv = await getConfiguredAiEnv(db, c.env);
  if (ai.isAiConfigured(aiEnv)) {
    if (usedFallback && isPdf) {
      aiResult = await ai.extractLeadFromPdfFile(bytes, file.type, leadType, aiEnv);
    } else {
      aiResult = await ai.extractLeadFromPdfText(cleanedText, leadType, aiEnv);
    }
  }

  // Merge regex + AI results
  const draftLead = mergeExtractionResults(regexResult, aiResult, leadType, cleanedText);

  // ── Step 4: Store document import record ──────────────────────────────
  if (!fileHash) {
    // Compute hash locally using Web Crypto API (Cloudflare Workers compatible)
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    fileHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  await db.insert(schema.documentImports).values({
    fileHash,
    originalFilename: file.name,
    mimeType: file.type,
    source: 'pdf_upload',
    markdownPreview: markdownPreview || cleanedText.substring(0, 2000),
    conversionStatus: usedFallback ? 'failed' : 'converted',
    conversionWarnings: conversionWarnings.length > 0 ? conversionWarnings : null,
    estimatedTokens: estimatedTokens || estimateTokens(cleanedText.length),
    charCount: charCount || cleanedText.length,
    usedFallback,
    fallbackReason: fallbackReason || null,
    ownerId: caller.userId,
  });

  // ── Step 5: Duplicate check ───────────────────────────────────────────
  const duplicates: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  }[] = [];
  if (draftLead.email) {
    const byEmail = await db
      .select()
      .from(schema.leads)
      .where(
        and(eq(schema.leads.email, draftLead.email.toLowerCase()), isNull(schema.leads.deletedAt))
      );
    for (const d of byEmail) duplicates.push(d);
  }
  if (draftLead.phone) {
    const byPhone = await db
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.phone, draftLead.phone), isNull(schema.contacts.deletedAt)));
    for (const d of byPhone)
      duplicates.push({
        id: d.id,
        firstName: d.firstName,
        lastName: d.lastName,
        email: d.email,
        phone: d.phone,
      });
  }

  return c.json({
    draftLead,
    duplicates: duplicates.slice(0, 5),
    rawTextPreview: cleanedText.substring(0, 2000),
    markdownPreview: markdownPreview || cleanedText.substring(0, 2000),
    conversionWarnings,
    estimatedTokens: estimatedTokens || estimateTokens(cleanedText.length),
    charCount: charCount || cleanedText.length,
    usedFallback,
    fallbackReason: fallbackReason || null,
  });
});

// Keep old route as alias for backward compatibility
app.post('/api/leads/import/pdf', async (c) => {
  return c.json({ error: 'Please use /api/leads/import/document instead.' }, 301);
});

app.post('/api/leads/import/document/confirm', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const leadData = body.lead;
  if (!leadData || !leadData.email || !leadData.firstName) {
    return c.json({ error: 'Missing required lead data (email, firstName).' }, 400);
  }

  // Check for duplicate by email
  const [existing] = await db
    .select()
    .from(schema.leads)
    .where(
      and(eq(schema.leads.email, leadData.email.toLowerCase()), isNull(schema.leads.deletedAt))
    );
  if (existing && !body.force) {
    return c.json(
      {
        error: 'Duplicate lead found.',
        existing: existing,
        hint: 'Use force=true to create anyway.',
      },
      409
    );
  }

  // Create or attach company if companyName provided
  let companyId: string | null = null;
  if (leadData.companyName) {
    const [existingCompany] = await db
      .select()
      .from(schema.companies)
      .where(
        and(
          like(sql`lower(${schema.companies.name})`, `%${leadData.companyName.toLowerCase()}%`),
          isNull(schema.companies.deletedAt)
        )
      );
    if (existingCompany) {
      companyId = existingCompany.id;
    } else if (body.createCompany !== false) {
      const [newCompany] = await db
        .insert(schema.companies)
        .values({
          name: leadData.companyName,
          domain: leadData.website ?? null,
          ownerId: caller.userId,
        })
        .returning();
      if (newCompany) companyId = newCompany.id;
    }
  }

  // Create contact if requested
  let contactId: string | null = null;
  if (body.createContact !== false) {
    const [contact] = await db
      .insert(schema.contacts)
      .values({
        firstName: leadData.firstName,
        lastName: leadData.lastName,
        email: leadData.email.toLowerCase(),
        phone: leadData.phone ?? null,
        title: leadData.title ?? null,
        companyId,
        ownerId: caller.userId,
      })
      .returning();
    if (contact) contactId = contact.id;
  }

  // Create lead
  const documentBaseJourneyStage = journeyStageFromLegacy({
    status: leadData.status,
    outreachStatus: leadData.outreachStatus,
  });
  const documentBatchTag = formatBatchTag(body.batchNumber ?? leadData.batchNumber);
  const requestedDocumentTags = normalizeTagNames(leadData.tags);
  if (!isSuperadmin && role !== 'manager') {
    const unknownTags = await unknownTagNames(db, requestedDocumentTags);
    if (unknownTags.length > 0) {
      return c.json(
        { error: `Members can only assign existing tags: ${unknownTags.join(', ')}` },
        400
      );
    }
  }
  const documentUserTags =
    isSuperadmin || role === 'manager'
      ? await ensureTagDefinitions(db, requestedDocumentTags, caller.userId)
      : requestedDocumentTags;
  const documentBatchTags = documentBatchTag
    ? await ensureTagDefinitions(db, [documentBatchTag], caller.userId, true)
    : [];
  const documentTags = normalizeTagNames([...documentUserTags, ...documentBatchTags]);
  const documentJourneyStage = journeyStageForTags(documentBaseJourneyStage, documentTags);
  const documentLegacy = legacyFieldsForJourney(documentJourneyStage);
  const documentIdentity = await nextLeadIdentity(db);
  const [lead] = await db
    .insert(schema.leads)
    .values({
      workspaceId: DEFAULT_WORKSPACE_ID,
      ...documentIdentity,
      firstName: leadData.firstName,
      lastName: leadData.lastName,
      email: leadData.email.toLowerCase(),
      phone: leadData.phone ?? null,
      companyName: leadData.companyName ?? null,
      companyDomain: leadData.website ?? null,
      headline: leadData.title ?? null,
      source: leadData.source ?? 'pdf_upload',
      status: documentLegacy.status,
      journeyStage: documentJourneyStage,
      outreachStatus: documentLegacy.outreachStatus,
      tags: documentTags.length > 0 ? documentTags : null,
      notes: leadData.notes ?? null,
      ownerId: caller.userId,
    })
    .returning();
  if (!lead) return c.json({ error: 'Internal error' }, 500);
  let finalLead = lead;
  if (hasPhdProfileEvidence(lead)) {
    finalLead = (await enforcePhdAutoDisqualification(db, lead, caller.userId)) ?? lead;
  } else if (hasLeadProfileEvidence(lead)) {
    await enqueueLeadProfileCleanup(db, lead.id);
  }

  // Link the most recent pending document import for this user to the new lead
  // Using raw SQL because Drizzle update builder doesn't support orderBy + limit in one chain
  await db.execute(sql`
    UPDATE crm.document_imports
    SET lead_id = ${lead.id}, conversion_status = 'linked'
    WHERE id = (
      SELECT id FROM crm.document_imports
      WHERE owner_id = ${caller.userId}
        AND conversion_status = 'converted'
        AND lead_id IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    )
  `);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'lead',
    resourceId: lead.id,
    after: finalLead,
    app: 'crm',
  });

  return c.json({ lead: finalLead, contactId, companyId }, 201);
});

// Keep old route as alias for backward compatibility
app.post('/api/leads/import/pdf/confirm', async (c) => {
  return c.json({ error: 'Please use /api/leads/import/document/confirm instead.' }, 301);
});

// ─── PDF TEXT EXTRACTION HELPERS ───────────────────────────────────────────

function extractTextFromPdf(bytes: Uint8Array): string {
  // Simple PDF text extraction: look for text between BT and ET operators,
  // and Tj/TJ text show operators. This is a basic heuristic, not a full parser.
  const decoder = new TextDecoder('utf-8');
  let text = '';

  // Try UTF-8 first
  try {
    text = decoder.decode(bytes);
  } catch {
    /* ignore */
  }
  if (!text) text = String.fromCharCode(...bytes);

  // Extract text from common PDF patterns
  const textMatches: string[] = [];
  const tjRegex = /\(([\x20-\x7E\s]+)\)\s*Tj/g;
  let m;
  while ((m = tjRegex.exec(text)) !== null) {
    textMatches.push(m[1]!);
  }

  // Also extract between stream ... endstream
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  while ((m = streamRegex.exec(text)) !== null) {
    const stream = m[1]!;
    // Look for text in streams
    const streamTj = /\(([\x20-\x7E\s]+)\)/g;
    let sm;
    while ((sm = streamTj.exec(stream)) !== null) {
      textMatches.push(sm[1]!);
    }
  }

  if (textMatches.length > 0) {
    return textMatches.join(' ');
  }

  // Fallback: return all printable ASCII text
  return text
    .replace(/[^\x20-\x7E\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTextFromPlainText(bytes: Uint8Array): string {
  const decoder = new TextDecoder('utf-8');
  try {
    return decoder.decode(bytes);
  } catch {
    return String.fromCharCode(...bytes);
  }
}

function regexExtractFromText(text: string) {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g;
  const linkedInRegex = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/g;
  const websiteRegex = /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/g;

  const emails = [...text.matchAll(emailRegex)].map((m) => m[0]);
  const phones = [...text.matchAll(phoneRegex)].map((m) => m[0]);
  const linkedins = [...text.matchAll(linkedInRegex)].map((m) => m[0]);
  const websites = [...text.matchAll(websiteRegex)].map((m) => m[0]);

  // Heuristic: first email is likely the primary one
  // Heuristic: first line that looks like a name (2-3 words, each capitalized)
  const lines = text
    .split(/\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  let fullName = '';
  for (const line of lines.slice(0, 20)) {
    const nameMatch = line.match(/^([A-Z][a-z]+)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)$/);
    if (nameMatch) {
      fullName = line;
      break;
    }
  }

  return {
    email: emails[0] ?? '',
    phone: phones[0] ?? '',
    linkedinUrl: linkedins[0] ?? '',
    website: websites[0] ?? '',
    fullName,
    rawText: text.substring(0, 5000),
  };
}

function mergeExtractionResults(
  regex: ReturnType<typeof regexExtractFromText>,
  ai: ai.ExtractedLeadDraft | null,
  leadType: string,
  _rawText: string
): ai.ExtractedLeadDraft {
  const aiName = ai ? `${ai.firstName} ${ai.lastName}`.trim() : '';
  const nameParts = (regex.fullName || aiName).trim().split(/\s+/);
  const firstName = nameParts[0] ?? ai?.firstName ?? '';
  const lastName = nameParts.slice(1).join(' ') || (ai?.lastName ?? '');
  const fullName = regex.fullName || aiName || `${firstName} ${lastName}`.trim();

  return {
    leadType: (ai?.leadType ?? leadType) as ai.ExtractedLeadDraft['leadType'],
    firstName,
    lastName,
    fullName,
    email: regex.email || (ai?.email ?? ''),
    phone: regex.phone || (ai?.phone ?? ''),
    linkedinUrl: regex.linkedinUrl || (ai?.linkedinUrl ?? ''),
    companyName: ai?.companyName ?? '',
    title: ai?.title ?? '',
    location: ai?.location ?? '',
    website: regex.website || (ai?.website ?? ''),
    source: 'pdf_upload',
    status: 'new',
    tags: ai?.tags ?? [],
    notes: ai?.notes ?? '',
    summary: ai?.summary ?? '',
    confidence: ai?.confidence ?? (regex.email ? 0.3 : 0.05),
    missingFields: ai?.missingFields ?? [],
  };
}

// ─── GLOBAL SEARCH ───────────────────────────────────────────────────

app.get('/api/search', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const q = c.req.query('q');
  if (!q || q.length < 2) return c.json({ results: [] });
  const query = `%${q}%`;

  const [leads, companies, contacts, opportunities] = await Promise.all([
    db
      .select()
      .from(schema.leads)
      .where(
        and(
          isNull(schema.leads.deletedAt),
          eq(schema.leads.reviewState, 'accepted'),
          or(
            like(sql`LOWER(${schema.leads.firstName})`, query),
            like(sql`LOWER(${schema.leads.lastName})`, query),
            like(sql`LOWER(${schema.leads.email})`, query),
            like(sql`LOWER(${schema.leads.companyName})`, query)
          )
        )
      )
      .limit(10),
    db
      .select()
      .from(schema.companies)
      .where(
        and(
          isNull(schema.companies.deletedAt),
          or(
            like(sql`LOWER(${schema.companies.name})`, query),
            like(sql`LOWER(${schema.companies.domain})`, query)
          )
        )
      )
      .limit(10),
    db
      .select()
      .from(schema.contacts)
      .where(
        and(
          isNull(schema.contacts.deletedAt),
          or(
            like(sql`LOWER(${schema.contacts.firstName})`, query),
            like(sql`LOWER(${schema.contacts.lastName})`, query),
            like(sql`LOWER(${schema.contacts.email})`, query)
          )
        )
      )
      .limit(10),
    db
      .select()
      .from(schema.opportunities)
      .where(
        and(
          isNull(schema.opportunities.deletedAt),
          or(
            like(sql`LOWER(${schema.opportunities.name})`, query),
            like(sql`LOWER(${schema.opportunities.notes})`, query)
          )
        )
      )
      .limit(10),
  ]);

  const results = [
    ...leads.map((l) => ({
      type: 'lead' as const,
      id: l.id,
      title: `${l.firstName} ${l.lastName}`,
      subtitle: l.companyName ?? l.email,
    })),
    ...companies.map((c) => ({
      type: 'company' as const,
      id: c.id,
      title: c.name,
      subtitle: c.domain ?? '',
    })),
    ...contacts.map((c) => ({
      type: 'contact' as const,
      id: c.id,
      title: `${c.firstName} ${c.lastName}`,
      subtitle: c.email,
    })),
    ...opportunities.map((o) => ({
      type: 'opportunity' as const,
      id: o.id,
      title: o.name,
      subtitle: `$${o.amount ?? '0'}`,
    })),
  ].slice(0, 20);

  return c.json({ query: q, results });
});

// ─── NOTIFICATIONS ───────────────────────────────────────────────────

app.get('/api/notifications', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const userId = c.get('userId');
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(50);
  return c.json({ notifications: rows });
});

app.get('/api/notifications/count', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const userId = c.get('userId');
  const rows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  return c.json({ count: rows[0]?.count ?? 0 });
});

app.post('/api/notifications/:id/read', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const userId = c.get('userId');
  const id = c.req.param('id');
  await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)));
  return c.json({ success: true });
});

// ─── INTEGRATIONS STATUS ───────────────────────────────────────────

app.get('/api/integrations/status', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const env = await getConfiguredAiEnv(db, c.env);
  const aiConfigured = ai.isAiConfigured(env);
  return c.json({
    googleApiKey: aiConfigured,
    resendConfigured: Boolean(env.RESEND_API_KEY),
    aiGateway: Boolean(env.AI_GATEWAY_BASE_URL && env.AI_GATEWAY_API_KEY),
    googleAiFallback: Boolean(env.GOOGLE_API_KEY),
    documentConverter: !!env.DOCUMENT_CONVERTER_URL,
    resendEmail: !!env.RESEND_API_KEY,
  });
});

// ─── OCR FOR SCANNED PDFS ───────────────────────────────────────────

app.post('/api/ocr', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const env = await getConfiguredAiEnv(db, c.env);
  const body = await c.req.parseBody();
  const file = body['file'] as File;
  if (!file) return c.json({ error: 'No file uploaded' }, 400);
  if (!ai.isAiConfigured(env)) return c.json({ error: 'AI not configured' }, 503);

  try {
    const text = await ai.extractDocumentText(
      new Uint8Array(await file.arrayBuffer()),
      file.type,
      env
    );
    if (!text) return c.json({ error: 'OCR failed' }, 500);
    return c.json({ text, source: env.AI_GATEWAY_API_KEY ? 'ai_gateway' : 'google_ai' });
  } catch (err) {
    console.error('OCR error:', err);
    return c.json({ error: 'OCR processing failed' }, 500);
  }
});

export default app;
