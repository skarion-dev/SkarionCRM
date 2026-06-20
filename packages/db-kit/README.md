# @skarion/db-kit

Shared Drizzle + Neon helpers used by every app (identity, crm, employee-portal, accounting).

## `getDb(env, schema)`

Returns a typed Drizzle client using the `neon-http` driver (HTTP fetch, no
persistent connection — see the comment in `src/client.ts` for why this is
_not_ the same transport Hyperdrive accelerates).

```ts
import { getDb } from '@skarion/db-kit';
import * as schema from './db/schema.js';

const db = getDb(env, schema);
```

## Mixins

```ts
import { timestamps, softDelete } from '@skarion/db-kit';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  ...timestamps(),
  ...softDelete(),
});
```

## `withAudit`

Writes one row to whichever `audit_log`-shaped table you pass it (each
Postgres schema owns its own audit_log table).

```ts
import { withAudit } from '@skarion/db-kit';
import { auditLog } from './db/schema.js';

await withAudit(db, auditLog, {
  actorUserId: user.id,
  action: 'user.disable',
  resourceType: 'user',
  resourceId: targetUserId,
  before: { disabledAt: null },
  after: { disabledAt: new Date().toISOString() },
});
```

## Migrations

Each app owns its own `drizzle.config.ts` and runs `drizzle-kit generate`
directly (it needs per-app schema context that db-kit doesn't have). Applying
already-generated migrations goes through this package so every app applies
the same way, with no `psql` binary dependency:

```bash
# from an app directory, e.g. apps/identity
pnpm drizzle-kit generate
tsx ../../packages/db-kit/scripts/migrate-cli.ts --folder=./drizzle
```

## Neon PR branching

See `.github/workflows/neon-branch-preview.yml` at the repo root — creates a
temporary Neon branch per PR, runs migrations against it, tears it down on
close. Needs `NEON_API_KEY` / `NEON_PROJECT_ID` repo secrets (ticket 1.8).
