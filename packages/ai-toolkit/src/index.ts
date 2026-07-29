export const name = '@skarion/ai-toolkit';

export type AiModelTier = 'reasoning' | 'fast' | 'cheap';

export interface AiGatewayEnv {
  AI_GATEWAY_BASE_URL?: string;
  AI_GATEWAY_API_KEY?: string;
  AI_MODEL_DEFAULT?: string;
  AI_MODEL_REASONING?: string;
  AI_MODEL_CHEAP?: string;
  AI_MODEL_FALLBACK?: string;
  AI_EMBEDDING_MODEL?: string;
  /** JSON object mapping an AI agent id to a model alias. */
  AI_AGENT_MODELS?: string;
  /** Optional server-side sink used to persist token and cost telemetry. */
  AI_USAGE_RECORDER?: AiUsageRecorder;
}

export type AiGatewayContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface AiGatewayMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | AiGatewayContentPart[];
}

export interface AiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
}

export interface AiUsageRecord {
  provider: 'vertex_proxy' | 'google_ai';
  model: string;
  backingModel: string;
  agentId?: AiAgentId;
  requestType: 'chat' | 'embedding' | 'ocr';
  status: 'success' | 'error' | 'cancelled';
  usage: AiTokenUsage;
  usageSource: 'provider' | 'estimated' | 'unavailable';
  estimatedCostUsd: number;
  latencyMs: number;
}

export type AiUsageRecorder = (record: AiUsageRecord) => void | Promise<void>;

const DEFAULT_CHAT_TIMEOUT_MS = 90_000;
const DEFAULT_EMBEDDING_TIMEOUT_MS = 20_000;

export const DEFAULT_AI_MODELS = {
  reasoning: 'coding-best',
  fast: 'coding-fast',
  cheap: 'coding-cheap',
  embedding: 'embedding',
} as const;

export const AI_MODELS = [
  {
    id: 'coding-best',
    backingModel: 'gemini-3.1-pro-preview',
    label: 'Coding Best',
    costClass: 'high',
    inputPricePerMillion: 2,
    outputPricePerMillion: 12,
  },
  {
    id: 'coding-fast',
    backingModel: 'gemini-3.6-flash',
    label: 'Coding Fast',
    costClass: 'medium',
    inputPricePerMillion: 1.5,
    outputPricePerMillion: 7.5,
  },
  {
    id: 'coding-cheap',
    backingModel: 'gemini-3.5-flash-lite',
    label: 'Coding Cheap',
    costClass: 'low',
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 2.5,
  },
  {
    id: 'gemini-3.1-pro-preview',
    backingModel: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
    costClass: 'high',
    inputPricePerMillion: 2,
    outputPricePerMillion: 12,
  },
  {
    id: 'gemini-3.6-flash',
    backingModel: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    costClass: 'medium',
    inputPricePerMillion: 1.5,
    outputPricePerMillion: 7.5,
  },
  {
    id: 'gemini-3.5-flash',
    backingModel: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    costClass: 'medium',
    inputPricePerMillion: 1.5,
    outputPricePerMillion: 9,
  },
  {
    id: 'gemini-3.5-flash-lite',
    backingModel: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite',
    costClass: 'low',
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 2.5,
  },
  {
    id: 'gemini-2.5-pro',
    backingModel: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    costClass: 'high',
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 10,
  },
  {
    id: 'gemini-2.5-flash',
    backingModel: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    costClass: 'medium',
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 2.5,
  },
  {
    id: 'gemini-2.5-flash-lite',
    backingModel: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    costClass: 'low',
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
  },
] as const;

const ADDITIONAL_MODEL_PRICING: Record<
  string,
  { inputPricePerMillion: number; outputPricePerMillion: number }
> = {
  embedding: { inputPricePerMillion: 0.15, outputPricePerMillion: 0 },
  'gemini-embedding-001': { inputPricePerMillion: 0.15, outputPricePerMillion: 0 },
  'gemini-1.5-flash': { inputPricePerMillion: 0.075, outputPricePerMillion: 0.3 },
  'gemini-1.5-pro': { inputPricePerMillion: 1.25, outputPricePerMillion: 5 },
  'text-embedding-004': { inputPricePerMillion: 0.025, outputPricePerMillion: 0 },
};

export const AI_PRICING_UPDATED_AT = '2026-07-29';

export function getAiBackingModel(model: string): string {
  return AI_MODELS.find((candidate) => candidate.id === model)?.backingModel ?? model;
}

