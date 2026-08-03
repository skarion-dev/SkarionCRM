export const LEAD_JOURNEY_STAGES = [
  'future',
  'foreign_national',
  'stem',
  'new',
  'ready_to_reach_out',
  'ready_for_email',
  'connection_sent',
  'connected',
  'engaged',
  'qualified',
  'meeting_booked',
  'opportunity',
  'follow_up',
  'converted',
  'nurture',
  'no_response',
  'disqualified',
  'lost',
] as const;

export type LeadJourneyStage = (typeof LEAD_JOURNEY_STAGES)[number];

export const NEEDS_PROFILE_CAPTURE_TAG = 'needs profile capture';
export const PROFILE_CAPTURE_COMPLETE_TAG = 'profile capture complete';

const PROFILE_CAPTURE_PENDING_TAGS = new Set([
  'needs profile capture',
  'profile capture needed',
  'profile capture required',
  'profile capture pending',
  'needs linkedin profile capture',
  'linkedin profile capture needed',
]);

function normalizedWorkflowTagName(tag: string): string {
  return tag.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

const ACTIVE_STAGE_RANK: Partial<Record<LeadJourneyStage, number>> = {
  future: 0,
  foreign_national: 0,
  stem: 0,
  new: 1,
  ready_to_reach_out: 2,
  ready_for_email: 3,
  connection_sent: 4,
  connected: 5,
  engaged: 6,
  qualified: 7,
  meeting_booked: 8,
  opportunity: 9,
  follow_up: 10,
  converted: 11,
};

const MANUAL_SIDE_STAGES = new Set<LeadJourneyStage>(['nurture', 'disqualified', 'lost']);
const ACTIVATION_STAGES = new Set<LeadJourneyStage>([
  'new',
  'ready_to_reach_out',
  'ready_for_email',
  'connection_sent',
  'connected',
  'engaged',
  'qualified',
  'meeting_booked',
  'opportunity',
  'follow_up',
]);

export function isLeadJourneyStage(value: unknown): value is LeadJourneyStage {
  return typeof value === 'string' && (LEAD_JOURNEY_STAGES as readonly string[]).includes(value);
}

export function isLeadActivationStage(stage: LeadJourneyStage): boolean {
  return ACTIVATION_STAGES.has(stage);
}

export function isLeadHoldingStage(stage: LeadJourneyStage | string): boolean {
  return stage === 'future' || stage === 'foreign_national' || stage === 'stem';
}

export function holdingStageTagName(stage: LeadJourneyStage | string): string | null {
  if (stage === 'future') return 'Future';
  if (stage === 'foreign_national') return 'Foreign National';
  if (stage === 'stem') return 'STEM';
  return null;
}

export function journeyStageFromLegacy(input: {
  status?: string | null;
  outreachStatus?: string | null;
  hasConnectionNote?: boolean;
}): LeadJourneyStage {
  if (input.status === 'converted') return 'converted';
  if (input.status === 'disqualified') return 'disqualified';
  if (input.status === 'qualified') return 'qualified';

  switch (input.outreachStatus) {
    case 'booked_call':
      return 'meeting_booked';
    case 'replied':
    case 'in_conversation':
    case 'connected':
      return 'engaged';
    case 'approached':
      return 'connected';
    case 'connection_request_sent':
      return 'connection_sent';
    case 'not_interested':
      return 'nurture';
    case 'bad_fit':
      return 'disqualified';
    default:
      if (input.status === 'contacted') return 'connected';
      return input.hasConnectionNote ? 'ready_to_reach_out' : 'new';
  }
}

export function journeyStageFromChannelStage(stage: string): LeadJourneyStage | null {
  switch (stage) {
    case 'connection_request_sent':
      return 'connection_sent';
    case 'connection_accepted':
    case 'message_sent':
    case 'awaiting_reply':
      return 'connected';
    case 'in_conversation':
    case 'replied':
      return 'engaged';
    case 'booked_call':
      return 'meeting_booked';
    case 'no_response':
      return 'no_response';
    default:
      return null;
  }
}

export function mergeJourneyWithChannelStages(
  current: LeadJourneyStage,
  channelStages: string[]
): LeadJourneyStage {
  if (MANUAL_SIDE_STAGES.has(current) || current === 'converted') return current;

  const channelJourneyStages = channelStages
    .map(journeyStageFromChannelStage)
    .filter((stage): stage is LeadJourneyStage => Boolean(stage));
  const activeChannelStages = channelJourneyStages.filter((stage) => stage !== 'no_response');
  if (activeChannelStages.length === 0) {
    return channelJourneyStages.length > 0 && (ACTIVE_STAGE_RANK[current] ?? 0) < 5
      ? 'no_response'
      : current;
  }

  return activeChannelStages.reduce<LeadJourneyStage>((best, stage) => {
    return (ACTIVE_STAGE_RANK[stage] ?? -1) > (ACTIVE_STAGE_RANK[best] ?? -1) ? stage : best;
  }, current);
}

export function legacyFieldsForJourney(stage: LeadJourneyStage): {
  status: 'new' | 'contacted' | 'qualified' | 'disqualified' | 'converted';
  outreachStatus: string;
} {
  if (stage === 'converted') return { status: 'converted', outreachStatus: 'booked_call' };
  if (stage === 'disqualified' || stage === 'lost') {
    return { status: 'disqualified', outreachStatus: 'bad_fit' };
  }
  if (
    stage === 'qualified' ||
    stage === 'meeting_booked' ||
    stage === 'opportunity' ||
    stage === 'follow_up'
  ) {
    return {
      status: 'qualified',
      outreachStatus: stage === 'meeting_booked' ? 'booked_call' : 'replied',
    };
  }
  if (stage === 'engaged') return { status: 'contacted', outreachStatus: 'replied' };
  if (stage === 'connected') return { status: 'contacted', outreachStatus: 'approached' };
  if (stage === 'connection_sent') {
    return { status: 'contacted', outreachStatus: 'connection_request_sent' };
  }
  if (stage === 'nurture') return { status: 'contacted', outreachStatus: 'not_interested' };
  if (stage === 'no_response') return { status: 'contacted', outreachStatus: 'not_interested' };
  return { status: 'new', outreachStatus: 'not_approached' };
}

export function normalizeTagNames(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const tags = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().replace(/\s+/g, ' '))
    .filter((value) => value.length > 0 && value.length <= 60);
  return [...new Map(tags.map((tag) => [tag.toLowerCase(), tag])).values()];
}

