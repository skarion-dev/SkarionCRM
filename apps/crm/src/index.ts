import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getDb, withAudit } from '@skarion/db-kit';
import { requireAuth, requireSuperadmin, type AuthedVariables } from '@skarion/auth-client';
import { can, canList } from '@skarion/permissions';
import { parseContactsCsv, parseCompaniesCsv, parseLeadsCsv } from '@skarion/importers';
import * as schema from './db/schema.js';
import { eq, and, isNull, like, sql, desc, asc, or } from 'drizzle-orm';
import type { CrmDb } from './db/types.js';

// --- Rate Limiting (per-Worker instance, in-memory) ---
// For production scale, replace with Cloudflare KV or Durable Objects.
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimits = new Map<string, RateLimitEntry>();

function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (entry.count >= maxRequests) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count++;
  return { allowed: true };
}

import * as ai from './lib/ai-service.js';
import * as docConv from './lib/document-converter.js';
import { cleanMarkdownForAi, estimateTokens } from './lib/markdown-utils.js';

// --- Outreach status summary ---
// Ranks a lead's channel stages and maps the "best" one back to the legacy
// leads.outreachStatus value that the UI tabs depend on.

const LEAD_CHANNEL_STAGE_RANK: Record<string, number> = {
  not_started: 0,
  warm_up_needed: 1,
  connection_request_sent: 2,
  connection_accepted: 3,
  message_sent: 4,
  awaiting_reply: 5,
  in_conversation: 6,
  replied: 7,
  booked_call: 8,
  no_response: -1,
};

const STAGE_TO_OUTREACH_STATUS: Record<string, string> = {
  not_started: 'not_approached',
  warm_up_needed: 'not_approached',
  connection_request_sent: 'approached',
  connection_accepted: 'approached',
  message_sent: 'approached',
  awaiting_reply: 'approached',
  in_conversation: 'connected',
  replied: 'replied',
  booked_call: 'booked_call',
  no_response: 'not_interested',
};

/**
 * Compute the best (highest-ranked non-`no_response`) stage across a lead's
 * channels and map it to a legacy `outreachStatus` value. If every channel is
 * `no_response`, returns `not_interested`.
 */
export function computeOutreachSummary(channels: { stage: string }[]): string {
  if (channels.length === 0) return 'not_approached';
  let bestStage: string | null = null;
  let bestRank = -Infinity;
  let allNoResponse = true;
  for (const ch of channels) {
    if (ch.stage !== 'no_response') allNoResponse = false;
    if (ch.stage === 'no_response') continue;
    const rank = LEAD_CHANNEL_STAGE_RANK[ch.stage] ?? -1;
    if (rank > bestRank) {
      bestRank = rank;
      bestStage = ch.stage;
    }
  }
  if (bestStage === null) {
    return allNoResponse ? 'not_interested' : 'not_approached';
  }
  return STAGE_TO_OUTREACH_STATUS[bestStage] ?? 'not_approached';
}
interface Env {
  DATABASE_URL: string;
  JWT_SECRET: string;
  APP_URL: string;
  RESEND_API_KEY?: string;
  WORKFLOW_RUNNER_URL?: string;
  AI_PROVIDER?: string;
  GOOGLE_API_KEY?: string;
  GOOGLE_MODEL?: string;
  GOOGLE_FALLBACK_MODEL?: string;
  GOOGLE_CHAT_MODEL?: string;
  GOOGLE_EMBEDDING_MODEL?: string;
  /** External document converter service (MarkItDown-based). Optional — falls back to local PDF text extractor if not set. */
  DOCUMENT_CONVERTER_URL?: string;
  /** Shared secret for converter auth. Optional — if not set, converter calls are unauthenticated (dev only). */
  DOCUMENT_CONVERTER_SECRET?: string;
  /** Max chars to send to AI from converted documents. Default 50000. */
  DOCUMENT_AI_MAX_CHARS?: string;
  /** Git branch name, set by deploy workflow. Optional for debug endpoints. */
  GIT_BRANCH?: string;
  /** Git commit SHA, set by deploy workflow. Optional for debug endpoints. */
  GIT_COMMIT_SHA?: string;
  /** Comma-separated list of allowed CORS origins. */
  ALLOWED_ORIGINS?: string;
  /** R2 bucket for lead attachments (resumes, screenshots, etc.). */
  ATTACHMENTS_BUCKET?: R2Bucket;
}

/** Send email via Resend API (if configured, otherwise log to console). */
async function sendEmail(env: Env, to: string, subject: string, html: string) {
  if (!env.RESEND_API_KEY) {
    console.log(`[EMAIL_STUB] to=${to} subject="${subject}" — not sent (Resend not configured)`);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({ from: 'Skarion CRM <noreply@skarion.com>', to, subject, html }),
    });
    if (!res.ok) {
      console.error('Resend email failed:', await res.text());
    } else {
      console.log(`[EMAIL_SENT] to=${to} subject="${subject}"`);
    }
  } catch (err) {
    console.error('Email send error:', err);
  }
}

/** Create a notification for a user. */
async function createNotification(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  userId: string,
  type: string,
  title: string,
  message: string,
  resourceType?: string,
  resourceId?: string
) {
  try {
    await db.insert(schema.notifications).values({
      userId,
      type,
      title,
      message,
      resourceType: resourceType ?? null,
      resourceId: resourceId ?? null,
    });
  } catch (err) {
    console.error('Notification creation failed:', err);
  }
}

