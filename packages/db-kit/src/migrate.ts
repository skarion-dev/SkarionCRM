// packages/db-kit/src/migrate.ts
//
// Applies already-generated SQL migrations (from `drizzle-kit generate`)
// against a target database. Uses drizzle-orm's neon-http migrator, which
// talks to Neon over HTTP — no `psql` binary required, so this works
// identically in GitHub Actions and on a local machine that doesn't have
// the Postgres client tools installed.
//
// `drizzle-kit generate` itself is still run as its own CLI step (per app,
// since each app/schema has its own drizzle.config.ts) - this module only
// covers "apply".

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

export interface RunMigrationsOptions {
  databaseUrl: string;
  migrationsFolder: string;
}

export async function runMigrations({
  databaseUrl,
  migrationsFolder,
}: RunMigrationsOptions): Promise<void> {
  if (!databaseUrl) throw new Error('runMigrations: databaseUrl is required');
  const sql = neon(databaseUrl);
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder });
}
