import { Hono } from "hono";
import { cors } from "hono/cors";
import { getDb, withAudit } from "@skarion/db-kit";
import { requireAuth, requireSuperadmin, type AuthedVariables } from "@skarion/auth-client";
import { can, canList } from "@skarion/permissions";
import { parseContactsCsv, parseCompaniesCsv, parseLeadsCsv } from "@skarion/importers";
import * as schema from "./db/schema.js";
import { eq, and, isNull, like, sql, desc, asc, or } from "drizzle-orm";
import type { CrmDb } from "./db/types.js";
import * as ai from "./lib/ai-service.js";
import * as docConv from "./lib/document-converter.js";
import { cleanMarkdownForAi, estimateTokens } from "./lib/markdown-utils.js";


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
}

/** Basic email stub — logs what would be sent. Full Resend wiring in a future ticket. */
function logEmailStub(to: string, subject: string, _html: string) {
  console.log(`[EMAIL_STUB] to=${to} subject="${subject}" — not sent (Resend not configured)`);
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

function isAllowedOrigin(origin: string, appUrl: string): boolean {
  if (!origin) return false;
  if (origin === appUrl) return true;
  if (origin.endsWith(".skarion.com")) return true;
  // Allow known Cloudflare Pages/Workers origins (shared-domain stopgap until custom domains)
  const knownCloudflareOrigins = new Set([
    'https://skarion-crm.pages.dev',
    'https://skarion-identity-login.pages.dev',
    'https://skarion-identity-admin.pages.dev',
    'https://skarion-identity.alsaki1999.workers.dev',
    'https://skarion-crm-platform.alsaki1999.workers.dev',
  ]);
  if (knownCloudflareOrigins.has(origin)) return true;
  if (origin.startsWith("http://localhost:")) return true;
  return false;
}

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

app.use("*", cors({
  origin: (origin, c) => isAllowedOrigin(origin, c.env.APP_URL) ? origin : "",
  credentials: true,
}));

app.use("*", async (c, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    if (origin && !isAllowedOrigin(origin, c.env.APP_URL)) {
      return c.json({ error: "CSRF: Invalid origin." }, 403);
    }
  }
  await next();
});

app.get("/health", (c) => c.json({ status: "ok", service: "skarion-crm-platform" }));

app.get("/api/debug/version", (c) => {
  const branch = c.env.GIT_BRANCH ?? "cloudflare-platform-rewrite";
  const commit = c.env.GIT_COMMIT_SHA ?? "unknown";
  return c.json({
    app: "crm",
    branch,
    commit,
    deployedAt: new Date().toISOString(),
    environment: "production",
  });
});

app.use("/api/*", requireAuth);
app.use("/api/admin/*", requireSuperadmin());

function getRole(c: unknown): string {
  const apps = (c as { get: (key: string) => unknown }).get("apps");
  return (apps as { crm?: string } | undefined)?.crm ?? "";
}

// --- COMPANIES ---

app.get("/api/companies", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: "Forbidden." }, 403);

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

  const rows = await db.select().from(schema.companies)
    .where(and(...conditions))
    .orderBy(desc(schema.companies.updatedAt))
    .limit(100);

  return c.json({ companies: rows });
});

app.post("/api/companies", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };
  if (!can(isSuperadmin, role, "create", { ownerId: caller.userId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
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
  if (!result) return c.json({ error: "Internal error" }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "create",
    resourceType: "company",
    resourceId: result.id,
    after: data,
    app: "crm",
  });

  return c.json({ company: result }, 201);
});

app.get("/api/companies/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [row] = await db.select().from(schema.companies)
    .where(and(eq(schema.companies.id, id), isNull(schema.companies.deletedAt)));
  if (!row) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "view", { ownerId: row.ownerId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  return c.json({ company: row });
});

app.put("/api/companies/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [existing] = await db.select().from(schema.companies)
    .where(and(eq(schema.companies.id, id), isNull(schema.companies.deletedAt)));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "edit", { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
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

  const [result] = await db.update(schema.companies).set(update)
    .where(eq(schema.companies.id, id)).returning();
  if (!result) return c.json({ error: "Internal error" }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "edit",
    resourceType: "company",
    resourceId: id,
    before: existing,
    after: result,
    app: "crm",
  });

  return c.json({ company: result });
});

app.delete("/api/companies/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [existing] = await db.select().from(schema.companies)
    .where(and(eq(schema.companies.id, id), isNull(schema.companies.deletedAt)));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "delete", { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  await db.update(schema.companies).set({
    deletedAt: new Date(),
    deletedBy: caller.userId,
  }).where(eq(schema.companies.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "delete",
    resourceType: "company",
    resourceId: id,
    before: existing,
    app: "crm",
  });

  return c.json({ success: true });
});

// --- CONTACTS ---

app.get("/api/contacts", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: "Forbidden." }, 403);

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

  const rows = await db.select().from(schema.contacts)
    .where(and(...conditions))
    .orderBy(desc(schema.contacts.updatedAt))
    .limit(100);

  return c.json({ contacts: rows });
});

