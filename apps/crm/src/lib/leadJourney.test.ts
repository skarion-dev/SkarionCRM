import { describe, expect, it } from 'vitest';
import {
  formatBatchTag,
  journeyStageFromLegacy,
  mergeJourneyWithChannelStages,
  normalizeTagNames,
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
  });
});

describe('lead tags', () => {
  it('normalizes duplicate names and creates batch tags', () => {
    expect(normalizeTagNames(['  Warm   Lead ', 'warm lead', '', 12])).toEqual(['warm lead']);
    expect(formatBatchTag('Batch #42')).toBe('Batch 42');
    expect(formatBatchTag('Set 4')).toBe('Batch 4');
  });
});
