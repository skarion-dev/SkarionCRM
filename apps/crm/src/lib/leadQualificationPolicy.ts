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
  'PhD profile — automatically disqualified by prospecting policy. Score forced to 0; no AI tokens used.';

export const URL_ONLY_PROVISIONAL_SCORE = 50;
export const URL_ONLY_PROVISIONAL_REASON =
  'Provisional URL-only score — no profile details were supplied. Capture the LinkedIn profile before outreach so the Lead Scoring Agent can replace this neutral score with an evidence-based assessment.';

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

export function urlOnlyProvisionalAssessment(): LeadQualificationAssessment {
  return {
    overallScore: URL_ONLY_PROVISIONAL_SCORE,
    rawScore: 0,
    classification: 'NURTURE',
    confidenceLevel: 'low',
    profileEvidenceQuality: 'insufficient',
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
    risksOrMissingInformation: [
      'Only a LinkedIn profile URL and URL-derived display name are available.',
      'Career stage, pathway fit, job-search need, location, and education are unknown.',
    ],
    hardDisqualifier: false,
    hardDisqualifierReason: null,
    campaignMatches: [],
    recommendedAction: 'Open and capture the LinkedIn profile, then review the automatic rescore.',
    bestOutreachAngle: '',
    qualificationQuestions: [],
    reasoningSummary: URL_ONLY_PROVISIONAL_REASON,
  };
}