app.post("/api/contacts", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };
  if (!can(isSuperadmin, role, "create", { ownerId: caller.userId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
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
  if (!result) return c.json({ error: "Internal error" }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "create",
    resourceType: "contact",
    resourceId: result.id,
    after: data,
    app: "crm",
  });

  return c.json({ contact: result }, 201);
});

app.get("/api/contacts/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [row] = await db.select().from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), isNull(schema.contacts.deletedAt)));
  if (!row) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "view", { ownerId: row.ownerId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  return c.json({ contact: row });
});

app.put("/api/contacts/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [existing] = await db.select().from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), isNull(schema.contacts.deletedAt)));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "edit", { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
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

  const [result] = await db.update(schema.contacts).set(update)
    .where(eq(schema.contacts.id, id)).returning();
  if (!result) return c.json({ error: "Internal error" }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "edit",
    resourceType: "contact",
    resourceId: id,
    before: existing,
    after: result,
    app: "crm",
  });

  return c.json({ contact: result });
});

app.delete("/api/contacts/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [existing] = await db.select().from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), isNull(schema.contacts.deletedAt)));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "delete", { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  await db.update(schema.contacts).set({
    deletedAt: new Date(),
    deletedBy: caller.userId,
  }).where(eq(schema.contacts.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "delete",
    resourceType: "contact",
    resourceId: id,
    before: existing,
    app: "crm",
  });

  return c.json({ success: true });
});

// --- LEADS ---

app.get("/api/leads", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: "Forbidden." }, 403);

  // Parse query params
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(c.req.query('pageSize') || '50', 10)));
  const { status, source, search, owner, outreachStatus } = c.req.query();

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

  // Search across name, email, company, linkedinUrl
  if (search) {
    const searchLower = search.toLowerCase();
    conditions.push(
      or(
        like(sql`lower(${schema.leads.email})`, `%${searchLower}%`),
        like(sql`lower(${schema.leads.firstName})`, `%${searchLower}%`),
        like(sql`lower(${schema.leads.lastName})`, `%${searchLower}%`),
        like(sql`lower(${schema.leads.companyName})`, `%${searchLower}%`),
        like(sql`lower(${schema.leads.linkedinUrl})`, `%${searchLower}%`),
      )!
    );
  }

  // Get total count
  const countResult = await db.select({ count: sql<number>`count(*)` }).from(schema.leads).where(and(...conditions));
  const total = countResult[0]?.count ?? 0;

  // Get paginated rows
  const rows = await db.select().from(schema.leads)
    .where(and(...conditions))
    .orderBy(desc(schema.leads.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Get status counts (for filters)
  const statusCountsRaw = await db.select({ status: schema.leads.status, count: sql<number>`count(*)` })
    .from(schema.leads)
    .where(and(isNull(schema.leads.deletedAt), ...(!isSuperadmin ? [eq(schema.leads.ownerId, caller.userId)] : [])))
    .groupBy(schema.leads.status);

  const statusCounts = { new: 0, contacted: 0, qualified: 0, disqualified: 0, converted: 0 };
  statusCountsRaw.forEach(s => { statusCounts[s.status as keyof typeof statusCounts] = s.count; });

  // Get outreach status counts (for filters)
  const outreachStatusCountsRaw = await db.select({ outreachStatus: schema.leads.outreachStatus, count: sql<number>`count(*)` })
    .from(schema.leads)
    .where(and(isNull(schema.leads.deletedAt), ...(!isSuperadmin ? [eq(schema.leads.ownerId, caller.userId)] : [])))
    .groupBy(schema.leads.outreachStatus);

  const outreachStatusCounts = { not_approached: 0, approached: 0, connected: 0, replied: 0, booked_call: 0, not_interested: 0, bad_fit: 0 };
  outreachStatusCountsRaw.forEach(s => { outreachStatusCounts[s.outreachStatus as keyof typeof outreachStatusCounts] = s.count; });

  return c.json({
    leads: rows,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    statusCounts,
    outreachStatusCounts,
  });
});

app.post("/api/leads", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };
  if (!can(isSuperadmin, role, "create", { ownerId: caller.userId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
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
    source: (body.source ?? "other") as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: (body.status ?? "new") as any,
    notes: body.notes ?? null,
    ownerId: caller.userId,
  };

  const [result] = await db.insert(schema.leads).values(data).returning();
  if (!result) return c.json({ error: "Internal error" }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "create",
    resourceType: "lead",
    resourceId: result.id,
    after: data,
    app: "crm",
  });

  // Trigger workflow event for lead_created rules
  c.executionCtx.waitUntil(
    triggerWorkflowEvent(c.env, 'lead_created', {
      id: result.id,
      source: result.source,
      ownerId: result.ownerId,
    })
  );

  // Basic email stub — will be wired to Resend in a future ticket
  logEmailStub(result.email, 'New lead in Skarion CRM', 'Welcome to Skarion CRM');

  return c.json({ lead: result }, 201);
});

app.get("/api/leads/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [row] = await db.select().from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!row) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "view", { ownerId: row.ownerId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  return c.json({ lead: row });
});

