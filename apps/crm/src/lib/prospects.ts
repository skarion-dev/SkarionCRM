import { canonicalizeLinkedinUrl, linkedinProfileKey } from './leadDedup.js';

export const PROSPECT_DISPOSITIONS = [
  'excellent_fit',
  'maybe',
  'worth_trying',
  'future',
  'disqualified',
] as const;

export type ProspectDisposition = (typeof PROSPECT_DISPOSITIONS)[number];

export function isProspectDisposition(value: unknown): value is ProspectDisposition {
  return typeof value === 'string' && (PROSPECT_DISPOSITIONS as readonly string[]).includes(value);
}

export function dispositionTag(disposition: ProspectDisposition): string {
  switch (disposition) {
    case 'excellent_fit':
      return 'Excellent Fit';
    case 'worth_trying':
      return 'Worth Trying';
    case 'maybe':
      return 'Maybe';
    case 'future':
      return 'Future';
    case 'disqualified':
      return 'Disqualified';
  }
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

export function deriveProspectName(
  suppliedName: unknown,
  linkedinUrl: string
): { firstName: string; lastName: string; generated: boolean } {
  const cleaned =
    typeof suppliedName === 'string'
      ? (suppliedName.trim().replace(/\s+/g, ' ').split(',')[0]?.trim() ?? '')
      : '';
  if (cleaned && !/^(linkedin\s*)?(member|candidate)?$/i.test(cleaned)) {
    const parts = cleaned.split(' ').filter(Boolean);
    if (parts.length > 1) {
      return {
        firstName: parts[0] ?? 'LinkedIn',
        lastName: parts.slice(1).join(' '),
        generated: false,
      };
    }
  }

  const key = linkedinProfileKey(linkedinUrl) ?? '';
  if (/^(aemaa|acwaa)/i.test(key) || !key) {
    const suffix =
      key
        .replace(/[^a-z0-9]/gi, '')
        .slice(-7)
        .toUpperCase() || 'UNKNOWN';
    return { firstName: 'LinkedIn', lastName: `Candidate ${suffix}`, generated: true };
  }
  const parts = key
    .replace(/_/g, '-')
    .split(/-+/)
    .map((part) => part.replace(/\d+.*$/g, ''))
    .filter((part) => part && !/\d/.test(part));
  if (parts.length > 1) {
    return {
      firstName: titleCase(parts[0] ?? 'LinkedIn'),
      lastName: titleCase(parts.slice(1).join(' ')),
      generated: true,
    };
  }
  return {
    firstName: titleCase(parts[0] || 'LinkedIn'),
    lastName: 'Candidate',
    generated: true,
  };
}

export type ProspectCsvRow = {
  sourceRow: number;
  linkedinUrl: string;
  linkedinProfileKey: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  headline: string | null;
  location: string | null;
  about: string | null;
  experience: string | null;
  education: string | null;
  skills: string | null;
  notes: string | null;
  generatedName: boolean;
};

function normalizedRecord(record: Record<string, unknown>): Map<string, unknown> {
  return new Map(
    Object.entries(record).map(([key, value]) => [
      key
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ''),
      value,
    ])
  );
}

function firstValue(record: Map<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    const value = record.get(name);
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return null;
}

export function normalizeProspectCsvRecord(
  raw: Record<string, unknown>,
  sourceRow: number
): { row?: ProspectCsvRow; error?: string } {
  const record = normalizedRecord(raw);
  const rawUrl = firstValue(record, ['linkedinurl', 'linkedin', 'profileurl', 'fixedurl', 'url']);
  const linkedinUrl = canonicalizeLinkedinUrl(rawUrl);
  const profileKey = linkedinProfileKey(linkedinUrl);
  if (!linkedinUrl || !profileKey) {
    return { error: 'Missing or invalid LinkedIn profile URL.' };
  }

  const fullName = firstValue(record, ['fullname', 'name', 'candidatename', 'leadname']);
  const firstNameValue = firstValue(record, ['firstname', 'first']);
  const lastNameValue = firstValue(record, ['lastname', 'last']);
  const suppliedName =
    fullName ??
    [firstNameValue, lastNameValue]
      .filter((value) => value !== undefined && value !== null && String(value).trim())
      .join(' ');
  const name = deriveProspectName(suppliedName, linkedinUrl);
  const nullable = (value: unknown): string | null => {
    const text = value == null ? '' : String(value).trim();
    return text || null;
  };

  return {
    row: {
      sourceRow,
      linkedinUrl,
      linkedinProfileKey: profileKey,
      firstName: name.firstName,
      lastName: name.lastName,
      email: nullable(firstValue(record, ['email', 'emailaddress'])),
      phone: nullable(firstValue(record, ['phone', 'phonenumber'])),
      companyName: nullable(firstValue(record, ['company', 'companyname', 'organization'])),
      headline: nullable(firstValue(record, ['headline', 'title', 'currenttitle', 'jobtitle'])),
      location: nullable(firstValue(record, ['location', 'city', 'region', 'country'])),
      about: nullable(firstValue(record, ['about', 'summary', 'bio', 'profileabout'])),
      experience: nullable(
        firstValue(record, ['experience', 'workexperience', 'employment', 'workhistory'])
      ),
      education: nullable(
        firstValue(record, ['education', 'schools', 'school', 'academicbackground'])
      ),
      skills: nullable(firstValue(record, ['skills', 'skillset', 'topskills'])),
      notes: nullable(firstValue(record, ['notes', 'remarks', 'note'])),
      generatedName: name.generated,
    },
  };
}

export function calculateLeadCompleteness(input: {
  firstName?: string | null;
  lastName?: string | null;
  linkedinUrl?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  headline?: string | null;
  location?: string | null;
  about?: string | null;
}): number {
  const weights: Array<[keyof typeof input, number]> = [
    ['firstName', 10],
    ['lastName', 10],
    ['linkedinUrl', 20],
    ['companyName', 15],
    ['headline', 15],
    ['location', 10],
    ['about', 10],
    ['email', 5],
    ['phone', 5],
  ];
  return weights.reduce(
    (score, [key, weight]) => score + (String(input[key] ?? '').trim() ? weight : 0),
    0
  );
}