/** Trigger workflow event evaluation (stub if WORKFLOW_RUNNER_URL not set). */
async function triggerWorkflowEvent(env: Env, trigger: string, payload: Record<string, unknown>) {
  if (!env.WORKFLOW_RUNNER_URL) {
    console.log(`[WORKFLOW_STUB] trigger=${trigger} payload=${JSON.stringify(payload)}`);
    return;
  }
  try {
    await fetch(`${env.WORKFLOW_RUNNER_URL}/evaluate-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger, payload }),
    });
  } catch (err) {
    console.error('Workflow event trigger failed:', err);
  }
}

function isAllowedOrigin(origin: string, appUrl: string, allowedOriginsEnv?: string): boolean {
  if (!origin) return false;
  if (origin === appUrl) return true;
  if (origin.endsWith('.skarion.com')) return true;
  // Allow known Cloudflare Pages/Workers origins (shared-domain stopgap until custom domains)
  const knownCloudflareOrigins = new Set([
    'https://skarion-crm-cv9.pages.dev',
    'https://skarion-identity-login-4hu.pages.dev',
    'https://skarion-identity-admin-dx5.pages.dev',
    'https://skarion-identity.skarion-talentos.workers.dev',
    'https://skarion-crm-platform.skarion-talentos.workers.dev',
  ]);
  if (knownCloudflareOrigins.has(origin)) return true;
  if (origin.startsWith('http://localhost:')) return true;
  if (allowedOriginsEnv) {
    const origins = allowedOriginsEnv.split(',').map((o) => o.trim());
    if (origins.includes(origin)) return true;
  }
  return false;
}

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

app.use(
  '*',
  cors({
    origin: (origin, c) =>
      isAllowedOrigin(origin, c.env.APP_URL, c.env.ALLOWED_ORIGINS) ? origin : '',
    credentials: true,
  })
);

app.use('*', async (c, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (origin && !isAllowedOrigin(origin, c.env.APP_URL, c.env.ALLOWED_ORIGINS)) {
      return c.json({ error: 'CSRF: Invalid origin.' }, 403);
    }
  }
  await next();
});

app.get('/health', (c) => c.json({ status: 'ok', service: 'skarion-crm-platform' }));

app.get('/api/debug/version', (c) => {
  const branch = c.env.GIT_BRANCH ?? 'cloudflare-platform-rewrite';
  const commit = c.env.GIT_COMMIT_SHA ?? 'unknown';
  return c.json({
    app: 'crm',
    branch,
    commit,
    deployedAt: new Date().toISOString(),
    environment: 'production',
  });
});

app.use('/api/*', requireAuth);
app.use('/api/admin/*', requireSuperadmin());

function getRole(c: unknown): string {
  const apps = (c as { get: (key: string) => unknown }).get('apps');
  return (apps as { crm?: string } | undefined)?.crm ?? '';
}

// --- COMPANIES ---

app.get('/api/companies', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { search, industry, owner } = c.req.query();
  const conditions = [isNull(schema.companies.deletedAt)];

  if (!isSuperadmin) {
    conditions.push(eq(schema.companies.ownerId, caller.userId));
  }
  if (search) {
    conditions.push(like(sql`lower(${schema.companies.name})`, `%${search.toLowerCase()}%`));
  }
  if (industry) conditions.push(eq(schema.companies.industry, industry));
  if (owner) conditions.push(eq(schema.companies.ownerId, owner));

  const rows = await db
    .select()
    .from(schema.companies)
    .where(and(...conditions))
    .orderBy(desc(schema.companies.updatedAt))
    .limit(100);

  return c.json({ companies: rows });
});

app.post('/api/companies', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const data = {
    name: body.name,
    domain: body.domain ?? null,
    industry: body.industry ?? null,
    size: body.size ?? null,
    address: body.address ?? null,
    ownerId: caller.userId,
  };

  const [result] = await db.insert(schema.companies).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'company',
    resourceId: result.id,
    after: data,
    app: 'crm',
  });

  // Auto-embed for RAG chatbot
  c.executionCtx.waitUntil(
    ai
      .autoEmbed(
        db,
        schema,
        'company',
        result.id,
        `${result.name} ${result.domain ?? ''} ${result.industry ?? ''} ${result.address ?? ''}`,
        caller.userId,
        c.env
      )
      .catch(() => {})
  );

  return c.json({ company: result }, 201);
});

app.get('/api/companies/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.id, id), isNull(schema.companies.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  return c.json({ company: row });
});

app.put('/api/companies/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.id, id), isNull(schema.companies.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.domain !== undefined) update.domain = body.domain;
  if (body.industry !== undefined) update.industry = body.industry;
  if (body.size !== undefined) update.size = body.size;
  if (body.address !== undefined) update.address = body.address;
  if (body.ownerId !== undefined && isSuperadmin) update.ownerId = body.ownerId;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.companies)
    .set(update)
    .where(eq(schema.companies.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'company',
    resourceId: id,
    before: existing,
    after: result,
    app: 'crm',
  });

  // Auto-embed for RAG chatbot
  c.executionCtx.waitUntil(
    ai
      .autoEmbed(
        db,
        schema,
        'company',
        result.id,
        `${result.name} ${result.domain ?? ''} ${result.industry ?? ''} ${result.address ?? ''}`,
        caller.userId,
        c.env
      )
      .catch(() => {})
  );

  return c.json({ company: result });
});

app.delete('/api/companies/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.id, id), isNull(schema.companies.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'delete', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db
    .update(schema.companies)
    .set({
      deletedAt: new Date(),
      deletedBy: caller.userId,
    })
    .where(eq(schema.companies.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'company',
    resourceId: id,
    before: existing,
    app: 'crm',
  });

  return c.json({ success: true });
});

// --- CONTACTS ---

app.get('/api/contacts', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { search, companyId, owner } = c.req.query();
  const conditions = [isNull(schema.contacts.deletedAt)];

  if (!isSuperadmin) {
    conditions.push(eq(schema.contacts.ownerId, caller.userId));
  }
  if (search) {
    conditions.push(like(sql`lower(${schema.contacts.email})`, `%${search.toLowerCase()}%`));
  }
  if (companyId) conditions.push(eq(schema.contacts.companyId, companyId));
  if (owner) conditions.push(eq(schema.contacts.ownerId, owner));

  const rows = await db
    .select()
    .from(schema.contacts)
    .where(and(...conditions))
    .orderBy(desc(schema.contacts.updatedAt))
    .limit(100);

  return c.json({ contacts: rows });
});

app.post('/api/contacts', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const data = {
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone ?? null,
    title: body.title ?? null,
    companyId: body.companyId ?? null,
    ownerId: caller.userId,
  };

  const [result] = await db.insert(schema.contacts).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'contact',
    resourceId: result.id,
    after: data,
    app: 'crm',
  });

  // Auto-embed for RAG chatbot
  c.executionCtx.waitUntil(
    ai
      .autoEmbed(
        db,
        schema,
        'contact',
        result.id,
        `${result.firstName} ${result.lastName} ${result.email} ${result.title ?? ''}`,
        caller.userId,
        c.env
      )
      .catch(() => {})
  );

  return c.json({ contact: result }, 201);
});

app.get('/api/contacts/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), isNull(schema.contacts.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  return c.json({ contact: row });
});

app.put('/api/contacts/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), isNull(schema.contacts.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.firstName !== undefined) update.firstName = body.firstName;
  if (body.lastName !== undefined) update.lastName = body.lastName;
  if (body.email !== undefined) update.email = body.email;
  if (body.phone !== undefined) update.phone = body.phone;
  if (body.title !== undefined) update.title = body.title;
  if (body.companyId !== undefined) update.companyId = body.companyId;
  if (body.ownerId !== undefined && isSuperadmin) update.ownerId = body.ownerId;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.contacts)
    .set(update)
    .where(eq(schema.contacts.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'contact',
    resourceId: id,
    before: existing,
    after: result,
    app: 'crm',
  });

  // Auto-embed for RAG chatbot
  c.executionCtx.waitUntil(
    ai
      .autoEmbed(
        db,
        schema,
        'contact',
        result.id,
        `${result.firstName} ${result.lastName} ${result.email} ${result.title ?? ''}`,
        caller.userId,
        c.env
      )
      .catch(() => {})
  );

  return c.json({ contact: result });
});

app.delete('/api/contacts/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), isNull(schema.contacts.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'delete', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db
    .update(schema.contacts)
    .set({
      deletedAt: new Date(),
      deletedBy: caller.userId,
    })
    .where(eq(schema.contacts.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'contact',
    resourceId: id,
    before: existing,
    app: 'crm',
  });

  return c.json({ success: true });
});

// --- LEADS ---

app.get('/api/leads', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  // Parse query params
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(c.req.query('pageSize') || '50', 10)));
  const { status, source, search, owner, outreachStatus, batchId, tag, include } = c.req.query();
  const sortBy = c.req.query('sortBy') || 'createdAt';
  const sortOrder = c.req.query('sortOrder') || 'desc';

  const conditions = [isNull(schema.leads.deletedAt)];

  if (!isSuperadmin) {
    conditions.push(eq(schema.leads.ownerId, caller.userId));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (status) conditions.push(eq(schema.leads.status, status as any));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (source) conditions.push(eq(schema.leads.source, source as any));
  if (owner) conditions.push(eq(schema.leads.ownerId, owner));
  if (outreachStatus) conditions.push(eq(schema.leads.outreachStatus, outreachStatus));
  if (batchId) conditions.push(eq(schema.leads.batchId, batchId));
  if (tag) conditions.push(sql`${schema.leads.tags} @> ${JSON.stringify([tag])}::jsonb`);

  // Search across name, email, company, linkedinUrl, leadNumber
  if (search) {
    const searchLower = search.toLowerCase();
    conditions.push(
      or(
        like(sql`lower(${schema.leads.email})`, `%${searchLower}%`),
        like(sql`lower(${schema.leads.firstName})`, `%${searchLower}%`),
        like(sql`lower(${schema.leads.lastName})`, `%${searchLower}%`),
        like(sql`lower(${schema.leads.companyName})`, `%${searchLower}%`),
        like(sql`lower(${schema.leads.linkedinUrl})`, `%${searchLower}%`),
        like(sql`lower(${schema.leads.leadNumber})`, `%${searchLower}%`)
      )!
    );
  }

  // Build orderBy dynamically
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const validSortColumns: Record<string, any> = {
    createdAt: schema.leads.createdAt,
    updatedAt: schema.leads.updatedAt,
    firstName: schema.leads.firstName,
    lastName: schema.leads.lastName,
    email: schema.leads.email,
    companyName: schema.leads.companyName,
    status: schema.leads.status,
    outreachStatus: schema.leads.outreachStatus,
    leadNumber: schema.leads.leadNumber,
  };
  const sortColumn = validSortColumns[sortBy] || schema.leads.createdAt;
  const orderByClause = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.leads)
    .where(and(...conditions));
  const total = countResult[0]?.count ?? 0;

  // Get paginated rows
  const rows = await db
    .select()
    .from(schema.leads)
    .where(and(...conditions))
    .orderBy(orderByClause)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Get status counts (for filters)
  const statusCountsRaw = await db
    .select({ status: schema.leads.status, count: sql<number>`count(*)` })
    .from(schema.leads)
    .where(
      and(
        isNull(schema.leads.deletedAt),
        ...(!isSuperadmin ? [eq(schema.leads.ownerId, caller.userId)] : [])
      )
    )
    .groupBy(schema.leads.status);

  const statusCounts = { new: 0, contacted: 0, qualified: 0, disqualified: 0, converted: 0 };
  statusCountsRaw.forEach((s) => {
    statusCounts[s.status as keyof typeof statusCounts] = s.count;
  });

  // Get outreach status counts (for filters)
  const outreachStatusCountsRaw = await db
    .select({ outreachStatus: schema.leads.outreachStatus, count: sql<number>`count(*)` })
    .from(schema.leads)
    .where(
      and(
        isNull(schema.leads.deletedAt),
        ...(!isSuperadmin ? [eq(schema.leads.ownerId, caller.userId)] : [])
      )
    )
    .groupBy(schema.leads.outreachStatus);

  const outreachStatusCounts = {
    not_approached: 0,
    approached: 0,
    connection_request_sent: 0,
    in_conversation: 0,
    connected: 0,
    replied: 0,
    booked_call: 0,
    not_interested: 0,
    bad_fit: 0,
  };
  outreachStatusCountsRaw.forEach((s) => {
    outreachStatusCounts[s.outreachStatus as keyof typeof outreachStatusCounts] = s.count;
  });

  // Optionally include channels for each lead (detail view)
  let leadsWithChannels: unknown[] = rows;
  if (include === 'channels' && rows.length > 0) {
    const leadIds = rows.map((r) => r.id);
    const allChannels = await db
      .select()
      .from(schema.leadChannels)
      .where(sql`${schema.leadChannels.leadId} = any(${leadIds}::uuid[])`)
      .orderBy(asc(schema.leadChannels.sequence));
    leadsWithChannels = rows.map((r) => ({
      ...r,
      channels: allChannels.filter((ch) => ch.leadId === r.id),
    }));
  }

  return c.json({
    leads: leadsWithChannels,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    statusCounts,
    outreachStatusCounts,
  });
});

app.post('/api/leads', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const data = {
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone ?? null,
    companyName: body.companyName ?? null,
    companyDomain: body.companyDomain ?? null,
    linkedinUrl: body.linkedinUrl ?? null,
    outreachStatus: body.outreachStatus ?? null,
    approachedAt: body.approachedAt ? new Date(body.approachedAt) : null,
    connectionStatus: body.connectionStatus ?? null,
    sourceSheet: body.sourceSheet ?? null,
    originalRowNumber: body.originalRowNumber ?? null,
    tags: body.tags ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    source: (body.source ?? 'other') as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: (body.status ?? 'new') as any,
    notes: body.notes ?? null,
    ownerId: caller.userId,
  };

  const [result] = await db.insert(schema.leads).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'lead',
    resourceId: result.id,
    after: data,
    app: 'crm',
  });

  // Auto-create lead_channels rows for the standard channels present on the lead
  c.executionCtx.waitUntil(autoCreateLeadChannels(db, result).catch(() => {}));

  // Trigger workflow event for lead_created rules
  c.executionCtx.waitUntil(
    triggerWorkflowEvent(c.env, 'lead_created', {
      id: result.id,
      source: result.source,
      ownerId: result.ownerId,
    })
  );

  // Basic email stub — will be wired to Resend in a future ticket
  sendEmail(c.env, result.email, 'New lead in Skarion CRM', 'Welcome to Skarion CRM');

  // Auto-embed for RAG chatbot
  c.executionCtx.waitUntil(
    ai
      .autoEmbed(
        db,
        schema,
        'lead',
        result.id,
        `${result.firstName} ${result.lastName} ${result.email} ${result.companyName ?? ''} ${result.notes ?? ''}`,
        caller.userId,
        c.env
      )
      .catch(() => {})
  );

  // Notification
  c.executionCtx.waitUntil(
    createNotification(
      db,
      schema,
      caller.userId,
      'lead_created',
      'New lead created',
      `${result.firstName} ${result.lastName} was added to the CRM.`,
      'lead',
      result.id
    ).catch(() => {})
  );

  return c.json({ lead: result }, 201);
});

function escapeCsv(val: unknown): string {
  const s = val === null || val === undefined ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

app.get('/api/leads/export.csv', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { status, source, search, outreachStatus } = c.req.query();

  const conditions = [isNull(schema.leads.deletedAt)];
  if (!isSuperadmin) conditions.push(eq(schema.leads.ownerId, caller.userId));
  if (status) conditions.push(eq(schema.leads.status, status as any)); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (source) conditions.push(eq(schema.leads.source, source as any)); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (outreachStatus) conditions.push(eq(schema.leads.outreachStatus, outreachStatus));

  if (search) {
    const searchLower = search.toLowerCase();
    conditions.push(
      or(
        like(sql`lower(${schema.leads.email})`, `%${searchLower}%`),
        like(sql`lower(${schema.leads.firstName})`, `%${searchLower}%`),
        like(sql`lower(${schema.leads.lastName})`, `%${searchLower}%`),
        like(sql`lower(${schema.leads.companyName})`, `%${searchLower}%`),
        like(sql`lower(${schema.leads.linkedinUrl})`, `%${searchLower}%`)
      )!
    );
  }

  const rows = await db
    .select()
    .from(schema.leads)
    .where(and(...conditions))
    .orderBy(desc(schema.leads.createdAt));

  const headers = [
    'firstName',
    'lastName',
    'email',
    'phone',
    'companyName',
    'companyDomain',
    'linkedinUrl',
    'status',
    'source',
    'outreachStatus',
    'approachedAt',
    'connectionStatus',
    'sourceSheet',
    'originalRowNumber',
    'notes',
    'createdAt',
    'updatedAt',
  ];

  let csv = headers.map(escapeCsv).join(',') + '\n';
  for (const row of rows) {
    csv +=
      [
        row.firstName,
        row.lastName,
        row.email,
        row.phone,
        row.companyName,
        row.companyDomain,
        row.linkedinUrl,
        row.status,
        row.source,
        row.outreachStatus,
        row.approachedAt ? new Date(row.approachedAt).toISOString() : '',
        row.connectionStatus,
        row.sourceSheet,
        row.originalRowNumber,
        row.notes,
        row.createdAt ? new Date(row.createdAt).toISOString() : '',
        row.updatedAt ? new Date(row.updatedAt).toISOString() : '',
      ]
        .map(escapeCsv)
        .join(',') + '\n';
  }

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="skarion-leads.csv"');

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'export',
    resourceType: 'leads',
    resourceId: 'bulk',
    after: { count: rows.length, filters: { status, source, search, outreachStatus } },
    app: 'crm',
  });

  return c.body(csv);
});

app.get('/api/leads/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  return c.json({ lead: row });
});

app.put('/api/leads/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.firstName !== undefined) update.firstName = body.firstName;
  if (body.lastName !== undefined) update.lastName = body.lastName;
  if (body.email !== undefined) update.email = body.email;
  if (body.phone !== undefined) update.phone = body.phone;
  if (body.companyName !== undefined) update.companyName = body.companyName;
  if (body.companyDomain !== undefined) update.companyDomain = body.companyDomain;
  if (body.linkedinUrl !== undefined) update.linkedinUrl = body.linkedinUrl;
  if (body.outreachStatus !== undefined) update.outreachStatus = body.outreachStatus;
  if (body.approachedAt !== undefined)
    update.approachedAt = body.approachedAt ? new Date(body.approachedAt) : null;
  if (body.connectionStatus !== undefined) update.connectionStatus = body.connectionStatus;
  if (body.sourceSheet !== undefined) update.sourceSheet = body.sourceSheet;
  if (body.originalRowNumber !== undefined) update.originalRowNumber = body.originalRowNumber;
  if (body.tags !== undefined) update.tags = body.tags;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (body.source !== undefined) update.source = body.source as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (body.status !== undefined) update.status = body.status as any;
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.ownerId !== undefined && isSuperadmin) update.ownerId = body.ownerId;
  // batchId is server-controlled; only superadmins may reassign it.
  if (body.batchId !== undefined && isSuperadmin) update.batchId = body.batchId;
  // leadNumber is server-controlled and never writable via PUT.
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.leads)
    .set(update)
    .where(eq(schema.leads.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'lead',
    resourceId: id,
    before: existing,
    after: result,
    app: 'crm',
  });

  // Auto-embed for RAG chatbot
  c.executionCtx.waitUntil(
    ai
      .autoEmbed(
        db,
        schema,
        'lead',
        result.id,
        `${result.firstName} ${result.lastName} ${result.email} ${result.companyName ?? ''} ${result.notes ?? ''}`,
        caller.userId,
        c.env
      )
      .catch(() => {})
  );

  return c.json({ lead: result });
});

app.delete('/api/leads/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'delete', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db
    .update(schema.leads)
    .set({
      deletedAt: new Date(),
      deletedBy: caller.userId,
    })
    .where(eq(schema.leads.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'lead',
    resourceId: id,
    before: existing,
    app: 'crm',
  });

  return c.json({ success: true });
});

// ─── LEAD CHANNELS / OUTREACH / ATTACHMENTS ─────────────────────────────────

const OUTREACH_CHANNELS = [
  'linkedin',
  'instagram',
  'facebook',
  'whatsapp',
  'email',
  'phone',
] as const;
const LEAD_CHANNEL_STAGES = [
  'not_started',
  'connection_request_sent',
  'connection_accepted',
  'message_sent',
  'awaiting_reply',
  'in_conversation',
  'warm_up_needed',
  'replied',
  'booked_call',
  'no_response',
] as const;
const CHANNEL_ACTIVITY_TYPE: Record<string, string> = {
  linkedin: 'linkedin_outreach',
  instagram: 'instagram_outreach',
  facebook: 'facebook_outreach',
  whatsapp: 'whatsapp_outreach',
  email: 'email',
  phone: 'phone_outreach',
};

/** Auto-create lead_channels rows for the standard channels present on a lead. */
async function autoCreateLeadChannels(
  db: CrmDb,
  lead: {
    id: string;
    ownerId: string;
    linkedinUrl: string | null;
    email: string;
    phone: string | null;
  }
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = [];
  if (lead.linkedinUrl) {
    rows.push({
      leadId: lead.id,
      channel: 'linkedin',
      stage: 'not_started',
      sequence: 1,
      ownerId: lead.ownerId,
    });
  }
  if (lead.email && !lead.email.includes('@placeholder.skarion')) {
    rows.push({
      leadId: lead.id,
      channel: 'email',
      stage: 'not_started',
      sequence: 2,
      ownerId: lead.ownerId,
    });
  }
  if (lead.phone) {
    rows.push({
      leadId: lead.id,
      channel: 'phone',
      stage: 'not_started',
      sequence: 3,
      ownerId: lead.ownerId,
    });
  }
  if (rows.length > 0) {
    await db.insert(schema.leadChannels).values(rows);
  }
}

/** Recompute and persist leads.outreachStatus from the lead's channels. */
async function recomputeLeadOutreachStatus(db: CrmDb, leadId: string): Promise<string> {
  const channels = await db
    .select({ stage: schema.leadChannels.stage })
    .from(schema.leadChannels)
    .where(eq(schema.leadChannels.leadId, leadId));
  const outreachStatus = computeOutreachSummary(channels.map((c) => ({ stage: c.stage })));
  await db
    .update(schema.leads)
    .set({ outreachStatus, updatedAt: new Date() })
    .where(eq(schema.leads.id, leadId));
  return outreachStatus;
}

app.post('/api/leads/:id/outreach-actions', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!lead) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const channel = body.channel as string;
  if (!channel || !OUTREACH_CHANNELS.includes(channel as (typeof OUTREACH_CHANNELS)[number])) {
    return c.json({ error: 'Invalid channel.' }, 400);
  }
  const action = body.action as 'log_attempt' | 'set_stage' | undefined;
  const stage = body.stage as string | undefined;

  // Find existing channel row
  const [existingChannel] = await db
    .select()
    .from(schema.leadChannels)
    .where(
      and(eq(schema.leadChannels.leadId, id), eq(schema.leadChannels.channel, channel as never))
    );

  let updatedRow: typeof schema.leadChannels.$inferSelect | null = null;
  let subject = '';

  if (action === 'log_attempt') {
    const now = new Date();
    if (existingChannel) {
      const [row] = await db
        .update(schema.leadChannels)
        .set({
          attemptCount: (existingChannel.attemptCount ?? 0) + 1,
          lastAttemptAt: now,
          updatedAt: now,
        })
        .where(eq(schema.leadChannels.id, existingChannel.id))
        .returning();
      updatedRow = row ?? null;
    } else {
      const maxSeqRows = await db
        .select({ seq: schema.leadChannels.sequence })
        .from(schema.leadChannels)
        .where(eq(schema.leadChannels.leadId, id));
      const maxSeq = maxSeqRows.reduce((m, r) => Math.max(m, r.seq), 0);
      const [row] = await db
        .insert(schema.leadChannels)
        .values({
          leadId: id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          channel: channel as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stage: (stage ?? 'message_sent') as any,
          sequence: maxSeq + 1,
          ownerId: lead.ownerId,
        })
        .returning();
      updatedRow = row ?? null;
    }
    subject = `Outreach logged on ${channel}`;
  } else {
    // set_stage (also trigger when stage provided without action)
    const finalStage = (stage ?? action === 'set_stage') ? stage : undefined;
    if (
      !finalStage ||
      !LEAD_CHANNEL_STAGES.includes(finalStage as (typeof LEAD_CHANNEL_STAGES)[number])
    ) {
      return c.json({ error: 'Invalid stage.' }, 400);
    }
    if (existingChannel) {
      const [row] = await db
        .update(schema.leadChannels)
        .set({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stage: finalStage as any,
          updatedAt: new Date(),
        })
        .where(eq(schema.leadChannels.id, existingChannel.id))
        .returning();
      updatedRow = row ?? null;
    } else {
      const maxSeqRows = await db
        .select({ seq: schema.leadChannels.sequence })
        .from(schema.leadChannels)
        .where(eq(schema.leadChannels.leadId, id));
      const maxSeq = maxSeqRows.reduce((m, r) => Math.max(m, r.seq), 0);
      const [row] = await db
        .insert(schema.leadChannels)
        .values({
          leadId: id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          channel: channel as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stage: finalStage as any,
          sequence: maxSeq + 1,
          ownerId: lead.ownerId,
        })
        .returning();
      updatedRow = row ?? null;
    }
    subject = `Stage set to ${finalStage}`;
  }

  if (!updatedRow) return c.json({ error: 'Internal error' }, 500);

  // Recompute leads.outreachStatus from all channels
  const outreachStatus = await recomputeLeadOutreachStatus(db, id);

  // Activity row referencing the lead via content JSON (no leadId FK on activities)
  await db.insert(schema.activities).values({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type: (CHANNEL_ACTIVITY_TYPE[channel] ?? 'note') as any,
    subject,
    content: JSON.stringify({ leadId: id }),
    contactId: null,
    companyId: null,
    opportunityId: null,
    actorId: caller.userId,
    happenedAt: new Date(),
  });

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'lead_channel',
    resourceId: updatedRow.id,
    before: existingChannel ?? null,
    after: updatedRow,
    app: 'crm',
  });

  return c.json({ channel: updatedRow, lead: { outreachStatus } });
});

app.get('/api/leads/:id/channels', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!lead) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const channels = await db
    .select()
    .from(schema.leadChannels)
    .where(eq(schema.leadChannels.leadId, id))
    .orderBy(asc(schema.leadChannels.sequence));
  return c.json({ channels });
});

app.get('/api/leads/:id/attachments', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!lead) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const attachments = await db
    .select()
    .from(schema.leadAttachments)
    .where(eq(schema.leadAttachments.leadId, id))
    .orderBy(desc(schema.leadAttachments.createdAt));
  return c.json({ attachments });
});

app.post('/api/leads/:id/attachments', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!lead) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const formData = await c.req.formData();
  const rawFile = formData.get('file');
  if (typeof rawFile === 'string' || rawFile === null) {
    return c.json({ error: "Missing 'file' field." }, 400);
  }
  const file = rawFile as {
    name: string;
    type: string;
    size: number;
    arrayBuffer: () => Promise<ArrayBuffer>;
  };
  const maxBytes = 25 * 1024 * 1024;
  if (file.size > maxBytes) {
    return c.json({ error: 'File too large (max 25MB).' }, 413);
  }

  const filename = file.name || 'attachment';
  const mimeType = file.type || 'application/octet-stream';
  const r2Key = `${id}/${crypto.randomUUID()}/${filename}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const bucket = c.env.ATTACHMENTS_BUCKET;
  if (bucket) {
    await bucket.put(r2Key, bytes, { httpMetadata: { contentType: mimeType } });
  } else {
    console.warn(`[ATTACHMENTS] R2 binding not available; metadata-only insert for ${r2Key}`);
  }

  const [attachment] = await db
    .insert(schema.leadAttachments)
    .values({
      leadId: id,
      filename,
      mimeType,
      size: file.size,
      r2Key,
      uploadedBy: caller.userId,
    })
    .returning();
  if (!attachment) return c.json({ error: 'Internal error' }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'lead_attachment',
    resourceId: attachment.id,
    after: attachment,
    app: 'crm',
  });

  return c.json({ attachment }, 201);
});