app.put("/api/leads/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [existing] = await db.select().from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "edit", { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
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
  if (body.approachedAt !== undefined) update.approachedAt = body.approachedAt ? new Date(body.approachedAt) : null;
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
  update.updatedAt = new Date();

  const [result] = await db.update(schema.leads).set(update)
    .where(eq(schema.leads.id, id)).returning();
  if (!result) return c.json({ error: "Internal error" }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "edit",
    resourceType: "lead",
    resourceId: id,
    before: existing,
    after: result,
    app: "crm",
  });

  return c.json({ lead: result });
});

app.delete("/api/leads/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [existing] = await db.select().from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "delete", { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  await db.update(schema.leads).set({
    deletedAt: new Date(),
    deletedBy: caller.userId,
  }).where(eq(schema.leads.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "delete",
    resourceType: "lead",
    resourceId: id,
    before: existing,
    app: "crm",
  });

  return c.json({ success: true });
});

// ─── LEAD EXPORT ─────────────────────────────────────────────

function escapeCsv(val: unknown): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

app.get("/api/leads/export.csv", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };
  if (!role) return c.json({ error: "Forbidden." }, 403);

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
        like(sql`lower(${schema.leads.linkedinUrl})`, `%${searchLower}%`),
      )!
    );
  }

  const rows = await db.select().from(schema.leads)
    .where(and(...conditions))
    .orderBy(desc(schema.leads.createdAt));

  const headers = [
    'firstName', 'lastName', 'email', 'phone', 'companyName', 'companyDomain',
    'linkedinUrl', 'status', 'source', 'outreachStatus', 'approachedAt',
    'connectionStatus', 'sourceSheet', 'originalRowNumber', 'notes', 'createdAt', 'updatedAt'
  ];

  let csv = headers.map(escapeCsv).join(',') + '\n';
  for (const row of rows) {
    csv += [
      row.firstName, row.lastName, row.email, row.phone, row.companyName, row.companyDomain,
      row.linkedinUrl, row.status, row.source, row.outreachStatus,
      row.approachedAt ? new Date(row.approachedAt).toISOString() : '',
      row.connectionStatus, row.sourceSheet, row.originalRowNumber,
      row.notes, row.createdAt ? new Date(row.createdAt).toISOString() : '',
      row.updatedAt ? new Date(row.updatedAt).toISOString() : ''
    ].map(escapeCsv).join(',') + '\n';
  }

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="skarion-leads.csv"');
  return c.body(csv);
});

app.post("/api/leads/:id/convert", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [lead] = await db.select().from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!lead) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "edit", { ownerId: lead.ownerId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }
  if (lead.status === "converted") {
    return c.json({ error: "Lead already converted." }, 400);
  }

  let companyId: string | null = null;
  if (lead.companyDomain) {
    const [existingCompany] = await db.select().from(schema.companies)
      .where(and(
        eq(sql`lower(${schema.companies.domain})`, lead.companyDomain.toLowerCase()),
        isNull(schema.companies.deletedAt)
      ));
    if (existingCompany) {
      companyId = existingCompany.id;
    } else {
      const [newCompany] = await db.insert(schema.companies).values({
        name: lead.companyName || lead.companyDomain,
        domain: lead.companyDomain,
        ownerId: caller.userId,
      }).returning();
      if (!newCompany) return c.json({ error: "Internal error" }, 500);
      companyId = newCompany.id;
      await withAudit(db, schema.auditLog, {
        actorUserId: caller.userId,
        action: "create",
        resourceType: "company",
        resourceId: newCompany.id,
        after: newCompany,
        app: "crm",
      });
    }
  }

  const [contact] = await db.insert(schema.contacts).values({
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    companyId,
    ownerId: caller.userId,
  }).returning();
  if (!contact) return c.json({ error: "Internal error" }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "create",
    resourceType: "contact",
    resourceId: contact.id,
    after: contact,
    app: "crm",
  });

  const [updatedLead] = await db.update(schema.leads).set({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: "converted" as any,
    convertedToContactId: contact.id,
    convertedToCompanyId: companyId,
    convertedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(schema.leads.id, id)).returning();
  if (!updatedLead) return c.json({ error: "Internal error" }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "convert",
    resourceType: "lead",
    resourceId: id,
    before: lead,
    after: updatedLead,
    app: "crm",
  });

  return c.json({ lead: updatedLead, contact, companyId });
});

// --- OPPORTUNITIES ---

app.get("/api/opportunities", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: "Forbidden." }, 403);

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

  const rows = await db.select().from(schema.opportunities)
    .where(and(...conditions))
    .orderBy(desc(schema.opportunities.updatedAt))
    .limit(100);

  return c.json({ opportunities: rows });
});

