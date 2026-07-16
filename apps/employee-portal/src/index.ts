import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getDb, withAudit } from '@skarion/db-kit';
import { requireAuth, type AuthedVariables } from '@skarion/auth-client';
import { can } from '@skarion/permissions';
import * as schema from './db/schema.js';
import { eq, and, isNull, like, sql, desc, or, type SQL } from 'drizzle-orm';
import type { HrDb } from './db/types.js';

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
  ALLOWED_ORIGINS?: string;
}

function isAllowedOrigin(origin: string, appUrl: string, allowedOriginsEnv?: string): boolean {
  if (!origin) return false;
  if (origin === appUrl) return true;
  if (origin.endsWith('.skarion.com')) return true;
  const knownCloudflareOrigins = new Set([
    'https://skarion-hr-4in.pages.dev',
    'https://skarion-identity-login-4hu.pages.dev',
    'https://skarion-identity-admin-dx5.pages.dev',
    'https://skarion-identity.skarion-talentos.workers.dev',
    'https://skarion-hr-platform.skarion-talentos.workers.dev',
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
    origin: (origin, c) => (isAllowedOrigin(origin, c.env.APP_URL, c.env.ALLOWED_ORIGINS) ? origin : ''),
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

app.get('/health', (c) => c.json({ status: 'ok', service: 'skarion-hr-platform' }));

app.use('/api/*', requireAuth);

function getRole(c: unknown): string {
  const apps = (c as { get: (key: string) => unknown }).get('apps');
  return (apps as { hr?: string } | undefined)?.hr ?? '';
}

function mutationRateLimit(userId: string) {
  return checkRateLimit(`hr_mutation:${userId}`, 5, 60000);
}

// ═══════════════════════════════════════════════════════════
// DEPARTMENTS
// ═══════════════════════════════════════════════════════════

app.get('/api/departments', async (c) => {
  const db = getDb(c.env, schema) as HrDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const _caller = { userId: c.get('userId'), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { search } = c.req.query();
  const conditions = [isNull(schema.departments.deletedAt)];

  if (search) {
    conditions.push(like(sql`lower(${schema.departments.name})`, `%${search.toLowerCase()}%`));
  }

  const rows = await db
    .select()
    .from(schema.departments)
    .where(and(...conditions))
    .orderBy(desc(schema.departments.name))
    .limit(100);

  return c.json({ departments: rows });
});

app.post('/api/departments', async (c) => {
  const db = getDb(c.env, schema) as HrDb;
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
    description: body.description ?? null,
    managerUserId: body.managerUserId ?? null,
    parentId: body.parentId ?? null,
  };

  const [result] = await db.insert(schema.departments).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'department',
    resourceId: result.id,
    after: data,
    app: 'hr',
  });

  return c.json({ department: result }, 201);
});

app.get('/api/departments/:id', async (c) => {
  const db = getDb(c.env, schema) as HrDb;
  const id = c.req.param('id');
  const _role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const _caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.departments)
    .where(and(eq(schema.departments.id, id), isNull(schema.departments.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);

  return c.json({ department: row });
});

app.put('/api/departments/:id', async (c) => {
  const db = getDb(c.env, schema) as HrDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'edit', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const [existing] = await db
    .select()
    .from(schema.departments)
    .where(and(eq(schema.departments.id, id), isNull(schema.departments.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.description !== undefined) update.description = body.description;
  if (body.managerUserId !== undefined) update.managerUserId = body.managerUserId;
  if (body.parentId !== undefined) update.parentId = body.parentId;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.departments)
    .set(update)
    .where(eq(schema.departments.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'department',
    resourceId: id,
    before: existing,
    after: result,
    app: 'hr',
  });

  return c.json({ department: result });
});

app.delete('/api/departments/:id', async (c) => {
  const db = getDb(c.env, schema) as HrDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'delete', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const [existing] = await db
    .select()
    .from(schema.departments)
    .where(and(eq(schema.departments.id, id), isNull(schema.departments.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);

  await db
    .update(schema.departments)
    .set({
      deletedAt: new Date(),
      deletedBy: caller.userId,
    })
    .where(eq(schema.departments.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'department',
    resourceId: id,
    before: existing,
    app: 'hr',
  });

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
// EMPLOYEES
// ═══════════════════════════════════════════════════════════

app.get('/api/employees', async (c) => {
  const db = getDb(c.env, schema) as HrDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const _caller = { userId: c.get('userId'), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { search, departmentId } = c.req.query();
  const conditions: SQL<unknown>[] = [isNull(schema.employees.deletedAt)];

  if (search) {
    conditions.push(
      or(
        like(sql`lower(${schema.employees.employeeNumber})`, `%${search.toLowerCase()}%`),
        like(sql`lower(${schema.employees.position})`, `%${search.toLowerCase()}%`)
      ) as SQL<unknown>
    );
  }
  if (departmentId) conditions.push(eq(schema.employees.departmentId, departmentId));

  const rows = await db
    .select()
    .from(schema.employees)
    .where(and(...conditions))
    .orderBy(desc(schema.employees.updatedAt))
    .limit(100);

  return c.json({
    employees: rows.map((e) => {
      if (!isSuperadmin && role !== 'manager') {
        const { salary: _salary, salaryCurrency: _salaryCurrency, ...rest } = e;
        return { ...rest, salary: null, salaryCurrency: 'USD' };
      }
      return e;
    }),
  });
});

app.post('/api/employees', async (c) => {
  const db = getDb(c.env, schema) as HrDb;
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
    userId: body.userId,
    employeeNumber: body.employeeNumber ?? null,
    departmentId: body.departmentId ?? null,
    position: body.position ?? null,
    hireDate: body.hireDate ?? null,
    salary: body.salary ? Number(body.salary) : null,
    salaryCurrency: body.salaryCurrency ?? 'USD',
    employmentType: body.employmentType ?? 'full_time',
    emergencyContact: body.emergencyContact ?? null,
  };

  const [result] = await db.insert(schema.employees).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'employee',
    resourceId: result.id,
    after: data,
    app: 'hr',
  });

  return c.json({ employee: result }, 201);
});

app.get('/api/employees/:id', async (c) => {
  const db = getDb(c.env, schema) as HrDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const _caller = { userId: c.get('userId'), isSuperadmin };

  const [row] = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.id, id), isNull(schema.employees.deletedAt)));
  if (!row) return c.json({ error: 'Not found.' }, 404);

  if (!isSuperadmin && role !== 'manager') {
    const { salary: _salary, salaryCurrency: _salaryCurrency, ...rest } = row;
    return c.json({ employee: { ...rest, salary: null, salaryCurrency: 'USD' } });
  }

  return c.json({ employee: row });
});

app.put('/api/employees/:id', async (c) => {
  const db = getDb(c.env, schema) as HrDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'edit', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const [existing] = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.id, id), isNull(schema.employees.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  if (body.employeeNumber !== undefined) update.employeeNumber = body.employeeNumber;
  if (body.departmentId !== undefined) update.departmentId = body.departmentId;
  if (body.position !== undefined) update.position = body.position;
  if (body.hireDate !== undefined) update.hireDate = body.hireDate;
  if (body.salary !== undefined) update.salary = body.salary ? Number(body.salary) : null;
  if (body.salaryCurrency !== undefined) update.salaryCurrency = body.salaryCurrency;
  if (body.employmentType !== undefined) update.employmentType = body.employmentType;
  if (body.emergencyContact !== undefined) update.emergencyContact = body.emergencyContact;
  update.updatedAt = new Date();

  const [result] = await db
    .update(schema.employees)
    .set(update)
    .where(eq(schema.employees.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'edit',
    resourceType: 'employee',
    resourceId: id,
    before: existing,
    after: result,
    app: 'hr',
  });

  return c.json({ employee: result });
});

app.delete('/api/employees/:id', async (c) => {
  const db = getDb(c.env, schema) as HrDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!can(isSuperadmin, role, 'delete', { ownerId: caller.userId }, caller)) {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const [existing] = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.id, id), isNull(schema.employees.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);

  await db
    .update(schema.employees)
    .set({
      deletedAt: new Date(),
      deletedBy: caller.userId,
    })
    .where(eq(schema.employees.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'employee',
    resourceId: id,
    before: existing,
    app: 'hr',
  });

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════
// TIME OFF REQUESTS
// ═══════════════════════════════════════════════════════════

app.get('/api/time-off', async (c) => {
  const db = getDb(c.env, schema) as HrDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), managedUserIds: undefined, isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const { status, employeeId } = c.req.query();
  const conditions = [isNull(schema.timeOffRequests.deletedAt)];

  if (!isSuperadmin && role === 'member') {
    const [emp] = await db
      .select()
      .from(schema.employees)
      .where(and(eq(schema.employees.userId, caller.userId), isNull(schema.employees.deletedAt)));
    if (emp) {
      conditions.push(eq(schema.timeOffRequests.employeeId, emp.id));
    } else {
      return c.json({ timeOffRequests: [] });
    }
  }
  if (status)
    conditions.push(
      eq(
        schema.timeOffRequests.status,
        status as (typeof schema.timeOffStatusEnum.enumValues)[number]
      )
    );
  if (employeeId && (isSuperadmin || role === 'manager')) {
    conditions.push(eq(schema.timeOffRequests.employeeId, employeeId));
  }

  const rows = await db
    .select()
    .from(schema.timeOffRequests)
    .where(and(...conditions))
    .orderBy(desc(schema.timeOffRequests.createdAt))
    .limit(100);

  return c.json({ timeOffRequests: rows });
});

app.post('/api/time-off', async (c) => {
  const db = getDb(c.env, schema) as HrDb;
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };
  if (!role) return c.json({ error: 'Forbidden.' }, 403);

  const rl = mutationRateLimit(caller.userId);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return c.json({ error: `Rate limit exceeded. Try again in ${rl.retryAfter} seconds.` }, 429);
  }

  const body = await c.req.json();
  const [emp] = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.userId, caller.userId), isNull(schema.employees.deletedAt)));
  if (!emp) return c.json({ error: 'Employee record not found.' }, 404);

  const data = {
    employeeId: emp.id,
    type: body.type as (typeof schema.timeOffTypeEnum.enumValues)[number],
    startDate: body.startDate,
    endDate: body.endDate,
    reason: body.reason ?? null,
    status: 'pending' as const,
  };

  const [result] = await db.insert(schema.timeOffRequests).values(data).returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'create',
    resourceType: 'time_off_request',
    resourceId: result.id,
    after: data,
    app: 'hr',
  });

  return c.json({ timeOffRequest: result }, 201);
});

