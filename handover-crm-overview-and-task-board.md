# Handover — Skarion CRM overview + leads/task-board revamp (2026-07-28/29)

Repo: [github.com/skarion-dev/SkarionCRM](https://github.com/skarion-dev/SkarionCRM)
This work landed at [`f5939e0`](https://github.com/skarion-dev/SkarionCRM/commit/f5939e01b9cf05e18f7c5259f671a55181d9db2a).
Note: `main` has since moved further ahead — someone else pushed a
"prospect review workflow" feature (curated batch imports, a review
disposition flow, a reworked extension popup) on top of this in parallel.
That work is not described here; see `main`'s own history for it.

## What this CRM is

A pnpm/turborepo monorepo running on Cloudflare (Workers + Pages) with Neon
Postgres via Drizzle ORM. Not a single app — several Workers plus their
frontends:

- **`apps/crm`** — the CRM itself (Hono API Worker, `apps/crm/src/index.ts`,
  one large file) + its React/Vite frontend (`apps/crm/web`). Leads,
  contacts, companies, opportunities, tasks, activities, workflow rules,
  saved searches, an AI chat/scoring layer (Gemini via
  `apps/crm/src/lib/ai-service.ts`).
- **`apps/identity`** — auth (JWT + PBKDF2, email-OTP two-step login for
  superadmins) and its admin UI (user management, API key issuance for the
  browser extension).
- **`apps/workers/cron`** — a Cloudflare Cron Trigger (hourly) that pings
  the next app below.
- **`apps/workers/workflow-runner`** — evaluates `workflow_rules` DB rows
  and executes their actions (create tasks, reassign leads, escalate stale
  outreach). This is where the automation lives; the CRM API just writes
  rule config, it doesn't run any of it itself.
- **`extension/li-profile-capture/`** — a Chrome extension (Manifest V3,
  plain JS, not a workspace package) that auto-captures LinkedIn profiles
  and sends them to the CRM as leads via a long-lived API key.

Migrations are hand-written SQL in `apps/crm/drizzle/000N_*.sql` (this repo
stopped using `drizzle-kit generate` after migration 0005) and apply
themselves automatically — `deploy-crm.yml`'s CI job runs `pnpm db:migrate`
on every push to `main`, before deploying. Nothing needs to be run by hand.

## This session's two chunks of work

### 1. LinkedIn extension duplicate-safety hardening

Full writeup already exists: [`handover-linkedin-extension-dedup.md`](https://github.com/skarion-dev/SkarionCRM/blob/main/handover-linkedin-extension-dedup.md)
in the repo root. Short version: the extension's dedup logic only checked
`leads` (not `contacts`), only compared raw LinkedIn URL strings, had no
DB-level uniqueness or idempotency, and manufactured fake placeholder
emails. All closed — canonical URL matching across both tables, a real
unique constraint, a client-supplied idempotency key, and the extension now
shows "already exists" instead of a blind "Sent ✓".

### 2. Leads page revamp + open-claim task board

**Leads page** (`apps/crm/web/src/pages/LeadsPage.tsx`): replaced classic
Prev/Next pagination with infinite scroll (`useInfiniteLeads`, 100-row
batches, load-more button + scroll trigger past 500+ rows), added a
"More Filters" panel (date range, multi-select status/outreach/owner, tag
chips) behind a shared `buildLeadConditions()` also used by CSV export
(which previously only supported a thin subset of filters), added saved
searches (save/apply/delete a named filter combo), and finally populated
the long-dead `leadNumber` column with sequential `SK0001`-style IDs via a
Postgres sequence (`crm.lead_number_seq`), wired into every lead-creation
path (manual, CSV import, PDF import, the extension).

**Task board**: found that an "outreach gone stale → auto-create a
follow-up task" automation was already fully built and deployed
(`evaluateOutreachStale` in the workflow-runner, running hourly) but never
actually configured, single-channel/single-step only, and always
auto-assigned to the lead's existing owner. Added:

- An open-claim model — `tasks.assigneeId` is now nullable, a task with no
  assignee sits in a shared pool, `PUT /api/tasks/:id/claim` lets anyone
  pick it up (atomic, 409 if someone beat you to it).
- A real multi-step sequence (`evaluateOutreachSequence`) — N ordered steps
  (day 7/14/21 by default) across one channel or _all_ channels, tracked
  per lead-channel via a new `followupStage` counter so a step can't
  re-fire and a completed step doesn't block the next one. The old
  single-step rules keep working unchanged — this is additive.
- `TasksPage.tsx` is now a 3-column board: Unclaimed / Mine / Team's.
- Settings → Workflows got a rule-type toggle (old single-step vs new
  multi-step sequence) with an editable step list.
- A one-time backfill script
  (`apps/crm/src/scripts/backfillOutreachFromLinkedInExport.ts`, run via
  `pnpm --filter @skarion/crm backfill:outreach`) that imports real
  last-contacted/replied data from a LinkedIn data export into
  `lead_channels`, since `attemptCount`/`lastAttemptAt` are otherwise only
  ever set by manually clicking "log outreach" in the CRM UI — almost
  nothing does that today, so without this the sequence has nothing
  accurate to work from for most existing leads.

Analyzed against the owner's own LinkedIn export as a gut-check: 855
tracked conversations, 331 awaiting a reply 7+ days (289 at 14+, 206 at
30+), plus 924 outgoing connection requests still pending 7+ days (845 at
14+, 569 at 30+) — that's the backlog the board now exists to surface.

## Verifying it

```bash
git clone https://github.com/skarion-dev/SkarionCRM.git
cd SkarionCRM && pnpm install
pnpm --filter @skarion/crm typecheck && pnpm --filter @skarion/crm lint && pnpm --filter @skarion/crm test
pnpm --filter @skarion/crm-web typecheck && pnpm --filter @skarion/crm-web lint
pnpm --filter @skarion/worker-workflow-runner typecheck && pnpm --filter @skarion/worker-workflow-runner test
```

All green as of `f5939e0`. CI and both Cloudflare deploys (CRM Worker +
Workflow Runner) ran clean on this commit; migrations 0007–0009 applied to
production automatically.

## Known gap, not yet fixed

The live Leads page's status/outreach count pills don't add up correctly
(a "New" count equal to the full total while "Contacted" is also non-zero;
outreach-stage pill counts summing past the total lead count). Flagged but
not investigated yet — worth a look next.

## Suggested next AI-agent work

The CRM's LLM layer (`scoreLead`, `suggestNextAction`, `draftOutreach`,
RAG chat) is all on-demand/button-triggered today, nothing proactive.
Highest-value next step: wire `scoreLead` into the existing `lead_created`
workflow trigger so new leads get an automatic priority score feeding the
task board's sort order, instead of everything landing in creation order.