app.get('/api/leads/attachments/:id/download', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [attachment] = await db
    .select()
    .from(schema.leadAttachments)
    .where(eq(schema.leadAttachments.id, id));
  if (!attachment) return c.json({ error: 'Not found.' }, 404);

  const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, attachment.leadId));
  if (!lead) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const bucket = c.env.ATTACHMENTS_BUCKET;
  if (!bucket) return c.json({ error: 'Attachment storage not configured.' }, 503);

  const r2Object = await bucket.get(attachment.r2Key);
  if (!r2Object || !r2Object.body) return c.json({ error: 'File not found in storage.' }, 404);

  return c.body(r2Object.body, 200, {
    'Content-Type': attachment.mimeType,
    'Content-Disposition': `attachment; filename="${attachment.filename.replace(/"/g, "'")}"`,
  });
});

app.delete('/api/leads/attachments/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [attachment] = await db
    .select()
    .from(schema.leadAttachments)
    .where(eq(schema.leadAttachments.id, id));
  if (!attachment) return c.json({ error: 'Not found.' }, 404);

  const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, attachment.leadId));
  if (!lead) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const bucket = c.env.ATTACHMENTS_BUCKET;
  if (bucket) {
    await bucket.delete(attachment.r2Key);
  }

  await db.delete(schema.leadAttachments).where(eq(schema.leadAttachments.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'lead_attachment',
    resourceId: id,
    before: attachment,
    app: 'crm',
  });

  return c.json({ success: true });
});

