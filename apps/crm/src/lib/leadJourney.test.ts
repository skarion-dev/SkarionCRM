import { describe, expect, it } from 'vitest';
import {
  formatBatchTag,
  hasLeadTag,
  isLeadActivationStage,
  isLeadHoldingStage,
  journeyStageForTags,
  journeyStageFromLegacy,
  mergeJourneyWithChannelStages,
  normalizeTagNames,
  profileCaptureCompleteTags,
  syncHoldingTagsForJourney,
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

  it('keeps holding tags and journey stages aligned', () => {
    expect(hasLeadTag(['Batch 8', ' future '], 'Future')).toBe(true);
    expect(journeyStageForTags('new', ['Future'])).toBe('future');
    expect(journeyStageForTags('new', ['Future Candidates'])).toBe('future');
    expect(journeyStageForTags('new', ['Foreign National'])).toBe('foreign_national');
    expect(journeyStageForTags('new', ['STEM'])).toBe('stem');
    expect(syncHoldingTagsForJourney(['Batch 8'], 'future')).toEqual(['Batch 8', 'Future']);
    expect(syncHoldingTagsForJourney(['Batch 8'], 'foreign_national')).toEqual([
      'Batch 8',
      'Foreign National',
    ]);
    expect(syncHoldingTagsForJourney(['Batch 8'], 'stem')).toEqual(['Batch 8', 'STEM']);
    expect(syncHoldingTagsForJourney(['Future', 'Batch 8'], 'new')).toEqual(['Batch 8']);
    expect(syncHoldingTagsForJourney(['Foreign National', 'Batch 8'], 'new')).toEqual(['Batch 8']);
    expect(syncHoldingTagsForJourney(['STEM', 'Batch 8'], 'new')).toEqual(['Batch 8']);
    expect(syncHoldingTagsForJourney(['Future'], 'foreign_national')).toEqual(['Foreign National']);
    expect(syncHoldingTagsForJourney(['Foreign National'], 'stem')).toEqual(['STEM']);
    expect(isLeadActivationStage('new')).toBe(true);
    expect(isLeadActivationStage('future')).toBe(false);
    expect(isLeadHoldingStage('future')).toBe(true);
    expect(isLeadHoldingStage('foreign_national')).toBe(true);
    expect(isLeadHoldingStage('stem')).toBe(true);
  });

  it('replaces the pending profile-capture tag with one canonical completion tag', () => {
    expect(
      profileCaptureCompleteTags(['Batch 8', 'Needs Profile Capture', 'PROFILE CAPTURE COMPLETE'])
    ).toEqual(['Batch 8', 'profile capture complete']);
    expect(profileCaptureCompleteTags(null)).toEqual(['profile capture complete']);
  });
});
