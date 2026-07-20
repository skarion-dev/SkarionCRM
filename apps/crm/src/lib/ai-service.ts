// apps/crm/src/lib/ai-service.ts
// Shared AI service layer for CRM. Wraps Google Gemini API calls with
// permission-aware context building, error handling, and fallback messages.
// Used by: chat endpoint, PDF lead extraction, outreach drafting, embeddings.

interface Env {
  AI_PROVIDER?: string;
  GOOGLE_API_KEY?: string;
  GOOGLE_MODEL?: string;
  GOOGLE_FALLBACK_MODEL?: string;
  GOOGLE_CHAT_MODEL?: string; // legacy alias
  GOOGLE_EMBEDDING_MODEL?: string;
}

import { and, eq } from 'drizzle-orm';

export const DEFAULT_CHAT_MODEL = 'gemini-1.5-flash';
export const DEFAULT_FALLBACK_MODEL = 'gemini-1.5-pro';
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-004';
export const AI_NOT_CONFIGURED_MSG = 'AI assistant is not configured. Add GOOGLE_API_KEY to enable AI features.';

// ── Embeddings ────────────────────────────────────────────────────────────

export async function getEmbedding(text: string, env: Env): Promise<number[] | null> {
  if (!env.GOOGLE_API_KEY) return null;
  const model = env.GOOGLE_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text }] },
      }),
    });
    if (!res.ok) { console.error('Google embedding error:', await res.text()); return null; }
    const data = (await res.json()) as { embedding?: { values?: number[] } };
    return data.embedding?.values ?? null;
  } catch (err) {
    console.error('Embedding fetch failed:', err);
    return null;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── Auto-embedding (RAG pipeline) ───────────────────────────────────────────

/** Upsert an embedding for a CRM entity. Deletes any old embedding first. */
export async function autoEmbed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  resourceType: string,
  resourceId: string,
  content: string,
  ownerId: string,
  env: Env,
): Promise<void> {
  if (!env.GOOGLE_API_KEY) return;
  const embedding = await getEmbedding(content, env);
  if (!embedding) return;
  await db.delete(schema.embeddings)
    .where(and(eq(schema.embeddings.resourceType, resourceType), eq(schema.embeddings.resourceId, resourceId)));
  await db.insert(schema.embeddings).values({
    resourceType,
    resourceId,
    content,
    embedding,
    ownerId,
    updatedAt: new Date(),
  });
}

// ── Chat / Completion ─────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export async function chatCompletion(
  messages: ChatMessage[],
  env: Env,
  opts?: { temperature?: number; systemInstruction?: string; model?: string }
): Promise<string | null> {
  if (!env.GOOGLE_API_KEY) return null;
  const preferredModel = opts?.model || env.GOOGLE_MODEL || env.GOOGLE_CHAT_MODEL || DEFAULT_CHAT_MODEL;
  const fallbackModel = env.GOOGLE_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;

  const contents = messages.map((m) => ({
    role: m.role === 'model' ? 'model' : 'user',
    parts: [{ text: m.text }],
  }));
  if (opts?.systemInstruction) {
    contents.unshift({
      role: 'user',
      parts: [{ text: 'System instruction: ' + opts.systemInstruction + '\n\n(End of system instruction.)' }],
    });
  }

  async function tryModel(model: string): Promise<string | null> {
    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + env.GOOGLE_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: opts?.temperature ?? 0.3 },
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error('Google chat error (' + model + '):', errText);
        return null;
      }
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    } catch (err) {
      console.error('Chat completion failed (' + model + '):', err);
      return null;
    }
  }

  const result = await tryModel(preferredModel);
  if (result) return result;
  console.log('[AI] Preferred model ' + preferredModel + ' failed, trying fallback ' + fallbackModel + '...');
  return tryModel(fallbackModel);
}

export async function chatCompletionSingle(prompt: string, env: Env, opts?: { temperature?: number; systemInstruction?: string }): Promise<string | null> {
  return chatCompletion([{ role: 'user', text: prompt }], env, opts);
}

// ── Structured extraction (JSON mode) ────────────────────────────────────

export async function extractStructured<T>(
  prompt: string,
  env: Env,
  opts?: { temperature?: number; systemInstruction?: string }
): Promise<T | null> {
  const text = await chatCompletionSingle(prompt, env, { ...opts, temperature: opts?.temperature ?? 0.1 });
  if (!text) return null;
  try {
    // Extract JSON from markdown code fences if present
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    const clean = jsonMatch ? jsonMatch[1]!.trim() : text.trim();
    return JSON.parse(clean) as T;
  } catch {
    console.error('Failed to parse JSON from AI response:', text);
    return null;
  }
}

// ── Outreach drafting ───────────────────────────────────────────────────────

