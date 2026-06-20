# Instructions for Kimi: fix Chunk 2, then start Chunk 3

Pull `cloudflare-platform-rewrite` before reading further — it now
includes commit `d355704` (Claude's fixes to your Chunk 2 push) and
`7314848` (this doc's companion, `handover-chunk3-kimi.md`, with the full
Chunk 3 spec). This doc is the short, sequential version: do these in
order, top to bottom.

## Step 0 — Pull and confirm you're caught up

```bash
git fetch origin
git checkout cloudflare-platform-rewrite
git pull
```

You should see commits `d355704` and `7314848` in your log. If you don't,
stop and re-sync before touching anything — don't build on a stale base.

## Step 1 — Understand what Claude already fixed in your Chunk 2 push

Don't redo these, just know they happened:

1. **`deploy-crm.yml` now pushes Worker secrets correctly.** Your version
   deployed the Worker but never ran `wrangler secret put` for
   `DATABASE_URL`/`JWT_SECRET` — setting `env:` on a wrangler-action step
   only affects the GitHub Actions runner, not the deployed Worker. Every
   DB-backed and auth-checked CRM route was running with undefined
   secrets in production. Fixed to match `deploy-identity.yml`'s pattern.
2. **`apps/crm/web/src/api.ts` is new, and `App.tsx` now uses it.** Your
   original `App.tsx` stored the access token in `localStorage` and
   expected identity to redirect back with a `?token=` query param —
   identity's login app never does that, so the flow couldn't have
   worked at all, and `localStorage` for a JWT is an XSS-amplification
   risk this project avoids everywhere else. The new `api.ts` keeps the
   token in a module-level variable and refreshes it via a credentialed
   `fetch('https://auth.skarion.com/auth/refresh')` (browser attaches the
   httpOnly cookie automatically). **Every frontend ticket you build from
   here imports from this file — do not reintroduce localStorage token
   storage.**
3. **`apps/crm/web` now has a `tsconfig.json` and `typecheck`/`lint`
   scripts.** It had neither before, which meant the root `pnpm
typecheck`/`pnpm lint` silently skipped it entirely — for both of us,
   this whole time. It's wired into CI now and will fail loudly if a
   ticket doesn't pass both.
4. Added `public/_headers` (real CSP) and `public/_redirects` (SPA
   routing) to `apps/crm/web`, matching the other two Pages apps. Bumped
   React 18 → 19.2.7 to match the rest of the monorepo.

Run this now to confirm your local state matches what's expected:

```bash
pnpm install
pnpm typecheck   # expect 22/22 passing
pnpm lint        # expect 18/18 passing
```

If either fails, something didn't pull cleanly — fix that before
proceeding, don't work around it.

## Step 2 — Finish the Chunk 2 API surface (ticket 3.0, do this before any UI)

Your Chunk 2 push only built CRUD for `companies`. `contacts`, `leads`,
`opportunities`, `activities`, `tasks` have full schema tables in
`apps/crm/src/db/schema.ts` and **zero API routes**. Chunk 3 is a
frontend chunk — it cannot be built against an API that doesn't exist
yet, so this is the actual first step of Chunk 3, not leftover Chunk 2
work.

For each of the five missing entities, replicate the exact pattern
already in `apps/crm/src/index.ts`'s companies routes:

- `GET /api/<entity>` — list, scoped to the caller's own records unless
  their role is `superadmin` (or `manager` per `canList()` in
  `@skarion/permissions`), with the same `search`/filter-by-field query
  params pattern companies uses
- `GET /api/<entity>/:id` — single record, `can(role, "view", ...)` check
- `POST /api/<entity>` — create, `can(role, "create", ...)` check,
  `withAudit(db, schema.auditLog, {...})` after insert
- `PUT /api/<entity>/:id` — edit, `can(role, "edit", ...)` check,
  `withAudit` with `before`/`after`
- `DELETE /api/<entity>/:id` — **soft** delete only (`deletedAt`/
  `deletedBy`, never a real SQL `DELETE`), `can(role, "delete", ...)`
  check, `withAudit`

Also add `POST /api/leads/:id/convert` — creates a contact (and a
company, if `companyDomain` doesn't match an existing one) from the
lead's fields, then sets `convertedToContactId`, `convertedToCompanyId`,
`convertedAt` on the lead row. The schema already has those three
columns; nothing currently writes to them.

**Two real bugs to fix while you're in this file, found in review:**

- `idx_companies_domain_lower` and `idx_contacts_email_lower` are named
  as if they lowercase the value, but the actual generated SQL is
  `CREATE UNIQUE INDEX ... ON ... ("domain")` — no `lower()` call at all.
  `Acme.com` and `acme.com` currently collide as different companies.
  Fix in the schema (`apps/crm/src/db/schema.ts`) using
  `uniqueIndex(...).on(sql\`lower(${table.domain})\`)`. This exactly
matches the case-insensitive-email pattern already used for
`users.email`in`apps/identity/src/db/schema.ts`— copy it. Since the
original migration is already applied to production, generate a new
migration for this change (run`pnpm db:generate`from`apps/crm`) —
  don't hand-edit the already-applied SQL file.
- The CSV importers in `packages/importers` typecheck and have correct
  logic but are never called from any API route — dead code right now.
  Wire `POST /api/import/contacts`, `/api/import/companies`,
  `/api/import/leads` (decide multipart vs. raw-text body) so ticket 3.5
  (import UI) has something real to call. If you decide importers don't
  belong in this chunk after all, say so explicitly in your commit
  message rather than leaving it silently unused.

**Validate before moving on:** for at least one of the five entities, run
a real database check — a throwaway script (use
`postgres.js`/`drizzle-orm/postgres-js` against a local Postgres, since
`@neondatabase/serverless`'s `neon-http` driver can't reach a non-Neon
host — see `packages/db-kit/README.md`) that creates a record, lists it
back, edits it, soft-deletes it, and asserts an `audit_log` row exists
for each mutation. Delete the script before committing. `pnpm typecheck`
and `pnpm lint` clean across the whole repo, not just `apps/crm`.

## Step 3 — One thing that needs Abdullah, not you

While fixing your Pages deploy, you reconfigured the **existing**
Cloudflare Pages project `skarion-crm` (previously wired to the legacy
`cloudflare-deploy` branch, `root_dir: "client"`) to build from
`cloudflare-platform-rewrite` / `apps/crm/web` instead. That's a change
to shared production infrastructure that affects whatever was live on
the legacy site. Don't make further changes to that Pages project's
config — if Chunk 3 needs something there, ask Abdullah first instead of
fixing it the way you fixed the last deploy blocker.

## Step 4 — Chunk 3 (CRM frontend)

Once step 2 is done and validated, proceed through
`handover-chunk3-kimi.md`'s tickets 3.1–3.5 in order: dashboard, list +
detail views, create/edit forms, activity timeline + tasks, import UI.
That file has the full detail per ticket — this doc just sequences the
overall work. Same rules apply throughout: incremental commits per
ticket, `pnpm typecheck`/`pnpm lint` clean every time, real validation
(DB script for API work, actual `vite build` + dev-server fetch for
frontend work — `tsc --noEmit` alone has missed real bugs in this project
before), push to `cloudflare-platform-rewrite` only.