app.post("/api/opportunities", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };
  if (!can(isSuperadmin, role, "create", { ownerId: caller.userId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  const body = await c.req.json();
  const data = {
    name: body.name,
    companyId: body.companyId ?? null,
    contactId: body.contactId ?? null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stage: (body.stage ?? "prospecting") as any,
    amount: body.amount ?? null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    currency: (body.currency ?? "USD") as any,
    expectedCloseDate: body.expectedCloseDate ?? null,
    probability: body.probability ?? null,
    notes: body.notes ?? null,
    ownerId: caller.userId,
  };

  const [result] = await db.insert(schema.opportunities).values(data).returning();
  if (!result) return c.json({ error: "Internal error" }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "create",
    resourceType: "opportunity",
    resourceId: result.id,
    after: data,
    app: "crm",
  });

  return c.json({ opportunity: result }, 201);
});

app.get("/api/opportunities/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [row] = await db.select().from(schema.opportunities)
    .where(and(eq(schema.opportunities.id, id), isNull(schema.opportunities.deletedAt)));
  if (!row) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "view", { ownerId: row.ownerId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  return c.json({ opportunity: row });
});

app.put("/api/opportunities/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [existing] = await db.select().from(schema.opportunities)
    .where(and(eq(schema.opportunities.id, id), isNull(schema.opportunities.deletedAt)));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "edit", { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
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

  const [result] = await db.update(schema.opportunities).set(update)
    .where(eq(schema.opportunities.id, id)).returning();
  if (!result) return c.json({ error: "Internal error" }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "edit",
    resourceType: "opportunity",
    resourceId: id,
    before: existing,
    after: result,
    app: "crm",
  });

  // Basic email stub on stage change — will be wired to Resend in a future ticket
  if (body.stage !== undefined && body.stage !== existing.stage) {
    logEmailStub(
      caller.userId,
      `Opportunity stage changed: ${result.name} → ${result.stage}`,
      `Opportunity ${result.name} moved from ${existing.stage} to ${result.stage}`
    );
  }

  return c.json({ opportunity: result });
});

app.delete("/api/opportunities/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [existing] = await db.select().from(schema.opportunities)
    .where(and(eq(schema.opportunities.id, id), isNull(schema.opportunities.deletedAt)));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "delete", { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  await db.update(schema.opportunities).set({
    deletedAt: new Date(),
    deletedBy: caller.userId,
  }).where(eq(schema.opportunities.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "delete",
    resourceType: "opportunity",
    resourceId: id,
    before: existing,
    app: "crm",
  });

  return c.json({ success: true });
});

// --- ACTIVITIES ---

app.get("/api/activities", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };
  if (!role) return c.json({ error: "Forbidden." }, 403);

  const { contactId, companyId, opportunityId, type } = c.req.query();
  const conditions: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

  // If a specific parent resource is provided, verify the caller can access it
  if (companyId) {
    const [company] = await db.select().from(schema.companies)
      .where(and(eq(schema.companies.id, companyId), isNull(schema.companies.deletedAt)));
    if (!company) return c.json({ error: "Not found." }, 404);
    if (!can(isSuperadmin, role, "view", { ownerId: company.ownerId }, caller)) {
      return c.json({ error: "Forbidden." }, 403);
    }
    conditions.push(eq(schema.activities.companyId, companyId));
  }
  if (contactId) {
    const [contact] = await db.select().from(schema.contacts)
      .where(and(eq(schema.contacts.id, contactId), isNull(schema.contacts.deletedAt)));
    if (!contact) return c.json({ error: "Not found." }, 404);
    if (!can(isSuperadmin, role, "view", { ownerId: contact.ownerId }, caller)) {
      return c.json({ error: "Forbidden." }, 403);
    }
    conditions.push(eq(schema.activities.contactId, contactId));
  }
  if (opportunityId) {
    const [opportunity] = await db.select().from(schema.opportunities)
      .where(and(eq(schema.opportunities.id, opportunityId), isNull(schema.opportunities.deletedAt)));
    if (!opportunity) return c.json({ error: "Not found." }, 404);
    if (!can(isSuperadmin, role, "view", { ownerId: opportunity.ownerId }, caller)) {
      return c.json({ error: "Forbidden." }, 403);
    }
    conditions.push(eq(schema.activities.opportunityId, opportunityId));
  }
  if (type) conditions.push(eq(schema.activities.type, type as any)); // eslint-disable-line @typescript-eslint/no-explicit-any

  if (conditions.length === 0) {
    return c.json({ error: "Provide at least one filter: contactId, companyId, opportunityId, or type." }, 400);
  }

  const rows = await db.select().from(schema.activities)
    .where(and(...conditions))
    .orderBy(desc(schema.activities.happenedAt))
    .limit(100);

  return c.json({ activities: rows });
});

app.post("/api/activities", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };
  if (!can(isSuperadmin, role, "create", { ownerId: caller.userId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
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
  if (!result) return c.json({ error: "Internal error" }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "create",
    resourceType: "activity",
    resourceId: result.id,
    after: data,
    app: "crm",
  });

  return c.json({ activity: result }, 201);
});

app.get("/api/activities/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId") };

  const [row] = await db.select().from(schema.activities)
    .where(eq(schema.activities.id, id));
  if (!row) return c.json({ error: "Not found." }, 404);
  if (!isSuperadmin && row.actorId !== caller.userId) {
    return c.json({ error: "Forbidden." }, 403);
  }

  return c.json({ activity: row });
});