// ─── LEAD BULK ACTIONS ─────────────────────────────────────────────

app.post('/api/leads/bulk', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const body = await c.req.json();
  const ids = body.ids as string[];
  const action = body.action as
    | 'delete'
    | 'update_status'
    | 'update_outreach_status'
    | 'update_tags'
    | 'assign_owner';

  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: 'No IDs provided.' }, 400);
  }
  if (ids.length > 500) {
    return c.json({ error: 'Maximum 500 items per bulk action.' }, 413);
  }
  if (
    !['delete', 'update_status', 'update_outreach_status', 'update_tags', 'assign_owner'].includes(
      action
    )
  ) {
    return c.json({ error: 'Invalid action.' }, 400);
  }

  // update_tags requires manager or superadmin; assign_owner requires superadmin only.
  if (action === 'update_tags' && !isSuperadmin && role !== 'manager') {
    return c.json({ error: 'Forbidden. Manager role required to bulk-update tags.' }, 403);
  }
  if (action === 'assign_owner' && !isSuperadmin) {
    return c.json({ error: 'Forbidden. Superadmin role required to reassign owners.' }, 403);
  }

  // Rate limit: 10 bulk actions per minute per user
  const rl = checkRateLimit(`bulk:leads:${caller.userId}`, 10, 60000);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return c.json({ error: `Rate limit exceeded. Try again in ${rl.retryAfter} seconds.` }, 429);
  }

  // Verify all leads exist and caller has permission
  // Safe approach: fetch all accessible non-deleted leads, then filter by ID in JS
  const accessConditions = [isNull(schema.leads.deletedAt)];
  if (!isSuperadmin) {
    accessConditions.push(eq(schema.leads.ownerId, caller.userId));
  }
  const allAccessibleLeads = await db
    .select()
    .from(schema.leads)
    .where(and(...accessConditions));
  const allLeads = allAccessibleLeads.filter((l) => ids.includes(l.id));

  if (allLeads.length === 0) {
    return c.json({ error: 'No leads found.' }, 404);
  }

  const notFound = ids.filter((id) => !allLeads.find((l) => l.id === id));
  if (notFound.length > 0) {
    return c.json({ error: `Some leads not found: ${notFound.join(', ')}` }, 404);
  }

  for (const lead of allLeads) {
    if (
      !can(
        isSuperadmin,
        role,
        action === 'delete' ? 'delete' : 'edit',
        { ownerId: lead.ownerId },
        caller
      )
    ) {
      return c.json({ error: `Forbidden on lead ${lead.id}.` }, 403);
    }
  }

  let updatedCount = 0;
  let deletedCount = 0;

  if (action === 'delete') {
    const now = new Date();
    for (const lead of allLeads) {
      await db
        .update(schema.leads)
        .set({
          deletedAt: now,
          deletedBy: caller.userId,
        })
        .where(eq(schema.leads.id, lead.id));
      await withAudit(db, schema.auditLog, {
        actorUserId: caller.userId,
        action: 'delete',
        resourceType: 'lead',
        resourceId: lead.id,
        before: lead,
        app: 'crm',
      });
      deletedCount++;
    }
  } else if (action === 'update_status') {
    const status = body.status as string;
    if (!status) return c.json({ error: "Missing 'status' field." }, 400);
    const now = new Date();
    for (const lead of allLeads) {
      await db
        .update(schema.leads)
        .set({
          status: status as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          updatedAt: now,
        })
        .where(eq(schema.leads.id, lead.id));
      await withAudit(db, schema.auditLog, {
        actorUserId: caller.userId,
        action: 'edit',
        resourceType: 'lead',
        resourceId: lead.id,
        before: lead,
        after: { ...lead, status, updatedAt: now },
        app: 'crm',
      });
      updatedCount++;
    }
  } else if (action === 'update_outreach_status') {
    const outreachStatus = body.outreachStatus as string;
    if (!outreachStatus) return c.json({ error: "Missing 'outreachStatus' field." }, 400);
    const now = new Date();
    for (const lead of allLeads) {
      await db
        .update(schema.leads)
        .set({
          outreachStatus: outreachStatus as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          updatedAt: now,
        })
        .where(eq(schema.leads.id, lead.id));
      await withAudit(db, schema.auditLog, {
        actorUserId: caller.userId,
        action: 'edit',
        resourceType: 'lead',
        resourceId: lead.id,
        before: lead,
        after: { ...lead, outreachStatus, updatedAt: now },
        app: 'crm',
      });
      updatedCount++;
    }
  } else if (action === 'update_tags') {
    const tags = Array.isArray(body.tags) ? (body.tags as string[]) : [];
    const mode = body.mode === 'replace' ? 'replace' : 'merge';
    if (tags.length === 0) return c.json({ error: "Missing 'tags' field." }, 400);
    const now = new Date();
    for (const lead of allLeads) {
      let nextTags: string[];
      if (mode === 'replace') {
        nextTags = [...tags];
      } else {
        const existing = Array.isArray(lead.tags) ? (lead.tags as string[]) : [];
        nextTags = [...new Set([...existing, ...tags])];
      }
      await db
        .update(schema.leads)
        .set({
          tags: nextTags,
          updatedAt: now,
        })
        .where(eq(schema.leads.id, lead.id));
      await withAudit(db, schema.auditLog, {
        actorUserId: caller.userId,
        action: 'edit',
        resourceType: 'lead',
        resourceId: lead.id,
        before: lead,
        after: { ...lead, tags: nextTags, updatedAt: now },
        app: 'crm',
      });
      updatedCount++;
    }
  } else if (action === 'assign_owner') {
    const ownerId = body.ownerId as string;
    if (!ownerId) return c.json({ error: "Missing 'ownerId' field." }, 400);
    const now = new Date();
    for (const lead of allLeads) {
      await db
        .update(schema.leads)
        .set({
          ownerId,
          updatedAt: now,
        })
        .where(eq(schema.leads.id, lead.id));
      await withAudit(db, schema.auditLog, {
        actorUserId: caller.userId,
        action: 'reassign',
        resourceType: 'lead',
        resourceId: lead.id,
        before: lead,
        after: { ...lead, ownerId, updatedAt: now },
        app: 'crm',
      });
      updatedCount++;
    }
  }

  return c.json({
    success: true,
    action,
    processed: action === 'delete' ? deletedCount : updatedCount,
    total: ids.length,
  });
});

app.post('/api/leads/:id/convert', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!lead) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }
  if (lead.status === 'converted') {
    return c.json({ error: 'Lead already converted.' }, 400);
  }

  let companyId: string | null = null;
  if (lead.companyDomain) {
    const [existingCompany] = await db
      .select()
      .from(schema.companies)
      .where(
        and(
          eq(sql`lower(${schema.companies.domain})`, lead.companyDomain.toLowerCase()),
          isNull(schema.companies.deletedAt)
        )
      );
    if (existingCompany) {
      companyId = existingCompany.id;
    } else {
      const [newCompany] = await db
        .insert(schema.companies)
        .values({
          name: lead.companyName || lead.companyDomain,
          domain: lead.companyDomain,
          ownerId: caller.userId,
        })
        .returning();
      if (!newCompany) return c.json({ error: 'Internal error' }, 500);
      companyId = newCompany.id;
      await withAudit(db, schema.auditLog, {
        actorUserId: caller.userId,
        action: 'create',
        resourceType: 'company',
        resourceId: newCompany.id,
        after: newCompany,
        app: 'crm',
      });
    }
  }

  const [contact] = await db
    .insert(schema.contacts)
    .values({
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      companyId,
      ownerId: caller.userId,
    })
    .returning();
  if (!contact) return c.json({ error: 'Internal error' }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'contact',
    resourceId: contact.id,
    after: contact,
    app: 'crm',
  });

  const [updatedLead] = await db
    .update(schema.leads)
    .set({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      status: 'converted' as any,
      convertedToContactId: contact.id,
      convertedToCompanyId: companyId,
      convertedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.leads.id, id))
    .returning();
  if (!updatedLead) return c.json({ error: 'Internal error' }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'convert',
    resourceType: 'lead',
    resourceId: id,
    before: lead,
    after: updatedLead,
    app: 'crm',
  });

  return c.json({ lead: updatedLead, contact, companyId });
});

// --- OPPORTUNITIES ---

app.get('/api/opportunities', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { stage, search, owner } = c.req.query();
  const conditions = [isNull(schema.opportunities.deletedAt)];

  if (!isSuperadmin) {
    conditions.push(eq(schema.opportunities.ownerId, caller.userId));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (stage) conditions.push(eq(schema.opportunities.stage, stage as any));
  if (search) {
    conditions.push(like(sql`lower(${schema.opportunities.name})`, `%${search.toLowerCase()}%`));
  }
  if (owner) conditions.push(eq(schema.opportunities.ownerId, owner));

  const rows = await db
    .select()
    .from(schema.opportunities)
    .where(and(...conditions))
    .orderBy(desc(schema.opportunities.updatedAt))
    .limit(100);

  return c.json({ opportunities: rows });
});

app.post('/api/opportunities', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const data = {
    name: body.name,
    companyId: body.companyId ?? null,
    contactId: body.contactId ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stage: (body.stage ?? 'prospecting') as any,
    amount: body.amount ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    currency: (body.currency ?? 'USD') as any,
    expectedCloseDate: body.expectedCloseDate ?? null,
    probability: body.probability ?? null,
    notes: body.notes ?? null,
    ownerId: caller.userId,
  };

  const [result] = await db.insert(schema.opportunities).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'opportunity',
    resourceId: result.id,
    after: data,
    app: 'crm',
  });

  return c.json({ opportunity: result }, 201);
});

