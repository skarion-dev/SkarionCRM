// apps/crm/src/lib/ai-service.ts
// Shared AI service layer for CRM. Wraps Google Gemini API calls with
// permission-aware context building, error handling, and fallback messages.
// Used by: chat endpoint, PDF lead extraction, outreach drafting, embeddings.

import {
  gatewayChatCompletion,
  gatewayChatCompletionStream,
  gatewayEmbedding,
  getAiBackingModel,
  hasAiGateway,
  estimateAiCostUsd,
  selectAiAgentModel,
  selectAiModel,
  type AiAgentId,
  type AiGatewayEnv,
  type AiGatewayMessage,
  type AiModelTier,
  type AiTokenUsage,
} from '@skarion/ai-toolkit';
import { and, eq } from 'drizzle-orm';

interface Env extends AiGatewayEnv {
  AI_PROVIDER?: string;
  GOOGLE_API_KEY?: string;
  GOOGLE_MODEL?: string;
  GOOGLE_FALLBACK_MODEL?: string;
  GOOGLE_CHAT_MODEL?: string; // legacy alias
  GOOGLE_EMBEDDING_MODEL?: string;
}

export const DEFAULT_CHAT_MODEL = 'gemini-1.5-flash';
export const DEFAULT_FALLBACK_MODEL = 'gemini-1.5-pro';
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-004';
export const AI_NOT_CONFIGURED_MSG =
  'AI assistant is not configured. Add AI gateway credentials or GOOGLE_API_KEY to enable AI features.';

function canUseDirectGoogleAi(env: Env): env is Env & { GOOGLE_API_KEY: string } {
  if (!env.GOOGLE_API_KEY) return false;
  // An explicitly selected Vertex proxy must remain inside its own project.
  // Direct Google AI is retained for the explicit google_ai provider and
  // legacy environments that do not have a gateway configured.
  return env.AI_PROVIDER === 'google_ai' || (!env.AI_PROVIDER && !hasAiGateway(env));
}

export function isAiConfigured(env: Env): boolean {
  return hasAiGateway(env) || canUseDirectGoogleAi(env);
}

