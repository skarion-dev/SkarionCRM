# Handover to Kimi: Chunk 3 — CRM Frontend (+ required Chunk 2 fixups)

## Status check first

Before starting Chunk 3, Claude reviewed your Chunk 2 push and fixed
three production-blocking issues directly (commit `d355704` on
`cloudflare-platform-rewrite`):

1. `deploy-crm.yml` deployed the Worker but never ran `wrangler secret put`
   for `DATABASE_URL`/`JWT_SECRET` — the `env:` block on a wrangler-action
   step only sets vars for the GitHub Actions runner process, not the
   deployed Worker. **Every DB-backed and auth-checked CRM route was
   running with undefined secrets in production.** Fixed by adding the
   same secret-push steps `deploy-identity.yml` already uses. Pull this
   before doing anything else.
2. `apps/crm/web/src/App.tsx` stored the access token in `localStorage`
   and expected identity to redirect back with `?token=` — identity's
   login app never does that, so the flow couldn't have worked at all,
   and storing a JWT in `localStorage` is an XSS-amplification risk this
   project deliberately avoids everywhere else. Rewrote
   `apps/crm/web/src/api.ts` to match the proven pattern from
   `apps/identity/admin/src/api.ts`: token in a module-level variable,
   refreshed via a credentialed `fetch` to identity's `/auth/refresh`
   (the browser attaches the httpOnly cookie automatically), redirect to
   `auth.skarion.com` only as a fallback when refresh fails. **Build all
   of Chunk 3's frontend work on top of this `api.ts`, don't reintroduce
   localStorage token storage.**
3. `apps/crm/web` had no `tsconfig.json` and no `typecheck`/`lint` scripts
   — meaning the root `pnpm typecheck`/`pnpm lint` silently never checked
   it at all, for either of you, this whole time. Both are added now;
   make sure new frontend code in Chunk 3 actually passes them (it's
   wired into CI now, so it will fail loudly if not).

### Things found but deliberately NOT fixed for you — do these first in Chunk 3

- **CRUD only exists for `companies`.** `contacts`, `leads`,
  `opportunities`, `activities`, `tasks` have full schema tables and zero
  API routes. Chunk 3 is supposed to build a real frontend against these
  entities — you cannot build that frontend until the API exists. Treat
  "finish the Chunk 2 API surface" as ticket 3.0, before any UI work.
  Follow the exact same pattern already in `apps/crm/src/index.ts`'s
  companies routes (ownership-scoped list/get, `can()` permission checks
  from `@skarion/permissions`, `withAudit` on every mutation, soft-delete
  via `deletedAt`/`deletedBy` not a real `DELETE`).
- `idx_companies_domain_lower` and `idx_contacts_email_lower` are named
  as if they lowercase, but the actual SQL is
  `CREATE UNIQUE INDEX ... ON ... ("domain")` — no `lower()` at all. This
  means `Acme.com` and `acme.com` collide as different companies, and
  email matching for contacts isn't case-insensitive like identity's is.
  Fix with a new migration (`pgSchema` already applied to prod, don't
  hand-edit the old migration file) using
  `uniqueIndex(...).on(sql\`lower(${table.domain})\`)`, matching
`apps/identity/src/db/schema.ts`'s pattern on `users.email` exactly.
- The CSV importers (`packages/importers`) are built and typecheck
  correctly but are never called from any API route — dead code right
  now. Wire an `/api/import/contacts`, `/api/import/companies`,
  `/api/import/leads` endpoint (multipart or raw-text body, your call) in
  Chunk 3 if there's frontend UI for bulk import, or explicitly punt it
  to a later chunk if there isn't — just don't leave it silently unused
  without a decision either way.
- The CSV parser in `packages/importers` splits naively on `,` — breaks
  on any quoted field containing a comma (e.g. `"Smith, John"`). Minor,
  but worth a real RFC 4180-aware parser before this handles real
  customer data dumps.

### Needs Abdullah's decision, not yours — flag it, don't act on it again

