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
}

export type AiGatewayContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface AiGatewayMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | AiGatewayContentPart[];
}

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
  },
  {
    id: 'coding-fast',
    backingModel: 'gemini-3.6-flash',
    label: 'Coding Fast',
    costClass: 'medium',
  },
  {
    id: 'coding-cheap',
    backingModel: 'gemini-3.5-flash-lite',
    label: 'Coding Cheap',
    costClass: 'low',
  },
  {
    id: 'gemini-3.1-pro-preview',
    backingModel: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
    costClass: 'high',
  },
  {
    id: 'gemini-3.6-flash',
    backingModel: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    costClass: 'medium',
  },
  {
    id: 'gemini-3.5-flash',
    backingModel: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    costClass: 'medium',
  },
  {
    id: 'gemini-3.5-flash-lite',
    backingModel: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite',
    costClass: 'low',
  },
  {
    id: 'gemini-2.5-pro',
    backingModel: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    costClass: 'high',
  },
  {
    id: 'gemini-2.5-flash',
    backingModel: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    costClass: 'medium',
  },
  {
    id: 'gemini-2.5-flash-lite',
    backingModel: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    costClass: 'low',
  },
] as const;

export type AiAgentId =
  | 'crm-copilot'
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

export async function gatewayChatCompletion(
  messages: AiGatewayMessage[],
  env: AiGatewayEnv,
  options: {
    model?: string;
    tier?: AiModelTier;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  } = {}
): Promise<string | null> {
  if (!hasAiGateway(env)) return null;

  const model = options.model || selectAiModel(env, options.tier);
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
      return null;
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    console.error(`AI gateway chat request failed (${model}):`, error);
    return null;
  }
}

export async function gatewayEmbedding(text: string, env: AiGatewayEnv): Promise<number[] | null> {
  if (!hasAiGateway(env)) return null;

  const model = env.AI_EMBEDDING_MODEL || DEFAULT_AI_MODELS.embedding;
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
      return null;
    }

    const data = (await response.json()) as {
      data?: { embedding?: number[] }[];
    };
    return data.data?.[0]?.embedding ?? null;
  } catch (error) {
    console.error(`AI gateway embedding request failed (${model}):`, error);
    return null;
  }
}
