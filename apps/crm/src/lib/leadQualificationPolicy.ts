import type { LeadQualificationAssessment } from './ai-service.js';

type ProspectProfileEvidence = {
  firstName?: string | null;
  lastName?: string | null;
  headline?: string | null;
  about?: string | null;
  experience?: string | null;
  education?: string | null;
  skills?: string | null;
  currentRole?: string | null;
  currentRoleDates?: string | null;
  profileSummary?: string | null;
  educationEntries?: unknown;
  experienceEntries?: unknown;
  notes?: string | null;
};

export const PHD_ZERO_SCORE_REASON =
  'PhD profile — excluded by the current prospecting policy. Score forced to 0.';

const PHD_PATTERN = /\bph\.?\s*d\b\.?|\bdoctor of philosophy\b/i;

function searchableValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return '';
}

export function hasPhdProfileEvidence(profile: ProspectProfileEvidence): boolean {
  return PHD_PATTERN.test(
    [
      profile.firstName,
      profile.lastName,
      profile.headline,
      profile.about,
      profile.experience,
      profile.education,
      profile.skills,
      profile.currentRole,
      profile.currentRoleDates,
      profile.profileSummary,
      profile.educationEntries,
      profile.experienceEntries,
      profile.notes,
    ]
      .map(searchableValue)
      .filter(Boolean)
      .join(' ')
  );
}

export function phdZeroScoreAssessment(): LeadQualificationAssessment {
  return {
    overallScore: 0,
    rawScore: 0,
    classification: 'REJECT OR LOW PRIORITY',
    confidenceLevel: 'high',
    profileEvidenceQuality: 'usable',
    marketEntryTiming: 'unknown',
    candidateNeedEvidence: 'none',
    scoreBreakdown: {
      careerStage: 0,
      jobSearchNeed: 0,
      pathwayFit: 0,
      usPositioningGap: 0,
      relocation: 0,
      internationalGraduateContext: 0,
      coachability: 0,
      bangladeshAffinity: 0,
      marketRealism: 0,
    },
    verifiedPositiveSignals: [],
    risksOrMissingInformation: [PHD_ZERO_SCORE_REASON],
    hardDisqualifier: true,
    hardDisqualifierReason: PHD_ZERO_SCORE_REASON,
    campaignMatches: [],
    recommendedAction: 'Do not include this profile in the active LinkedIn outreach queue.',
    bestOutreachAngle: '',
    qualificationQuestions: [],
    reasoningSummary: PHD_ZERO_SCORE_REASON,
  };
}
