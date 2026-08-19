import http from 'node:http';
import { GoogleAuth } from 'google-auth-library';

const port = Number(process.env.PORT || 8080);
const project = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.VERTEX_LOCATION || 'us-central1';
const gatewayKey = process.env.GATEWAY_API_KEY?.trim();
if (!project || !gatewayKey) throw new Error('GOOGLE_CLOUD_PROJECT and GATEWAY_API_KEY are required');

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const modelName = (value, fallback) => {
  const raw = String(value || fallback).replace(/^vertex_ai\//, '');
  if (raw === 'coding-cheapest') return 'gemini-2.5-flash-lite';
  if (raw === 'coding-cheap') return 'gemini-3.5-flash-lite';
  if (raw === 'coding-fast') return 'gemini-2.5-flash';
  if (raw === 'coding-best') return 'gemini-2.5-pro';
  if (raw === 'embedding') return 'text-embedding-004';
  return raw;
};

function authorized(req) {
  const value = req.headers.authorization || '';
  return value === `Bearer ${gatewayKey}`;
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function chat(payload) {
  const model = modelName(payload.model, 'gemini-3.5-flash-lite');
  const system = payload.messages?.filter((m) => m.role === 'system').map((m) => typeof m.content === 'string' ? m.content : '').join('\n');
  const contents = (payload.messages || []).filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join('\n') }],
  }));
  const client = await auth.getClient();
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  const endpoint = `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const result = await client.request({ url: endpoint, method: 'POST', data: {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    generationConfig: { temperature: payload.temperature ?? 0.3, ...(payload.max_tokens ? { maxOutputTokens: payload.max_tokens } : {}) },
  } });
  const response = result.data;
  const text = response.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  return { id: `chatcmpl-${Date.now()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
}

async function embeddings(payload) {
  const model = modelName(payload.model, 'text-embedding-004');
  const inputs = Array.isArray(payload.input) ? payload.input : [payload.input];
  const client = await auth.getClient();
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  const endpoint = `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`;
  const response = await client.request({ url: endpoint, method: 'POST', data: { instances: inputs.map((input) => ({ content: String(input || '') })) } });
  const predictions = response.data?.predictions || [];
  const data = [];
  for (const prediction of predictions) data.push({ object: 'embedding', index: data.length, embedding: prediction.embeddings?.values || prediction.embedding?.values || [] });
  return { object: 'list', data, model, usage: { prompt_tokens: 0, total_tokens: 0 } };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true, project, location });
  if (!authorized(req)) return json(res, 401, { error: { message: 'Unauthorized', type: 'authentication_error' } });
  try {
    const payload = await body(req);
    if (req.method === 'POST' && req.url === '/v1/chat/completions') return json(res, 200, await chat(payload));
    if (req.method === 'POST' && req.url === '/v1/embeddings') return json(res, 200, await embeddings(payload));
    return json(res, 404, { error: { message: 'Not found' } });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: { message: error instanceof Error ? error.message : 'Gateway error', type: 'server_error' } });
  }
});
server.listen(port, '0.0.0.0', () => console.log(`Vertex gateway listening on ${port}`));
