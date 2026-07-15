import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getDb, withAudit } from '@skarion/db-kit';
import { requireAuth, requireSuperadmin, type AuthedVariables } from '@skarion/auth-client';
import { can } from '@skarion/permissions';
import * as schema from './db/schema.js';
import { eq, and, isNull, like, sql, desc, asc, or } from 'drizzle-orm';
import type { BooksDb } from './db/types.js';

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

interface Env {
  DATABASE_URL: string;
  JWT_SECRET: string;
  APP_URL: string;
}

function isAllowedOrigin(origin: string, appUrl: string): boolean {
  if (!origin) return false;
  if (origin === appUrl) return true;
  if (origin.endsWith('.skarion.com')) return true;
  // Allow known Cloudflare Pages/Workers origins (shared-domain stopgap until custom domains)
  const knownCloudflareOrigins = new Set([
    'https://skarion-books-2r7.pages.dev',
    'https://skarion-identity-login-4hu.pages.dev',
    'https://skarion-identity-admin-dx5.pages.dev',
    'https://skarion-identity.skarion-talentos.workers.dev',
    'https://skarion-books-platform.skarion-talentos.workers.dev',
  ]);
  if (knownCloudflareOrigins.has(origin)) return true;
  if (origin.startsWith('http://localhost:')) return true;
  return false;
}

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

app.use(
  '*',
  cors({
    origin: (origin, c) => (isAllowedOrigin(origin, c.env.APP_URL) ? origin : ''),
    credentials: true,
  })
);

app.use('*', async (c, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (origin && !isAllowedOrigin(origin, c.env.APP_URL)) {
      return c.json({ error: 'CSRF: Invalid origin.' }, 403);
    }
  }
  await next();
});

app.get('/health', (c) => c.json({ status: 'ok', service: 'skarion-books-platform' }));

app.use('/api/*', requireAuth);
app.use('/api/*', requireSuperadmin());

function getRole(c: unknown): string {
  const apps = (c as { get: (key: string) => unknown }).get('apps');
  return (apps as { books?: string } | undefined)?.books ?? '';
}

// ─── HELPER: mutation rate limit (5 creations/min per user) ───
function mutationRateLimit(userId: string) {
  return checkRateLimit(`mutation:${userId}`, 5, 60000);
}

// ═══════════════════════════════════════════════════════════
// ACCOUNTS
// ═══════════════════════════════════════════════════════════

app.get('/api/accounts', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { search, type, owner } = c.req.query();
  const conditions = [isNull(schema.accounts.deletedAt)];

  if (!isSuperadmin) {
    conditions.push(eq(schema.accounts.ownerId, caller.userId));
  }
  if (search) {
    conditions.push(like(sql`lower(${schema.accounts.name})`, `%${search.toLowerCase()}%`));
  }
  if (type) conditions.push(eq(schema.accounts.type, type as any)); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (owner) conditions.push(eq(schema.accounts.ownerId, owner));

  const rows = await db
    .select()
    .from(schema.accounts)
    .where(and(...conditions))
    .orderBy(desc(schema.accounts.updatedAt))
    .limit(100);

  return c.json({ accounts: rows });
});

app.post('/api/accounts', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const rl = mutationRateLimit(caller.userId);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return c.json({ error: `Rate limit exceeded. Try again in ${rl.retryAfter} seconds.` }, 429);
  }

  const body = await c.req.json();
  const data = {
    name: body.name,
    code: body.code,
    type: body.type as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    description: body.description ?? null,
    parentId: body.parentId ?? null,
    balance: body.balance ?? '0',
    ownerId: caller.userId,
  };

  const [result] = await db.insert(schema.accounts).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'account',
    resourceId: result.id,
    after: data,
    app: 'books',
  });

  return c.json({ account: result }, 201);
});

app.get('/api/accounts/:id', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, id), isNull(schema.accounts.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  return c.json({ account: row });
});

app.put('/api/accounts/:id', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, id), isNull(schema.accounts.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.code !== undefined) update.code = body.code;
  if (body.type !== undefined) update.type = body.type;
  if (body.description !== undefined) update.description = body.description;
  if (body.parentId !== undefined) update.parentId = body.parentId;
  if (body.balance !== undefined) update.balance = body.balance;
  if (body.ownerId !== undefined && isSuperadmin) update.ownerId = body.ownerId;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.accounts)
    .set(update)
    .where(eq(schema.accounts.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'account',
    resourceId: id,
    before: existing,
    after: result,
    app: 'books',
  });

  return c.json({ account: result });
});