export interface OutreachDraftRequest {
  leadType: string;
  leadSource: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  title: string | null;
  notes: string | null;
  pdfSummary: string | null;
  tone: 'short' | 'professional' | 'warm' | 'sales' | 'candidate';
  channel: 'email' | 'linkedin' | 'sms';
}

export async function draftOutreach(request: OutreachDraftRequest, env: Env): Promise<string | null> {
  if (!env.GOOGLE_API_KEY) return null;

  const toneMap: Record<string, string> = {
    short: 'Short and direct, get to the point in 2-3 sentences',
    professional: 'Professional and courteous business tone',
    warm: 'Warm, community-focused, friendly and approachable',
    sales: 'Sales-focused, value-driven, compelling CTA',
    candidate: 'Candidate-friendly, encouraging, supportive',
  };

  const channelMap: Record<string, string> = {
    email: 'a professional email with subject line suggestion',
    linkedin: 'a LinkedIn direct message, concise and personal',
    sms: 'a short SMS/WhatsApp style message, under 160 characters if possible',
  };

  const positioning: Record<string, string> = {
    candidate: 'Skarion helps with job search, training, placement, resume/interview prep, and applications.',
    client: 'Skarion Engineering provides telecom, GIS, OSP, fiber, CAD support with a US-led offshore team and fast turnaround.',
    vendor: 'Skarion Engineering partners with subcontractors for telecom, GIS, fiber, OSP, CAD projects with fast turnaround.',
    job_rfp: 'Skarion Engineering is ready to bid on or support this opportunity.',
    other: 'Skarion Engineering can provide engineering and technical support.',
  };

  const position = positioning[request.leadType] || positioning.other;
  const tone = toneMap[request.tone] || toneMap.professional;
  const channel = channelMap[request.channel] || channelMap.email;

  const prompt = `Draft ${channel} to ${request.firstName} ${request.lastName}.

Lead type: ${request.leadType}
Lead source: ${request.leadSource}
${request.companyName ? `Company: ${request.companyName}` : ''}
${request.title ? `Title: ${request.title}` : ''}
${request.notes ? `Notes: ${request.notes}` : ''}
${request.pdfSummary ? `PDF summary: ${request.pdfSummary}` : ''}

Tone: ${tone}

Skarion positioning: ${position}

Do not include any markdown formatting. Output plain text only. Include a clear call to action.`;

  return chatCompletionSingle(prompt, env, { temperature: 0.4 });
}

// ── PDF lead extraction ────────────────────────────────────────────────────

export interface ExtractedLeadDraft {
  leadType: 'candidate' | 'client' | 'vendor' | 'job_rfp' | 'other';
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  companyName: string;
  title: string;
  location: string;
  website: string;
  source: string;
  status: 'new';
  tags: string[];
  notes: string;
  summary: string;
  confidence: number;
  missingFields: string[];
}

export async function extractLeadFromPdfText(rawText: string, suggestedType: string, env: Env): Promise<ExtractedLeadDraft | null> {
  if (!env.GOOGLE_API_KEY) return null;

  const typePrompt = suggestedType === 'candidate' ? 'This is a resume/CV.' :
    suggestedType === 'client' ? 'This is a client/vendor document or company profile.' :
    suggestedType === 'job_rfp' ? 'This is a job posting or RFP document.' :
    'This is a business document.';

  const prompt = `${typePrompt}

Extract the following information from the text below and return ONLY valid JSON matching this schema:

{
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

Use empty strings for missing fields. Use 0 for confidence if nothing useful was found. confidence should be 0.0-1.0 based on how much information was successfully extracted. missingFields should list which fields were empty or uncertain.

Text to extract from:
---
${rawText.substring(0, 12000)}
---

Return ONLY the JSON object, no markdown, no explanation.`;

  return extractStructured<ExtractedLeadDraft>(prompt, env);
}

function uint8ArrayToBase64(arr: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 8192;
  for (let i = 0; i < arr.length; i += chunkSize) {
    const chunk = arr.slice(i, i + chunkSize);
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(''));
}

export async function extractLeadFromPdfFile(
  fileBytes: Uint8Array,
  mimeType: string,
  suggestedType: string,
  env: Env
): Promise<ExtractedLeadDraft | null> {
  if (!env.GOOGLE_API_KEY) return null;

  const base64Data = uint8ArrayToBase64(fileBytes);

  const typePrompt = suggestedType === 'candidate' ? 'This is a resume/CV.' :
    suggestedType === 'client' ? 'This is a client/vendor document or company profile.' :
    suggestedType === 'job_rfp' ? 'This is a job posting or RFP document.' :
    'This is a business document.';

  const prompt = `${typePrompt}

Extract the following information from this document and return ONLY valid JSON matching this schema:

{
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

Use empty strings for missing fields. Use 0 for confidence if nothing useful was found. confidence should be 0.0-1.0 based on how much information was successfully extracted. missingFields should list which fields were empty or uncertain.

Return ONLY the JSON object, no markdown, no explanation.`;

  const preferredModel = env.GOOGLE_MODEL || DEFAULT_CHAT_MODEL;
  const fallbackModel = env.GOOGLE_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;

  async function tryModel(model: string): Promise<string | null> {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: { temperature: 0.1 },
        }),
      });
      if (!res.ok) {
        console.error(`Google extract error (${model}):`, await res.text());
        return null;
      }
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    } catch (err) {
      console.error(`File extraction failed (${model}):`, err);
      return null;
    }
  }

  const text = await tryModel(preferredModel) || await tryModel(fallbackModel);
  if (!text) return null;

  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    const clean = jsonMatch ? jsonMatch[1]!.trim() : text.trim();
    return JSON.parse(clean) as ExtractedLeadDraft;
  } catch {
    console.error('Failed to parse JSON from file extraction:', text);
    return null;
  }
}

