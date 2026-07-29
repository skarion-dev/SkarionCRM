export interface LeadAutomationCandidate {
  source: string;
  status: string;
}

/**
 * Automatic AI generation is intentionally narrow: it runs only once a
 * brand-new LinkedIn lead has been created. Other sources retain the manual
 * generate action without incurring AI usage during creation.
 */
export function shouldAutoGenerateLinkedinConnectionNote(lead: LeadAutomationCandidate): boolean {
  return lead.source === 'linkedin' && lead.status === 'new';
}