function estimatedTokenUsage(input: string, output = ''): AiTokenUsage {
  const inputTokens = Math.ceil(input.length / 4);
  const outputTokens = Math.ceil(output.length / 4);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function googleUsageMetadata(value: unknown): AiTokenUsage | null {
  if (!value || typeof value !== 'object') return null;
  const usage = value as Record<string, unknown>;
  const inputTokens = Number(usage.promptTokenCount ?? 0);
  const outputTokens = Number(usage.candidatesTokenCount ?? 0);
  const reasoningTokens = Number(usage.thoughtsTokenCount ?? 0);
  const totalTokens = Number(usage.totalTokenCount ?? inputTokens + outputTokens + reasoningTokens);
  if (![inputTokens, outputTokens, reasoningTokens, totalTokens].some((count) => count > 0))
    return null;
  return {
    inputTokens: Math.max(0, Math.round(inputTokens)),
    outputTokens: Math.max(0, Math.round(outputTokens)),
    reasoningTokens: Math.max(0, Math.round(reasoningTokens)),
    totalTokens: Math.max(0, Math.round(totalTokens)),
    cachedInputTokens: Math.max(0, Math.round(Number(usage.cachedContentTokenCount ?? 0))),
  };
}

async function recordGoogleUsage(
  env: Env,
  input: {
    model: string;
    agentId?: AiAgentId;
    requestType: 'chat' | 'embedding' | 'ocr';
    status: 'success' | 'error';
    usage: AiTokenUsage;
    usageSource: 'provider' | 'estimated' | 'unavailable';
    startedAt: number;
  }
): Promise<void> {
  if (!env.AI_USAGE_RECORDER) return;
  try {
    await env.AI_USAGE_RECORDER({
      provider: 'google_ai',
      model: input.model,
      backingModel: getAiBackingModel(input.model),
      agentId: input.agentId,
      requestType: input.requestType,
      status: input.status,
      usage: input.usage,
      usageSource: input.usageSource,
      estimatedCostUsd: estimateAiCostUsd(input.model, input.usage),
      latencyMs: Date.now() - input.startedAt,
    });
  } catch (error) {
    console.error('Google AI usage recorder failed:', error);
  }
}

// ── Embeddings ────────────────────────────────────────────────────────────

export async function getEmbedding(
  text: string,
  env: Env,
  agent: AiAgentId = 'rag-search'
): Promise<number[] | null> {
  if (hasAiGateway(env)) {
    const embedding = await gatewayEmbedding(text, env, { agent });
    if (embedding) return embedding;
  }
  if (!canUseDirectGoogleAi(env)) return null;
  const model = env.GOOGLE_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  const startedAt = Date.now();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${env.GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text }] },
        }),
      }
    );
    if (!res.ok) {
      console.error('Google embedding error:', await res.text());
      await recordGoogleUsage(env, {
        model,
        agentId: agent,
        requestType: 'embedding',
        status: 'error',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        usageSource: 'unavailable',
        startedAt,
      });
      return null;
    }
    const data = (await res.json()) as {
      embedding?: { values?: number[] };
      usageMetadata?: unknown;
    };
    const providerUsage = googleUsageMetadata(data.usageMetadata);
    await recordGoogleUsage(env, {
      model,
      agentId: agent,
      requestType: 'embedding',
      status: 'success',
      usage: providerUsage ?? estimatedTokenUsage(text),
      usageSource: providerUsage ? 'provider' : 'estimated',
      startedAt,
    });
    return data.embedding?.values ?? null;
  } catch (err) {
    console.error('Embedding fetch failed:', err);
    await recordGoogleUsage(env, {
      model,
      agentId: agent,
      requestType: 'embedding',
      status: 'error',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      usageSource: 'unavailable',
      startedAt,
    });
    return null;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    if (!Number.isFinite(ai) || !Number.isFinite(bi)) return 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denominator = Math.sqrt(na) * Math.sqrt(nb);
  return denominator > 0 ? dot / denominator : 0;
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
  env: Env
): Promise<void> {
  if (!isAiConfigured(env)) return;
  const embedding = await getEmbedding(content, env, 'rag-indexer');
  if (!embedding) return;
  await db
    .delete(schema.embeddings)
    .where(
      and(
        eq(schema.embeddings.resourceType, resourceType),
        eq(schema.embeddings.resourceId, resourceId)
      )
    );
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
  opts?: {
    temperature?: number;
    systemInstruction?: string;
    model?: string;
    tier?: AiModelTier;
    agent?: AiAgentId;
  }
): Promise<string | null> {
  if (!isAiConfigured(env)) return null;

  if (hasAiGateway(env)) {
    const gatewayMessages: AiGatewayMessage[] = messages.map((message) => ({
      role: message.role === 'model' ? 'assistant' : 'user',
      content: message.text,
    }));
    if (opts?.systemInstruction) {
      gatewayMessages.unshift({ role: 'system', content: opts.systemInstruction });
    }

    const preferredModel =
      opts?.model ||
      (opts?.agent
        ? selectAiAgentModel(env, opts.agent, opts?.tier || 'fast')
        : selectAiModel(env, opts?.tier || 'fast'));
    const fallbackModel = env.AI_MODEL_FALLBACK || selectAiModel(env, 'cheap');
    const result = await gatewayChatCompletion(gatewayMessages, env, {
      model: preferredModel,
      agent: opts?.agent,
      temperature: opts?.temperature,
    });
    if (result) return result;

    if (fallbackModel !== preferredModel) {
      console.log(
        `[AI] Gateway model ${preferredModel} failed, trying fallback ${fallbackModel}...`
      );
      const fallback = await gatewayChatCompletion(gatewayMessages, env, {
        model: fallbackModel,
        agent: opts?.agent,
        temperature: opts?.temperature,
      });
      if (fallback) return fallback;
    }
  }

  if (!canUseDirectGoogleAi(env)) return null;
  const preferredModel = env.GOOGLE_MODEL || env.GOOGLE_CHAT_MODEL || DEFAULT_CHAT_MODEL;
  const fallbackModel = env.GOOGLE_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;

  const contents = messages.map((m) => ({
    role: m.role === 'model' ? 'model' : 'user',
    parts: [{ text: m.text }],
  }));
  if (opts?.systemInstruction) {
    contents.unshift({
      role: 'user',
      parts: [
        {
          text:
            'System instruction: ' + opts.systemInstruction + '\n\n(End of system instruction.)',
        },
      ],
    });
  }

  async function tryModel(model: string): Promise<string | null> {
    const startedAt = Date.now();
    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' +
          model +
          ':generateContent?key=' +
          env.GOOGLE_API_KEY,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            generationConfig: { temperature: opts?.temperature ?? 0.3 },
          }),
        }
      );
      if (!res.ok) {
        const errText = await res.text();
        console.error('Google chat error (' + model + '):', errText);
        await recordGoogleUsage(env, {
          model,
          agentId: opts?.agent,
          requestType: 'chat',
          status: 'error',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          usageSource: 'unavailable',
          startedAt,
        });
        return null;
      }
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: unknown;
      };
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
      const providerUsage = googleUsageMetadata(data.usageMetadata);
      await recordGoogleUsage(env, {
        model,
        agentId: opts?.agent,
        requestType: 'chat',
        status: 'success',
        usage:
          providerUsage ??
          estimatedTokenUsage(
            contents
              .flatMap((entry) => entry.parts)
              .map((part) => part.text)
              .join('\n'),
            content ?? ''
          ),
        usageSource: providerUsage ? 'provider' : 'estimated',
        startedAt,
      });
      return content;
    } catch (err) {
      console.error('Chat completion failed (' + model + '):', err);
      await recordGoogleUsage(env, {
        model,
        agentId: opts?.agent,
        requestType: 'chat',
        status: 'error',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        usageSource: 'unavailable',
        startedAt,
      });
      return null;
    }
  }

  const result = await tryModel(preferredModel);
  if (result) return result;
  console.log(
    '[AI] Preferred model ' + preferredModel + ' failed, trying fallback ' + fallbackModel + '...'
  );
  return tryModel(fallbackModel);
}

export async function* chatCompletionStream(
  messages: ChatMessage[],
  env: Env,
  opts?: {
    temperature?: number;
    systemInstruction?: string;
    model?: string;
    tier?: AiModelTier;
    agent?: AiAgentId;
    maxTokens?: number;
  }
): AsyncGenerator<string> {
  if (!isAiConfigured(env)) return;

  if (hasAiGateway(env)) {
    const gatewayMessages: AiGatewayMessage[] = messages.map((message) => ({
      role: message.role === 'model' ? 'assistant' : 'user',
      content: message.text,
    }));
    if (opts?.systemInstruction) {
      gatewayMessages.unshift({ role: 'system', content: opts.systemInstruction });
    }

    const preferredModel =
      opts?.model ||
      (opts?.agent
        ? selectAiAgentModel(env, opts.agent, opts?.tier || 'fast')
        : selectAiModel(env, opts?.tier || 'fast'));
    const fallbackModel = env.AI_MODEL_FALLBACK || selectAiModel(env, 'cheap');
    let producedOutput = false;

    try {
      for await (const delta of gatewayChatCompletionStream(gatewayMessages, env, {
        model: preferredModel,
        agent: opts?.agent,
        temperature: opts?.temperature,
        maxTokens: opts?.maxTokens,
      })) {
        producedOutput = true;
        yield delta;
      }
    } catch (error) {
      console.error(`AI streaming failed after starting model ${preferredModel}:`, error);
    }
    if (producedOutput) return;

    if (fallbackModel !== preferredModel) {
      try {
        for await (const delta of gatewayChatCompletionStream(gatewayMessages, env, {
          model: fallbackModel,
          agent: opts?.agent,
          temperature: opts?.temperature,
          maxTokens: opts?.maxTokens,
        })) {
          producedOutput = true;
          yield delta;
        }
      } catch (error) {
        console.error(`AI streaming fallback failed (${fallbackModel}):`, error);
      }
    }
    if (producedOutput) return;
  }

  // Google fallback and gateways without streaming support still produce a
  // valid response. The API sends it as one final delta so the client protocol
  // remains identical.
  const result = await chatCompletion(messages, env, opts);
  if (result) yield result;
}