app.put("/api/activities/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId") };

  const [existing] = await db.select().from(schema.activities)
    .where(eq(schema.activities.id, id));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!isSuperadmin && existing.actorId !== caller.userId) {
    return c.json({ error: "Forbidden." }, 403);
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

  const [result] = await db.update(schema.activities).set(update)
    .where(eq(schema.activities.id, id)).returning();
  if (!result) return c.json({ error: "Internal error" }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "edit",
    resourceType: "activity",
    resourceId: id,
    before: existing,
    after: result,
    app: "crm",
  });

  return c.json({ activity: result });
});

app.delete("/api/activities/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId") };

  const [existing] = await db.select().from(schema.activities)
    .where(eq(schema.activities.id, id));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!isSuperadmin && existing.actorId !== caller.userId) {
    return c.json({ error: "Forbidden." }, 403);
  }

  await db.delete(schema.activities).where(eq(schema.activities.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "delete",
    resourceType: "activity",
    resourceId: id,
    before: existing,
    app: "crm",
  });

  return c.json({ success: true });
});

// --- TASKS ---

app.get("/api/tasks", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: "Forbidden." }, 403);

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
  if (completed === "true") conditions.push(sql`${schema.tasks.completedAt} IS NOT NULL`);
  if (completed === "false") conditions.push(sql`${schema.tasks.completedAt} IS NULL`);

  const rows = await db.select().from(schema.tasks)
    .where(and(...conditions))
    .orderBy(asc(schema.tasks.dueDate))
    .limit(100);

  return c.json({ tasks: rows });
});

app.post("/api/tasks", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };
  if (!can(isSuperadmin, role, "create", { ownerId: caller.userId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
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
    priority: body.priority ?? "medium",
  };

  const [result] = await db.insert(schema.tasks).values(data).returning();
  if (!result) return c.json({ error: "Internal error" }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "create",
    resourceType: "task",
    resourceId: result.id,
    after: data,
    app: "crm",
  });

  // Basic email stub on task assignment — will be wired to Resend in a future ticket
  if (result.assigneeId !== caller.userId) {
    logEmailStub(
      result.assigneeId,
      `New task assigned: ${result.title}`,
      `You have been assigned a new task: ${result.title}`
    );
  }

  return c.json({ task: result }, 201);
});

app.get("/api/tasks/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [row] = await db.select().from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)));
  if (!row) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "view", { ownerId: row.assigneeId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  return c.json({ task: row });
});

app.put("/api/tasks/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [existing] = await db.select().from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "edit", { ownerId: existing.assigneeId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
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

  const [result] = await db.update(schema.tasks).set(update)
    .where(eq(schema.tasks.id, id)).returning();
  if (!result) return c.json({ error: "Internal error" }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "edit",
    resourceType: "task",
    resourceId: id,
    before: existing,
    after: result,
    app: "crm",
  });

  return c.json({ task: result });
});

app.put("/api/tasks/:id/complete", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [existing] = await db.select().from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "edit", { ownerId: existing.assigneeId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  const [result] = await db.update(schema.tasks).set({
    completedAt: new Date(),
    completedBy: caller.userId,
    updatedAt: new Date(),
  }).where(eq(schema.tasks.id, id)).returning();
  if (!result) return c.json({ error: "Internal error" }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "complete",
    resourceType: "task",
    resourceId: id,
    before: existing,
    after: result,
    app: "crm",
  });

  return c.json({ task: result });
});

app.put("/api/tasks/:id/reopen", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [existing] = await db.select().from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "edit", { ownerId: existing.assigneeId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  const [result] = await db.update(schema.tasks).set({
    completedAt: null,
    completedBy: null,
    updatedAt: new Date(),
  }).where(eq(schema.tasks.id, id)).returning();
  if (!result) return c.json({ error: "Internal error" }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "reopen",
    resourceType: "task",
    resourceId: id,
    before: existing,
    after: result,
    app: "crm",
  });

  return c.json({ task: result });
});

app.delete("/api/tasks/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [existing] = await db.select().from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt)));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "delete", { ownerId: existing.assigneeId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  await db.update(schema.tasks).set({
    deletedAt: new Date(),
    deletedBy: caller.userId,
  }).where(eq(schema.tasks.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: "delete",
    resourceType: "task",
    resourceId: id,
    before: existing,
    app: "crm",
  });

  return c.json({ success: true });
});

// --- IMPORT ---

