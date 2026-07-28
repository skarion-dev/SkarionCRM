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
}

export type AiGatewayContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface AiGatewayMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | AiGatewayContentPart[];
}

export const DEFAULT_AI_MODELS = {
  reasoning: 'coding-best',
  fast: 'coding-fast',
  cheap: 'coding-cheap',
  embedding: 'embedding',
} as const;

export function hasAiGateway(env: AiGatewayEnv): boolean {
  return Boolean(env.AI_GATEWAY_BASE_URL && env.AI_GATEWAY_API_KEY);
}

export function selectAiModel(env: AiGatewayEnv, tier: AiModelTier = 'fast'): string {
  if (tier === 'reasoning') return env.AI_MODEL_REASONING || DEFAULT_AI_MODELS.reasoning;
  if (tier === 'cheap') return env.AI_MODEL_CHEAP || DEFAULT_AI_MODELS.cheap;
  return env.AI_MODEL_DEFAULT || DEFAULT_AI_MODELS.fast;
}

function gatewayUrl(env: AiGatewayEnv, path: string): string {
  return `${env.AI_GATEWAY_BASE_URL!.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export async function gatewayChatCompletion(
  messages: AiGatewayMessage[],
  env: AiGatewayEnv,
  options: {
    model?: string;
    tier?: AiModelTier;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<string | null> {
  if (!hasAiGateway(env)) return null;

  const model = options.model || selectAiModel(env, options.tier);
  try {
    const response = await fetch(gatewayUrl(env, 'chat/completions'), {
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
    });

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
    const response = await fetch(gatewayUrl(env, 'embeddings'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AI_GATEWAY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input: text }),
    });

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
