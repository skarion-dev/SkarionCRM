export interface LeadAutomationCandidate {
  source: string;
  status: string;
  journeyStage?: string | null;
  tags?: unknown;
}

/**
 * Automatic AI generation is intentionally narrow: it runs only once a
 * brand-new LinkedIn lead has been created. Other sources retain the manual
 * generate action without incurring AI usage during creation.
 */
export function shouldAutoGenerateLinkedinConnectionNote(lead: LeadAutomationCandidate): boolean {
  const isHolding =
    lead.journeyStage === 'future' ||
    lead.journeyStage === 'foreign_national' ||
    lead.journeyStage === 'stem' ||
    (Array.isArray(lead.tags) &&
      lead.tags.some(
        (tag) =>
          typeof tag === 'string' &&
          ['future', 'foreign national', 'stem'].includes(tag.trim().toLowerCase())
      ));
  return lead.source === 'linkedin' && lead.status === 'new' && !isHolding;
}