app.post("/api/import/companies", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };
  if (!can(isSuperadmin, role, "create", { ownerId: caller.userId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  const body = await c.req.json();
  const csvText = body.csv;
  if (!csvText || typeof csvText !== "string") {
    return c.json({ error: "Missing or invalid 'csv' field." }, 400);
  }

  const parsed = parseCompaniesCsv(csvText);
  const created: typeof schema.companies.$inferInsert[] = [];
  for (const row of parsed.success) {
    const [result] = await db.insert(schema.companies).values({
      name: row.name,
      domain: row.domain ?? null,
      industry: row.industry ?? null,
      size: row.size ?? null,
      ownerId: caller.userId,
    }).returning();
    if (!result) return c.json({ error: "Internal error" }, 500);
    created.push(result);
  }

  return c.json({ imported: created.length, errors: parsed.errors, duplicates: parsed.duplicates });
});

app.post("/api/import/contacts", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };
  if (!can(isSuperadmin, role, "create", { ownerId: caller.userId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  const body = await c.req.json();
  const csvText = body.csv;
  if (!csvText || typeof csvText !== "string") {
    return c.json({ error: "Missing or invalid 'csv' field." }, 400);
  }

  const parsed = parseContactsCsv(csvText);
  const created: typeof schema.contacts.$inferInsert[] = [];
  for (const row of parsed.success) {
    let companyId: string | null = null;
    if (row.companyName) {
      const [company] = await db.select().from(schema.companies)
        .where(and(
          like(sql`lower(${schema.companies.name})`, `%${row.companyName.toLowerCase()}%`),
          isNull(schema.companies.deletedAt)
        ));
      if (company) companyId = company.id;
    }
    const [result] = await db.insert(schema.contacts).values({
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone ?? null,
      title: row.title ?? null,
      companyId,
      ownerId: caller.userId,
    }).returning();
    if (!result) return c.json({ error: "Internal error" }, 500);
    created.push(result);
  }

  return c.json({ imported: created.length, errors: parsed.errors, duplicates: parsed.duplicates });
});

app.post("/api/import/leads/preview", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };
  if (!can(isSuperadmin, role, "create", { ownerId: caller.userId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  const body = await c.req.json();
  const csvText = body.csv;
  if (!csvText || typeof csvText !== "string") {
    return c.json({ error: "Missing or invalid 'csv' field." }, 400);
  }

  const parsed = parseLeadsCsv(csvText);
  // Check DB for existing duplicates
  const enriched = await Promise.all(
    parsed.success.map(async (row) => {
      const conflicts: string[] = [];
      if (row.email && !row.email.includes('@placeholder.skarion')) {
        const existing = await db.select({ id: schema.leads.id }).from(schema.leads)
          .where(and(
            eq(sql`lower(${schema.leads.email})`, row.email.toLowerCase()),
            isNull(schema.leads.deletedAt)
          ))
          .limit(1);
        if (existing.length > 0) conflicts.push('email exists');
      }
      if (row.linkedinUrl) {
        const normalizedLi = row.linkedinUrl.toLowerCase().replace(/\/+$/, '');
        const existingLi = await db.select({ id: schema.leads.id }).from(schema.leads)
          .where(and(
            eq(sql`lower(${schema.leads.linkedinUrl})`, normalizedLi),
            isNull(schema.leads.deletedAt)
          ))
          .limit(1);
        if (existingLi.length > 0) conflicts.push('linkedin exists');
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
  });
});

app.post("/api/import/leads", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };
  if (!can(isSuperadmin, role, "create", { ownerId: caller.userId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  const body = await c.req.json();
  const csvText = body.csv;
  if (!csvText || typeof csvText !== "string") {
    return c.json({ error: "Missing or invalid 'csv' field." }, 400);
  }

  const parsed = parseLeadsCsv(csvText);
  const created: typeof schema.leads.$inferInsert[] = [];
  const dbDuplicates: { row: number; reason: string }[] = [];
  for (const row of parsed.success) {
    // Check for existing duplicate by email (skip placeholders)
    if (row.email && !row.email.includes('@placeholder.skarion')) {
      const existingEmail = await db.select({ id: schema.leads.id }).from(schema.leads)
        .where(and(
          eq(sql`lower(${schema.leads.email})`, row.email.toLowerCase()),
          isNull(schema.leads.deletedAt)
        ))
        .limit(1);
      if (existingEmail.length > 0) {
        dbDuplicates.push({ row: row.originalRowNumber ?? 0, reason: `Email already exists: ${row.email}` });
        continue;
      }
    }
    // Check for existing duplicate by LinkedIn URL
    if (row.linkedinUrl) {
      const normalizedLi = row.linkedinUrl.toLowerCase().replace(/\/+$/, '');
      const existingLi = await db.select({ id: schema.leads.id }).from(schema.leads)
        .where(and(
          eq(sql`lower(${schema.leads.linkedinUrl})`, normalizedLi),
          isNull(schema.leads.deletedAt)
        ))
        .limit(1);
      if (existingLi.length > 0) {
        dbDuplicates.push({ row: row.originalRowNumber ?? 0, reason: `LinkedIn already exists: ${row.linkedinUrl}` });
        continue;
      }
    }
    const [result] = await db.insert(schema.leads).values({
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone ?? null,
      companyName: row.companyName ?? null,
      companyDomain: row.companyDomain ?? null,
      linkedinUrl: row.linkedinUrl ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      source: (row.source ?? "other") as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      status: (row.status ?? "new") as any,
      notes: row.notes ?? null,
      outreachStatus: row.outreachStatus ?? "not_approached",
      approachedAt: row.approachedAt ? new Date(row.approachedAt) : null,
      connectionStatus: row.connectionStatus ?? null,
      sourceSheet: row.sourceSheet ?? null,
      originalRowNumber: row.originalRowNumber ?? null,
      tags: row.tags ? JSON.stringify(row.tags) : null,
      ownerId: caller.userId,
    }).returning();
    if (!result) return c.json({ error: "Internal error" }, 500);
    created.push(result);
  }

  return c.json({ imported: created.length, errors: parsed.errors, duplicates: [...parsed.duplicates, ...dbDuplicates], warnings: parsed.warnings });
});

// --- ADMIN ---

app.get("/api/admin/audit-log", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const rows = await db.select().from(schema.auditLog)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(200);
  return c.json({ auditLog: rows });
});

// --- WORKFLOW RULES ---

app.get("/api/workflow-rules", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  if (!role) return c.json({ error: "Forbidden." }, 403);
  // Only managers and superadmins can view workflow rules
  if (!isSuperadmin && role !== "manager") {
    return c.json({ error: "Forbidden." }, 403);
  }

  const rows = await db.select().from(schema.workflowRules)
    .orderBy(desc(schema.workflowRules.updatedAt))
    .limit(100);
  return c.json({ workflowRules: rows });
});

app.post("/api/workflow-rules", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };
  if (!can(isSuperadmin, role, "create", { ownerId: caller.userId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
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
  if (!result) return c.json({ error: "Internal error" }, 500);
  return c.json({ workflowRule: result }, 201);
});

app.put("/api/workflow-rules/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [existing] = await db.select().from(schema.workflowRules).where(eq(schema.workflowRules.id, id));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "edit", { ownerId: caller.userId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
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

  const [result] = await db.update(schema.workflowRules).set(update).where(eq(schema.workflowRules.id, id)).returning();
  return c.json({ workflowRule: result });
});

app.delete("/api/workflow-rules/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  const caller = { userId: c.get("userId"), isSuperadmin };

  const [existing] = await db.select().from(schema.workflowRules).where(eq(schema.workflowRules.id, id));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!can(isSuperadmin, role, "delete", { ownerId: caller.userId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  await db.delete(schema.workflowRules).where(eq(schema.workflowRules.id, id));
  return c.json({ success: true });
});

// --- INTEGRATIONS ---

app.get("/api/integrations", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const isSuperadmin = c.get("isSuperadmin");
  if (!role) return c.json({ error: "Forbidden." }, 403);
  // Only managers and superadmins can view integrations
  if (!isSuperadmin && role !== "manager") {
    return c.json({ error: "Forbidden." }, 403);
  }

  const rows = await db.select().from(schema.integrationConfigs)
    .orderBy(desc(schema.integrationConfigs.updatedAt));
  return c.json({ integrations: rows });
});

app.post("/api/integrations", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const isSuperadmin = c.get("isSuperadmin");
  if (!isSuperadmin) return c.json({ error: "Forbidden." }, 403);

  const body = await c.req.json();
  const data = {
    provider: body.provider,
    label: body.label,
    status: body.status ?? "disconnected",
    settings: body.settings ?? {},
  };

  const [result] = await db.insert(schema.integrationConfigs).values(data).returning();
  if (!result) return c.json({ error: "Internal error" }, 500);
  return c.json({ integration: result }, 201);
});

app.put("/api/integrations/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const isSuperadmin = c.get("isSuperadmin");
  if (!isSuperadmin) return c.json({ error: "Forbidden." }, 403);

  const [existing] = await db.select().from(schema.integrationConfigs).where(eq(schema.integrationConfigs.id, id));
  if (!existing) return c.json({ error: "Not found." }, 404);

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.label !== undefined) update.label = body.label;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (body.status !== undefined) update.status = body.status as any;
  if (body.settings !== undefined) update.settings = body.settings;
  update.updatedAt = new Date();

  const [result] = await db.update(schema.integrationConfigs).set(update).where(eq(schema.integrationConfigs.id, id)).returning();
  return c.json({ integration: result });
});

app.delete("/api/integrations/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const isSuperadmin = c.get("isSuperadmin");
  if (!isSuperadmin) return c.json({ error: "Forbidden." }, 403);

  await db.delete(schema.integrationConfigs).where(eq(schema.integrationConfigs.id, id));
  return c.json({ success: true });
});