app.put('/api/time-off/:id/review', async (c) => {
  const db = getDb(c.env, schema) as HrDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  if (!can(isSuperadmin, role, 'edit', { ownerId: '' }, caller)) {
    if (role !== 'manager') return c.json({ error: 'Forbidden.' }, 403);
  }

  const body = await c.req.json<{ status: 'approved' | 'rejected' }>();
  if (!['approved', 'rejected'].includes(body.status)) {
    return c.json({ error: 'Invalid status. Must be approved or rejected.' }, 400);
  }

  const [existing] = await db
    .select()
    .from(schema.timeOffRequests)
    .where(and(eq(schema.timeOffRequests.id, id), isNull(schema.timeOffRequests.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);
  if (existing.status !== 'pending') return c.json({ error: 'Request already reviewed.' }, 400);

  const update = {
    status: body.status as (typeof schema.timeOffStatusEnum.enumValues)[number],
    approvedBy: caller.userId,
    approvedAt: new Date(),
    updatedAt: new Date(),
  };

  const [result] = await db
    .update(schema.timeOffRequests)
    .set(update)
    .where(eq(schema.timeOffRequests.id, id))
    .returning();
  if (!result) return c.json({ error: 'Internal error' }, 500);
  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: body.status === 'approved' ? 'approve' : 'reject',
    resourceType: 'time_off_request',
    resourceId: id,
    before: existing,
    after: result,
    app: 'hr',
  });

  return c.json({ timeOffRequest: result });
});

