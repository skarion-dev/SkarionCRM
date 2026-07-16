import { Hono } from 'hono';
import { getDb } from '@skarion/db-kit';
import * as schema from '@skarion/crm/db/schema';
import type { CrmDb } from '@skarion/crm/db/types';
import { eq, and, isNull } from 'drizzle-orm';

interface Env {
  DATABASE_URL: string;
  GOOGLE_API_KEY?: string;
  GOOGLE_EMBEDDING_MODEL?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok', service: 'skarion-embeddings-builder' }));

// Build a plain-text representation of a CRM record for embedding.
function recordToText(type: string, record: Record<string, unknown>): string {
  switch (type) {
    case 'company':
      return `Company: ${record.name}. Domain: ${record.domain ?? 'N/A'}. Industry: ${record.industry ?? 'N/A'}. Size: ${record.size ?? 'N/A'}.`;
    case 'contact':
      return `Contact: ${record.firstName} ${record.lastName}. Email: ${record.email}. Title: ${record.title ?? 'N/A'}. Phone: ${record.phone ?? 'N/A'}.`;
    case 'lead':
      return `Lead: ${record.firstName} ${record.lastName}. Email: ${record.email}. Company: ${record.companyName ?? 'N/A'}. Status: ${record.status}. Source: ${record.source}. Notes: ${record.notes ?? 'N/A'}.`;
    case 'opportunity':
      return `Opportunity: ${record.name}. Stage: ${record.stage}. Amount: ${record.amount ?? 'N/A'} ${record.currency ?? ''}. Probability: ${record.probability ?? 'N/A'}%. Expected close: ${record.expectedCloseDate ?? 'N/A'}. Notes: ${record.notes ?? 'N/A'}.`;
    case 'task':
      return `Task: ${record.title}. Description: ${record.description ?? 'N/A'}. Priority: ${record.priority}. Due: ${record.dueDate ?? 'N/A'}.`;
    case 'activity':
      return `Activity (${record.type}): ${record.subject}. Content: ${record.content ?? 'N/A'}.`;
    default:
      return JSON.stringify(record);
  }
}

async function fetchEmbedding(text: string, env: Env): Promise<number[] | null> {
  if (!env.GOOGLE_API_KEY) return null;
  const model = env.GOOGLE_EMBEDDING_MODEL || 'text-embedding-004';
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

async function upsertEmbedding(
  db: CrmDb,
  resourceType: string,
  resourceId: string,
  content: string,
  embedding: number[],
  ownerId: string
) {
  const existing = await db.select().from(schema.embeddings)
    .where(and(eq(schema.embeddings.resourceType, resourceType), eq(schema.embeddings.resourceId, resourceId)))
    .limit(1);
  if (existing.length > 0) {
    const id = existing[0]!.id;
    await db.update(schema.embeddings)
      .set({ content, embedding, ownerId, updatedAt: new Date() })
      .where(eq(schema.embeddings.id, id));
  } else {
    await db.insert(schema.embeddings).values({ resourceType, resourceId, content, embedding, ownerId });
  }
}

async function processTable(
  db: CrmDb,
  env: Env,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  type: string,
  idField: string,
  ownerField: string
) {
  // Select records that either have no embedding or have been updated since their last embedding
  const rows = await db.select().from(table)
    .where(isNull(table.deletedAt))
    .limit(50); // batch size per run

  let processed = 0;
  for (const row of rows) {
    const text = recordToText(type, row as Record<string, unknown>);
    const embedding = await fetchEmbedding(text, env);
    if (!embedding) continue;
    await upsertEmbedding(db, type, row[idField] as string, text, embedding, row[ownerField] as string);
    processed++;
  }
  return processed;
}

async function buildAllEmbeddings(env: Env): Promise<{ processed: number; errors: string[] }> {
  const db = getDb(env, schema) as CrmDb;
  const errors: string[] = [];
  let total = 0;

  try {
    total += await processTable(db, env, schema.companies, 'company', 'id', 'ownerId');
  } catch (err) { errors.push(`companies: ${(err as Error).message}`); }

  try {
    total += await processTable(db, env, schema.contacts, 'contact', 'id', 'ownerId');
  } catch (err) { errors.push(`contacts: ${(err as Error).message}`); }

  try {
    total += await processTable(db, env, schema.leads, 'lead', 'id', 'ownerId');
  } catch (err) { errors.push(`leads: ${(err as Error).message}`); }

  try {
    total += await processTable(db, env, schema.opportunities, 'opportunity', 'id', 'ownerId');
  } catch (err) { errors.push(`opportunities: ${(err as Error).message}`); }

  try {
    total += await processTable(db, env, schema.tasks, 'task', 'id', 'assigneeId');
  } catch (err) { errors.push(`tasks: ${(err as Error).message}`); }

  try {
    total += await processTable(db, env, schema.activities, 'activity', 'id', 'actorId');
  } catch (err) { errors.push(`activities: ${(err as Error).message}`); }

  return { processed: total, errors };
}

// Manual trigger endpoint (for testing or on-demand rebuilds)
app.post('/build', async (c) => {
  if (!c.env.GOOGLE_API_KEY) {
    return c.json({ error: 'GOOGLE_API_KEY not configured.' }, 503);
  }
  const result = await buildAllEmbeddings(c.env);
  return c.json(result);
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(buildAllEmbeddings(env).then((result) => {
      console.log(`[embeddings-builder] processed=${result.processed} errors=${result.errors.length}`);
      if (result.errors.length) console.error('[embeddings-builder] errors:', result.errors);
    }));
  },
};