While debugging the Pages deploy, you reconfigured the **existing**
Cloudflare Pages project `skarion-crm` (previously wired to the legacy
`cloudflare-deploy` branch, `root_dir: "client"`) to instead build from
`cloudflare-platform-rewrite`, `root_dir: apps/crm/web`. That's a
production change to shared infrastructure that affects whatever was
live on the legacy site, made without it being flagged as a decision
first. Claude is surfacing this to Abdullah rather than silently
reverting or accepting it. **Don't make further changes to that Pages
project's configuration without it being an explicit, confirmed
decision** — if Chunk 3 needs Pages config changes, ask first.

---

## What Chunk 3 actually is

Build out the real CRM frontend in `apps/crm/web` on top of the API
(once 3.0 fills in the missing entities). This handover is being written
under the same constraint as the Chunk 2 one: it's a reconstruction, not
the verbatim original spec text. If Abdullah still has the original
Chunk 3 spec, prefer it over anything below that conflicts.

### 3.0 — Finish the Chunk 2 API surface (do this first)

CRUD + list/search for `contacts`, `leads`, `opportunities`, `activities`,
`tasks`, matching the companies implementation already in
`apps/crm/src/index.ts` exactly: permission-checked via `can()`,
audit-logged via `withAudit`, ownership-scoped lists for non-superadmin
roles, soft-delete. Add a lead-conversion endpoint
(`POST /api/leads/:id/convert`) that creates a contact + company (if not
already linked) and sets `convertedToContactId`/`convertedToCompanyId`/
`convertedAt` on the lead — the schema already has those columns, nothing
currently sets them.

### 3.1 — Dashboard

Replace the placeholder in `apps/crm/web/src/App.tsx` with real routing
(`react-router-dom`, matching `apps/identity/admin`'s pattern) and a
dashboard: pipeline summary (opportunities by stage, total value), recent
activities, tasks due soon, lead funnel counts. Scope all of it to the
logged-in user's own data unless they're a manager/superadmin (the
`can()`/`canList()` functions in `@skarion/permissions` already encode
this — use them client-side too for what to _show_ as actionable, even
though the API is the real enforcement boundary).

### 3.2 — List + detail views

Companies, contacts, leads, opportunities, tasks: a list view per entity
(search/filter matching what 3.0's API supports, paginated) and a detail
view (full record, related records via the relations already defined in
`apps/crm/src/db/schema.ts` — e.g. a company's detail view should show
its contacts and opportunities).

### 3.3 — Create/edit forms

For every entity in 3.2. Validate client-side with `zod` (already a CRM
Worker dependency; add it to `crm-web` too) mirroring whatever validation
3.0's API does server-side — client-side validation is UX, not a
security boundary, the API must reject bad data regardless of what the
form does.

### 3.4 — Activity timeline + task management

A unified activity feed per contact/company/opportunity (calls, emails,
meetings, notes, ordered by `happenedAt`), and a task list with
due-date sorting and complete/reopen actions.

### 3.5 — Import UI

A CSV upload flow against whatever endpoint(s) 3.0/the importers
decision above produced — file picker, preview of `parseContactsCsv`/
etc.'s `success`/`errors`/`duplicates` result before committing the
import, so a bad upload doesn't silently corrupt data.

### Validation discipline (same as every prior chunk, non-negotiable)

`pnpm typecheck` and `pnpm lint` clean across the whole monorepo for
every ticket — not just your new files; the duplicate-dependency
resolution trap (see the Chunk 2 handover doc, still applies) means a
clean isolated typecheck can still break others. For the API tickets
(3.0), prove correctness against a real database with a throwaway
validation script (create → list → filter → mutate → soft-delete →
assert audit log row exists), not just "it compiles" — delete the script
before committing. For frontend tickets, run the actual `vite build` and
hit the dev server directly for each new source file, the same way every
SPA in this project has been validated — `tsc --noEmit` alone has missed
real bugs here before.

Commit and push incrementally, one ticket at a time, to
`cloudflare-platform-rewrite`.