app.get('/api/opportunities/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.opportunities)
    .where(and(eq(schema.opportunities.id, id), isNull(schema.opportunities.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  return c.json({ opportunity: row });
});

app.put('/api/opportunities/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.opportunities)
    .where(and(eq(schema.opportunities.id, id), isNull(schema.opportunities.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.companyId !== undefined) update.companyId = body.companyId;
  if (body.contactId !== undefined) update.contactId = body.contactId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (body.stage !== undefined) update.stage = body.stage as any;
  if (body.amount !== undefined) update.amount = body.amount;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (body.currency !== undefined) update.currency = body.currency as any;
  if (body.expectedCloseDate !== undefined) update.expectedCloseDate = body.expectedCloseDate;
  if (body.probability !== undefined) update.probability = body.probability;
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.ownerId !== undefined && isSuperadmin) update.ownerId = body.ownerId;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.opportunities)
    .set(update)
    .where(eq(schema.opportunities.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'opportunity',
    resourceId: id,
    before: existing,
    after: result,
    app: 'crm',
  });

  // Email notification on stage change
  if (body.stage !== undefined && body.stage !== existing.stage) {
    sendEmail(
      c.env,
      caller.userId,
      `Opportunity stage changed: ${result.name} → ${result.stage}`,
      `Opportunity ${result.name} moved from ${existing.stage} to ${result.stage}`
    );
  }

  return c.json({ opportunity: result });
});

app.delete('/api/opportunities/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.opportunities)
    .where(and(eq(schema.opportunities.id, id), isNull(schema.opportunities.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'delete', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db
    .update(schema.opportunities)
    .set({
      deletedAt: new Date(),
      deletedBy: caller.userId,
    })
    .where(eq(schema.opportunities.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'opportunity',
    resourceId: id,
    before: existing,
    app: 'crm',
  });

  return c.json({ success: true });
});

// --- ACTIVITIES ---

app.get('/api/activities', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { contactId, companyId, opportunityId, type } = c.req.query();
  const conditions: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

  // If a specific parent resource is provided, verify the caller can access it
  if (companyId) {
    const [company] = await db
      .select()
      .from(schema.companies)
      .where(and(eq(schema.companies.id, companyId), isNull(schema.companies.deletedAt)));
    if (!company) return c.json({ error: 'Not found.' }, 404);
    if (!can(isSuperadmin, role, 'view', { ownerId: company.ownerId }, caller)) {
      return c.json({ error: 'Forbidden.' }, 403);
    }
    conditions.push(eq(schema.activities.companyId, companyId));
  }
  if (contactId) {
    const [contact] = await db
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.id, contactId), isNull(schema.contacts.deletedAt)));
    if (!contact) return c.json({ error: 'Not found.' }, 404);
    if (!can(isSuperadmin, role, 'view', { ownerId: contact.ownerId }, caller)) {
      return c.json({ error: 'Forbidden.' }, 403);
    }
    conditions.push(eq(schema.activities.contactId, contactId));
  }
  if (opportunityId) {
    const [opportunity] = await db
      .select()
      .from(schema.opportunities)
      .where(
        and(eq(schema.opportunities.id, opportunityId), isNull(schema.opportunities.deletedAt))
      );
    if (!opportunity) return c.json({ error: 'Not found.' }, 404);
    if (!can(isSuperadmin, role, 'view', { ownerId: opportunity.ownerId }, caller)) {
      return c.json({ error: 'Forbidden.' }, 403);
    }
    conditions.push(eq(schema.activities.opportunityId, opportunityId));
  }
  if (type) conditions.push(eq(schema.activities.type, type as any)); // eslint-disable-line @typescript-eslint/no-explicit-any

  if (conditions.length === 0) {
    return c.json(
      { error: 'Provide at least one filter: contactId, companyId, opportunityId, or type.' },
      400
    );
  }

  const rows = await db
    .select()
    .from(schema.activities)
    .where(and(...conditions))
    .orderBy(desc(schema.activities.happenedAt))
    .limit(100);

  return c.json({ activities: rows });
});

app.post('/api/activities', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const data = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type: body.type as any,
    subject: body.subject,
    content: body.content ?? null,
    contactId: body.contactId ?? null,
    companyId: body.companyId ?? null,
    opportunityId: body.opportunityId ?? null,
    actorId: caller.userId,
    happenedAt: body.happenedAt ? new Date(body.happenedAt) : new Date(),
  };

  const [result] = await db.insert(schema.activities).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'activity',
    resourceId: result.id,
    after: data,
    app: 'crm',
  });

  return c.json({ activity: result }, 201);
});

app.get('/api/activities/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId') };

  const [row] = await db.select().from(schema.activities).where(eq(schema.activities.id, id));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!isSuperadmin && row.actorId !== caller.userId) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  return c.json({ activity: row });
});

app.put('/api/activities/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId') };

  const [existing] = await db.select().from(schema.activities).where(eq(schema.activities.id, id));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!isSuperadmin && existing.actorId !== caller.userId) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (body.type !== undefined) update.type = body.type as any;
  if (body.subject !== undefined) update.subject = body.subject;
  if (body.content !== undefined) update.content = body.content;
  if (body.contactId !== undefined) update.contactId = body.contactId;
  if (body.companyId !== undefined) update.companyId = body.companyId;
  if (body.opportunityId !== undefined) update.opportunityId = body.opportunityId;
  if (body.happenedAt !== undefined) update.happenedAt = new Date(body.happenedAt);
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.activities)
    .set(update)
    .where(eq(schema.activities.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'activity',
    resourceId: id,
    before: existing,
    after: result,
    app: 'crm',
  });

  return c.json({ activity: result });
});

app.delete('/api/activities/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId') };

  const [existing] = await db.select().from(schema.activities).where(eq(schema.activities.id, id));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!isSuperadmin && existing.actorId !== caller.userId) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db.delete(schema.activities).where(eq(schema.activities.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'activity',
    resourceId: id,
    before: existing,
    app: 'crm',
  });

  return c.json({ success: true });
});

// --- TASKS ---

app.get('/api/tasks', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { assigneeId, contactId, companyId, opportunityId, completed, priority } = c.req.query();
  const conditions = [isNull(schema.tasks.deletedAt)];

  if (!isSuperadmin) {
    conditions.push(eq(schema.tasks.assigneeId, caller.userId));
  }
  if (assigneeId) conditions.push(eq(schema.tasks.assigneeId, assigneeId));
  if (contactId) conditions.push(eq(schema.tasks.contactId, contactId));
  if (companyId) conditions.push(eq(schema.tasks.companyId, companyId));
  if (opportunityId) conditions.push(eq(schema.tasks.opportunityId, opportunityId));
  if (priority) conditions.push(eq(schema.tasks.priority, priority));
  if (completed === 'true') conditions.push(sql`${schema.tasks.completedAt} IS NOT NULL`);
  if (completed === 'false') conditions.push(sql`${schema.tasks.completedAt} IS NULL`);

  const rows = await db
    .select()
    .from(schema.tasks)
    .where(and(...conditions))
    .orderBy(asc(schema.tasks.dueDate))
    .limit(100);

  return c.json({ tasks: rows });
});

app.post('/api/tasks', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const data = {
    title: body.title,
    description: body.description ?? null,
    dueDate: body.dueDate ? new Date(body.dueDate) : null,
    assigneeId: body.assigneeId ?? caller.userId,
    contactId: body.contactId ?? null,
    companyId: body.companyId ?? null,
    opportunityId: body.opportunityId ?? null,
    priority: body.priority ?? 'medium',
  };

  const [result] = await db.insert(schema.tasks).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'task',
    resourceId: result.id,
    after: data,
    app: 'crm',
  });

  // Email notification on task assignment
  if (result.assigneeId !== caller.userId) {
    sendEmail(
      c.env,
      result.assigneeId,
      `New task assigned: ${result.title}`,
      `You have been assigned a new task: ${result.title}`
    );
  }

  return c.json({ task: result }, 201);
});

app.get('/api/tasks/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.assigneeId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  return c.json({ task: row });
});

app.put('/api/tasks/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.assigneeId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.title !== undefined) update.title = body.title;
  if (body.description !== undefined) update.description = body.description;
  if (body.dueDate !== undefined) update.dueDate = body.dueDate ? new Date(body.dueDate) : null;
  if (body.assigneeId !== undefined) update.assigneeId = body.assigneeId;
  if (body.contactId !== undefined) update.contactId = body.contactId;
  if (body.companyId !== undefined) update.companyId = body.companyId;
  if (body.opportunityId !== undefined) update.opportunityId = body.opportunityId;
  if (body.priority !== undefined) update.priority = body.priority;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.tasks)
    .set(update)
    .where(eq(schema.tasks.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'task',
    resourceId: id,
    before: existing,
    after: result,
    app: 'crm',
  });

  return c.json({ task: result });
});

app.put('/api/tasks/:id/complete', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.assigneeId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const [result] = await db
    .update(schema.tasks)
    .set({
      completedAt: new Date(),
      completedBy: caller.userId,
      updatedAt: new Date(),
    })
    .where(eq(schema.tasks.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'complete',
    resourceType: 'task',
    resourceId: id,
    before: existing,
    after: result,
    app: 'crm',
  });

  return c.json({ task: result });
});

app.put('/api/tasks/:id/reopen', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.assigneeId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const [result] = await db
    .update(schema.tasks)
    .set({
      completedAt: null,
      completedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.tasks.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'reopen',
    resourceType: 'task',
    resourceId: id,
    before: existing,
    after: result,
    app: 'crm',
  });

  return c.json({ task: result });
});

app.delete('/api/tasks/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'delete', { ownerId: existing.assigneeId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db
    .update(schema.tasks)
    .set({
      deletedAt: new Date(),
      deletedBy: caller.userId,
    })
    .where(eq(schema.tasks.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'task',
    resourceId: id,
    before: existing,
    app: 'crm',
  });

  return c.json({ success: true });
});

// --- IMPORT ---

app.get('/api/import-batches', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const conditions = [];
  if (!isSuperadmin) {
    conditions.push(eq(schema.importBatches.importedByUserId, caller.userId));
  }

  const batches = await db
    .select()
    .from(schema.importBatches)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.importBatches.createdAt))
    .limit(50);

  return c.json({ batches });
});

app.post('/api/import/companies', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const csvText = body.csv;
  if (!csvText || typeof csvText !== 'string') {
    return c.json({ error: "Missing or invalid 'csv' field." }, 400);
  }

  const parsed = parseCompaniesCsv(csvText);
  const created: (typeof schema.companies.$inferInsert)[] = [];
  for (const row of parsed.success) {
    const [result] = await db
      .insert(schema.companies)
      .values({
        name: row.name,
        domain: row.domain ?? null,
        industry: row.industry ?? null,
        size: row.size ?? null,
        ownerId: caller.userId,
      })
      .returning();
    if (!result) return c.json({ error: 'Internal error' }, 500);
    created.push(result);
  }

  return c.json({ imported: created.length, errors: parsed.errors, duplicates: parsed.duplicates });
});

app.post('/api/import/contacts', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const csvText = body.csv;
  if (!csvText || typeof csvText !== 'string') {
    return c.json({ error: "Missing or invalid 'csv' field." }, 400);
  }

  const parsed = parseContactsCsv(csvText);
  const created: (typeof schema.contacts.$inferInsert)[] = [];
  for (const row of parsed.success) {
    let companyId: string | null = null;
    if (row.companyName) {
      const [company] = await db
        .select()
        .from(schema.companies)
        .where(
          and(
            like(sql`lower(${schema.companies.name})`, `%${row.companyName.toLowerCase()}%`),
            isNull(schema.companies.deletedAt)
          )
        );
      if (company) companyId = company.id;
    }
    const [result] = await db
      .insert(schema.contacts)
      .values({
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        phone: row.phone ?? null,
        title: row.title ?? null,
        companyId,
        ownerId: caller.userId,
      })
      .returning();
    if (!result) return c.json({ error: 'Internal error' }, 500);
    created.push(result);
  }

  return c.json({ imported: created.length, errors: parsed.errors, duplicates: parsed.duplicates });
});

