// apps/crm/src/lib/leadDedup.ts
//
// Pure normalization + duplicate-lookup logic for the LinkedIn extension's
// /extension/leads and /extension/leads/check routes. Kept separate from
// index.ts so it's testable without a Hono context or a live database.

import { eq, and, isNull, sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import type { CrmDb } from '../db/types.js';

/**
 * Canonicalizes a LinkedIn profile URL so different formattings of the same
 * profile compare equal: lowercase host+path, no query string/fragment/
 * trailing slash, mobile hosts folded to www. Returns null for anything
 * that isn't parseable or isn't actually a linkedin.com URL.
 */
export function canonicalizeLinkedinUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  let host = parsed.hostname.toLowerCase();
  if (host === 'm.linkedin.com' || host === 'mobile.linkedin.com' || host === 'linkedin.com') {
    host = 'www.linkedin.com';
  }
  if (host !== 'www.linkedin.com') return null;

  const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
  return `https://${host}${path}`;
}

/** Stable workspace-local identity for a LinkedIn profile. Unlike the full
 * URL, this survives mobile hosts, query parameters and trailing slashes. */
export function linkedinProfileKey(raw: unknown): string | null {
  const canonical = canonicalizeLinkedinUrl(raw);
  if (!canonical) return null;
  try {
    const parts = new URL(canonical).pathname.split('/').filter(Boolean);
    return parts[0] === 'in' && parts[1] ? decodeURIComponent(parts[1]).toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Digits-only phone comparison key: last 10 digits, so a missing/extra
 * country code still matches. Returns null for anything with no digits. */
export function normalizePhoneKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** The extension's own placeholder scheme (and the CSV importer's, which this
 * matches) — never treat these as a real identifying email. */
export function isRealEmail(raw: unknown): raw is string {
  return (
    typeof raw === 'string' && !!raw.trim() && !raw.toLowerCase().includes('@placeholder.skarion')
  );
}

export interface DedupMatch {
  matchType: 'linkedin_url' | 'email' | 'phone';
  entityType: 'lead' | 'contact';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  record: any;
}

type LeadEnrichmentRecord = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  notes: string | null;
  tags: unknown;
};

type LeadEnrichmentInput = Partial<LeadEnrichmentRecord>;

function blank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim());
}

const LINKEDIN_PROFILE_SECTION =
  /^(headline|location|connections|about|experience|education|skills|certifications):(?:\s*(.*))?$/i;

function splitLinkedInProfileSections(notes: string): Map<string, string> {
  const sections = new Map<string, string>();
  let sectionName: string | null = null;
  let sectionLines: string[] = [];
  const saveSection = () => {
    if (sectionName && sectionLines.length > 0) {
      sections.set(sectionName, sectionLines.join('\n').trim());
    }
  };

  for (const line of notes.replace(/\r\n?/g, '\n').split('\n')) {
    const match = line.trim().match(LINKEDIN_PROFILE_SECTION);
    if (match) {
      saveSection();
      sectionName = match[1]!.toLowerCase();
      sectionLines = [line.trim()];
    } else if (sectionName) {
      sectionLines.push(line);
    }
  }
  saveSection();
  return sections;
}

export function hasLinkedInProfileDetails(notes: unknown): boolean {
  if (typeof notes !== 'string') return false;
  return splitLinkedInProfileSections(notes).size > 0;
}

/**
 * Builds a non-destructive enrichment patch. Existing human-entered values
 * always win; a fresh extension capture fills gaps and appends its richer
 * profile notes only when no LinkedIn profile sections were stored before.
 */
export function buildLeadEnrichmentPatch(
  existing: LeadEnrichmentRecord,
  incoming: LeadEnrichmentInput
): { patch: Partial<LeadEnrichmentRecord>; enrichedFields: string[] } {
  const patch: Partial<LeadEnrichmentRecord> = {};
  const enrichedFields: string[] = [];

  const fill = (field: keyof LeadEnrichmentRecord, value: unknown) => {
    if (!blank(existing[field]) || blank(value)) return;
    (patch as Record<string, unknown>)[field] = value;
    enrichedFields.push(field);
  };

  fill('firstName', incoming.firstName?.trim());
  fill('lastName', incoming.lastName?.trim());
  if (isRealEmail(incoming.email)) fill('email', incoming.email.trim().toLowerCase());
  fill('phone', incoming.phone?.trim());
  fill('companyName', incoming.companyName?.trim());
  fill('companyDomain', incoming.companyDomain?.trim());
  fill('linkedinUrl', canonicalizeLinkedinUrl(incoming.linkedinUrl));

  const incomingNotes = incoming.notes?.trim();
  if (incomingNotes) {
    const existingNotes = existing.notes?.trim() ?? '';
    const existingSections = splitLinkedInProfileSections(existingNotes);
    const incomingSections = splitLinkedInProfileSections(incomingNotes);
    const missingSections = [...incomingSections.entries()]
      .filter(([section]) => !existingSections.has(section))
      .map(([, content]) => content);

    if (existingSections.size === 0 || missingSections.length > 0) {
      const addition = existingSections.size === 0 ? incomingNotes : missingSections.join('\n\n');
      patch.notes = existingNotes
        ? `${existingNotes}\n\n--- LinkedIn profile ${
            existingSections.size === 0 ? 'capture' : 'enrichment'
          } ---\n${addition}`
        : addition;
      enrichedFields.push('notes');
    }
  }

  const existingTags = Array.isArray(existing.tags)
    ? existing.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  const incomingTags = Array.isArray(incoming.tags)
    ? incoming.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  const mergedTags = [...new Set([...existingTags, ...incomingTags])];
  if (mergedTags.length > existingTags.length) {
    patch.tags = mergedTags;
    enrichedFields.push('tags');
  }

  return { patch, enrichedFields };
}