export function getAiModelPricing(
  model: string
): { inputPricePerMillion: number; outputPricePerMillion: number } | null {
  const configured = AI_MODELS.find(
    (candidate) => candidate.id === model || candidate.backingModel === model
  );
  if (configured) {
    return {
      inputPricePerMillion: configured.inputPricePerMillion,
      outputPricePerMillion: configured.outputPricePerMillion,
    };
  }
  return ADDITIONAL_MODEL_PRICING[model] ?? null;
}

export function estimateAiCostUsd(model: string, usage: AiTokenUsage): number {
  const pricing = getAiModelPricing(model);
  if (!pricing) return 0;
  const cachedInputTokens = Math.min(usage.inputTokens, usage.cachedInputTokens ?? 0);
  const uncachedInputTokens = usage.inputTokens - cachedInputTokens;
  return (
    (uncachedInputTokens * pricing.inputPricePerMillion +
      cachedInputTokens * pricing.inputPricePerMillion * 0.1 +
      usage.outputTokens * pricing.outputPricePerMillion) /
    1_000_000
  );
}

export type AiAgentId =
  | 'crm-copilot'
  | 'reporting-ceo'
  | 'lead-intake'
  | 'document-ocr'
  | 'linkedin-connection-writer'
  | 'outreach-writer'
  | 'lead-scorer'
  | 'next-best-action'
  | 'lead-summarizer'
  | 'company-summarizer'
  | 'contact-summarizer'
  | 'rag-search'
  | 'rag-indexer';

export const AI_AGENTS: ReadonlyArray<{
  id: AiAgentId;
  name: string;
  description: string;
  tier: AiModelTier | 'embedding';
}> = [
  {
    id: 'crm-copilot',
    name: 'CRM Copilot',
    description: 'Answers CRM questions using permission-filtered RAG context.',
    tier: 'fast',
  },
  {
    id: 'reporting-ceo',
    name: 'Reporting CEO',
    description:
      'Analyzes company-wide CRM metrics, highlights risks, and produces executive reports and charts.',
    tier: 'reasoning',
  },
  {
    id: 'lead-intake',
    name: 'Lead Intake Agent',
    description: 'Extracts structured lead data from PDFs, resumes, and pasted text.',
    tier: 'reasoning',
  },
  {
    id: 'document-ocr',
    name: 'Document OCR Agent',
    description: 'Reads scanned PDFs and images.',
    tier: 'reasoning',
  },
  {
    id: 'linkedin-connection-writer',
    name: 'LinkedIn Connection Writer',
    description:
      'Creates a verified, personalized connection note that is ready to paste and never exceeds 300 characters.',
    tier: 'fast',
  },
  {
    id: 'outreach-writer',
    name: 'Outreach Writer',
    description: 'Drafts email, LinkedIn, and SMS outreach.',
    tier: 'fast',
  },
  {
    id: 'lead-scorer',
    name: 'Lead Scoring Agent',
    description: 'Scores lead quality and returns structured reasoning.',
    tier: 'reasoning',
  },
  {
    id: 'next-best-action',
    name: 'Next Best Action Agent',
    description: 'Suggests a concise next step for a lead.',
    tier: 'cheap',
  },
  {
    id: 'lead-summarizer',
    name: 'Lead Summarizer',
    description: 'Creates short CRM lead summaries.',
    tier: 'cheap',
  },
  {
    id: 'company-summarizer',
    name: 'Company Summarizer',
    description: 'Creates short company-fit summaries.',
    tier: 'cheap',
  },
  {
    id: 'contact-summarizer',
    name: 'Contact Summarizer',
    description: 'Creates short contact and approach summaries.',
    tier: 'cheap',
  },
  {
    id: 'rag-search',
    name: 'RAG Search Agent',
    description: 'Embeds CRM questions for semantic retrieval.',
    tier: 'embedding',
  },
  {
    id: 'rag-indexer',
    name: 'RAG Indexer',
    description: 'Builds and refreshes embeddings for CRM records.',
    tier: 'embedding',
  },
];

export function hasAiGateway(env: AiGatewayEnv): boolean {
  return Boolean(env.AI_GATEWAY_BASE_URL && env.AI_GATEWAY_API_KEY);
}

export function selectAiModel(env: AiGatewayEnv, tier: AiModelTier = 'fast'): string {
  if (tier === 'reasoning') return env.AI_MODEL_REASONING || DEFAULT_AI_MODELS.reasoning;
  if (tier === 'cheap') return env.AI_MODEL_CHEAP || DEFAULT_AI_MODELS.cheap;
  return env.AI_MODEL_DEFAULT || DEFAULT_AI_MODELS.fast;
}