// ── Lead summary ────────────────────────────────────────────────────────────

export async function summarizeLead(
  lead: { firstName: string; lastName: string; email: string; companyName: string | null; title?: string | null; status: string; source: string; notes: string | null },
  env: Env
): Promise<string | null> {
  if (!env.GOOGLE_API_KEY) return null;

  const prompt = `Summarize this lead in 2-3 bullet points for a CRM user:

Name: ${lead.firstName} ${lead.lastName}
Email: ${lead.email}
${lead.companyName ? `Company: ${lead.companyName}` : ''}
${lead.title ? `Title: ${lead.title}` : ''}
Status: ${lead.status}
Source: ${lead.source}
${lead.notes ? `Notes: ${lead.notes}` : ''}

Focus on: what they likely want, how strong the lead is, and what next action to take.`;

  return chatCompletionSingle(prompt, env, { temperature: 0.3 });
}

// ── Company summary ─────────────────────────────────────────────────────────

export async function summarizeCompany(
  company: { name: string; domain: string | null; industry: string | null; size: string | null },
  env: Env
): Promise<string | null> {
  if (!env.GOOGLE_API_KEY) return null;

  const prompt = `Summarize this company in 2-3 sentences for a CRM user:

Name: ${company.name}
${company.domain ? `Domain: ${company.domain}` : ''}
${company.industry ? `Industry: ${company.industry}` : ''}
${company.size ? `Size: ${company.size}` : ''}

Focus on: what they do, how they might fit Skarion's services (telecom, GIS, fiber, OSP, CAD, engineering), and any outreach suggestions.`;

  return chatCompletionSingle(prompt, env, { temperature: 0.3 });
}

// ── Contact summary ─────────────────────────────────────────────────────────

export async function summarizeContact(
  contact: { firstName: string; lastName: string; email: string; title: string | null; companyName: string | null },
  env: Env
): Promise<string | null> {
  if (!env.GOOGLE_API_KEY) return null;

  const prompt = `Summarize this contact in 2-3 sentences for a CRM user:

Name: ${contact.firstName} ${contact.lastName}
Email: ${contact.email}
${contact.title ? `Title: ${contact.title}` : ''}
${contact.companyName ? `Company: ${contact.companyName}` : ''}

Focus on: their role, how to approach them, and what Skarion services might be relevant.`;

  return chatCompletionSingle(prompt, env, { temperature: 0.3 });
}

// ── Suggest next action ─────────────────────────────────────────────────────

export async function suggestNextAction(
  lead: { firstName: string; lastName: string; status: string; notes: string | null },
  env: Env
): Promise<string | null> {
  if (!env.GOOGLE_API_KEY) return null;

  const prompt = `Based on this lead, suggest the single best next action:

Name: ${lead.firstName} ${lead.lastName}
Status: ${lead.status}
${lead.notes ? `Notes: ${lead.notes}` : ''}

Return ONE clear, actionable next step (e.g., "Send a follow-up email about X", "Schedule a call to discuss Y", "Connect on LinkedIn with Z message"). Keep it to 1-2 sentences.`;

  return chatCompletionSingle(prompt, env, { temperature: 0.3 });
}

// ── Score lead ──────────────────────────────────────────────────────────────

export async function scoreLead(
  lead: { firstName: string; lastName: string; email: string; companyName: string | null; title?: string | null; status: string; source: string; notes: string | null },
  env: Env
): Promise<{ score: number; reasoning: string } | null> {
  if (!env.GOOGLE_API_KEY) return null;

  const prompt = `Score this lead from 0-100 for a CRM user and explain why:

Name: ${lead.firstName} ${lead.lastName}
Email: ${lead.email}
${lead.companyName ? `Company: ${lead.companyName}` : ''}
${lead.title ? `Title: ${lead.title}` : ''}
Status: ${lead.status}
Source: ${lead.source}
${lead.notes ? `Notes: ${lead.notes}` : ''}

Return ONLY JSON: {"score": 75, "reasoning": "brief explanation"}`;

  return extractStructured<{ score: number; reasoning: string }>(prompt, env);
}
