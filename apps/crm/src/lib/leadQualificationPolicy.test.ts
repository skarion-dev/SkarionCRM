import { describe, expect, it } from 'vitest';
import {
  hasPhdProfileEvidence,
  phdZeroScoreAssessment,
  PHD_ZERO_SCORE_REASON,
} from './leadQualificationPolicy.js';

describe('lead qualification policy', () => {
  it.each([
    { headline: 'PhD candidate in civil engineering' },
    { lastName: 'Ahamed, Ph.D.' },
    { education: 'Doctor of Philosophy in Computer Science' },
    { educationEntries: [{ degree: 'Ph D', field: 'Electrical Engineering' }] },
  ])('detects PhD evidence across captured profile fields', (profile) => {
    expect(hasPhdProfileEvidence(profile)).toBe(true);
  });

  it('does not match unrelated words or recruiter source metadata', () => {
    expect(
      hasPhdProfileEvidence({
        headline: 'AlphaHD systems engineer',
        notes: 'Experienced infrastructure analyst',
      })
    ).toBe(false);
  });

  it('creates a deterministic zero assessment without an AI call', () => {
    expect(phdZeroScoreAssessment()).toMatchObject({
      overallScore: 0,
      rawScore: 0,
      hardDisqualifier: true,
      reasoningSummary: PHD_ZERO_SCORE_REASON,
    });
  });
});