export function selectAiAgentModel(
  env: AiGatewayEnv,
  agentId: AiAgentId,
  tier: AiModelTier = 'fast'
): string {
  if (env.AI_AGENT_MODELS) {
    try {
      const overrides = JSON.parse(env.AI_AGENT_MODELS) as Record<string, string>;
      if (overrides[agentId]) return overrides[agentId];
    } catch {
      console.error('AI_AGENT_MODELS must be a JSON object.');
    }
  }
  return selectAiModel(env, tier);
}

function gatewayUrl(env: AiGatewayEnv, path: string): string {
  return `${env.AI_GATEWAY_BASE_URL!.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function toNonNegativeInteger(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
}

function parseOpenAiUsage(value: unknown): AiTokenUsage | null {
  if (!value || typeof value !== 'object') return null;
  const usage = value as Record<string, unknown>;
  const inputTokens = toNonNegativeInteger(
    usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount
  );
  const outputTokens = toNonNegativeInteger(
    usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount
  );
  const totalTokens =
    toNonNegativeInteger(usage.total_tokens ?? usage.totalTokenCount) || inputTokens + outputTokens;
  if (totalTokens === 0 && inputTokens === 0 && outputTokens === 0) return null;
  const details = (usage.prompt_tokens_details ?? usage.input_tokens_details) as
    | Record<string, unknown>
    | undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens: toNonNegativeInteger(
      details?.cached_tokens ?? usage.cachedContentTokenCount
    ),
  };
}

function contentCharacterCount(content: AiGatewayMessage['content']): number {
  if (typeof content === 'string') return content.length;
  return content.reduce((total, part) => {
    if (part.type === 'text') return total + part.text.length;
    return total;
  }, 0);
}

function estimateUsage(
  messages: AiGatewayMessage[],
  outputText = '',
  embeddingInput = ''
): AiTokenUsage {
  const inputCharacters =
    embeddingInput.length +
    messages.reduce((total, message) => total + contentCharacterCount(message.content), 0);
  const inputTokens = Math.ceil(inputCharacters / 4);
  const outputTokens = Math.ceil(outputText.length / 4);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

async function recordGatewayUsage(
  env: AiGatewayEnv,
  record: Omit<AiUsageRecord, 'backingModel' | 'estimatedCostUsd'>
): Promise<void> {
  if (!env.AI_USAGE_RECORDER) return;
  const completeRecord: AiUsageRecord = {
    ...record,
    backingModel: getAiBackingModel(record.model),
    estimatedCostUsd: estimateAiCostUsd(record.model, record.usage),
  };
  try {
    await env.AI_USAGE_RECORDER(completeRecord);
  } catch (error) {
    console.error('AI usage recorder failed:', error);
  }
}

export async function gatewayChatCompletion(
  messages: AiGatewayMessage[],
  env: AiGatewayEnv,
  options: {
    model?: string;
    tier?: AiModelTier;
    agent?: AiAgentId;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  } = {}
): Promise<string | null> {
  if (!hasAiGateway(env)) return null;

  const model = options.model || selectAiModel(env, options.tier);
  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(
      gatewayUrl(env, 'chat/completions'),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AI_GATEWAY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.3,
          ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        }),
      },
      options.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS
    );

    if (!response.ok) {
      console.error(`AI gateway chat error (${model}, ${response.status}):`, await response.text());
      await recordGatewayUsage(env, {
        provider: 'vertex_proxy',
        model,
        agentId: options.agent,
        requestType: 'chat',
        status: 'error',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        usageSource: 'unavailable',
        latencyMs: Date.now() - startedAt,
      });
      return null;
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: unknown;
    };
    const content = data.choices?.[0]?.message?.content ?? null;
    const providerUsage = parseOpenAiUsage(data.usage);
    const usage = providerUsage ?? estimateUsage(messages, content ?? '');
    await recordGatewayUsage(env, {
      provider: 'vertex_proxy',
      model,
      agentId: options.agent,
      requestType: 'chat',
      status: 'success',
      usage,
      usageSource: providerUsage ? 'provider' : 'estimated',
      latencyMs: Date.now() - startedAt,
    });
    return content;
  } catch (error) {
    console.error(`AI gateway chat request failed (${model}):`, error);
    await recordGatewayUsage(env, {
      provider: 'vertex_proxy',
      model,
      agentId: options.agent,
      requestType: 'chat',
      status: 'error',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      usageSource: 'unavailable',
      latencyMs: Date.now() - startedAt,
    });
    return null;
  }
}

/**
 * Streams OpenAI-compatible chat completion deltas from the configured
 * gateway. Some compatible gateways ignore `stream: true` and return a normal
 * JSON completion; that response is supported as a single delta as well.
 */
export async function* gatewayChatCompletionStream(
  messages: AiGatewayMessage[],
  env: AiGatewayEnv,
  options: {
    model?: string;
    tier?: AiModelTier;
    agent?: AiAgentId;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  } = {}
): AsyncGenerator<string> {
  if (!hasAiGateway(env)) return;

  const model = options.model || selectAiModel(env, options.tier);
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetchWithTimeout(
      gatewayUrl(env, 'chat/completions'),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AI_GATEWAY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.3,
          stream: true,
          stream_options: { include_usage: true },
          ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        }),
      },
      options.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS
    );
  } catch (error) {
    console.error(`AI gateway streaming request failed (${model}):`, error);
    await recordGatewayUsage(env, {
      provider: 'vertex_proxy',
      model,
      agentId: options.agent,
      requestType: 'chat',
      status: 'error',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      usageSource: 'unavailable',
      latencyMs: Date.now() - startedAt,
    });
    return;
  }

  if (!response.ok) {
    console.error(
      `AI gateway streaming error (${model}, ${response.status}):`,
      await response.text()
    );
    await recordGatewayUsage(env, {
      provider: 'vertex_proxy',
      model,
      agentId: options.agent,
      requestType: 'chat',
      status: 'error',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      usageSource: 'unavailable',
      latencyMs: Date.now() - startedAt,
    });
    return;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: unknown;
    };
    const content = data.choices?.[0]?.message?.content;
    const providerUsage = parseOpenAiUsage(data.usage);
    await recordGatewayUsage(env, {
      provider: 'vertex_proxy',
      model,
      agentId: options.agent,
      requestType: 'chat',
      status: 'success',
      usage: providerUsage ?? estimateUsage(messages, content ?? ''),
      usageSource: providerUsage ? 'provider' : 'estimated',
      latencyMs: Date.now() - startedAt,
    });
    if (content) yield content;
    return;
  }

  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  let outputText = '';
  let providerUsage: AiTokenUsage | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';

      for (const event of events) {
        for (const line of event.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const data = JSON.parse(payload) as {
              choices?: { delta?: { content?: string } }[];
              usage?: unknown;
            };
            providerUsage = parseOpenAiUsage(data.usage) ?? providerUsage;
            const content = data.choices?.[0]?.delta?.content;
            if (content) {
              outputText += content;
              yield content;
            }
          } catch {
            console.error('AI gateway returned an invalid streaming event.');
          }
        }
      }

      if (done) {
        completed = true;
        break;
      }
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    await recordGatewayUsage(env, {
      provider: 'vertex_proxy',
      model,
      agentId: options.agent,
      requestType: 'chat',
      status: completed ? 'success' : 'cancelled',
      usage: providerUsage ?? estimateUsage(messages, outputText),
      usageSource: providerUsage ? 'provider' : 'estimated',
      latencyMs: Date.now() - startedAt,
    });
  }
}

export async function gatewayEmbedding(
  text: string,
  env: AiGatewayEnv,
  options: { agent?: AiAgentId; model?: string } = {}
): Promise<number[] | null> {
  if (!hasAiGateway(env)) return null;

  const model = options.model || env.AI_EMBEDDING_MODEL || DEFAULT_AI_MODELS.embedding;
  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(
      gatewayUrl(env, 'embeddings'),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AI_GATEWAY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, input: text }),
      },
      DEFAULT_EMBEDDING_TIMEOUT_MS
    );

    if (!response.ok) {
      console.error(
        `AI gateway embedding error (${model}, ${response.status}):`,
        await response.text()
      );
      await recordGatewayUsage(env, {
        provider: 'vertex_proxy',
        model,
        agentId: options.agent,
        requestType: 'embedding',
        status: 'error',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        usageSource: 'unavailable',
        latencyMs: Date.now() - startedAt,
      });
      return null;
    }

    const data = (await response.json()) as {
      data?: { embedding?: number[] }[];
      usage?: unknown;
    };
    const providerUsage = parseOpenAiUsage(data.usage);
    await recordGatewayUsage(env, {
      provider: 'vertex_proxy',
      model,
      agentId: options.agent,
      requestType: 'embedding',
      status: 'success',
      usage: providerUsage ?? estimateUsage([], '', text),
      usageSource: providerUsage ? 'provider' : 'estimated',
      latencyMs: Date.now() - startedAt,
    });
    return data.data?.[0]?.embedding ?? null;
  } catch (error) {
    console.error(`AI gateway embedding request failed (${model}):`, error);
    await recordGatewayUsage(env, {
      provider: 'vertex_proxy',
      model,
      agentId: options.agent,
      requestType: 'embedding',
      status: 'error',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      usageSource: 'unavailable',
      latencyMs: Date.now() - startedAt,
    });
    return null;
  }
}
