// apps/crm/src/lib/ai-prompts.ts
// Shared prompt fragments and JSON-parsing helpers reused across ai-service.ts's
// agent prompts. Kept as one short, versioned guard string rather than each
// prompt writing its own paraphrase — cheaper in tokens than restating the
// same guardrail with different wording per agent, and removes the drift
// where some agents had a 15-line ethics section and others had none.

/** Bump this when the wording of any shared prompt fragment below changes. */
export const PROMPT_PACK_VERSION = '2026-07-29.1';

/**
 * One-line anti-hallucination guard for every agent that reads CRM records
 * and produces free text or structured output from them. Domain-specific
 * agents (lead-scorer, profile-normalizer, the CEO reporting system
 * instruction) keep their own longer, rubric-specific guidance in addition
 * to this — this is the floor, not a replacement for agent-specific rules.
 */
export const SUPPLIED_DATA_ONLY_GUARD =
  'Use only the information supplied below. Do not invent, infer, or assume ' +
  'facts, dates, employers, credentials, or personal traits that are not ' +
  'explicitly present. If something is missing, say so instead of guessing.';

/** Shorter variant for prompts that are already tight on token budget (e.g. a
 * single-line drafting instruction) — same meaning, fewer words. */
export const SUPPLIED_DATA_ONLY_GUARD_SHORT =
  'Use only the supplied facts below — do not invent details.';

/**
 * Extracts a JSON payload from an AI text response, tolerating a ```json
 * fenced block or a bare JSON body. Shared by extractStructured() and the
 * PDF/image lead-extraction paths, which previously duplicated this same
 * regex-and-parse logic in two places.
 */
export function parseJsonFromAiText<T>(text: string): T | null {
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    const clean = jsonMatch ? jsonMatch[1]!.trim() : text.trim();
    return JSON.parse(clean) as T;
  } catch {
    return null;
  }
}

export type LeadIntakeDocumentKind = 'candidate' | 'client' | 'job_rfp' | 'other';

/** The one-line framing sentence for the lead-intake agent, shared between
 * the plain-text and image/PDF extraction call sites so it can't drift. */
export function leadIntakeDocumentFraming(suggestedType: string): string {
  switch (suggestedType) {
    case 'candidate':
      return 'This is a resume/CV.';
    case 'client':
      return 'This is a client/vendor document or company profile.';
    case 'job_rfp':
      return 'This is a job posting or RFP document.';
    default:
      return 'This is a business document.';
  }
}

/**
 * The extracted-lead JSON schema + field rules, shared verbatim between the
 * plain-text and image/PDF lead-intake prompts (previously two independent
 * copies of the same block that could silently drift out of sync).
 */
export const LEAD_INTAKE_JSON_SCHEMA_BLOCK = `{
  "leadType": "candidate | client | vendor | job_rfp | other",
  "firstName": "",
  "lastName": "",
  "fullName": "",
  "email": "",
  "phone": "",
  "linkedinUrl": "",
  "companyName": "",
  "title": "",
  "location": "",
  "website": "",
  "source": "pdf_upload",
  "status": "new",
  "tags": [],
  "notes": "",
  "summary": "",
  "confidence": 0.0,
  "missingFields": []
}

Use empty strings for missing fields. Use 0 for confidence if nothing useful was found. confidence should be 0.0-1.0 based on how much information was successfully extracted. missingFields should list which fields were empty or uncertain. ${SUPPLIED_DATA_ONLY_GUARD_SHORT}

Return ONLY the JSON object above — no markdown fences, no explanation.`;
