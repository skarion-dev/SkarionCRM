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