// ─── CHAT ────────────────────────────────────────────────────────────────

app.get('/api/chat/history', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const userId = c.get('userId');
  const rows = await db.select().from(schema.chatMessages)
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
      score: queryEmbedding && Array.isArray(e.embedding)
        ? ai.cosineSimilarity(queryEmbedding, e.embedding as number[])
        : 0,
    }))
    .filter((e) => canList(isSuperadmin, role, { userId: userId, isSuperadmin }, e.ownerId))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // 4. Build context prompt
  const context = scored.map((e, i) => `\n[${i + 1}] ${e.resourceType} ${e.resourceId}:\n${e.content}`).join('');
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
  const contextIds = scored.map((e) => ({ resourceType: e.resourceType, resourceId: e.resourceId }));
  const [assistantMessage] = await db.insert(schema.chatMessages).values({
    userId,
    role: 'assistant',
    content: answer,
    contextIds,
  }).returning();

  return c.json({ answer, context: scored, message: assistantMessage });
});

// ─── AI SUMMARY / OUTREACH / SCORE ─────────────────────────────────────────

app.post('/api/leads/:id/summarize', async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db.select().from(schema.leads)
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

  const [row] = await db.select().from(schema.leads)
    .where(and(eq(schema.leads.id, id), isNull(schema.leads.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const draft = await ai.draftOutreach({
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
  }, c.env);
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

  const [row] = await db.select().from(schema.leads)
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

  const [row] = await db.select().from(schema.leads)
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

  const [row] = await db.select().from(schema.companies)
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

  const [row] = await db.select().from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), isNull(schema.contacts.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const [company] = row.companyId
    ? await db.select().from(schema.companies).where(eq(schema.companies.id, row.companyId))
    : [null];

  const summary = await ai.summarizeContact({
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    title: row.title,
    companyName: company?.name ?? null,
  }, c.env);
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
    return c.json({ error: `Unsupported file type: ${file.type}. Allowed: PDF, DOCX, PPTX, XLSX, CSV, TXT.` }, 415);
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
        return c.json({ error: 'No selectable text found in PDF. OCR is not implemented yet. Please upload a text-based PDF.' }, 422);
      }
    } else if (file.type === 'text/plain' || file.type === 'text/csv' || file.name.endsWith('.txt') || file.name.endsWith('.csv')) {
      rawText = extractTextFromPlainText(bytes);
      if (!rawText || rawText.trim().length === 0) {
        return c.json({ error: 'No text found in file. The file may be empty or binary.' }, 422);
      }
    } else {
      return c.json({ error: `Document converter not available for ${file.type}. Supported without converter: PDF, TXT, CSV.` }, 503);
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
  const duplicates: { id: string; firstName: string; lastName: string; email: string; phone: string | null }[] = [];
  if (draftLead.email) {
    const byEmail = await db.select().from(schema.leads)
      .where(and(
        eq(schema.leads.email, draftLead.email.toLowerCase()),
        isNull(schema.leads.deletedAt)
      ));
    for (const d of byEmail) duplicates.push(d);
  }
  if (draftLead.phone) {
    const byPhone = await db.select().from(schema.contacts)
      .where(and(
        eq(schema.contacts.phone, draftLead.phone),
        isNull(schema.contacts.deletedAt)
      ));
    for (const d of byPhone) duplicates.push({ id: d.id, firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone });
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
  const [existing] = await db.select().from(schema.leads)
    .where(and(eq(schema.leads.email, leadData.email.toLowerCase()), isNull(schema.leads.deletedAt)));
  if (existing && !body.force) {
    return c.json({ error: 'Duplicate lead found.', existing: existing, hint: 'Use force=true to create anyway.' }, 409);
  }

  // Create or attach company if companyName provided
  let companyId: string | null = null;
  if (leadData.companyName) {
    const [existingCompany] = await db.select().from(schema.companies)
      .where(and(
        like(sql`lower(${schema.companies.name})`, `%${leadData.companyName.toLowerCase()}%`),
        isNull(schema.companies.deletedAt)
      ));
    if (existingCompany) {
      companyId = existingCompany.id;
    } else if (body.createCompany !== false) {
      const [newCompany] = await db.insert(schema.companies).values({
        name: leadData.companyName,
        domain: leadData.website ?? null,
        ownerId: caller.userId,
      }).returning();
      if (newCompany) companyId = newCompany.id;
    }
  }

  // Create contact if requested
  let contactId: string | null = null;
  if (body.createContact !== false) {
    const [contact] = await db.insert(schema.contacts).values({
      firstName: leadData.firstName,
      lastName: leadData.lastName,
      email: leadData.email.toLowerCase(),
      phone: leadData.phone ?? null,
      title: leadData.title ?? null,
      companyId,
      ownerId: caller.userId,
    }).returning();
    if (contact) contactId = contact.id;
  }

  // Create lead
  const [lead] = await db.insert(schema.leads).values({
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
  }).returning();
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
  try { text = decoder.decode(bytes); } catch { /* ignore */ }
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
  return text.replace(/[^\x20-\x7E\s]/g, ' ').replace(/\s+/g, ' ').trim();
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

  const emails = [...text.matchAll(emailRegex)].map(m => m[0]);
  const phones = [...text.matchAll(phoneRegex)].map(m => m[0]);
  const linkedins = [...text.matchAll(linkedInRegex)].map(m => m[0]);
  const websites = [...text.matchAll(websiteRegex)].map(m => m[0]);

  // Heuristic: first email is likely the primary one
  // Heuristic: first line that looks like a name (2-3 words, each capitalized)
  const lines = text.split(/\n|\r/).map(l => l.trim()).filter(l => l.length > 0);
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
  const firstName = nameParts[0] ?? (ai?.firstName ?? '');
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

export default app;
