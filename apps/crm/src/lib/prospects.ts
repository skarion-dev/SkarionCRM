import { canonicalizeLinkedinUrl, linkedinProfileKey } from './leadDedup.js';

export const PROSPECT_DISPOSITIONS = [
  'excellent_fit',
  'maybe',
  'worth_trying',
  'future',
  'foreign_national',
  'disqualified',
] as const;

export type ProspectDisposition = (typeof PROSPECT_DISPOSITIONS)[number];

export const ACTIVE_CONVERSATION_JOURNEY_STAGES = [
  'connection_sent',
  'connected',
  'engaged',
  'qualified',
  'meeting_booked',
  'opportunity',
  'follow_up',
  'converted',
] as const;

type ProspectIdentity = {
  id?: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
};

function identityText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function identityPhone(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : '';
}

export function prospectIdentityNameKey(identity: ProspectIdentity): string | null {
  const firstName = identityText(identity.firstName);
  const lastName = identityText(identity.lastName);
  if (!firstName || !lastName || firstName === 'linkedin' || firstName === 'candidate') {
    return null;
  }
  return `${firstName}|${lastName}`;
}

export function findActiveLeadIdentityDuplicate<T extends ProspectIdentity>(
  candidate: ProspectIdentity,
  activeLeads: T[]
): { lead: T; reason: 'email' | 'phone' | 'name_company' | 'unique_name' } | null {
  const email = identityText(candidate.email);
  if (email) {
    const match = activeLeads.find((lead) => identityText(lead.email) === email);
    if (match) return { lead: match, reason: 'email' };
  }

  const phone = identityPhone(candidate.phone);
  if (phone) {
    const match = activeLeads.find((lead) => identityPhone(lead.phone) === phone);
    if (match) return { lead: match, reason: 'phone' };
  }

  const nameKey = prospectIdentityNameKey(candidate);
  if (!nameKey) return null;
  const nameMatches = activeLeads.filter((lead) => prospectIdentityNameKey(lead) === nameKey);
  if (nameMatches.length === 0) return null;

  const companyName = identityText(candidate.companyName);
  if (companyName) {
    const companyMatches = nameMatches.filter(
      (lead) => identityText(lead.companyName) === companyName
    );
    if (companyMatches.length === 1) {
      return { lead: companyMatches[0] as T, reason: 'name_company' };
    }
  }
  return nameMatches.length === 1 ? { lead: nameMatches[0] as T, reason: 'unique_name' } : null;
}

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
    case 'foreign_national':
      return 'Foreign National';
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
  currentRole: string | null;
  currentRoleDates: string | null;
  openToWork: boolean | null;
  yearsExperience: string | null;
  connectionDegree: string | null;
  sourceContext: Record<string, string | null>;
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
  const joinEvidence = (values: unknown[]): string | null => {
    const parts = values.map(nullable).filter((value): value is string => Boolean(value));
    return parts.length > 0 ? parts.join(' | ') : null;
  };
  const cleanRecruiterNoise = (value: unknown): string | null => {
    const text = nullable(value);
    return text && !/^(enhanced by resume|profile experience|--)$/i.test(text) ? text : null;
  };
  let headline = nullable(firstValue(record, ['headline', 'title', 'currenttitle', 'jobtitle']));
  let location = nullable(firstValue(record, ['location', 'city', 'region', 'country']));
  if (
    headline &&
    !location &&
    /\b(?:united states|canada|california|new york|texas|florida)\b.*[·|]/i.test(headline)
  ) {
    location = headline.split(/[·|]/)[0]?.trim() || null;
    headline = null;
  }
  if (
    !headline &&
    location &&
    /[|@]|\b(?:engineer|scientist|student|analyst|manager)\b/i.test(location)
  ) {
    headline = location;
    location = null;
  }
  const currentRole = cleanRecruiterNoise(
    firstValue(record, ['currentrole', 'currenttitle', 'role'])
  );
  const currentCompany = nullable(
    firstValue(record, ['currentcompany', 'company', 'companyname', 'organization'])
  );
  const currentRoleDates = nullable(firstValue(record, ['currentdates', 'roledates']));
  const pastRoles = nullable(
    firstValue(record, ['pastroles', 'experience', 'workexperience', 'employment', 'workhistory'])
  );
  const experience = joinEvidence([
    currentRole
      ? `${currentRole}${currentCompany ? ` at ${currentCompany}` : ''}${currentRoleDates ? ` · ${currentRoleDates}` : ''}`
      : null,
    pastRoles,
  ]);
  const education = joinEvidence([
    firstValue(record, ['education', 'schools', 'school', 'academicbackground']),
    firstValue(record, ['degree']),
    firstValue(record, ['edudates', 'educationdates']),
  ]);
  const openToWorkText = nullable(firstValue(record, ['opentowork']));
  const openToWork =
    openToWorkText === null
      ? null
      : /^(yes|true|1|open|actively looking)$/i.test(openToWorkText)
        ? true
        : /^(no|false|0)$/i.test(openToWorkText)
          ? false
          : null;

  return {
    row: {
      sourceRow,
      linkedinUrl,
      linkedinProfileKey: profileKey,
      firstName: name.firstName,
      lastName: name.lastName,
      email: nullable(firstValue(record, ['email', 'emailaddress'])),
      phone: nullable(firstValue(record, ['phone', 'phonenumber'])),
      companyName: currentCompany,
      headline,
      location,
      about: nullable(firstValue(record, ['about', 'summary', 'bio', 'profileabout'])),
      experience,
      education,
      skills: nullable(firstValue(record, ['skills', 'skillset', 'topskills'])),
      currentRole,
      currentRoleDates,
      openToWork,
      yearsExperience: nullable(firstValue(record, ['yrsexp', 'yearsexperience'])),
      connectionDegree: nullable(firstValue(record, ['connection', 'connectiondegree'])),
      sourceContext: {
        searchName: nullable(firstValue(record, ['searchname'])),
        keywords: nullable(firstValue(record, ['keywords'])),
        filterLocations: nullable(firstValue(record, ['filterlocations'])),
        filterTitles: nullable(firstValue(record, ['filtertitles'])),
        openToWorkFilter: nullable(firstValue(record, ['opentoworkfilter'])),
      },
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
