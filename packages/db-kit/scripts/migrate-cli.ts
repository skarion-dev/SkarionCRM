#!/usr/bin/env tsx
// packages/db-kit/scripts/migrate-cli.ts
//
// Usage (from any app directory):
//   tsx ../../packages/db-kit/scripts/migrate-cli.ts --folder=./drizzle --url-env=DATABASE_URL
//
// --folder    path to the drizzle-kit generated migrations folder (default: ./drizzle)
// --url-env   name of the env var holding the target connection string (default: DATABASE_URL)

import { runMigrations } from '../src/migrate.js';

function getArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function main() {
  const folder = getArg('folder', './drizzle');
  const urlEnvName = getArg('url-env', 'DATABASE_URL');
  const databaseUrl = process.env[urlEnvName];

  if (!databaseUrl) {
    console.error(`Missing env var ${urlEnvName}. Set it before running migrations.`);
    process.exit(1);
  }

  console.log(`Applying migrations from ${folder} ...`);
  await runMigrations({ databaseUrl, migrationsFolder: folder });
  console.log('Migrations applied successfully.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
