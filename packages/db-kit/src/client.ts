// packages/db-kit/src/client.ts
//
// getDb(env) returns a typed Drizzle client for a given schema, reading
// DATABASE_URL from Worker env bindings.
//
// IMPORTANT — Hyperdrive vs neon-http, read before changing the transport:
// `@neondatabase/serverless`'s `neon()` function is an HTTP-fetch driver —
// each query is a fetch() call to Neon's Data API, no persistent connection.
// Cloudflare Hyperdrive, by contrast, proxies the *Postgres wire protocol*
// (TCP) and pools/caches real connections — it does not speak to Neon's HTTP
// endpoint, so it cannot accelerate the neon-http driver as configured here.
// To get Hyperdrive's pooling benefit you'd bind Hyperdrive in wrangler.toml
// and connect with a TCP-capable driver (drizzle-orm/node-postgres or
// postgres.js over Workers TCP sockets) using the Hyperdrive connection
// string instead of DATABASE_URL. That's a separate code path from this one.
// Shipping neon-http now (zero extra infra, works the moment DATABASE_URL is
// set) and documenting the Hyperdrive swap as a deliberate follow-up once
// Hyperdrive is actually provisioned (ticket 1.8 prereq) and we've measured
// whether neon-http's per-query latency is actually a problem in practice.

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';

export interface DbEnv {
  DATABASE_URL: string;
}

/**
 * Returns a typed Drizzle client bound to the given schema.
 * Call once per request in a Worker (neon-http has no connection to reuse
 * across requests anyway, so there's no pooling concern at this layer).
 */
export function getDb<TSchema extends Record<string, unknown>>(
  env: DbEnv,
  schema: TSchema
): NeonHttpDatabase<TSchema> {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Check Worker secrets / .dev.vars.');
  }
  const sql = neon(env.DATABASE_URL);
  return drizzle(sql, { schema });
}

export type Db<TSchema extends Record<string, unknown> = Record<string, unknown>> =
  NeonHttpDatabase<TSchema>;
