# SkarionCRM — Complete Session Changes Log (July 16, 2026)
> **Date:** July 16, 2026  
> **Project:** `/Users/rafsanmallik/Downloads/SkarionCRM-main`

---

## 🔑 Credentials & Connection Strings

| Item | Value |
|---|---|
| **Admin Email** | `admin@skarion.com` |
| **Admin Password** | `changeme-now` |
| **Database** | Neon PostgreSQL (cloud) |
| **Database URL** | `postgresql://neondb_owner:npg_HvpAtDKhe09E@ep-jolly-sound-ahgfjvmt-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require` |

---

## 🌐 Local Development URLs

| App | URL | Description |
|---|---|---|
| CRM Dashboard | http://localhost:5173 | Contacts, deals, pipeline |
| Accounting / Books | http://localhost:5174 | Invoices, expenses, financial reports |
| Employee Portal | http://localhost:5175 | HR, leave requests, employee data |
| Identity Login App | http://localhost:5181 | Login landing page |
| Identity Admin | http://localhost:5184/admin/ | Users, invitations, audit logs (Requires trailing `/`) |

---

## ✅ All Bugs Fixed & Features Built Today

### 1. Login Redirect Loop Fix (Frontend)
* **Problem:** After entering credentials, the CRM dashboard loaded for a second, then immediately redirected back to the login screen.
* **Root Cause:** The dashboard fired multiple concurrent API calls on mount. Each API call independently tried to refresh the authentication token. Because the backend uses **Refresh Token Rotation (RTR)**, parallel refresh requests invalidated each other, prompting an automatic session revocation.
* **Fix Applied:** Added request deduplication (promise caching) to all three frontend app API helpers. Concurrent token refreshes are now collapsed into a single call:
  * `apps/crm/web/src/api.ts`
  * `apps/accounting/web/src/api.ts`
  * `apps/employee-portal/web/src/api.ts`

---

### 2. CRM Dashboard 500 Error Fix (Database Migration)
* **Problem:** The CRM dashboard was crashing with a `500 Internal Server Error` due to a missing notifications table.
* **Fix Applied:**
  * Created a SQL migration file: `apps/crm/drizzle/0005_add_notifications.sql`
  * Registered it in: `apps/crm/drizzle/meta/_journal.json`
  * Ran Drizzle migrations against the live Neon DB to create the `crm.notifications` table and its indexes.

---

### 3. Identity Admin "Internal Server Error" Fix (Database Schema)
* **Problem:** Accessing `http://localhost:5184/admin/users` crashed the user list page with `There are multiple relations between "appMemberships" and "users". Please specify relation name.`
* **Root Cause:** The `appMemberships` table has two foreign keys pointing to `users` (`userId` and `grantedBy`). Drizzle ORM required named relations to resolve the ambiguous join.
* **Fix Applied:** Updated the Drizzle schema definitions in `apps/identity/src/db/schema.ts` to assign explicit relation names (`'user'` and `'grantedByUser'`) on both sides of the join.

---

### 4. Localhost Redirect Loop Fix (Auth Redirect)
* **Problem:** Logging in directly from `http://localhost:5181` did not redirect the user to the CRM dashboard; instead, it reloaded the login page endlessly.
* **Root Cause:** When `return_to` parameters were missing, the auth redirection fallback defaulted to `window.location.origin` (which on localhost is the login server `http://localhost:5181`), causing a feedback loop.
* **Fix Applied:** Updated `apps/identity/login/src/redirect.ts` to map application keys (`crm`, `hr`, `books`) to their respective local dev ports (e.g. `5173`, `5175`, `5174`) in `localhost` environments.

---

### 5. CRM Leads Export CSV Bug Fix (Route Order Collision)
* **Problem:** Clicking "Export CSV" on the Leads page failed with `500 Internal Server Error` and a database error (`invalid input syntax for type uuid: "export.csv"`).
* **Root Cause:** The static route `GET /api/leads/export.csv` was registered *after* the parameterized route `GET /api/leads/:id`. Hono matched `"export.csv"` as the lead ID parameter, routing it to the database lookup where the query crashed.
* **Fix Applied:** Reordered routes in `apps/crm/src/index.ts` to register `GET /api/leads/export.csv` before `GET /api/leads/:id`.

---

### 6. Transactional Email "React is not defined" Fix (JSX Compilation)
* **Problem:** Inviting new users or resending invitations failed with a `500 ReferenceError: React is not defined`.
* **Root Cause:** The Cloudflare worker bundler compiled transactional email JSX templates using the classic runtime, which expected `React` to be imported in scope inside the compiler module.
* **Fix Applied:** Added `import React from 'react';` to `packages/ui/emails/index.tsx`.

---

### 7. Local Mock Email Delivery Mode (Development Tooling)
* **Problem:** Running the platform locally without a configured Resend API key threw errors when inviting users or resending confirmation links.
* **Fix Applied:** Programmed a dev fallback in `packages/auth-client/src/email.ts`. If the `RESEND_API_KEY` is a dummy key, the app logs the email details and the **invite acceptance URLs** directly to the terminal console/logs instead of attempting to hit the API, allowing local signup flows to be fully testable.

---

### 8. Audit Log Pagination Refactor (UI/UX)
* **Problem:** Previous and Next buttons were disabled and pagination couldn't be easily tested.
* **Fixes Applied:**
  * Reduced the default page size from `50` to `10` for easy local testing.
  * Implemented lookahead slice pagination (`pageSize + 1` query) to cleanly calculate if next pages exist, preventing blank next pages.
  * Added a visible `Page X` indicator to the pagination controls.
  * Updated UI state handlers in `InvitationsList.tsx` to clear old error states on button click.

---

## 🤖 Google Gemini AI Configuration

The CRM AI features are configured with the following active models:

| Action | Configured Model |
|---|---|
| Primary Chat | `gemini-1.5-flash` |
| Fallback Chat | `gemini-1.5-pro` |
| Embeddings | `text-embedding-004` |

---

## 📁 Key Files Modified This Session

* `apps/crm/web/src/api.ts`
* `apps/accounting/web/src/api.ts`
* `apps/employee-portal/web/src/api.ts`
* `apps/crm/drizzle/0005_add_notifications.sql`
* `apps/crm/drizzle/meta/_journal.json`
* `apps/identity/src/db/schema.ts`
* `apps/identity/login/src/redirect.ts`
* `apps/crm/src/index.ts`
* `packages/ui/emails/index.tsx`
* `packages/auth-client/src/email.ts`
* `apps/identity/admin/src/pages/InvitationsList.tsx`
* `apps/identity/admin/src/pages/AuditLog.tsx`
* `apps/crm/.dev.vars`