app.delete('/api/accounts/:id', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, id), isNull(schema.accounts.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'delete', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db
    .update(schema.accounts)
    .set({
      deletedAt: new Date(),
      deletedBy: caller.userId,
    })
    .where(eq(schema.accounts.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'account',
    resourceId: id,
    before: existing,
    app: 'books',
  });

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
// TRANSACTIONS
// ═══════════════════════════════════════════════════════════

app.get('/api/transactions', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { status, fromDate, toDate, owner } = c.req.query();
  const conditions = [isNull(schema.transactions.deletedAt)];

  if (!isSuperadmin) {
    conditions.push(eq(schema.transactions.ownerId, caller.userId));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (status) conditions.push(eq(schema.transactions.status, status as any));
  if (fromDate) conditions.push(sql`${schema.transactions.date} >= ${fromDate}`);
  if (toDate) conditions.push(sql`${schema.transactions.date} <= ${toDate}`);
  if (owner) conditions.push(eq(schema.transactions.ownerId, owner));

  const rows = await db
    .select()
    .from(schema.transactions)
    .where(and(...conditions))
    .orderBy(desc(schema.transactions.date))
    .limit(100);

  return c.json({ transactions: rows });
});

app.post('/api/transactions', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const rl = mutationRateLimit(caller.userId);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return c.json({ error: `Rate limit exceeded. Try again in ${rl.retryAfter} seconds.` }, 429);
  }

  const body = await c.req.json();
  const lines = body.lines as Array<{
    accountId: string;
    debit?: string | null;
    credit?: string | null;
    description?: string;
  }>;

  if (!Array.isArray(lines) || lines.length < 2) {
    return c.json({ error: 'A transaction must have at least 2 lines.' }, 400);
  }

  // Validate debits == credits
  const totalDebits = lines.reduce((sum, l) => sum + Number(l.debit ?? 0), 0);
  const totalCredits = lines.reduce((sum, l) => sum + Number(l.credit ?? 0), 0);
  if (Math.abs(totalDebits - totalCredits) > 0.0001) {
    return c.json({ error: `Debits (${totalDebits}) must equal credits (${totalCredits}).` }, 400);
  }

  const transactionData = {
    date: body.date,
    description: body.description ?? null,
    reference: body.reference ?? null,
    status: (body.status ?? 'draft') as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    totalAmount: String(totalDebits),
    ownerId: caller.userId,
  };

  // Insert transaction
  const [transaction] = await db.insert(schema.transactions).values(transactionData).returning();
  if (!transaction) return c.json({ error: 'Internal error' }, 500);

  // Insert transaction lines
  for (const line of lines) {
    await db.insert(schema.transactionLines).values({
      transactionId: transaction.id,
      accountId: line.accountId,
      debit: line.debit ?? null,
      credit: line.credit ?? null,
      description: line.description ?? null,
    });
  }

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'transaction',
    resourceId: transaction.id,
    after: { ...transactionData, lines },
    app: 'books',
  });

  return c.json({ transaction }, 201);
});

app.get('/api/transactions/:id', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.transactions)
    .where(and(eq(schema.transactions.id, id), isNull(schema.transactions.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const lines = await db
    .select()
    .from(schema.transactionLines)
    .where(eq(schema.transactionLines.transactionId, id))
    .orderBy(asc(schema.transactionLines.createdAt));

  return c.json({ transaction: row, lines });
});

app.put('/api/transactions/:id', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.transactions)
    .where(and(eq(schema.transactions.id, id), isNull(schema.transactions.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.date !== undefined) update.date = body.date;
  if (body.description !== undefined) update.description = body.description;
  if (body.reference !== undefined) update.reference = body.reference;
  if (body.status !== undefined) update.status = body.status;
  if (body.totalAmount !== undefined) update.totalAmount = body.totalAmount;
  if (body.ownerId !== undefined && isSuperadmin) update.ownerId = body.ownerId;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.transactions)
    .set(update)
    .where(eq(schema.transactions.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'transaction',
    resourceId: id,
    before: existing,
    after: result,
    app: 'books',
  });

  return c.json({ transaction: result });
});

