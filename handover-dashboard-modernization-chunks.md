# Handover — Dashboard modernization, chunked for a cheap AI session (2026-07-29)

Repo: [github.com/skarion-dev/SkarionCRM](https://github.com/skarion-dev/SkarionCRM), branch `main`,
based on `1cfae4d`.

**Read this whole doc before touching anything.** It corrects an earlier mistake: an initial pass at
this plan was written against a stale fork (`alsaki27/SkarionCRM`) instead of this repo, and
over-scoped work that's already built here (prospect review, lead scoring, the extension, the task
board all already exist — see `handover-crm-overview-and-task-board.md` and
`docs/ai-agent-playbook.md`). This doc only covers what's actually still missing: **Dashboard.tsx is
177 lines of the original scaffold and has not been touched by any of that work.**

## What already exists — do not rebuild any of this

- **Prospect review**: `apps/crm/web/src/pages/ProspectReviewPage.tsx` + `/api/prospects*` routes
  (`apps/crm/src/index.ts` ~line 2522-2924) — capture-quality review queue, five human decisions
  (Excellent Fit/Worth Trying/Maybe/Future/Disqualify), claim-next-10, CSV import, live SSE updates.
  AI scoring (`qualifyLead`/`generateAndSaveLeadScore`, `apps/crm/src/lib/ai-service.ts`) runs
  **after** a human accepts a prospect (`index.ts:472-477`), never before, never auto-promotes.
- **Task board**: `apps/crm/web/src/pages/TasksPage.tsx` — 3-column Unclaimed/Mine/Team's, claim
  mutation, outreach-follow-up filter, multi-step outreach sequences via
  `evaluateOutreachSequence` in `apps/workers/workflow-runner`.
- **Lead outreach/channel tracking**: `leadChannels` table (`apps/crm/src/db/schema.ts` ~line
  551-580, FK to `leads.id`) + `ChannelPanel.tsx`, surfaced on `LeadDetail.tsx` — this is the real,
  working per-lead activity mechanism, per-channel (LinkedIn/email/WhatsApp/etc.).