app.delete('/api/time-off/:id', async (c) => {
  const db = getDb(c.env, schema) as HrDb;
  const id = c.req.param('id');
  const role = getRole(c);
  const isSuperadmin = c.get('isSuperadmin');
  const caller = { userId: c.get('userId'), isSuperadmin };

  const [existing] = await db
    .select()
    .from(schema.timeOffRequests)
    .where(and(eq(schema.timeOffRequests.id, id), isNull(schema.timeOffRequests.deletedAt)));
  if (!existing) return c.json({ error: 'Not found.' }, 404);

  const [emp] = await db
    .select()
    .from(schema.employees)
    .where(and(eq(schema.employees.id, existing.employeeId), isNull(schema.employees.deletedAt)));
  if (!emp) return c.json({ error: 'Employee not found.' }, 404);

  const isOwn = emp.userId === caller.userId;
  if (!isSuperadmin && !isOwn && role !== 'manager') {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  await db
    .update(schema.timeOffRequests)
    .set({
      deletedAt: new Date(),
      deletedBy: caller.userId,
    })
    .where(eq(schema.timeOffRequests.id, id));

  await withAudit(db, schema.auditLog, {
    actorUserId: caller.userId,
    action: 'delete',
    resourceType: 'time_off_request',
    resourceId: id,
    before: existing,
    app: 'hr',
  });

  return c.json({ success: true });
});

app.get('/debug/version', (c) =>
  c.json({
    app: 'employee-portal',
    deployedAt: new Date().toISOString(),
  })
);

export default app;