app.delete('/api/transactions/:id', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.transactions)
    .where(and(eq(schema.transactions.id, id), isNull(schema.transactions.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'delete', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db
    .update(schema.transactions)
    .set({
      deletedAt: new Date(),
      deletedBy: caller.userId,
    })
    .where(eq(schema.transactions.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'transaction',
    resourceId: id,
    before: existing,
    app: 'books',
  });

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
// INVOICES
// ═══════════════════════════════════════════════════════════

app.get('/api/invoices', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { status, search, owner, fromDate, toDate } = c.req.query();
  const conditions = [isNull(schema.invoices.deletedAt)];

  if (!isSuperadmin) {
    conditions.push(eq(schema.invoices.ownerId, caller.userId));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (status) conditions.push(eq(schema.invoices.status, status as any));
  if (search) {
    conditions.push(
      or(
        like(sql`lower(${schema.invoices.number})`, `%${search.toLowerCase()}%`),
        like(sql`lower(${schema.invoices.customerName})`, `%${search.toLowerCase()}%`)
      )!
    );
  }
  if (owner) conditions.push(eq(schema.invoices.ownerId, owner));
  if (fromDate) conditions.push(sql`${schema.invoices.issueDate} >= ${fromDate}`);
  if (toDate) conditions.push(sql`${schema.invoices.issueDate} <= ${toDate}`);

  const rows = await db
    .select()
    .from(schema.invoices)
    .where(and(...conditions))
    .orderBy(desc(schema.invoices.issueDate))
    .limit(100);

  return c.json({ invoices: rows });
});

app.post('/api/invoices', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const rl = mutationRateLimit(caller.userId);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return c.json({ error: `Rate limit exceeded. Try again in ${rl.retryAfter} seconds.` }, 429);
  }

  const body = await c.req.json();
  const items = body.items as Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    taxCodeId?: string | null;
    lineTotal?: string;
  }>;

  const invoiceData = {
    number: body.number,
    customerName: body.customerName,
    customerEmail: body.customerEmail ?? null,
    issueDate: body.issueDate,
    dueDate: body.dueDate,
    status: (body.status ?? 'draft') as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    subtotal: body.subtotal ?? '0',
    taxTotal: body.taxTotal ?? '0',
    total: body.total ?? '0',
    notes: body.notes ?? null,
    ownerId: caller.userId,
  };

  const [invoice] = await db.insert(schema.invoices).values(invoiceData).returning();
  if (!invoice) return c.json({ error: 'Internal error' }, 500);

  // Insert invoice items
  if (Array.isArray(items)) {
    for (const item of items) {
      const lineTotal = item.lineTotal ?? String(Number(item.quantity) * Number(item.unitPrice));
      await db.insert(schema.invoiceItems).values({
        invoiceId: invoice.id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxCodeId: item.taxCodeId ?? null,
        lineTotal,
      });
    }
  }

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'invoice',
    resourceId: invoice.id,
    after: { ...invoiceData, items },
    app: 'books',
  });

  return c.json({ invoice }, 201);
});

app.get('/api/invoices/:id', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, id), isNull(schema.invoices.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'view', { ownerId: row.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const items = await db
    .select()
    .from(schema.invoiceItems)
    .where(eq(schema.invoiceItems.invoiceId, id))
    .orderBy(asc(schema.invoiceItems.createdAt));

  return c.json({ invoice: row, items });
});

app.put('/api/invoices/:id', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, id), isNull(schema.invoices.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.number !== undefined) update.number = body.number;
  if (body.customerName !== undefined) update.customerName = body.customerName;
  if (body.customerEmail !== undefined) update.customerEmail = body.customerEmail;
  if (body.issueDate !== undefined) update.issueDate = body.issueDate;
  if (body.dueDate !== undefined) update.dueDate = body.dueDate;
  if (body.status !== undefined) update.status = body.status;
  if (body.subtotal !== undefined) update.subtotal = body.subtotal;
  if (body.taxTotal !== undefined) update.taxTotal = body.taxTotal;
  if (body.total !== undefined) update.total = body.total;
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.ownerId !== undefined && isSuperadmin) update.ownerId = body.ownerId;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.invoices)
    .set(update)
    .where(eq(schema.invoices.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'invoice',
    resourceId: id,
    before: existing,
    after: result,
    app: 'books',
  });

  return c.json({ invoice: result });
});

