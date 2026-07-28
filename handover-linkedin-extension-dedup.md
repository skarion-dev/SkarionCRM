# Handover — LinkedIn extension duplicate-safety hardening (2026-07-28 evening)

Follows on from commits `65c3f1d` (API key issuance), `70fa522` (extension
vendored into the repo), and `564530f` (quality-tier tagging). This session's
review of `70fa522` found the dedup story was 4/10 — real gaps, listed below,
now closed. Nothing here was redone from those three commits; this only adds
what was missing.

## Where the extension lives

`extension/li-profile-capture/` at repo root — not under `apps/`, since it's
a standalone Chrome extension (manifest v3), not a Worker/Pages app. Files:

- `manifest.json` — permissions, host_permissions (linkedin.com, `*.workers.dev`,
  localhost — no `<all_urls>`), content script registration.
- `content.js` — runs on every `linkedin.com/in/*` page, scrolls/expands the
  profile, extracts it into `chrome.storage.local`.
- `popup.js` / `popup.html` — the toolbar popup: profile list, capture button,
  lead-quality tier buttons, the "Send to CRM" form, Settings panel, Excel
  export.
- `background.js` — badge count only.
- `xlsx.full.min.js` — vendored SheetJS for the Excel export.

It talks to the CRM Worker's `/extension/leads` and (new) `/extension/leads/check`
routes, mounted in `apps/crm/src/index.ts` outside the `/api/*` auth middleware
(the extension authenticates with a long-lived key instead of a session).

## What was broken (found this session, reviewing `70fa522`)

1. Duplicate check only looked at `leads`, never `contacts` — a profile
   already converted to a contact could be recaptured as a brand-new lead.
2. Duplicate check only compared LinkedIn URL, and only with
   `.toLowerCase().replace(/\/+$/, '')` — query strings, fragments, and
   `m.`/`mobile.`/bare `linkedin.com` host variants of the _same_ profile
   counted as different leads.
3. No database-level uniqueness on `linkedin_url` — two near-simultaneous
   captures could both pass the app-level check and both insert (classic
   SELECT-then-INSERT race).
4. No idempotency key — a client-side retry after a timeout could create a
   second lead even when the first one actually succeeded.