- **CEO reporting/AI chat**: `ReportingCeoPage.tsx` (854 lines) — superadmin-only SSE chat backed by
  `POST /api/ceo-chat`, server-assembled verified counts fed to the LLM, renders tables/charts from
  fenced ` ```chart` JSON blocks via a real Recharts component (`ExecutiveChart`). This is already
  the "AI insight dashboard" — don't build a second one.
- **LinkedIn extension**: `extension/li-profile-capture/` — captures profiles, dedups against both
  `leads` and `contacts` by canonical URL, idempotency-keyed.

## A real bug, unrelated to the dashboard but found while researching this — worth its own chunk

`LeadDetail.tsx` (~lines 863-887) renders a generic `ActivityTimeline`/`ActivityForm` (the same
components `ContactDetail`/`CompanyDetail` use) passing `filters={{ contactId: lead.id }}` — but
`activities` has no `leadId` column, only `contactId`/`companyId`/`opportunityId`. A lead's UUID
will never match a `contacts.id` row, so `GET /api/activities` 404s and `POST /api/activities`
FK-violates every time. This is dead/vestigial code left over from before `leadChannels` existed as
the real mechanism — it was never fixed to route through `leadChannels`/`ChannelPanel` because
`ChannelPanel` already covers the same need. **Fix: delete the `ActivityTimeline`/`ActivityForm`
usage from `LeadDetail.tsx` entirely** (contacts/companies/opportunities keep using them normally,
unaffected) rather than adding a `leadId` column nobody needs — `ChannelPanel` is already the
correct, working per-lead activity UI.

---

## Chunks

Each chunk names exact files, what NOT to touch, and acceptance criteria. Run
`pnpm --filter @skarion/crm typecheck && pnpm --filter @skarion/crm lint` and
`pnpm --filter @skarion/crm-web typecheck && pnpm --filter @skarion/crm-web lint` before finishing
any chunk that touches `apps/crm` — this repo has real, passing CI, don't break it.

### Chunk A — Remove the broken lead-activity dead code

**Files:** `apps/crm/web/src/pages/LeadDetail.tsx` (~lines 863-887).
**Do:** Delete the `ActivityTimeline`/`ActivityForm` block for leads. `ChannelPanel` (already present
on the same page) is the real mechanism — don't replace it with anything, just remove the broken,
unused-in-practice section.
**Don't touch:** `ActivityTimeline.tsx`/`ActivityForm.tsx` themselves, or their usage on
`ContactDetail.tsx`/`CompanyDetail.tsx`/`OpportunityDetail.tsx` — those work correctly today.
**Acceptance:** Lead detail page no longer shows a broken/404ing activity section; `ChannelPanel`
is unaffected; typecheck/lint pass.

### Chunk B — Factor out a real `/api/dashboard/summary` endpoint

**Files:** `apps/crm/src/index.ts` — find the CEO-chat handler (~line 6912) and the verified-count
assembly it does before calling the LLM (per `docs/ai-agent-playbook.md` lines 79-83 — server-side
counts of leads/contacts/companies/opportunities/tasks/activities/lead scores + recent records).
**Do:** Extract that count-assembly logic into a standalone function, and add a new
`GET /api/dashboard/summary` route that returns it as plain JSON (no LLM call) — {companies,
leads, contacts, opportunities, tasks, openTaskCount, recentLeads, pipelineByStage, prospectsPendingReview}.
Reuse the CEO-chat's existing queries, don't write new ones from scratch. Add `prospectsPendingReview`
by querying `/api/prospects`'s underlying query with a pending-status filter (see `index.ts:2522`).
**Don't touch:** the `/api/ceo-chat` route's own behavior — it can optionally call the new shared
function too (nice-to-have, not required), but its LLM/streaming logic must not change.
**Acceptance:** `GET /api/dashboard/summary` (authenticated) returns real counts matching what
`GET /api/leads`, `/api/opportunities`, etc. would separately compute. Typecheck/lint pass.

### Chunk C — Wire Dashboard.tsx to the new summary endpoint, drop client-side full-list math

**Depends on:** Chunk B.
**Files:** `apps/crm/web/src/pages/Dashboard.tsx` (full file, 177 lines), plus whatever hook file
defines `useCompanies`/`useLeads`/`useContacts`/`useOpportunities`/`useTasks` (add a new
`useDashboardSummary()` alongside them, same file/pattern).
**Do:** Replace the five separate full-list fetches + client-side `.filter()`/`.reduce()` math with
one call to the new `/api/dashboard/summary` endpoint. Keep every existing visible section
(stat cards, Recent Leads, Pipeline Overview, My Tasks) — this is a data-source swap, not a redesign.
**Don't touch:** `useCompanies`/`useLeads`/etc. themselves — other pages still need full lists; just
add the new hook alongside them, don't remove or modify the existing ones.
**Acceptance:** Dashboard renders identical numbers to before (verify against the old client-computed
values on a test account), just sourced from one request instead of five. Typecheck/lint pass.

### Chunk D — Swap the fake pipeline bar for the real stage data

**Depends on:** Chunk C (touches the same file, do it right after to avoid merge pain).
**Files:** `apps/crm/web/src/pages/Dashboard.tsx` (~lines 130-155, the "Pipeline Overview" section),
`apps/crm/web/src/pages/PipelinePage.tsx` (read-only reference — its `stages` array/config is what
you're reusing).
**Do:** Import and reuse `PipelinePage`'s stage list/config (don't hardcode a second copy of
`['prospecting','qualification','proposal','negotiation']` in Dashboard.tsx — that's the exact
duplication that exists today). Render it as a compact bar/funnel, not the full kanban — this is a
summary widget, not a second `PipelinePage`. If `PipelinePage`'s stage config isn't already exported/
importable, export it from there first (small, additive change to that file only).
**Don't touch:** `PipelinePage.tsx`'s own kanban rendering/drag-drop logic.
**Acceptance:** Dashboard's pipeline section now includes all 6 real stages (including Closed
Won/Lost, which the old 4-stage version omitted) with real per-stage values, sourced from Chunk B's
summary endpoint. Typecheck/lint pass.

### Chunk E — Add AI-scored leads + prospect-review widgets to Dashboard

**Depends on:** Chunk C.
**Files:** `apps/crm/web/src/pages/Dashboard.tsx`.
**Do:** Add two small widgets using data already in the Chunk B summary payload:
(1) a "Recently AI-Scored Leads" list (top N by score from `leadAiAssessments`, whatever shape
`generateAndSaveLeadScore` writes — check `ai-service.ts` for the actual field names before wiring
this up, don't guess), each linking to that lead's detail page;
(2) a "Prospects Pending Review" tile showing the count with a link to `/prospects` (the existing
`ProspectReviewPage` route).
**Don't touch:** `ProspectReviewPage.tsx` or the AI scoring pipeline itself — this chunk only reads
and displays data that already exists.
**Acceptance:** Both widgets render real data on a test account with at least one scored lead and
one pending prospect; degrade gracefully (empty state, not a crash) when there are zero of either.

### Chunk F — Reuse the task board's claim-state for "My Tasks"

**Depends on:** Chunk C.
**Files:** `apps/crm/web/src/pages/Dashboard.tsx`, `apps/crm/web/src/pages/TasksPage.tsx` (read-only
reference for its query/hook pattern).
**Do:** Change Dashboard's "My Tasks" section to use the same "mine" filter query `TasksPage` uses
(so a task claimed on the task board immediately reflects here too), instead of Dashboard's own
separate task fetch/filter logic.
**Don't touch:** `TasksPage.tsx` itself.
**Acceptance:** Claiming a task on `/tasks` and reloading the dashboard shows it under "My Tasks"
immediately, using the same data source, not a second stale copy.

### Chunk G — Visual pass (do last, optional, keep small)

**Depends on:** C, D, E, F all done.
**Files:** `apps/crm/web/src/pages/Dashboard.tsx` and shared card/layout components only.
**Do:** Cosmetic only — spacing, subtle shadows, maybe a loading-skeleton state for the new
summary-driven sections (there's a real network request now where there wasn't fully before, so a
loading state matters more than it did). Check `package.json` for an existing motion/animation
dependency before adding one; if none exists, don't add a new dependency just for this.
**Don't touch:** Any other page. No new component library. No dark mode unless explicitly asked for
separately.
**Acceptance:** Purely visual diff, zero behavior change, typecheck/lint pass.

---

## Suggested order

A can be done anytime, independently. B → C → D/E/F (D, E, F can happen in any order or in parallel
sessions once C lands, since they touch different sections of the same file — merge carefully if
run truly in parallel) → G last.

## What's explicitly NOT in scope for this doc

Don't touch `apps/identity`, `apps/employee-portal`, `apps/accounting`, `apps/document-converter`,
or the extension. Don't add a "calls vs. meetings vs. chats" schema split — `leadChannels` already
covers per-channel outreach tracking for leads; if a genuine gap exists there (e.g., no way to log a
phone call or a scheduled meeting distinctly from a LinkedIn message), that's a follow-up
investigation into `leadChannels`'s actual channel/type enum, not something to guess at and build
here — read `apps/crm/src/db/schema.ts`'s `leadChannels` definition and `ChannelPanel.tsx` first if
that's ever picked up as its own chunk.