export function hasLeadTag(values: unknown, expectedTag: string): boolean {
  const expected = expectedTag.trim().toLowerCase();
  return normalizeTagNames(values).some((tag) => tag.toLowerCase() === expected);
}

export function profileCaptureCompleteTags(values: unknown): string[] {
  return normalizeTagNames([
    ...normalizeTagNames(values).filter((tag) => {
      const normalized = normalizedWorkflowTagName(tag);
      return (
        !PROFILE_CAPTURE_PENDING_TAGS.has(normalized) && normalized !== PROFILE_CAPTURE_COMPLETE_TAG
      );
    }),
    PROFILE_CAPTURE_COMPLETE_TAG,
  ]);
}

function isFutureTagName(tag: string): boolean {
  const normalized = tag.trim().toLowerCase();
  return normalized === 'future' || normalized.startsWith('future ');
}

function isForeignNationalTagName(tag: string): boolean {
  const normalized = tag.trim().toLowerCase();
  return normalized === 'foreign national' || normalized.startsWith('foreign national ');
}

function isStemTagName(tag: string): boolean {
  const normalized = tag.trim().toLowerCase();
  return normalized === 'stem' || normalized.startsWith('stem ');
}

export function journeyStageForTags(stage: LeadJourneyStage, tags: unknown): LeadJourneyStage {
  const normalizedTags = normalizeTagNames(tags);
  if (normalizedTags.some(isFutureTagName)) return 'future';
  if (normalizedTags.some(isForeignNationalTagName)) return 'foreign_national';
  if (normalizedTags.some(isStemTagName)) return 'stem';
  return stage;
}

export function syncHoldingTagsForJourney(values: unknown, stage: LeadJourneyStage): string[] {
  const withoutHoldingTags = normalizeTagNames(values).filter(
    (tag) => !isFutureTagName(tag) && !isForeignNationalTagName(tag) && !isStemTagName(tag)
  );
  const holdingTag = holdingStageTagName(stage);
  if (holdingTag) return normalizeTagNames([...withoutHoldingTags, holdingTag]);
  return withoutHoldingTags;
}

/** Compatibility alias for older imports. */
export const syncFutureTagForJourney = syncHoldingTagsForJourney;

export function tagSlug(name: string): string {
  const asciiSlug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (asciiSlug) return asciiSlug;
  const codePointSlug = Array.from(name.trim())
    .map((character) => character.codePointAt(0)?.toString(36) ?? '')
    .filter(Boolean)
    .join('-');
  return codePointSlug ? `tag-${codePointSlug}`.slice(0, 80) : '';
}

export function formatBatchTag(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const cleaned = String(value)
    .trim()
    .replace(/^(?:batch|set)[\s#:_-]*/i, '')
    .replace(/\s+/g, ' ');
  return cleaned ? `Batch ${cleaned}`.slice(0, 60) : null;
}
