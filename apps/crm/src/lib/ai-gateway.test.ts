import { afterEach, describe, expect, it, vi } from 'vitest';
import { gatewayChatCompletion, gatewayEmbedding } from '@skarion/ai-toolkit';
import { chatCompletionSingle } from './ai-service.js';

const env = {
  AI_GATEWAY_BASE_URL: 'https://vertex-proxy.example/v1/',
  AI_GATEWAY_API_KEY: 'test-secret',
  AI_MODEL_DEFAULT: 'coding-fast',
  AI_MODEL_CHEAP: 'coding-cheap',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Vertex gateway client', () => {
  it('calls the OpenAI-compatible chat and embedding routes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'gateway chat works' } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      gatewayChatCompletion([{ role: 'user', content: 'hello' }], env, {
        model: 'coding-fast',
      })
    ).resolves.toBe('gateway chat works');
    await expect(gatewayEmbedding('hello', env)).resolves.toEqual([0.1, 0.2, 0.3]);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://vertex-proxy.example/v1/chat/completions');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://vertex-proxy.example/v1/embeddings');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer test-secret',
    });
  });

  it('falls back to the cheap model when the selected chat model fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('model unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: 'fallback works' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      chatCompletionSingle('hello', env, {
        model: 'coding-best',
        agent: 'crm-copilot',
      })
    ).resolves.toBe('fallback works');

    const fallbackBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      model: string;
    };
    expect(fallbackBody.model).toBe('coding-cheap');
  });
});