5. Every send manufactured a fake `...@placeholder.skarion` email (LinkedIn
   doesn't expose real emails) — poisoned email-based dedup and reporting,
   and a URL-normalization miss meant the same person could get a second fake
   email on a second capture.
6. `firstName`/`lastName`/`email` were all hard-required, blocking single-name
   profiles and anyone without a fabricated email.
7. `popup.js` ignored the backend's `{ duplicate: true }` response and always
   showed "Sent to CRM ✓", so nobody could tell a send was actually a no-op.
8. The manifest auto-injects `content.js` on every profile page; the popup's
   "Capture Current Profile Now" button injects it _again_ into the same tab.
   No guard meant two `MutationObserver`s and two overlapping scroll passes.
9. Excel export wrote scraped text directly into cells — a headline or About
   section starting with `=`, `+`, `-`, or `@` would execute as a formula in
   Excel/Sheets on open.
10. `apps/crm`'s `test` script was a stub — no automated coverage existed for
    any of this.

## What changed, file by file

### `apps/crm/drizzle/0006_extension_lead_dedup.sql` (new)

Hand-authored migration (the `0005` migration in this repo was already
hand-written rather than `drizzle-kit generate`d, so this follows that
existing precedent — meta/snapshots aren't regenerated). In order:

1. Canonicalizes every existing `leads.linkedin_url` (lowercase, strip
   query/fragment/trailing slash, fold `m.`/`mobile.`/bare host to
   `www.linkedin.com`). Where two rows collide after normalizing, keeps the
   older row's URL and nulls the rest — a unique index can't be created over
   dirty data.
2. Drops the old plain `idx_leads_linkedin` index.
3. Adds a **unique** partial index on `lower(linkedin_url)` (`WHERE
linkedin_url IS NOT NULL AND deleted_at IS NULL`) — this is what actually
   closes the race condition; the database itself now rejects a second row.
4. `leads.email` → nullable.
5. Adds `leads.idempotency_key` (text) + unique partial index.
6. Adds `contacts.linkedin_url` (didn't exist before), backfills it from
   already-converted leads (`leads.converted_to_contact_id`), and adds the
   same unique partial index there.

**This runs automatically** — `deploy-crm.yml`'s `migrate` job runs
`pnpm db:migrate` on every push to `main`, before the deploy job. Nothing
extra to do by hand.

### `apps/crm/src/db/schema.ts`

- `leads.email` — `text().notNull()` → `text()` (nullable), added
  `idempotencyKey`, added the two new unique indexes, removed the now-redundant
  plain `idx_leads_linkedin`.
- `contacts` — added `linkedinUrl` + its unique partial index.

### `apps/crm/src/lib/leadDedup.ts` (new)

Pulled the pure logic out of `index.ts` so it's unit-testable without a DB:

- `canonicalizeLinkedinUrl(raw)` — the actual fix for gap #2 above.
- `normalizePhoneKey(raw)` — digits-only, last 10 digits, so a missing/extra
  country code still matches.
- `isRealEmail(raw)` — rejects the `@placeholder.skarion` scheme (matches the
  CSV importer's existing convention).
- `findExactMatch(db, {linkedinUrl, email, phone})` — the hierarchy: canonical
  LinkedIn URL (leads, then contacts) → real email (leads, then contacts) →
  phone (leads). This is the fix for gap #1.

### `apps/crm/src/index.ts`

- **`POST /extension/leads/check`** (new) — preflight endpoint. Runs
  `findExactMatch` and returns `{status: 'exact_duplicate', matchType,
entityType, record}` or, if no exact match but the same first+last name at
  the same company already exists, `{status: 'possible_duplicate', matches}`
  (a warning only — never blocks). Otherwise `{status: 'new'}`.
- **`POST /extension/leads`** — rewritten:
  - Honors `X-Idempotency-Key`: if a lead already has that key, replays it
    (fix for gap #4).
  - Requires a name plus _either_ a LinkedIn URL or a real email — no longer
    hard-requires all three fields (fix for gap #6).
  - Runs `findExactMatch` before inserting; a contact match returns
    `{duplicate: true, entityType: 'contact', contact}` without creating a
    lead at all (fix for gap #1).
  - Catches a Postgres `23505` unique-violation on insert as a last-resort
    safety net for the race the new DB constraint mostly already closes
    (fix for gap #3, belt-and-suspenders).
  - No more placeholder email generation (fix for gap #5).
- Lead→contact conversion route now copies `linkedinUrl` onto the new contact
  (so gap #1's fix actually has data to match against going forward), and
  blocks conversion with a clear 400 if the lead has no email yet (contacts
  still require one).
- `ai-service.ts`'s `summarizeLead`/`scoreLead` signatures widened to accept
  `email: string | null`, since a lead's email is no longer guaranteed.

### `extension/li-profile-capture/popup.js` + `popup.html`

- Debounced preflight call to `/extension/leads/check` on every field edit
  and on form-open; renders a banner for `exact_duplicate` (with an "Open
  existing lead/contact" link built from the CRM's known Pages URL) or
  `possible_duplicate` (name+company warning) — fix for gaps #1/#2/#7.
- Parses the real `POST /extension/leads` response and shows "Already exists
  in CRM" instead of always "Sent ✓" — fix for gap #7.
- Dropped `placeholderEmail()` entirely; Email field is genuinely optional
  now — fix for gap #5.
- Stable per-profile idempotency key (`crypto.randomUUID()`, persisted in
  `chrome.storage.local` alongside the captured profile so it survives popup
  close/reopen and re-captures) sent as `X-Idempotency-Key` — fix for gap #4.
- `sanitizeCell()` on every Excel export cell — prefixes a leading `=+-@`
  with `'` so it's inert text, not a formula — fix for gap #9.
- Settings panel: new **"📋 Paste from admin panel"** button — reads a
  `{crmUrl, apiKey}` JSON blob off the clipboard and saves both fields in one
  click (see admin-side change below).

### `extension/li-profile-capture/content.js`

- Wrapped the whole script in `initLiProfileCapture()`, guarded by
  `window.__liProfileCaptureInitialized` — re-injection from the popup's
  "Capture Current Profile Now" now reads the guard as already-true and
  returns instead of registering a second `MutationObserver` — fix for gap #8.
- `run()` now also guards on `window.__liProfileCaptureRunning` so the
  auto-capture and a manual re-trigger can't scroll the same page
  concurrently.
- Generates/reuses the idempotency key at capture time (not send time), so
  the profile object stored in `chrome.storage.local` already carries it.

### `apps/identity/admin/src/pages/ApiKeysList.tsx`

Added a **"Copy for extension"** button next to the existing "Copy" button on
a freshly-generated key — puts `{crmUrl, apiKey}` JSON on the clipboard
(pairs with the extension's new paste button above). The existing "generate
key" / "revoke key" UI was already correct and untouched.

### Tests

`apps/crm`'s `test` script was a stub ("tests coming soon") — wired up
`vitest` (already used by `apps/identity`, same config) and added
`apps/crm/src/lib/leadDedup.test.ts`: 16 tests covering URL canonicalization
(host folding, query/fragment stripping, equivalence of three formattings of
the same profile), phone normalization, placeholder-email detection, and the
full `findExactMatch` hierarchy against a mocked `db.select().from().where().limit()`
chain (no real database needed). All pass; `tsc --noEmit` and
`eslint --max-warnings=0` clean on `apps/crm` and `apps/identity/admin`.

**Not covered:** end-to-end route tests against a real/miniflare Postgres —
that's still future work, same gap the repo already had before this session.

## Verifying this landed

```bash
git pull
pnpm install
pnpm --filter @skarion/crm typecheck   # clean
pnpm --filter @skarion/crm lint        # clean
pnpm --filter @skarion/crm test        # 16 passing
```

The migration applies itself via CI (`deploy-crm.yml`) on this push to
`main` — no manual `db:migrate` needed. Watch that workflow's `migrate` job
if you want to confirm it before the deploy job runs.
