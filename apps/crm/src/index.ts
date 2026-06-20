import { Hono } from "hono";
import { cors } from "hono/cors";
import { getDb, withAudit } from "@skarion/db-kit";
import { requireAuth, requireAppRole, type AuthedVariables } from "@skarion/auth-client";
import { can } from "@skarion/permissions";
import * as schema from "./db/schema.js";
import { eq, and, isNull, like, sql, desc } from "drizzle-orm";
import type { CrmDb } from "./db/types.js";

interface Env {
  DATABASE_URL: string;
  JWT_SECRET: string;
  APP_URL: string;
}

function isAllowedOrigin(origin: string, appUrl: string): boolean {
  if (!origin) return false;
  if (origin === appUrl) return true;
  if (origin.endsWith(".skarion.com")) return true;
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

app.use("/api/*", requireAuth);
app.use("/api/admin/*", requireAppRole("crm", ["superadmin"]));

function getRole(c: unknown): string {
  const apps = (c as { get: (key: string) => unknown }).get("apps");
  return (apps as { crm?: string } | undefined)?.crm ?? "";
}

// COMPANIES
app.get("/api/companies", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const role = getRole(c);
  const caller = { userId: c.get("userId"), managedUserIds: undefined };
  if (!role) return c.json({ error: "Forbidden." }, 403);

  const { search, industry, owner } = c.req.query();
  const conditions = [isNull(schema.companies.deletedAt)];

  if (role !== "superadmin") {
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
  const caller = { userId: c.get("userId") };
  if (!can(role, "create", { ownerId: caller.userId }, caller)) {
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
  if (!result) return c.json({ error: "Insert failed." }, 500);
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
  const caller = { userId: c.get("userId") };

  const [row] = await db.select().from(schema.companies)
    .where(and(eq(schema.companies.id, id), isNull(schema.companies.deletedAt)));
  if (!row) return c.json({ error: "Not found." }, 404);
  if (!can(role, "view", { ownerId: row.ownerId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  return c.json({ company: row });
});

app.put("/api/companies/:id", async (c) => {
  const db = getDb(c.env, schema) as CrmDb;
  const id = c.req.param("id");
  const role = getRole(c);
  const caller = { userId: c.get("userId") };

  const [existing] = await db.select().from(schema.companies)
    .where(and(eq(schema.companies.id, id), isNull(schema.companies.deletedAt)));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!can(role, "edit", { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.domain !== undefined) update.domain = body.domain;
  if (body.industry !== undefined) update.industry = body.industry;
  if (body.size !== undefined) update.size = body.size;
  if (body.address !== undefined) update.address = body.address;
  if (body.ownerId !== undefined && role === "superadmin") update.ownerId = body.ownerId;
  update.updatedAt = new Date();

  const [result] = await db.update(schema.companies).set(update)
    .where(eq(schema.companies.id, id)).returning();
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
  const caller = { userId: c.get("userId") };

  const [existing] = await db.select().from(schema.companies)
    .where(and(eq(schema.companies.id, id), isNull(schema.companies.deletedAt)));
  if (!existing) return c.json({ error: "Not found." }, 404);
  if (!can(role, "delete", { ownerId: existing.ownerId }, caller)) {
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

export default app;
