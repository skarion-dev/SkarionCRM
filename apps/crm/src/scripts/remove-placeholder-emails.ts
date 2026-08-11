import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sqlClient = neon(dbUrl);
  const db = drizzle(sqlClient, { schema });

  const result = await db
    .update(schema.leads)
    .set({ email: null })
    .where(sql`email LIKE '%@linkedin-lead.placeholder'`)
    .returning();

  console.log(`Removed ${result.length} placeholder emails from leads.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
