// apps/identity/src/scripts/seed-admin.ts
// Seeds (or recovers) the admin user in the identity database.
// Run after identity migrations: tsx apps/identity/src/scripts/seed-admin.ts
// Requires DATABASE_URL env var.
//
// By default, if ADMIN_EMAIL already exists, this only upgrades it to
// superadmin if needed - it does NOT touch the password, so it's safe to
// re-run without clobbering a working login. Set FORCE_RESET_PASSWORD=true
// to also overwrite the existing user's password (account-recovery path,
// e.g. when the original password was lost) - this also bumps
// tokenVersion so any old sessions/JWTs for that user are invalidated,
// matching the same pattern used by resetPassword() in services/auth.ts.

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { hashPassword } from '../lib/password.js';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@skarion.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme-now';
const ADMIN_NAME = process.env.ADMIN_NAME || 'System Admin';
const FORCE_RESET_PASSWORD = process.env.FORCE_RESET_PASSWORD === 'true';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sqlClient = neon(dbUrl);
  const db = drizzle(sqlClient, { schema });

  const existing = await db.query.users.findFirst({
    where: (t, { sql: s }) => s`lower(${t.email}) = lower(${ADMIN_EMAIL})`,
  });

  if (existing) {
    console.log(`Admin user already exists: ${ADMIN_EMAIL} (id=${existing.id})`);
    if (!existing.isSuperadmin) {
      await db
        .update(schema.users)
        .set({ isSuperadmin: true })
        .where(sql`id = ${existing.id}`);
      console.log('Upgraded to superadmin.');
    }
    if (FORCE_RESET_PASSWORD) {
      const passwordHash = await hashPassword(ADMIN_PASSWORD);
      await db
        .update(schema.users)
        .set({
          passwordHash,
          disabledAt: null,
          tokenVersion: sql`${schema.users.tokenVersion} + 1`,
        })
        .where(sql`id = ${existing.id}`);
      console.log('Password reset and all existing sessions invalidated.');
      console.log(`  New password: ${ADMIN_PASSWORD}`);
    }
    return;
  }

  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const [user] = await db
    .insert(schema.users)
    .values({
      email: ADMIN_EMAIL,
      displayName: ADMIN_NAME,
      passwordHash,
      isSuperadmin: true,
    })
    .returning();

  await db.insert(schema.appMemberships).values({
    userId: user.id,
    app: 'crm',
    role: 'manager',
  });

  console.log(`Admin user created:`);
  console.log(`  Email:    ${ADMIN_EMAIL}`);
  console.log(`  Password: ${ADMIN_PASSWORD}`);
  console.log(`  ID:       ${user.id}`);
  console.log(`  Superadmin: true`);
  console.log(`  CRM role: manager`);
  console.log(`\nIMPORTANT: Change the password immediately after first login.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
