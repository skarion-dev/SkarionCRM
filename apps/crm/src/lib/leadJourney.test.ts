import { describe, expect, it } from 'vitest';
import {
  formatBatchTag,
  hasLeadTag,
  isLeadActivationStage,
  journeyStageForTags,
  journeyStageFromLegacy,
  mergeJourneyWithChannelStages,
  normalizeTagNames,
  syncFutureTagForJourney,
} from './leadJourney.js';

describe('lead journey compatibility', () => {
  it('maps legacy lead and outreach fields into one journey', () => {
    expect(journeyStageFromLegacy({ status: 'contacted' })).toBe('connected');
    expect(journeyStageFromLegacy({ outreachStatus: 'connection_request_sent' })).toBe(
      'connection_sent'
    );
    expect(journeyStageFromLegacy({ outreachStatus: 'booked_call' })).toBe('meeting_booked');
    expect(journeyStageFromLegacy({ hasConnectionNote: true })).toBe('ready_to_reach_out');
  });

  it('moves forward from channel activity without regressing manual outcomes', () => {
    expect(mergeJourneyWithChannelStages('new', ['connection_request_sent'])).toBe(
      'connection_sent'
    );
    expect(mergeJourneyWithChannelStages('engaged', ['connection_request_sent'])).toBe('engaged');
    expect(mergeJourneyWithChannelStages('nurture', ['replied'])).toBe('nurture');
    expect(mergeJourneyWithChannelStages('follow_up', ['booked_call'])).toBe('follow_up');
    expect(mergeJourneyWithChannelStages('future', ['connection_request_sent'])).toBe(
      'connection_sent'
    );
  });
});

describe('lead tags', () => {
  it('normalizes duplicate names and creates batch tags', () => {
    expect(normalizeTagNames(['  Warm   Lead ', 'warm lead', '', 12])).toEqual(['warm lead']);
    expect(formatBatchTag('Batch #42')).toBe('Batch 42');
    expect(formatBatchTag('Set 4')).toBe('Batch 4');
  });

  it('keeps the Future tag and journey stage aligned', () => {
    expect(hasLeadTag(['Batch 8', ' future '], 'Future')).toBe(true);
    expect(journeyStageForTags('new', ['Future'])).toBe('future');
    expect(syncFutureTagForJourney(['Batch 8'], 'future')).toEqual(['Batch 8', 'Future']);
    expect(syncFutureTagForJourney(['Future', 'Batch 8'], 'new')).toEqual(['Batch 8']);
    expect(isLeadActivationStage('new')).toBe(true);
    expect(isLeadActivationStage('future')).toBe(false);
  });
});
