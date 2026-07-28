import { describe, it, expect } from 'vitest';
import type { CrmDb } from '../db/types.js';
import {
  canonicalizeLinkedinUrl,
  normalizePhoneKey,
  isRealEmail,
  findExactMatch,
} from './leadDedup.js';

describe('canonicalizeLinkedinUrl', () => {
  it('lowercases and strips query string, fragment, and trailing slash', () => {
    expect(canonicalizeLinkedinUrl('https://www.linkedin.com/in/John-Doe/?trk=profile#about')).toBe(
      'https://www.linkedin.com/in/john-doe'
    );
  });

  it('folds mobile and bare linkedin.com hosts to www', () => {
    expect(canonicalizeLinkedinUrl('https://m.linkedin.com/in/jane-doe')).toBe(
      'https://www.linkedin.com/in/jane-doe'
    );
    expect(canonicalizeLinkedinUrl('https://mobile.linkedin.com/in/jane-doe/')).toBe(
      'https://www.linkedin.com/in/jane-doe'
    );
    expect(canonicalizeLinkedinUrl('https://linkedin.com/in/jane-doe')).toBe(
      'https://www.linkedin.com/in/jane-doe'
    );
  });

  it('treats these three formattings of the same profile as equal', () => {
    const a = canonicalizeLinkedinUrl('https://www.linkedin.com/in/john-doe');
    const b = canonicalizeLinkedinUrl('https://www.linkedin.com/in/john-doe/?trk=profile');
    const c = canonicalizeLinkedinUrl('https://linkedin.com/in/john-doe#about');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('accepts a bare host+path with no scheme', () => {
    expect(canonicalizeLinkedinUrl('www.linkedin.com/in/john-doe')).toBe(
      'https://www.linkedin.com/in/john-doe'
    );
  });

  it('rejects non-LinkedIn URLs and non-strings', () => {
    expect(canonicalizeLinkedinUrl('https://example.com/in/john-doe')).toBeNull();
    expect(canonicalizeLinkedinUrl('not a url at all')).toBeNull();
    expect(canonicalizeLinkedinUrl(null)).toBeNull();
    expect(canonicalizeLinkedinUrl(undefined)).toBeNull();
    expect(canonicalizeLinkedinUrl('')).toBeNull();
    expect(canonicalizeLinkedinUrl('   ')).toBeNull();
  });
});

describe('normalizePhoneKey', () => {
  it('strips non-digits and keeps the last 10 digits', () => {
    expect(normalizePhoneKey('+1 (555) 123-4567')).toBe('5551234567');
    expect(normalizePhoneKey('015551234567')).toBe('5551234567');
  });

  it('returns null for anything with no digits', () => {
    expect(normalizePhoneKey('')).toBeNull();
    expect(normalizePhoneKey('n/a')).toBeNull();
    expect(normalizePhoneKey(null)).toBeNull();
    expect(normalizePhoneKey(undefined)).toBeNull();
  });
});

describe('isRealEmail', () => {
  it('accepts a normal email', () => {
    expect(isRealEmail('jane@example.com')).toBe(true);
  });

  it('rejects the extension/importer placeholder scheme', () => {
    expect(isRealEmail('janedoe-abc123@placeholder.skarion')).toBe(false);
  });

  it('rejects empty, whitespace, non-strings', () => {
    expect(isRealEmail('')).toBe(false);
    expect(isRealEmail('   ')).toBe(false);
    expect(isRealEmail(null)).toBe(false);
    expect(isRealEmail(undefined)).toBe(false);
  });
});

// Minimal drizzle-shaped mock: db.select().from(table).where(cond).limit(n).
// Each call to .limit() consumes the next queued result set, in the same
// order findExactMatch issues its queries (leads-by-linkedin, contacts-by-
// linkedin, leads-by-email, contacts-by-email, leads-by-phone) — tests only
// queue as many entries as the scenario needs to reach a match.
function mockDb(resultsQueue: unknown[][]): CrmDb {
  let i = 0;
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(resultsQueue[i++] ?? []),
  };
  return { select: () => chain } as unknown as CrmDb;
}

describe('findExactMatch', () => {
  it('matches a lead by canonical LinkedIn URL first, without checking further', async () => {
    const lead = { id: 'lead-1', ownerId: 'u1' };
    const db = mockDb([[lead]]);
    const result = await findExactMatch(db, {
      linkedinUrl: 'https://www.linkedin.com/in/john-doe',
      email: null,
      phone: null,
    });
    expect(result).toEqual({ matchType: 'linkedin_url', entityType: 'lead', record: lead });
  });

  it('falls through to contacts when no lead matches the LinkedIn URL', async () => {
    const contact = { id: 'contact-1', ownerId: 'u1' };
    const db = mockDb([[], [contact]]);
    const result = await findExactMatch(db, {
      linkedinUrl: 'https://www.linkedin.com/in/john-doe',
      email: null,
      phone: null,
    });
    expect(result).toEqual({ matchType: 'linkedin_url', entityType: 'contact', record: contact });
  });

  it('falls through to email when LinkedIn URL matches nothing', async () => {
    const lead = { id: 'lead-2', ownerId: 'u1' };
    const db = mockDb([[], [], [lead]]);
    const result = await findExactMatch(db, {
      linkedinUrl: 'https://www.linkedin.com/in/no-match',
      email: 'jane@example.com',
      phone: null,
    });
    expect(result).toEqual({ matchType: 'email', entityType: 'lead', record: lead });
  });

  it('falls through to phone when LinkedIn URL and email match nothing', async () => {
    const lead = { id: 'lead-3', ownerId: 'u1' };
    const db = mockDb([[], [], [], [], [lead]]);
    const result = await findExactMatch(db, {
      linkedinUrl: 'https://www.linkedin.com/in/no-match',
      email: 'nomatch@example.com',
      phone: '5551234567',
    });
    expect(result).toEqual({ matchType: 'phone', entityType: 'lead', record: lead });
  });

  it('returns null when nothing matches anywhere', async () => {
    const db = mockDb([[], [], [], [], []]);
    const result = await findExactMatch(db, {
      linkedinUrl: 'https://www.linkedin.com/in/no-match',
      email: 'nomatch@example.com',
      phone: '5551234567',
    });
    expect(result).toBeNull();
  });

  it('skips every query for a field that is null', async () => {
    const db = mockDb([]);
    const result = await findExactMatch(db, { linkedinUrl: null, email: null, phone: null });
    expect(result).toBeNull();
  });
});