app.post('/api/import/leads/preview', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  // Rate limit: 30 previews per minute per user
  const rl = checkRateLimit(`import:leads:preview:${caller.userId}`, 30, 60000);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return c.json({ error: `Rate limit exceeded. Try again in ${rl.retryAfter} seconds.` }, 429);
  }

  const body = await c.req.json();
  const csvText = body.csv;
  if (!csvText || typeof csvText !== 'string') {
    return c.json({ error: "Missing or invalid 'csv' field." }, 400);
  }
  const batchName = typeof body.batchName === 'string' ? body.batchName : '';
  const tags = Array.isArray(body.tags) ? (body.tags as string[]) : [];

  const parsed = parseLeadsCsv(csvText);
  if (parsed.success.length > 500) {
    return c.json({ error: 'CSV too large. Maximum 500 rows allowed per import.' }, 413);
  }
  // Check DB for existing duplicates (email, LinkedIn URL, and name+company)
  const enriched = await Promise.all(
    parsed.success.map(async (row) => {
      const conflicts: string[] = [];
      if (row.email && !row.email.includes('@placeholder.skarion')) {
        const existing = await db
          .select({ id: schema.leads.id })
          .from(schema.leads)
          .where(
            and(
              eq(sql`lower(${schema.leads.email})`, row.email.toLowerCase()),
              isNull(schema.leads.deletedAt)
            )
          )
          .limit(1);
        if (existing.length > 0) conflicts.push('email exists');
      }
      if (row.linkedinUrl) {
        const normalizedLi = row.linkedinUrl.toLowerCase().replace(/\/+$/, '');
        const existingLi = await db
          .select({ id: schema.leads.id })
          .from(schema.leads)
          .where(
            and(
              eq(sql`lower(${schema.leads.linkedinUrl})`, normalizedLi),
              isNull(schema.leads.deletedAt)
            )
          )
          .limit(1);
        if (existingLi.length > 0) conflicts.push('linkedin exists');
      }
      if (row.firstName && row.lastName && row.companyName) {
        const existingName = await db
          .select({ id: schema.leads.id })
          .from(schema.leads)
          .where(
            and(
              eq(sql`lower(${schema.leads.firstName})`, row.firstName.toLowerCase()),
              eq(sql`lower(${schema.leads.lastName})`, row.lastName.toLowerCase()),
              eq(sql`lower(${schema.leads.companyName})`, row.companyName.toLowerCase()),
              isNull(schema.leads.deletedAt)
            )
          )
          .limit(1);
        if (existingName.length > 0) conflicts.push('name+company exists');
      }
      return { ...row, conflicts, canImport: conflicts.length === 0 };
    })
  );

  const dbDuplicates = enriched.filter((r) => !r.canImport).length;
  const importable = enriched.filter((r) => r.canImport);

  return c.json({
    preview: importable.slice(0, 50),
    totalRows: parsed.success.length,
    importableCount: importable.length,
    dbDuplicates,
    errors: parsed.errors,
    duplicates: parsed.duplicates,
    warnings: parsed.warnings,
    allRows: enriched.slice(0, 100),
    // Echo back batch metadata for UI display (batch is not created on preview)
    batchName,
    tags,
  });
});

app.post('/api/import/leads', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  // Rate limit: 10 imports per minute per user, max 500 rows per CSV
  const rl = checkRateLimit(`import:leads:${caller.userId}`, 10, 60000);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return c.json({ error: `Rate limit exceeded. Try again in ${rl.retryAfter} seconds.` }, 429);
  }

  const body = await c.req.json();
  const csvText = body.csv;
  if (!csvText || typeof csvText !== 'string') {
    return c.json({ error: "Missing or invalid 'csv' field." }, 400);
  }
  const batchName = typeof body.batchName === 'string' ? body.batchName : '';
  const batchTags = Array.isArray(body.tags) ? (body.tags as string[]) : [];
  const assigneeId =
    typeof body.assigneeId === 'string' && body.assigneeId ? body.assigneeId : caller.userId;

  const parsed = parseLeadsCsv(csvText);
  if (parsed.success.length > 500) {
    return c.json({ error: 'CSV too large. Maximum 500 rows allowed per import.' }, 413);
  }

  // Insert the import_batches row first; counts are finalized after processing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const batchSource = (parsed.success[0]?.source ?? 'other') as any;
  const [batch] = await db
    .insert(schema.importBatches)
    .values({
      name: batchName || `Import ${new Date().toISOString()}`,
      importedByUserId: caller.userId,
      source: batchSource,
      totalRows: parsed.success.length,
      importedCount: 0,
      duplicatesSkipped: 0,
      defaultTags: batchTags.length > 0 ? batchTags : null,
    })
    .returning();
  if (!batch) return c.json({ error: 'Internal error' }, 500);

  const created: (typeof schema.leads.$inferInsert)[] = [];
  const dbDuplicates: { row: number; reason: string }[] = [];
  for (const row of parsed.success) {
    // 1. Dedup by email (skip placeholders)
    const [emailDup, linkedinDup, nameCompanyDup] = await Promise.all([
      row.email && !row.email.includes('@placeholder.skarion')
        ? db
            .select({ id: schema.leads.id })
            .from(schema.leads)
            .where(
              and(
                eq(sql`lower(${schema.leads.email})`, row.email.toLowerCase()),
                isNull(schema.leads.deletedAt)
              )
            )
            .limit(1)
        : Promise.resolve([]),
      row.linkedinUrl
        ? db
            .select({ id: schema.leads.id })
            .from(schema.leads)
            .where(
              and(
                eq(
                  sql`lower(${schema.leads.linkedinUrl})`,
                  row.linkedinUrl.toLowerCase().replace(/\/+$/, '')
                ),
                isNull(schema.leads.deletedAt)
              )
            )
            .limit(1)
        : Promise.resolve([]),
      row.firstName && row.lastName && row.companyName
        ? db
            .select({ id: schema.leads.id })
            .from(schema.leads)
            .where(
              and(
                eq(sql`lower(${schema.leads.firstName})`, row.firstName.toLowerCase()),
                eq(sql`lower(${schema.leads.lastName})`, row.lastName.toLowerCase()),
                eq(sql`lower(${schema.leads.companyName})`, row.companyName.toLowerCase()),
                isNull(schema.leads.deletedAt)
              )
            )
            .limit(1)
        : Promise.resolve([]),
    ]);

    if (emailDup.length > 0) {
      dbDuplicates.push({
        row: row.originalRowNumber ?? 0,
        reason: `Email already exists: ${row.email}`,
      });
      continue;
    }
    if (linkedinDup.length > 0) {
      dbDuplicates.push({
        row: row.originalRowNumber ?? 0,
        reason: `LinkedIn already exists: ${row.linkedinUrl}`,
      });
      continue;
    }
    if (nameCompanyDup.length > 0) {
      dbDuplicates.push({
        row: row.originalRowNumber ?? 0,
        reason: `Name + company already exists: ${row.firstName} ${row.lastName} @ ${row.companyName}`,
      });
      continue;
    }

    const rowTags = Array.isArray(row.tags) ? row.tags : [];
    const finalTags = [...batchTags, ...rowTags];
    const [result] = await db
      .insert(schema.leads)
      .values({
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        phone: row.phone ?? null,
        companyName: row.companyName ?? null,
        companyDomain: row.companyDomain ?? null,
        linkedinUrl: row.linkedinUrl ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        source: (row.source ?? 'other') as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        status: (row.status ?? 'new') as any,
        notes: row.notes ?? null,
        outreachStatus: row.outreachStatus ?? 'not_approached',
        approachedAt: row.approachedAt ? new Date(row.approachedAt) : null,
        connectionStatus: row.connectionStatus ?? null,
        sourceSheet: row.sourceSheet ?? null,
        originalRowNumber: row.originalRowNumber ?? null,
        tags: finalTags.length > 0 ? finalTags : null,
        ownerId: assigneeId,
        batchId: batch.id,
      })
      .returning();
    if (!result) return c.json({ error: 'Internal error' }, 500);
    created.push(result);

    // Auto-create lead_channels rows for the standard channels present on the lead
    await autoCreateLeadChannels(db, result);
  }

  // Finalize batch counts
  await db
    .update(schema.importBatches)
    .set({
      importedCount: created.length,
      duplicatesSkipped: dbDuplicates.length,
    })
    .where(eq(schema.importBatches.id, batch.id));

  return c.json({
    imported: created.length,
    errors: parsed.errors,
    duplicates: [...parsed.duplicates, ...dbDuplicates],
    warnings: parsed.warnings,
    batchId: batch.id,
  });
});

// --- ADMIN ---

app.get('/api/admin/audit-log', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const rows = await db
    .select()
    .from(schema.auditLog)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(200);
  return c.json({ auditLog: rows });
});

// --- WORKFLOW RULES ---

app.get('/api/workflow-rules', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  if (!role) return c.json({ error: 'Forbidden.' }, 403);
  // Only managers and superadmins can view workflow rules
  if (!isSuperadmin && role !== 'manager') {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const rows = await db
    .select()
    .from(schema.workflowRules)
    .orderBy(desc(schema.workflowRules.updatedAt))
    .limit(100);
  return c.json({ workflowRules: rows });
});

app.post('/api/workflow-rules', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const data = {
    name: body.name,
    trigger: body.trigger,
    conditions: body.conditions ?? {},
    actions: body.actions ?? {},
    enabled: body.enabled ?? true,
  };

  const [result] = await db.insert(schema.workflowRules).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  return c.json({ workflowRule: result }, 201);
});

app.put('/api/workflow-rules/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.workflowRules)
    .where(eq(schema.workflowRules.id, id));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (body.trigger !== undefined) update.trigger = body.trigger as any;
  if (body.conditions !== undefined) update.conditions = body.conditions;
  if (body.actions !== undefined) update.actions = body.actions;
  if (body.enabled !== undefined) update.enabled = body.enabled;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.workflowRules)
    .set(update)
    .where(eq(schema.workflowRules.id, id))
    .returning();
  return c.json({ workflowRule: result });
});

app.delete('/api/workflow-rules/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.workflowRules)
    .where(eq(schema.workflowRules.id, id));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'delete', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db.delete(schema.workflowRules).where(eq(schema.workflowRules.id, id));
  return c.json({ success: true });
});

// --- INTEGRATIONS ---

app.get('/api/integrations', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  if (!role) return c.json({ error: 'Forbidden.' }, 403);
  // Only managers and superadmins can view integrations
  if (!isSuperadmin && role !== 'manager') {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const rows = await db
    .select()
    .from(schema.integrationConfigs)
    .orderBy(desc(schema.integrationConfigs.updatedAt));
  return c.json({ integrations: rows });
});

app.post('/api/integrations', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const isSuperadmin = c.get('isSuperadmin');
  if (!isSuperadmin) return c.json({ error: 'Forbidden.' }, 403);

  const body = await c.req.json();
  const data = {
    provider: body.provider,
    label: body.label,
    status: body.status ?? 'disconnected',
    settings: body.settings ?? {},
  };

  const [result] = await db.insert(schema.integrationConfigs).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  return c.json({ integration: result }, 201);
});