app.put('/api/invoices/:id/mark-paid', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, id), isNull(schema.invoices.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const [result] = await db
    .update(schema.invoices)
    .set({
      status: 'paid' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      updatedAt: new Date(),
    })
    .where(eq(schema.invoices.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'mark-paid',
    resourceType: 'invoice',
    resourceId: id,
    before: existing,
    after: result,
    app: 'books',
  });

  return c.json({ invoice: result });
});

app.delete('/api/invoices/:id', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, id), isNull(schema.invoices.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'delete', { ownerId: existing.ownerId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db
    .update(schema.invoices)
    .set({
      deletedAt: new Date(),
      deletedBy: caller.userId,
    })
    .where(eq(schema.invoices.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'invoice',
    resourceId: id,
    before: existing,
    app: 'books',
  });

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
// TAX CODES
// ═══════════════════════════════════════════════════════════

app.get('/api/tax-codes', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const role = getRole(c);
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { search, jurisdiction } = c.req.query();
  const conditions = [isNull(schema.taxCodes.deletedAt)];

  if (search) {
    conditions.push(like(sql`lower(${schema.taxCodes.name})`, `%${search.toLowerCase()}%`));
  }
  if (jurisdiction) conditions.push(eq(schema.taxCodes.jurisdiction, jurisdiction));

  const rows = await db
    .select()
    .from(schema.taxCodes)
    .where(and(...conditions))
    .orderBy(desc(schema.taxCodes.updatedAt))
    .limit(100);

  return c.json({ taxCodes: rows });
});

app.post('/api/tax-codes', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'create', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const rl = mutationRateLimit(caller.userId);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return c.json({ error: `Rate limit exceeded. Try again in ${rl.retryAfter} seconds.` }, 429);
  }

  const body = await c.req.json();
  const data = {
    name: body.name,
    rate: body.rate,
    jurisdiction: body.jurisdiction ?? null,
    description: body.description ?? null,
  };

  const [result] = await db.insert(schema.taxCodes).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'tax_code',
    resourceId: result.id,
    after: data,
    app: 'books',
  });

  return c.json({ taxCode: result }, 201);
});

app.get('/api/tax-codes/:id', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.taxCodes)
    .where(and(eq(schema.taxCodes.id, id), isNull(schema.taxCodes.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  // Tax codes are global; no owner-based permission check for view
  if (!can(isSuperadmin, role, 'view', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  return c.json({ taxCode: row });
});

app.put('/api/tax-codes/:id', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.taxCodes)
    .where(and(eq(schema.taxCodes.id, id), isNull(schema.taxCodes.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'edit', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.rate !== undefined) update.rate = body.rate;
  if (body.jurisdiction !== undefined) update.jurisdiction = body.jurisdiction;
  if (body.description !== undefined) update.description = body.description;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.taxCodes)
    .set(update)
    .where(eq(schema.taxCodes.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'tax_code',
    resourceId: id,
    before: existing,
    after: result,
    app: 'books',
  });

  return c.json({ taxCode: result });
});

app.delete('/api/tax-codes/:id', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.taxCodes)
    .where(and(eq(schema.taxCodes.id, id), isNull(schema.taxCodes.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (!can(isSuperadmin, role, 'delete', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db
    .update(schema.taxCodes)
    .set({
      deletedAt: new Date(),
      deletedBy: caller.userId,
    })
    .where(eq(schema.taxCodes.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'tax_code',
    resourceId: id,
    before: existing,
    app: 'books',
  });

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
// ADMIN / AUDIT LOG
// ═══════════════════════════════════════════════════════════

app.get('/api/admin/audit-log', async (c) => {
  const db = getDb(c.env, schema) as BooksDb;
  const isSuperadmin = c.get('isSuperadmin');
  if (!isSuperadmin) return c.json({ error: 'Forbidden.' }, 403);

  const rows = await db
    .select()
    .from(schema.auditLog)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(200);
  return c.json({ auditLog: rows });
});

export default app;