export async function chatCompletionSingle(
  prompt: string,
  env: Env,
  opts?: {
    temperature?: number;
    systemInstruction?: string;
    model?: string;
    tier?: AiModelTier;
    agent?: AiAgentId;
  }
): Promise<string | null> {
  return chatCompletion([{ role: 'user', text: prompt }], env, opts);
}

// ── Structured extraction (JSON mode) ────────────────────────────────────

export async function extractStructured<T>(
  prompt: string,
  env: Env,
  opts?: {
    temperature?: number;
    systemInstruction?: string;
    agent?: AiAgentId;
    tier?: AiModelTier;
  }
): Promise<T | null> {
  const text = await chatCompletionSingle(prompt, env, {
    ...opts,
    temperature: opts?.temperature ?? 0.1,
    tier: opts?.tier ?? 'fast',
    agent: opts?.agent,
  });
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

export async function draftOutreach(
  request: OutreachDraftRequest,
  env: Env
): Promise<string | null> {
  if (!isAiConfigured(env)) return null;

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
    candidate:
      'Skarion helps with job search, training, placement, resume/interview prep, and applications.',
    client:
      'Skarion Engineering provides telecom, GIS, OSP, fiber, CAD support with a US-led offshore team and fast turnaround.',
    vendor:
      'Skarion Engineering partners with subcontractors for telecom, GIS, fiber, OSP, CAD projects with fast turnaround.',
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

  return chatCompletionSingle(prompt, env, {
    temperature: 0.4,
    tier: 'cheap',
    agent: 'outreach-writer',
  });
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

export async function extractLeadFromPdfText(
  rawText: string,
  suggestedType: string,
  env: Env
): Promise<ExtractedLeadDraft | null> {
  if (!isAiConfigured(env)) return null;

  const typePrompt =
    suggestedType === 'candidate'
      ? 'This is a resume/CV.'
      : suggestedType === 'client'
        ? 'This is a client/vendor document or company profile.'
        : suggestedType === 'job_rfp'
          ? 'This is a job posting or RFP document.'
          : 'This is a business document.';

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

  return extractStructured<ExtractedLeadDraft>(prompt, env, {
    agent: 'lead-intake',
    tier: 'fast',
  });
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
  if (!isAiConfigured(env)) return null;

  const base64Data = uint8ArrayToBase64(fileBytes);

  const typePrompt =
    suggestedType === 'candidate'
      ? 'This is a resume/CV.'
      : suggestedType === 'client'
        ? 'This is a client/vendor document or company profile.'
        : suggestedType === 'job_rfp'
          ? 'This is a job posting or RFP document.'
          : 'This is a business document.';

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

  let text: string | null = null;
  if (hasAiGateway(env)) {
    const messages: AiGatewayMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Data}` },
          },
        ],
      },
    ];
    const preferredModel = selectAiAgentModel(env, 'lead-intake', 'fast');
    text = await gatewayChatCompletion(messages, env, {
      model: preferredModel,
      agent: 'lead-intake',
      temperature: 0.1,
    });
    if (!text) {
      text = await gatewayChatCompletion(messages, env, {
        model: env.AI_MODEL_FALLBACK || selectAiModel(env, 'cheap'),
        agent: 'lead-intake',
        temperature: 0.1,
      });
    }
  }

  if (text) return parseExtractedLead(text);
  if (!canUseDirectGoogleAi(env)) return null;

  const preferredModel = env.GOOGLE_MODEL || DEFAULT_CHAT_MODEL;
  const fallbackModel = env.GOOGLE_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;

  async function tryModel(model: string): Promise<string | null> {
    const startedAt = Date.now();
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GOOGLE_API_KEY}`,
        {
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
        }
      );
      if (!res.ok) {
        console.error(`Google extract error (${model}):`, await res.text());
        await recordGoogleUsage(env, {
          model,
          agentId: 'lead-intake',
          requestType: 'ocr',
          status: 'error',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          usageSource: 'unavailable',
          startedAt,
        });
        return null;
      }
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: unknown;
      };
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
      const providerUsage = googleUsageMetadata(data.usageMetadata);
      await recordGoogleUsage(env, {
        model,
        agentId: 'lead-intake',
        requestType: 'ocr',
        status: 'success',
        usage: providerUsage ?? estimatedTokenUsage(prompt, content ?? ''),
        usageSource: providerUsage ? 'provider' : 'estimated',
        startedAt,
      });
      return content;
    } catch (err) {
      console.error(`File extraction failed (${model}):`, err);
      await recordGoogleUsage(env, {
        model,
        agentId: 'lead-intake',
        requestType: 'ocr',
        status: 'error',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        usageSource: 'unavailable',
        startedAt,
      });
      return null;
    }
  }

  text = (await tryModel(preferredModel)) || (await tryModel(fallbackModel));
  if (!text) return null;

  return parseExtractedLead(text);
}