app.put('/api/integrations/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const isSuperadmin = c.get('isSuperadmin');
  if (!isSuperadmin) return c.json({ error: 'Forbidden.' }, 403);

  const [existing] = await db
    .select()
    .from(schema.integrationConfigs)
    .where(eq(schema.integrationConfigs.id, id));
  if (!existing) return c.json({ error: 'Not found.' }, 404);

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.label !== undefined) update.label = body.label;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (body.status !== undefined) update.status = body.status as any;
  if (body.settings !== undefined) update.settings = body.settings;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.integrationConfigs)
    .set(update)
    .where(eq(schema.integrationConfigs.id, id))
    .returning();
  return c.json({ integration: result });
});

app.delete('/api/integrations/:id', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const isSuperadmin = c.get('isSuperadmin');
  if (!isSuperadmin) return c.json({ error: 'Forbidden.' }, 403);

  await db.delete(schema.integrationConfigs).where(eq(schema.integrationConfigs.id, id));
  return c.json({ success: true });
});

// ─── CHAT ────────────────────────────────────────────────────────────────

app.get('/api/chat/history', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const userId = c.get('userId');
  const rows = await db
    .select()
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.userId, userId))
    .orderBy(asc(schema.chatMessages.createdAt))
    .limit(100);
  return c.json({ messages: rows });
});

app.post('/api/chat', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const userId = c.get('userId');
  const isSuperadmin = c.get('isSuperadmin') ?? false;
  const role = c.get('apps')?.crm ?? 'member';

  const body = await c.req.json();
  const message = body.message?.trim();
  if (!message) return c.json({ error: 'Message is required.' }, 400);

  // 1. Embed the user's question
  const queryEmbedding = await ai.getEmbedding(message, c.env);

  // 2. Retrieve all candidate embeddings
  const allEmbeddings = await db.select().from(schema.embeddings);

  // 3. Score by similarity and filter by permission using canList()
  const scored = allEmbeddings
    .map((e) => ({
      ...e,
      score:
        queryEmbedding && Array.isArray(e.embedding)
          ? ai.cosineSimilarity(queryEmbedding, e.embedding as number[])
          : 0,
    }))
    .filter((e) => canList(isSuperadmin, role, { userId: userId, isSuperadmin }, e.ownerId))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // 4. Build context prompt
  const context = scored
    .map((e, i) => `\n[${i + 1}] ${e.resourceType} ${e.resourceId}:\n${e.content}`)
    .join('');
  const prompt = `Context:${context}\n\nUser question: ${message}`;

  // 5. Persist user message
  await db.insert(schema.chatMessages).values({
    userId,
    role: 'user',
    content: message,
  });

  // 6. Call LLM
  let answer = await ai.chatCompletionSingle(prompt, c.env);
  if (!answer) {
    answer = ai.AI_NOT_CONFIGURED_MSG;
  }

  // 7. Persist assistant response
  const contextIds = scored.map((e) => ({
    resourceType: e.resourceType,
    resourceId: e.resourceId,
  }));
  const [assistantMessage] = await db
    .insert(schema.chatMessages)
    .values({
      userId,
      role: 'assistant',
      content: answer,
      contextIds,
    })
    .returning();

  return c.json({ answer, context: scored, message: assistantMessage });
});

// ─── AI SUMMARY / OUTREACH / SCORE ─────────────────────────────────────────

app.post('/api/leads/:id/summarize', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const summary = await ai.summarizeLead(row, c.env);
  if (!summary) return c.json({ error: ai.AI_NOT_CONFIGURED_MSG }, 503);
  return c.json({ summary });
});

app.post('/api/leads/:id/outreach', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const draft = await ai.draftOutreach(
    {
      leadType: row.source ?? 'other',
      leadSource: row.source ?? 'other',
      firstName: row.firstName,
      lastName: row.lastName,
      companyName: row.companyName,
      title: null,
      notes: row.notes,
      pdfSummary: null,
      tone: body.tone ?? 'professional',
      channel: body.channel ?? 'email',
    },
    c.env
  );
  if (!draft) return c.json({ error: ai.AI_NOT_CONFIGURED_MSG }, 503);

  // Save as activity
  await db.insert(schema.activities).values({
    type: 'note',
    subject: `AI outreach draft (${body.channel ?? 'email'})`,
    content: draft,
    contactId: null,
    companyId: null,
    opportunityId: null,
    actorId: caller.userId,
    happenedAt: new Date(),
  });

  return c.json({ draft });
});

app.post('/api/leads/:id/score', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const result = await ai.scoreLead(row, c.env);
  if (!result) return c.json({ error: ai.AI_NOT_CONFIGURED_MSG }, 503);
  return c.json(result);
});

app.post('/api/leads/:id/suggest-next-action', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const suggestion = await ai.suggestNextAction(row, c.env);
  if (!suggestion) return c.json({ error: ai.AI_NOT_CONFIGURED_MSG }, 503);
  return c.json({ suggestion });
});

app.post('/api/companies/:id/summarize', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.id, id), isNull(schema.companies.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const summary = await ai.summarizeCompany(row, c.env);
  if (!summary) return c.json({ error: ai.AI_NOT_CONFIGURED_MSG }, 503);
  return c.json({ summary });
});

app.post('/api/contacts/:id/summarize', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), isNull(schema.contacts.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const [company] = row.companyId
    ? await db.select().from(schema.companies).where(eq(schema.companies.id, row.companyId))
    : [null];

  const summary = await ai.summarizeContact(
    {
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      title: row.title,
      companyName: company?.name ?? null,
    },
    c.env
  );
  if (!summary) return c.json({ error: ai.AI_NOT_CONFIGURED_MSG }, 503);
  return c.json({ summary });
});

// ─── PDF LEAD IMPORT ───────────────────────────────────────────────────────

app.post('/api/leads/import/document', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.parseBody();
  const file = body['file'] as File | undefined;
  const leadType = (body['leadType'] as string) ?? 'other';

  if (!file) return c.json({ error: 'Missing file.' }, 400);
  if (file.size > 10 * 1024 * 1024) return c.json({ error: 'File too large. Max 10MB.' }, 400);

  // Expanded MIME type support: PDF, DOCX, PPTX, XLSX, CSV, TXT
  const allowedTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
  ];
  const isPdf = file.type === 'application/pdf';
  const isKnownType = allowedTypes.includes(file.type);
  if (!isKnownType && !isPdf) {
    return c.json(
      { error: `Unsupported file type: ${file.type}. Allowed: PDF, DOCX, PPTX, XLSX, CSV, TXT.` },
      415
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // ── Step 1: Try external document converter (MarkItDown) ────────────────
  let rawText = '';
  let markdownPreview = '';
  let conversionWarnings: string[] = [];
  let estimatedTokens = 0;
  let usedFallback = false;
  let fallbackReason = '';
  let charCount = 0;
  let fileHash = '';

  const convResult = await docConv.convertDocument(bytes, file.name, file.type, c.env, leadType);

  if ('usedFallback' in convResult && convResult.usedFallback) {
    // ── Fallback: local text extraction ───────────────────────────────────
    usedFallback = true;
    fallbackReason = convResult.fallbackReason;

    if (isPdf) {
      rawText = extractTextFromPdf(bytes);
      if (!rawText || rawText.trim().length === 0) {
        return c.json(
          {
            error:
              'No selectable text found in PDF. OCR is not implemented yet. Please upload a text-based PDF.',
          },
          422
        );
      }
    } else if (
      file.type === 'text/plain' ||
      file.type === 'text/csv' ||
      file.name.endsWith('.txt') ||
      file.name.endsWith('.csv')
    ) {
      rawText = extractTextFromPlainText(bytes);
      if (!rawText || rawText.trim().length === 0) {
        return c.json({ error: 'No text found in file. The file may be empty or binary.' }, 422);
      }
    } else {
      return c.json(
        {
          error: `Document converter not available for ${file.type}. Supported without converter: PDF, TXT, CSV.`,
        },
        503
      );
    }
  } else {
    // ── Converter succeeded ──────────────────────────────────────────────
    const result = convResult as docConv.ConverterResult;
    rawText = result.markdown;
    markdownPreview = result.markdownPreview;
    conversionWarnings = result.warnings;
    estimatedTokens = result.estimatedTokens;
    charCount = result.charCount;
    fileHash = result.sha256;
  }

  // Clean markdown for AI (strip base64, cap length, etc.)
  const maxChars = parseInt(c.env.DOCUMENT_AI_MAX_CHARS ?? '50000', 10);
  const cleanedText = cleanMarkdownForAi(rawText, maxChars);

  // ── Step 2: Regex extraction ──────────────────────────────────────────
  const regexResult = regexExtractFromText(cleanedText);

  // ── Step 3: AI extraction ─────────────────────────────────────────────
  let aiResult: ai.ExtractedLeadDraft | null = null;
  if (c.env.GOOGLE_API_KEY) {
    aiResult = await ai.extractLeadFromPdfText(cleanedText, leadType, c.env);
  }

  // Merge regex + AI results
  const draftLead = mergeExtractionResults(regexResult, aiResult, leadType, cleanedText);

  // ── Step 4: Store document import record ──────────────────────────────
  if (!fileHash) {
    // Compute hash locally using Web Crypto API (Cloudflare Workers compatible)
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    fileHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  await db.insert(schema.documentImports).values({
    fileHash,
    originalFilename: file.name,
    mimeType: file.type,
    source: 'pdf_upload',
    markdownPreview: markdownPreview || cleanedText.substring(0, 2000),
    conversionStatus: usedFallback ? 'failed' : 'converted',
    conversionWarnings: conversionWarnings.length > 0 ? conversionWarnings : null,
    estimatedTokens: estimatedTokens || estimateTokens(cleanedText.length),
    charCount: charCount || cleanedText.length,
    usedFallback,
    fallbackReason: fallbackReason || null,
    ownerId: caller.userId,
  });

  // ── Step 5: Duplicate check ───────────────────────────────────────────
  const duplicates: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  }[] = [];
  if (draftLead.email) {
    const byEmail = await db
      .select()
      .from(schema.leads)
      .where(
        and(eq(schema.leads.email, draftLead.email.toLowerCase()), isNull(schema.leads.deletedAt))
      );
    for (const d of byEmail) duplicates.push(d);
  }
  if (draftLead.phone) {
    const byPhone = await db
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.phone, draftLead.phone), isNull(schema.contacts.deletedAt)));
    for (const d of byPhone)
      duplicates.push({
        id: d.id,
        firstName: d.firstName,
        lastName: d.lastName,
        email: d.email,
        phone: d.phone,
      });
  }

  return c.json({
    draftLead,
    duplicates: duplicates.slice(0, 5),
    rawTextPreview: cleanedText.substring(0, 2000),
    markdownPreview: markdownPreview || cleanedText.substring(0, 2000),
    conversionWarnings,
    estimatedTokens: estimatedTokens || estimateTokens(cleanedText.length),
    charCount: charCount || cleanedText.length,
    usedFallback,
    fallbackReason: fallbackReason || null,
  });
});

// Keep old route as alias for backward compatibility
app.post('/api/leads/import/pdf', async (c) => {
  return c.json({ error: 'Please use /api/leads/import/document instead.' }, 301);
});

