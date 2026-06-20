// packages/db-kit/src/mixins.ts
// Spread these into a pgTable() column definition object.
//
//   export const users = pgTable('users', {
//     id: uuid('id').defaultRandom().primaryKey(),
//     ...timestamps(),
//     ...softDelete(),
//   });

import { timestamp, uuid } from 'drizzle-orm/pg-core';

export function timestamps() {
  return {
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  };
}

export function softDelete() {
  return {
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
  };
}