function parseExtractedLead(text: string): ExtractedLeadDraft | null {
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    const clean = jsonMatch ? jsonMatch[1]!.trim() : text.trim();
    return JSON.parse(clean) as ExtractedLeadDraft;
  } catch {
    console.error('Failed to parse JSON from file extraction:', text);
    return null;
  }
}

export async function extractDocumentText(
  fileBytes: Uint8Array,
  mimeType: string,
  env: Env
): Promise<string | null> {
  if (!isAiConfigured(env)) return null;

  const prompt =
    'Extract all text from this image or PDF. Return only the raw text, no formatting or commentary.';
  const base64Data = uint8ArrayToBase64(fileBytes);

  if (hasAiGateway(env)) {
    const result = await gatewayChatCompletion(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Data}` },
            },
          ],
        },
      ],
      env,
      {
        model: selectAiAgentModel(env, 'document-ocr', 'cheap'),
        agent: 'document-ocr',
        temperature: 0.1,
      }
    );
    if (result) return result;
  }

  if (!canUseDirectGoogleAi(env)) return null;
  const model = env.GOOGLE_MODEL || DEFAULT_FALLBACK_MODEL;
  const startedAt = Date.now();
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Data } }],
            },
          ],
        }),
      }
    );
    if (!response.ok) {
      console.error(`Google OCR error (${model}, ${response.status}):`, await response.text());
      await recordGoogleUsage(env, {
        model,
        agentId: 'document-ocr',
        requestType: 'ocr',
        status: 'error',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        usageSource: 'unavailable',
        startedAt,
      });
      return null;
    }
    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: unknown;
    };
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    const providerUsage = googleUsageMetadata(data.usageMetadata);
    await recordGoogleUsage(env, {
      model,
      agentId: 'document-ocr',
      requestType: 'ocr',
      status: 'success',
      usage: providerUsage ?? estimatedTokenUsage(prompt, content ?? ''),
      usageSource: providerUsage ? 'provider' : 'estimated',
      startedAt,
    });
    return content;
  } catch (error) {
    console.error(`Google OCR request failed (${model}):`, error);
    await recordGoogleUsage(env, {
      model,
      agentId: 'document-ocr',
      requestType: 'ocr',
      status: 'error',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      usageSource: 'unavailable',
      startedAt,
    });
    return null;
  }
}

// ── Lead summary ────────────────────────────────────────────────────────────

export async function summarizeLead(
  lead: {
    firstName: string;
    lastName: string;
    email: string | null;
    companyName: string | null;
    title?: string | null;
    status: string;
    source: string;
    notes: string | null;
  },
  env: Env
): Promise<string | null> {
  if (!isAiConfigured(env)) return null;

  const prompt = `Summarize this lead in 2-3 bullet points for a CRM user:

Name: ${lead.firstName} ${lead.lastName}
${lead.email ? `Email: ${lead.email}` : ''}
${lead.companyName ? `Company: ${lead.companyName}` : ''}
${lead.title ? `Title: ${lead.title}` : ''}
Status: ${lead.status}
Source: ${lead.source}
${lead.notes ? `Notes: ${lead.notes}` : ''}

Focus on: what they likely want, how strong the lead is, and what next action to take.`;

  return chatCompletionSingle(prompt, env, {
    temperature: 0.3,
    tier: 'cheap',
    agent: 'lead-summarizer',
  });
}

// ── Company summary ─────────────────────────────────────────────────────────

export async function summarizeCompany(
  company: { name: string; domain: string | null; industry: string | null; size: string | null },
  env: Env
): Promise<string | null> {
  if (!isAiConfigured(env)) return null;

  const prompt = `Summarize this company in 2-3 sentences for a CRM user:

Name: ${company.name}
${company.domain ? `Domain: ${company.domain}` : ''}
${company.industry ? `Industry: ${company.industry}` : ''}
${company.size ? `Size: ${company.size}` : ''}

Focus on: what they do, how they might fit Skarion's services (telecom, GIS, fiber, OSP, CAD, engineering), and any outreach suggestions.`;

  return chatCompletionSingle(prompt, env, {
    temperature: 0.3,
    tier: 'cheap',
    agent: 'company-summarizer',
  });
}

// ── Contact summary ─────────────────────────────────────────────────────────

export async function summarizeContact(
  contact: {
    firstName: string;
    lastName: string;
    email: string;
    title: string | null;
    companyName: string | null;
  },
  env: Env
): Promise<string | null> {
  if (!isAiConfigured(env)) return null;

  const prompt = `Summarize this contact in 2-3 sentences for a CRM user:

Name: ${contact.firstName} ${contact.lastName}
Email: ${contact.email}
${contact.title ? `Title: ${contact.title}` : ''}
${contact.companyName ? `Company: ${contact.companyName}` : ''}

Focus on: their role, how to approach them, and what Skarion services might be relevant.`;

  return chatCompletionSingle(prompt, env, {
    temperature: 0.3,
    tier: 'cheap',
    agent: 'contact-summarizer',
  });
}

// ── Suggest next action ─────────────────────────────────────────────────────

export async function suggestNextAction(
  lead: { firstName: string; lastName: string; status: string; notes: string | null },
  env: Env
): Promise<string | null> {
  if (!isAiConfigured(env)) return null;

  const prompt = `Based on this lead, suggest the single best next action:

Name: ${lead.firstName} ${lead.lastName}
Status: ${lead.status}
${lead.notes ? `Notes: ${lead.notes}` : ''}

Return ONE clear, actionable next step (e.g., "Send a follow-up email about X", "Schedule a call to discuss Y", "Connect on LinkedIn with Z message"). Keep it to 1-2 sentences.`;

  return chatCompletionSingle(prompt, env, {
    temperature: 0.3,
    tier: 'cheap',
    agent: 'next-best-action',
  });
}

// ── LinkedIn profile cleanup ────────────────────────────────────────────────

export interface NormalizedEducationEntry {
  institution: string;
  degree: string | null;
  fieldOfStudy: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

export interface NormalizedExperienceEntry {
  title: string;
  organization: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  description: string | null;
}

export interface NormalizedLeadProfile {
  summary: string;
  education: NormalizedEducationEntry[];
  experience: NormalizedExperienceEntry[];
  skills: string[];
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

export interface LeadProfileNormalizationInput {
  name: string;
  headline: string | null;
  location: string | null;
  about: string | null;
  education: string | null;
  experience: string | null;
  skills: string | null;
  currentRole?: string | null;
  currentRoleDates?: string | null;
  openToWork?: boolean | null;
  yearsExperience?: string | null;
  legacyNotes?: string | null;
}

function cleanAiText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

export function sanitizeNormalizedLeadProfile(value: unknown): NormalizedLeadProfile | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const summary = cleanAiText(input.summary, 1600);
  if (!summary) return null;

  const education = (Array.isArray(input.education) ? input.education : [])
    .slice(0, 20)
    .map((entry) => {
      const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      const institution = cleanAiText(row.institution, 240);
      return institution
        ? {
            institution,
            degree: cleanAiText(row.degree, 240),
            fieldOfStudy: cleanAiText(row.fieldOfStudy, 240),
            startDate: cleanAiText(row.startDate, 80),
            endDate: cleanAiText(row.endDate, 80),
            description: cleanAiText(row.description, 1200),
          }
        : null;
    })
    .filter((entry): entry is NormalizedEducationEntry => Boolean(entry));

  const experience = (Array.isArray(input.experience) ? input.experience : [])
    .slice(0, 30)
    .map((entry) => {
      const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      const title = cleanAiText(row.title, 240);
      return title
        ? {
            title,
            organization: cleanAiText(row.organization, 240),
            location: cleanAiText(row.location, 240),
            startDate: cleanAiText(row.startDate, 80),
            endDate: cleanAiText(row.endDate, 80),
            isCurrent: row.isCurrent === true,
            description: cleanAiText(row.description, 1600),
          }
        : null;
    })
    .filter((entry): entry is NormalizedExperienceEntry => Boolean(entry));

  const cleanedSkills = (Array.isArray(input.skills) ? input.skills : [])
    .map((skill) => cleanAiText(skill, 120))
    .filter((skill): skill is string => Boolean(skill));
  const skills = cleanedSkills
    .filter(
      (skill, index) =>
        cleanedSkills.findIndex((candidate) => candidate.toLowerCase() === skill.toLowerCase()) ===
        index
    )
    .slice(0, 80);
  const warnings = (Array.isArray(input.warnings) ? input.warnings : [])
    .map((warning) => cleanAiText(warning, 300))
    .filter((warning): warning is string => Boolean(warning))
    .slice(0, 20);
  const confidence =
    input.confidence === 'high' || input.confidence === 'medium' ? input.confidence : 'low';

  return { summary, education, experience, skills, confidence, warnings };
}

export async function normalizeLeadProfile(
  profile: LeadProfileNormalizationInput,
  env: Env
): Promise<NormalizedLeadProfile | null> {
  if (!isAiConfigured(env)) return null;

  const prompt = `You are Skarion's Profile Cleanup Agent. Convert a noisy
LinkedIn capture into clean, factual CRM data.

RULES
- Use only the supplied text. Never infer or invent employers, schools,
  credentials, dates, locations, skills, graduation status, nationality, visa
  status, or job-search intent.
- Remove duplicated UI labels, follower/connection counts, navigation text,
  and repeated lines.
- The summary must be 2-4 concise sentences describing current focus, relevant
  background, and notable skills using neutral language.
- Preserve partial dates exactly when full dates are unavailable.
- Put each distinct school and role in its own record.
- Sort education records from most recent to oldest using the stated end date.
  An expected graduation date is an end date, not a completed credential.
- Skills must be specific, deduplicated names rather than sentences.
- Add a warning when text is ambiguous or a record cannot be separated
  confidently. Empty arrays are valid.

PROFILE
Name: ${profile.name}
${profile.headline ? `Headline: ${profile.headline.substring(0, 1000)}` : ''}
${profile.location ? `Location: ${profile.location.substring(0, 500)}` : ''}
${profile.about ? `About:\n${profile.about.substring(0, 6000)}` : ''}
${profile.experience ? `Experience:\n${profile.experience.substring(0, 12000)}` : ''}
${profile.education ? `Education:\n${profile.education.substring(0, 8000)}` : ''}
${profile.skills ? `Skills:\n${profile.skills.substring(0, 6000)}` : ''}
${profile.currentRole ? `Current role: ${profile.currentRole}` : ''}
${profile.currentRoleDates ? `Current role dates: ${profile.currentRoleDates}` : ''}
${profile.openToWork === true ? 'Candidate-level Open to Work signal: yes' : ''}
${profile.yearsExperience ? `Years of experience label: ${profile.yearsExperience}` : ''}
${profile.legacyNotes ? `Legacy captured notes:\n${profile.legacyNotes.substring(0, 6000)}` : ''}

Return ONLY valid JSON:
{
  "summary": "",
  "education": [
    {
      "institution": "",
      "degree": null,
      "fieldOfStudy": null,
      "startDate": null,
      "endDate": null,
      "description": null
    }
  ],
  "experience": [
    {
      "title": "",
      "organization": null,
      "location": null,
      "startDate": null,
      "endDate": null,
      "isCurrent": false,
      "description": null
    }
  ],
  "skills": [],
  "confidence": "high | medium | low",
  "warnings": []
}`;

  const result = await extractStructured<unknown>(prompt, env, {
    agent: 'profile-normalizer',
    tier: 'fast',
  });
  return sanitizeNormalizedLeadProfile(result);
}

// ── Lead qualification and LinkedIn connection notes ───────────────────────

export interface LeadQualificationInput {
  firstName: string;
  lastName: string;
  email: string | null;
  companyName: string | null;
  title?: string | null;
  status: string;
  source: string;
  notes: string | null;
  profileSummary?: string | null;
  education?: NormalizedEducationEntry[] | null;
  experience?: NormalizedExperienceEntry[] | null;
  skills?: string[] | null;
  currentRole?: string | null;
  currentRoleDates?: string | null;
  openToWork?: boolean | null;
  yearsExperience?: string | null;
  connectionDegree?: string | null;
  sourceContext?: Record<string, unknown> | null;
}

export interface LeadQualificationAssessment {
  overallScore: number;
  rawScore: number;
  classification:
    | 'PRIORITY A1'
    | 'PRIORITY A2'
    | 'QUALIFIED B'
    | 'BORDERLINE'
    | 'NURTURE'
    | 'REJECT OR LOW PRIORITY';
  confidenceLevel: 'high' | 'medium' | 'low';
  profileEvidenceQuality: 'strong' | 'usable' | 'thin' | 'insufficient';
  marketEntryTiming: 'now' | 'within_6_months' | 'six_to_18_months' | 'future' | 'unknown';
  candidateNeedEvidence: 'explicit' | 'probable' | 'none';
  scoreBreakdown: {
    careerStage: number;
    jobSearchNeed: number;
    pathwayFit: number;
    usPositioningGap: number;
    relocation: number;
    internationalGraduateContext: number;
    coachability: number;
    bangladeshAffinity: number;
    marketRealism: number;
  };
  verifiedPositiveSignals: string[];
  risksOrMissingInformation: string[];
  hardDisqualifier: boolean;
  hardDisqualifierReason: string | null;
  campaignMatches: string[];
  recommendedAction: string;
  bestOutreachAngle: string;
  qualificationQuestions: string[];
  reasoningSummary: string;
}

export async function qualifyLead(
  lead: LeadQualificationInput,
  env: Env
): Promise<LeadQualificationAssessment | null> {
  if (!isAiConfigured(env)) return null;

  const prompt = `You are Skarion's Lead Qualification Agent. Evaluate whether
Skarion can realistically help this person and whether the person is likely to
engage with a success-based career-support program. Do not evaluate personal
worth or general engineering talent.

SKARION CONTEXT
Skarion helps early-career engineering and technology professionals enter
specialized, less-saturated U.S. pathways. Support can include career-path
analysis, practical training, portfolio work, resume/LinkedIn positioning,
targeted applications, recruiter outreach, interview preparation, and
onboarding. Skarion is not a staffing agency, does not guarantee employment,
and never creates or sells offer letters. Offers must come from legitimate
employers through normal hiring.

EVIDENCE AND ETHICS
- Use only profile/conversation facts supplied below.
- Never infer nationality, ethnicity, religion, immigration status, visa status,
  sponsorship needs, or language from a name, photo, appearance, or clothing.
- Only score an international transition or Bangladesh affinity when explicit,
  objective evidence exists. If evidence is absent, score it zero.
- Distinguish verified facts from reasonable interpretation and missing facts.
- Prestige, publications, AI projects, and a polished profile do not by
  themselves show that the person needs Skarion.
- Source-search context is metadata about how the recruiter found the profile,
  never evidence about the candidate. Do not use search keywords, filter
  locations, filter titles, schools, date filters, or the search-level Open to
  Work filter to score any category.
- A candidate is Open to Work only when the candidate-level field is true or
  their own headline/about explicitly says they are seeking opportunities.
- Recruiter captures can contain shifted fields. Treat "Enhanced by resume",
  "Profile experience", "--", follower counts, and connection degree as UI
  noise. A location-looking headline or a headline-looking location is usable
  only for its apparent content, not its column label.
- The three raw education strings can each be separate education records.
  Never assume they are respectively a school, degree, and date.
- Missing, contradictory, or garbled evidence must reduce confidence and
  profileEvidenceQuality; it must never be filled by the model.

STRONGEST PATHWAYS
1. Civil/construction/infrastructure: civil, transportation, project/field
   engineering, inspection, materials, structural, geotechnical, water,
   utilities, permitting, estimating, CAD, Civil 3D, MicroStation, OpenRoads,
   AutoCAD, Bluebeam, and ArcGIS.
2. Electrical/utility/industrial: power, distribution, substations, controls,
   PLC, automation, validation, embedded/firmware, electronics, commissioning,
   instrumentation, and network infrastructure.
3. Telecom/OSP/GIS: fiber design/planning, outside plant, utility design, GIS,
   permitting, make-ready, fielding, splicing documentation, QA/QC, Vetro,
   Katapult, and AutoCAD Map 3D.
4. Technology applied to real industries: analytics, QA/testing, NOC,
   cybersecurity, IT/cloud infrastructure, technical/application support,
   systems, automation, and Python applied to engineering, utilities, telecom,
   GIS, construction, or industrial operations. Generic software/AI/data
   science is only a strong fit when open to these applications.
5. Secondary business/accounting: MIS, accounting, finance, operations,
   project coordination, and business analysis only when a clear Skarion
   pathway exists.

SCORING RUBRIC
The category caps total 105. Calculate rawScore out of 105, then set
overallScore = round(rawScore * 100 / 105).
- careerStage 0-15: 15 for 2025/2026 graduate, within six months, or immediately
  available; 11-14 for 2024/final semester/6-12 months; 6-10 for 2027; 0-5 for
  2028+, early undergraduate, or not entering the market.
- jobSearchNeed 0-20: 17-20 for explicit struggle, months searching, few
  interviews, urgent timeline, work outside field, ended temporary role, or
  certifications without relevant work; 12-16 for active search, limited
  responses, interview-conversion difficulty, referrals, or guidance; 6-11
  casual exploration; 0-5 no need or satisfied employment.
- pathwayFit 0-20: 17-20 direct pathways; 12-16 realistic adjacent transition;
  6-11 generic software/AI/research needing repositioning; 0-5 unsupported.
- usPositioningGap 0-10: 9-10 strong foreign/academic experience with little
  relevant U.S. experience; 6-8 some U.S. internship/research/campus work; 3-5
  relevant U.S. experience but a transition need; 0-2 established career.
- relocation 0-10: 9-10 nationwide/multi-state and industry flexibility; 6-8
  several locations or work modes; 3-5 one metro but several roles; 0-2 remote
  only or extremely narrow. Missing evidence must not receive high points.
- internationalGraduateContext 0-10: only explicit F-1/OPT/CPT/sponsorship or
  documented foreign-to-U.S. transition may score; otherwise zero.
- coachability 0-10: 9-10 thoughtful, clear, realistic, open to feedback and
  adjacent paths; 6-8 responsive but underqualified; 3-5 vague/passive; 0-2
  demands guarantees, fabrication, or is dishonest. With no conversation
  evidence, keep this low and ask a question.
- bangladeshAffinity 0-5: only explicit Bangladesh location, education,
  employment, organization, or statement. Never infer from a name.
- marketRealism 0-5: 5 for multiple related titles/industries and legitimate
  process; 3-4 initially narrow but open; 1-2 saturated-only/unrealistic; 0 for
  guarantees, fake offers, or misrepresentation.

CLASSIFICATION
90-100 PRIORITY A1; 80-89 PRIORITY A2; 70-79 QUALIFIED B; 55-69 BORDERLINE;
40-54 NURTURE; 0-39 REJECT OR LOW PRIORITY.

HARD DISQUALIFIERS
Flag fake/purchased offer letters, fabricated experience, high school, 2028+
with no future relevance, established senior/executive/founder/professor with
no transition need, academic-only PhD focus, no realistic pathway, strong
relevant full-time role with no transition, outside the U.S. with no stated
U.S. intent, insufficient profile information, fraud, disrespect, or refusal
to use legitimate hiring. Employment alone is not disqualifying when someone
is underemployed, temporary, outside their field, or transitioning.

CALIBRATION RULES FROM REVIEWED PROSPECTS
- A 2025/2026 graduate with internship, assistantship, temporary, part-time, or
  outside-field work can still have strong job-search need and pathway fit.
- A current PhD candidate, postdoc, professor, founder, staff engineer, senior
  manager, or established specialist does not receive high need points without
  explicit transition, underemployment, or search evidence.
- A future graduation year should produce marketEntryTiming "future" and
  normally NURTURE rather than a fabricated immediate need. Do not hard
  disqualify solely because someone is an early student.
- Academic research only scores as pathway fit when the supplied evidence maps
  to a realistic Skarion pathway and the person shows non-academic career intent.
- Generic software, AI, biotech, law, arts, content creation, and unrelated
  business profiles require an explicit adjacent path; prestige alone is not fit.
- A relevant full-time role lowers jobSearchNeed unless the evidence explicitly
  shows a transition or active search.
- connectionDegree is outreach logistics only and must not change fit or need.

LEAD EVIDENCE
Name: ${lead.firstName} ${lead.lastName}
${lead.email ? `Email: ${lead.email}` : ''}
${lead.companyName ? `Company: ${lead.companyName}` : ''}
${lead.title ? `Title: ${lead.title}` : ''}
${lead.currentRole ? `Current role: ${lead.currentRole}` : ''}
${lead.currentRoleDates ? `Current role dates: ${lead.currentRoleDates}` : ''}
${lead.openToWork === true ? 'Candidate-level Open to Work: Yes' : ''}
${lead.yearsExperience ? `Years of experience label: ${lead.yearsExperience}` : ''}
${lead.connectionDegree ? `Connection degree (outreach logistics only): ${lead.connectionDegree}` : ''}
Status: ${lead.status}
Source: ${lead.source}
${lead.profileSummary ? `Clean profile summary: ${lead.profileSummary}` : ''}
${lead.education?.length ? `Education records:\n${JSON.stringify(lead.education).substring(0, 8000)}` : ''}
${lead.experience?.length ? `Experience records:\n${JSON.stringify(lead.experience).substring(0, 12000)}` : ''}
${lead.skills?.length ? `Verified skills: ${lead.skills.join(', ').substring(0, 4000)}` : ''}
${lead.notes ? `Profile and conversation evidence:\n${lead.notes.substring(0, 18000)}` : 'No profile or conversation evidence supplied.'}
${lead.sourceContext ? `SOURCE-SEARCH CONTEXT — DO NOT TREAT AS CANDIDATE EVIDENCE:\n${JSON.stringify(lead.sourceContext).substring(0, 4000)}` : ''}

Return ONLY valid JSON:
{
  "overallScore": 0,
  "rawScore": 0,
  "classification": "PRIORITY A1 | PRIORITY A2 | QUALIFIED B | BORDERLINE | NURTURE | REJECT OR LOW PRIORITY",
  "confidenceLevel": "high | medium | low",
  "profileEvidenceQuality": "strong | usable | thin | insufficient",
  "marketEntryTiming": "now | within_6_months | six_to_18_months | future | unknown",
  "candidateNeedEvidence": "explicit | probable | none",
  "scoreBreakdown": {
    "careerStage": 0,
    "jobSearchNeed": 0,
    "pathwayFit": 0,
    "usPositioningGap": 0,
    "relocation": 0,
    "internationalGraduateContext": 0,
    "coachability": 0,
    "bangladeshAffinity": 0,
    "marketRealism": 0
  },
  "verifiedPositiveSignals": [],
  "risksOrMissingInformation": [],
  "hardDisqualifier": false,
  "hardDisqualifierReason": null,
  "campaignMatches": [],
  "recommendedAction": "",
  "bestOutreachAngle": "",
  "qualificationQuestions": ["", ""],
  "reasoningSummary": ""
}

Do not invent facts. Keep reasoningSummary to 2-4 sentences and ask at most two
questions that resolve the highest-impact missing information.`;

  const assessment = await extractStructured<LeadQualificationAssessment>(prompt, env, {
    agent: 'lead-scorer',
    tier: 'fast',
  });
  if (!assessment) return null;

  const caps: Record<keyof LeadQualificationAssessment['scoreBreakdown'], number> = {
    careerStage: 15,
    jobSearchNeed: 20,
    pathwayFit: 20,
    usPositioningGap: 10,
    relocation: 10,
    internationalGraduateContext: 10,
    coachability: 10,
    bangladeshAffinity: 5,
    marketRealism: 5,
  };
  for (const key of Object.keys(caps) as Array<keyof typeof caps>) {
    const value = Number(assessment.scoreBreakdown?.[key] ?? 0);
    assessment.scoreBreakdown[key] = Math.max(0, Math.min(caps[key], Math.round(value)));
  }
  assessment.rawScore = Object.values(assessment.scoreBreakdown).reduce(
    (total, value) => total + value,
    0
  );
  assessment.overallScore = Math.round((assessment.rawScore * 100) / 105);
  assessment.profileEvidenceQuality = (
    ['strong', 'usable', 'thin', 'insufficient'] as const
  ).includes(assessment.profileEvidenceQuality)
    ? assessment.profileEvidenceQuality
    : 'insufficient';
  assessment.marketEntryTiming = (
    ['now', 'within_6_months', 'six_to_18_months', 'future', 'unknown'] as const
  ).includes(assessment.marketEntryTiming)
    ? assessment.marketEntryTiming
    : 'unknown';
  assessment.candidateNeedEvidence = (['explicit', 'probable', 'none'] as const).includes(
    assessment.candidateNeedEvidence
  )
    ? assessment.candidateNeedEvidence
    : 'none';
  assessment.classification = assessment.hardDisqualifier
    ? 'REJECT OR LOW PRIORITY'
    : assessment.overallScore >= 90
      ? 'PRIORITY A1'
      : assessment.overallScore >= 80
        ? 'PRIORITY A2'
        : assessment.overallScore >= 70
          ? 'QUALIFIED B'
          : assessment.overallScore >= 55
            ? 'BORDERLINE'
            : assessment.overallScore >= 40
              ? 'NURTURE'
              : 'REJECT OR LOW PRIORITY';
  return assessment;
}

export async function scoreLead(
  lead: LeadQualificationInput,
  env: Env
): Promise<{ score: number; reasoning: string } | null> {
  const assessment = await qualifyLead(lead, env);
  if (!assessment) return null;
  return { score: assessment.overallScore, reasoning: assessment.reasoningSummary };
}

export function normalizeLinkedinConnectionNote(text: string): string {
  let note = text
    .replace(/```(?:text)?/gi, '')
    .replace(/```/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“]|["”]$/g, '');
  if ([...note].length <= 300) return note;
  const characters = [...note].slice(0, 297).join('');
  const lastSpace = characters.lastIndexOf(' ');
  note = `${characters.slice(0, lastSpace > 240 ? lastSpace : 297).trimEnd()}...`;
  return [...note].slice(0, 300).join('');
}

export async function draftLinkedinConnectionNote(
  lead: LeadQualificationInput,
  env: Env
): Promise<string | null> {
  if (!isAiConfigured(env)) return null;

  const prompt = `You are Skarion's LinkedIn Connection Writer. Create one
connection-request note that the user can paste directly into LinkedIn.

HARD REQUIREMENTS
- Maximum 300 Unicode characters including spaces. Target 180-260.
- Output only the note: no label, quotation marks, markdown, score, or analysis.
- One paragraph. Begin "Hi ${lead.firstName},".
- Mention one or two specific, verified profile facts, ideally a concrete tool,
  discipline, project, transition, or graduation/search fact.
- Ask one low-friction, relevant question about goals or how the search is going.
- Be warm, peer-like, specific, and concise. Do not sound like a mass campaign.
- Do not infer nationality, ethnicity, visa status, sponsorship, graduation,
  unemployment, relocation, or job-search difficulty.
- Do not promise a job, interview, placement, sponsorship, or offer letter.
- Do not mention Skarion's payment model in a connection note.
- Avoid empty praise, emojis, hashtags, links, phone numbers, and multiple
  questions.

Useful pattern:
"Hi [First name], your [specific work/tool] stood out, especially [second
verified detail]. I work with [accurate peer group] navigating U.S. career
paths—how has your search for [relevant roles] been going?"

LEAD EVIDENCE
Name: ${lead.firstName} ${lead.lastName}
${lead.companyName ? `Company: ${lead.companyName}` : ''}
${lead.title ? `Title: ${lead.title}` : ''}
Source: ${lead.source}
${lead.profileSummary ? `Clean profile summary: ${lead.profileSummary}` : ''}
${lead.education?.length ? `Education records: ${JSON.stringify(lead.education).substring(0, 5000)}` : ''}
${lead.experience?.length ? `Experience records: ${JSON.stringify(lead.experience).substring(0, 7000)}` : ''}
${lead.skills?.length ? `Verified skills: ${lead.skills.join(', ').substring(0, 2500)}` : ''}
${lead.notes ? lead.notes.substring(0, 12000) : 'No additional profile evidence supplied.'}`;

  const note = await chatCompletionSingle(prompt, env, {
    temperature: 0.35,
    tier: 'fast',
    agent: 'linkedin-connection-writer',
  });
  return note ? normalizeLinkedinConnectionNote(note) : null;
}