app.post('/api/leads/import/document/confirm', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const leadData = body.lead;
  if (!leadData || !leadData.email || !leadData.firstName) {
    return c.json({ error: 'Missing required lead data (email, firstName).' }, 400);
  }

  // Check for duplicate by email
  const [existing] = await db
    .select()
    .from(schema.leads)
    .where(
      and(eq(schema.leads.email, leadData.email.toLowerCase()), isNull(schema.leads.deletedAt))
    );
  if (existing && !body.force) {
    return c.json(
      {
        error: 'Duplicate lead found.',
        existing: existing,
        hint: 'Use force=true to create anyway.',
      },
      409
    );
  }

  // Create or attach company if companyName provided
  let companyId: string | null = null;
  if (leadData.companyName) {
    const [existingCompany] = await db
      .select()
      .from(schema.companies)
      .where(
        and(
          like(sql`lower(${schema.companies.name})`, `%${leadData.companyName.toLowerCase()}%`),
          isNull(schema.companies.deletedAt)
        )
      );
    if (existingCompany) {
      companyId = existingCompany.id;
    } else if (body.createCompany !== false) {
      const [newCompany] = await db
        .insert(schema.companies)
        .values({
          name: leadData.companyName,
          domain: leadData.website ?? null,
          ownerId: caller.userId,
        })
        .returning();
      if (newCompany) companyId = newCompany.id;
    }
  }

  // Create contact if requested
  let contactId: string | null = null;
  if (body.createContact !== false) {
    const [contact] = await db
      .insert(schema.contacts)
      .values({
        firstName: leadData.firstName,
        lastName: leadData.lastName,
        email: leadData.email.toLowerCase(),
        phone: leadData.phone ?? null,
        title: leadData.title ?? null,
        companyId,
        ownerId: caller.userId,
      })
      .returning();
    if (contact) contactId = contact.id;
  }

  // Create lead
  const [lead] = await db
    .insert(schema.leads)
    .values({
      firstName: leadData.firstName,
      lastName: leadData.lastName,
      email: leadData.email.toLowerCase(),
      phone: leadData.phone ?? null,
      companyName: leadData.companyName ?? null,
      companyDomain: leadData.website ?? null,
      source: leadData.source ?? 'pdf_upload',
      status: leadData.status ?? 'new',
      notes: leadData.notes ?? null,
      ownerId: caller.userId,
    })
    .returning();
  if (!lead) return c.json({ error: 'Internal error' }, 500);

  // Link the most recent pending document import for this user to the new lead
  // Using raw SQL because Drizzle update builder doesn't support orderBy + limit in one chain
  await db.execute(sql`
    UPDATE crm.document_imports
    SET lead_id = ${lead.id}, conversion_status = 'linked'
    WHERE id = (
      SELECT id FROM crm.document_imports
      WHERE owner_id = ${caller.userId}
        AND conversion_status = 'converted'
        AND lead_id IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    )
  `);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'lead',
    resourceId: lead.id,
    after: lead,
    app: 'crm',
  });

  return c.json({ lead, contactId, companyId }, 201);
});

// Keep old route as alias for backward compatibility
app.post('/api/leads/import/pdf/confirm', async (c) => {
  return c.json({ error: 'Please use /api/leads/import/document/confirm instead.' }, 301);
});

// ─── PDF TEXT EXTRACTION HELPERS ───────────────────────────────────────────

function extractTextFromPdf(bytes: Uint8Array): string {
  // Simple PDF text extraction: look for text between BT and ET operators,
  // and Tj/TJ text show operators. This is a basic heuristic, not a full parser.
  const decoder = new TextDecoder('utf-8');
  let text = '';

  // Try UTF-8 first
  try {
    text = decoder.decode(bytes);
  } catch {
    /* ignore */
  }
  if (!text) text = String.fromCharCode(...bytes);

  // Extract text from common PDF patterns
  const textMatches: string[] = [];
  const tjRegex = /\(([\x20-\x7E\s]+)\)\s*Tj/g;
  let m;
  while ((m = tjRegex.exec(text)) !== null) {
    textMatches.push(m[1]!);
  }

  // Also extract between stream ... endstream
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  while ((m = streamRegex.exec(text)) !== null) {
    const stream = m[1]!;
    // Look for text in streams
    const streamTj = /\(([\x20-\x7E\s]+)\)/g;
    let sm;
    while ((sm = streamTj.exec(stream)) !== null) {
      textMatches.push(sm[1]!);
    }
  }

  if (textMatches.length > 0) {
    return textMatches.join(' ');
  }

  // Fallback: return all printable ASCII text
  return text
    .replace(/[^\x20-\x7E\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTextFromPlainText(bytes: Uint8Array): string {
  const decoder = new TextDecoder('utf-8');
  try {
    return decoder.decode(bytes);
  } catch {
    return String.fromCharCode(...bytes);
  }
}

function regexExtractFromText(text: string) {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g;
  const linkedInRegex = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/g;
  const websiteRegex = /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/g;

  const emails = [...text.matchAll(emailRegex)].map((m) => m[0]);
  const phones = [...text.matchAll(phoneRegex)].map((m) => m[0]);
  const linkedins = [...text.matchAll(linkedInRegex)].map((m) => m[0]);
  const websites = [...text.matchAll(websiteRegex)].map((m) => m[0]);

  // Heuristic: first email is likely the primary one
  // Heuristic: first line that looks like a name (2-3 words, each capitalized)
  const lines = text
    .split(/\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  let fullName = '';
  for (const line of lines.slice(0, 20)) {
    const nameMatch = line.match(/^([A-Z][a-z]+)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)$/);
    if (nameMatch) {
      fullName = line;
      break;
    }
  }

  return {
    email: emails[0] ?? '',
    phone: phones[0] ?? '',
    linkedinUrl: linkedins[0] ?? '',
    website: websites[0] ?? '',
    fullName,
    rawText: text.substring(0, 5000),
  };
}

function mergeExtractionResults(
  regex: ReturnType<typeof regexExtractFromText>,
  ai: ai.ExtractedLeadDraft | null,
  leadType: string,
  _rawText: string
): ai.ExtractedLeadDraft {
  const aiName = ai ? `${ai.firstName} ${ai.lastName}`.trim() : '';
  const nameParts = (regex.fullName || aiName).trim().split(/\s+/);
  const firstName = nameParts[0] ?? ai?.firstName ?? '';
  const lastName = nameParts.slice(1).join(' ') || (ai?.lastName ?? '');
  const fullName = regex.fullName || aiName || `${firstName} ${lastName}`.trim();

  return {
    leadType: (ai?.leadType ?? leadType) as ai.ExtractedLeadDraft['leadType'],
    firstName,
    lastName,
    fullName,
    email: regex.email || (ai?.email ?? ''),
    phone: regex.phone || (ai?.phone ?? ''),
    linkedinUrl: regex.linkedinUrl || (ai?.linkedinUrl ?? ''),
    companyName: ai?.companyName ?? '',
    title: ai?.title ?? '',
    location: ai?.location ?? '',
    website: regex.website || (ai?.website ?? ''),
    source: 'pdf_upload',
    status: 'new',
    tags: ai?.tags ?? [],
    notes: ai?.notes ?? '',
    summary: ai?.summary ?? '',
    confidence: ai?.confidence ?? (regex.email ? 0.3 : 0.05),
    missingFields: ai?.missingFields ?? [],
  };
}

// ─── GLOBAL SEARCH ───────────────────────────────────────────────────

app.get('/api/search', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const q = c.req.query('q');
  if (!q || q.length < 2) return c.json({ results: [] });
  const query = `%${q}%`;

  const [leads, companies, contacts, opportunities] = await Promise.all([
    db
      .select()
      .from(schema.leads)
      .where(
        and(
          isNull(schema.leads.deletedAt),
          or(
            like(sql`LOWER(${schema.leads.firstName})`, query),
            like(sql`LOWER(${schema.leads.lastName})`, query),
            like(sql`LOWER(${schema.leads.email})`, query),
            like(sql`LOWER(${schema.leads.companyName})`, query)
          )
        )
      )
      .limit(10),
    db
      .select()
      .from(schema.companies)
      .where(
        and(
          isNull(schema.companies.deletedAt),
          or(
            like(sql`LOWER(${schema.companies.name})`, query),
            like(sql`LOWER(${schema.companies.domain})`, query)
          )
        )
      )
      .limit(10),
    db
      .select()
      .from(schema.contacts)
      .where(
        and(
          isNull(schema.contacts.deletedAt),
          or(
            like(sql`LOWER(${schema.contacts.firstName})`, query),
            like(sql`LOWER(${schema.contacts.lastName})`, query),
            like(sql`LOWER(${schema.contacts.email})`, query)
          )
        )
      )
      .limit(10),
    db
      .select()
      .from(schema.opportunities)
      .where(
        and(
          isNull(schema.opportunities.deletedAt),
          or(
            like(sql`LOWER(${schema.opportunities.name})`, query),
            like(sql`LOWER(${schema.opportunities.notes})`, query)
          )
        )
      )
      .limit(10),
  ]);

  const results = [
    ...leads.map((l) => ({
      type: 'lead' as const,
      id: l.id,
      title: `${l.firstName} ${l.lastName}`,
      subtitle: l.companyName ?? l.email,
    })),
    ...companies.map((c) => ({
      type: 'company' as const,
      id: c.id,
      title: c.name,
      subtitle: c.domain ?? '',
    })),
    ...contacts.map((c) => ({
      type: 'contact' as const,
      id: c.id,
      title: `${c.firstName} ${c.lastName}`,
      subtitle: c.email,
    })),
    ...opportunities.map((o) => ({
      type: 'opportunity' as const,
      id: o.id,
      title: o.name,
      subtitle: `$${o.amount ?? '0'}`,
    })),
  ].slice(0, 20);

  return c.json({ query: q, results });
});

// ─── NOTIFICATIONS ───────────────────────────────────────────────────

app.get('/api/notifications', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const userId = c.get('userId');
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(50);
  return c.json({ notifications: rows });
});

app.get('/api/notifications/count', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const userId = c.get('userId');
  const rows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  return c.json({ count: rows[0]?.count ?? 0 });
});

app.post('/api/notifications/:id/read', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const userId = c.get('userId');
  const id = c.req.param('id');
  await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)));
  return c.json({ success: true });
});

// ─── INTEGRATIONS STATUS ───────────────────────────────────────────

app.get('/api/integrations/status', async (c) => {
  const env = c.env as Env;
  return c.json({
    googleAi: !!env.GOOGLE_API_KEY,
    documentConverter: !!env.DOCUMENT_CONVERTER_URL,
    resendEmail: !!env.RESEND_API_KEY,
  });
});

// ─── OCR FOR SCANNED PDFS ───────────────────────────────────────────

app.post('/api/ocr', async (c) => {
  const env = c.env as Env;
  const body = await c.req.parseBody();
  const file = body['file'] as File;
  if (!file) return c.json({ error: 'No file uploaded' }, 400);
  if (!env.GOOGLE_API_KEY) return c.json({ error: 'AI not configured' }, 503);

  const bytes = await file.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));

  try {
    const ocrModel = env.GOOGLE_MODEL || 'gemini-1.5-pro';
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${ocrModel}:generateContent?key=${env.GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: 'Extract all text from this image or PDF. Return only the raw text, no formatting or commentary.',
                },
                { inlineData: { mimeType: file.type, data: base64 } },
              ],
            },
          ],
        }),
      }
    );
    if (!res.ok) return c.json({ error: 'OCR failed', details: await res.text() }, 500);
    const data = (await res.json()) as {
      candidates?: [{ content?: { parts?: [{ text?: string }] } }];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return c.json({ text, source: 'google_document_ai' });
  } catch (err) {
    console.error('OCR error:', err);
    return c.json({ error: 'OCR processing failed' }, 500);
  }
});

export default app;
