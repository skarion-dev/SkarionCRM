// apps/identity/src/db/schema.ts
// Identity Postgres schema. Lives in its own `identity` Postgres schema
// (set via drizzle.config.ts schemaFilter / search_path), separate from
// crm/hr/books per the multi-schema plan.
//
// Note on email uniqueness: the spec calls for `citext` for case-insensitive
// email matching. This drizzle-orm version has no native citext column type,
// and citext requires `CREATE EXTENSION citext` (works on Neon, but is an
// extra moving part). Using `text` + a unique index on `lower(email)` gets
// the same case-insensitive-uniqueness guarantee with zero extension
// dependency. Application code must query with `lower(email) = lower($1)`
// to get the case-insensitive lookup; this is wrapped in the auth service,
// not left to callers.
//
// Note on the inlined `timestamps()` below: @skarion/db-kit has the same
// helper, but `drizzle-kit generate` resolves workspace packages (via the
// pnpm node_modules symlink) as external and loads them with a plain Node
// `require()`, which can't follow this package's `.js`-suffixed relative
// imports back to their `.ts` source. Every schema file fed to drizzle-kit
// needs to avoid importing workspace packages for this reason - inline
// small helpers here; keep db-kit's copy as the canonical one for runtime
// (non-drizzle-kit) code.

import { relations, sql } from 'drizzle-orm';
import {
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  integer,
  boolean,
  index,
  uuid,
  jsonb,
  inet,
} from 'drizzle-orm/pg-core';

function timestamps() {
  return {
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  };
}

export const identitySchema = pgSchema('identity');

export const appEnum = identitySchema.enum('app', ['crm', 'hr', 'books']);

// ─────────────────────────────────────────────────────────
// users
// ─────────────────────────────────────────────────────────
export const users = identitySchema.table(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    passwordHash: text('password_hash'),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    // Bumped on password change / forced logout to invalidate already-issued
    // access JWTs (their embedded `ver` claim stops matching on next check).
    tokenVersion: integer('token_version').notNull().default(1),
    isSuperadmin: boolean('is_superadmin').default(false).notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [uniqueIndex('idx_users_email_lower').on(sql`lower(${table.email})`)]
);

// ─────────────────────────────────────────────────────────
// app_memberships
// ─────────────────────────────────────────────────────────
export const appMemberships = identitySchema.table(
  'app_memberships',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    app: appEnum('app').notNull(),
    role: text('role').notNull(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('idx_app_memberships_pk').on(table.userId, table.app),
    index('idx_app_memberships_user').on(table.userId),
  ]
);

// ─────────────────────────────────────────────────────────
// invitations
// ─────────────────────────────────────────────────────────
export const invitations = identitySchema.table(
  'invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    app: appEnum('app').notNull(),
    role: text('role').notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'set null' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_invitations_email_app').on(table.email, table.app),
    uniqueIndex('idx_invitations_token_hash').on(table.tokenHash),
  ]
);

// ─────────────────────────────────────────────────────────
// sessions
// ─────────────────────────────────────────────────────────
export const sessions = identitySchema.table(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('idx_sessions_refresh_token_hash').on(table.refreshTokenHash),
    index('idx_sessions_user').on(table.userId),
  ]
);

// ─────────────────────────────────────────────────────────
// password_reset_tokens
// ─────────────────────────────────────────────────────────
export const passwordResetTokens = identitySchema.table(
  'password_reset_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('idx_password_reset_token_hash').on(table.tokenHash),
    index('idx_password_reset_user').on(table.userId),
  ]
);

// ─────────────────────────────────────────────────────────
// mfa_secrets
// ─────────────────────────────────────────────────────────
export const mfaSecrets = identitySchema.table('mfa_secrets', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  totpSecretEncrypted: text('totp_secret_encrypted').notNull(),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }),
  recoveryCodesHashes: text('recovery_codes_hashes').array(),
});

// ─────────────────────────────────────────────────────────
// oauth_accounts (future Google SSO)
// ─────────────────────────────────────────────────────────
export const oauthAccounts = identitySchema.table(
  'oauth_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_oauth_provider_account').on(table.provider, table.providerAccountId),
    index('idx_oauth_user').on(table.userId),
  ]
);

// ─────────────────────────────────────────────────────────
// audit_log
// ─────────────────────────────────────────────────────────
export const auditLog = identitySchema.table(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    app: appEnum('app'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_audit_actor').on(table.actorUserId),
    index('idx_audit_resource').on(table.resourceType, table.resourceId),
    index('idx_audit_created').on(table.createdAt),
  ]
);

// ─────────────────────────────────────────────────────────
// login_otp_codes
// ─────────────────────────────────────────────────────────
export const loginOtpCodes = identitySchema.table(
  'login_otp_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    pendingTokenHash: text('pending_token_hash').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_login_otp_pending_token_hash').on(table.pendingTokenHash),
    index('idx_login_otp_user').on(table.userId),
  ]
);

// ─────────────────────────────────────────────────────────
// relations
// ─────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  appMemberships: many(appMemberships),
  sessions: many(sessions),
  oauthAccounts: many(oauthAccounts),
  loginOtpCodes: many(loginOtpCodes),
}));

export const appMembershipsRelations = relations(appMemberships, ({ one }) => ({
  user: one(users, { fields: [appMemberships.userId], references: [users.id] }),
  grantedByUser: one(users, { fields: [appMemberships.grantedBy], references: [users.id] }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  invitedByUser: one(users, { fields: [invitations.invitedBy], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const oauthAccountsRelations = relations(oauthAccounts, ({ one }) => ({
  user: one(users, { fields: [oauthAccounts.userId], references: [users.id] }),
}));

export const loginOtpCodesRelations = relations(loginOtpCodes, ({ one }) => ({
  user: one(users, { fields: [loginOtpCodes.userId], references: [users.id] }),
}));