/**
 * Duplicate hierarchy, checked in order, across BOTH leads and contacts —
 * someone already converted to a contact must still be caught, not just
 * leads still sitting in the pipeline.
 */
export async function findExactMatch(
  db: CrmDb,
  input: { linkedinUrl: string | null; email: string | null; phone: string | null }
): Promise<DedupMatch | null> {
  if (input.linkedinUrl) {
    const [lead] = await db
      .select()
      .from(schema.leads)
      .where(
        and(
          eq(sql`lower(${schema.leads.linkedinUrl})`, input.linkedinUrl),
          isNull(schema.leads.deletedAt)
        )
      )
      .limit(1);
    if (lead) return { matchType: 'linkedin_url', entityType: 'lead', record: lead };

    const [contact] = await db
      .select()
      .from(schema.contacts)
      .where(
        and(
          eq(sql`lower(${schema.contacts.linkedinUrl})`, input.linkedinUrl),
          isNull(schema.contacts.deletedAt)
        )
      )
      .limit(1);
    if (contact) return { matchType: 'linkedin_url', entityType: 'contact', record: contact };
  }

  if (input.email) {
    const [lead] = await db
      .select()
      .from(schema.leads)
      .where(
        and(eq(sql`lower(${schema.leads.email})`, input.email), isNull(schema.leads.deletedAt))
      )
      .limit(1);
    if (lead) return { matchType: 'email', entityType: 'lead', record: lead };

    const [contact] = await db
      .select()
      .from(schema.contacts)
      .where(
        and(
          eq(sql`lower(${schema.contacts.email})`, input.email),
          isNull(schema.contacts.deletedAt)
        )
      )
      .limit(1);
    if (contact) return { matchType: 'email', entityType: 'contact', record: contact };
  }

  if (input.phone) {
    const [lead] = await db
      .select()
      .from(schema.leads)
      .where(
        and(
          sql`right(regexp_replace(${schema.leads.phone}, '\\D', '', 'g'), 10) = ${input.phone}`,
          isNull(schema.leads.deletedAt)
        )
      )
      .limit(1);
    if (lead) return { matchType: 'phone', entityType: 'lead', record: lead };
  }

  return null;
}

/**
 * Safe fallback for older name-only leads. A name match is accepted only
 * when it is unique (or uniquely matches the supplied company) and the old
 * record has no conflicting LinkedIn URL.
 */
export async function findNameEnrichmentCandidate(
  db: CrmDb,
  input: {
    firstName: string;
    lastName: string;
    companyName: string | null;
    linkedinUrl: string | null;
  }
): Promise<typeof schema.leads.$inferSelect | null> {
  const firstName = input.firstName.trim().toLowerCase();
  const lastName = input.lastName.trim().toLowerCase();
  if (!firstName || !lastName) return null;

  const matches = await db
    .select()
    .from(schema.leads)
    .where(
      and(
        eq(sql`lower(${schema.leads.firstName})`, firstName),
        eq(sql`lower(${schema.leads.lastName})`, lastName),
        isNull(schema.leads.deletedAt)
      )
    )
    .limit(10);

  const nonConflicting = matches.filter((lead) => {
    const storedUrl = canonicalizeLinkedinUrl(lead.linkedinUrl);
    return !storedUrl || !input.linkedinUrl || storedUrl === input.linkedinUrl;
  });
  if (nonConflicting.length === 1) return nonConflicting[0] ?? null;

  const companyName = input.companyName?.trim().toLowerCase();
  if (!companyName) return null;
  const sameCompany = nonConflicting.filter(
    (lead) => lead.companyName?.trim().toLowerCase() === companyName
  );
  return sameCompany.length === 1 ? (sameCompany[0] ?? null) : null;
}
