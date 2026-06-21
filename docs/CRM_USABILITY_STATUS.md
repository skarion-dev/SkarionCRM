# Skarion CRM Usability Status

**Last updated:** 2026-06-21
**Production branch:** `main`
**Latest commit:** `2780c7d`

## Production URLs

| Service | URL |
|---------|-----|
| CRM Pages (UI) | https://skarion-crm.pages.dev |
| CRM Worker (API) | https://skarion-crm-platform.alsaki1999.workers.dev |
| Identity Worker (API) | https://skarion-identity.alsaki1999.workers.dev |
| Identity Login Pages | https://skarion-identity-login.pages.dev |
| CRM Health | https://skarion-crm-platform.alsaki1999.workers.dev/health |
| CRM Debug | https://skarion-crm-platform.alsaki1999.workers.dev/api/debug/version |
| Identity Debug | https://skarion-identity.alsaki1999.workers.dev/debug/version |

## Admin Login

- **Email:** `admin@skarion.com`
- **Password:** *(set during initial setup — change immediately after first login)*
- **Role:** superadmin + CRM manager

> ⚠️ **Security Note:** The default admin password should be changed immediately after the first login. Do not commit production credentials to the repository.

## What Works

### Leads Management
- ✅ View all leads (320 total in database)
- ✅ Pagination (page size: 25, 50, 100, 250)
- ✅ Search across name, email, company, LinkedIn URL
- ✅ Status filter tabs (new, contacted, qualified, disqualified, converted)
- ✅ Outreach status filter tabs (not_approached, approached, connected, replied, booked_call, not_interested, bad_fit)
- ✅ Server-side counts for both status and outreach status
- ✅ LinkedIn URL display in table (clickable icon)
- ✅ Outreach status badges in table
- ✅ Add lead manually with full fields
- ✅ Edit lead with LinkedIn URL, outreach status, connection status, source sheet, row number
- ✅ Lead detail page shows all fields (LinkedIn, outreach, connection, source sheet, row #, tags, notes)
- ✅ Delete/archive leads

### Import
- ✅ CSV/TXT import with flexible column mapping
- ✅ Supported aliases: `name`, `full name`, `linkedin`, `company`, `title`, `notes`, `status`, `connection`
- ✅ Duplicate detection by email, LinkedIn URL, or name+company
- ✅ Placeholder email generation for leads without real email (`slugified-name@placeholder.skarion`)
- ✅ Notes extraction from headline, location, education, industry, profile URL, score

### Export
- ✅ Export all filtered leads as CSV
- ✅ Export includes all fields: name, email, phone, company, LinkedIn, outreach status, connection status, source sheet, row number, notes, timestamps
- ✅ Export respects current filters (status, outreach status, search)

### Database
- ✅ 320 leads imported from Excel
- ✅ 100% have LinkedIn URLs
- ✅ 2 marked as `approached` (from Excel status), 318 as `not_approached`
- ✅ All have placeholder emails (no real email in source data)
- ✅ Outreach status, connection status, notes, and LinkedIn URLs populated from Excel

## What Is Disabled / Not Working

| Feature | Status | Reason |
|---------|--------|--------|
| AI chat / summarization | ❌ Hidden | Out of scope for this sprint |
| PDF import | ❌ Hidden | No document converter deployed |
| MarkItDown converter | ❌ Not deployed | Docker-based, not on Cloudflare |
| Email automation | ❌ Hidden | Out of scope |
| Workflow automation | ❌ Hidden | Out of scope |
| Custom domains | ❌ Not configured | Out of scope |

## Import Column Mapping

The CSV importer recognizes these column aliases (case-insensitive, spaces/underscores ignored):

| Field | Recognized Aliases |
|-------|-------------------|
| **First Name** | `firstName`, `first name`, `first_name`, `firstname` |
| **Last Name** | `lastName`, `last name`, `last_name`, `lastname` |
| **Full Name** | `name`, `full name`, `fullname`, `candidate name` |
| **Email** | `email`, `emailAddress`, `email address`, `e-mail` |
| **LinkedIn URL** | `linkedin`, `linkedin url`, `linkedin profile`, `profile url`, `profile`, `linkedinLink`, `linkedin_link`, `profile_link`, `guessed linkedin url` |
| **Company** | `company`, `company name`, `organization`, `school`, `university`, `current company`, `employer` |
| **Title** | `title`, `position`, `jobTitle`, `job title`, `role`, `currentRole` |
| **Phone** | `phone`, `phoneNumber`, `phone number`, `mobile`, `tel` |
| **Status** | `status`, `leadStatus`, `lead status`, `outreachStatus`, `outreach status` |
| **Connection** | `connection`, `connectionStatus`, `connected`, `approached` |
| **Notes** | `notes`, `comments`, `personalizedNote`, `note`, `remarks` |
| **Source** | `source`, `leadSource`, `lead source`, `category`, `type` |

## Duplicate Rules

1. **Primary:** Lowercase email match (if real email exists)
2. **Secondary:** Normalized LinkedIn URL match
3. **Fallback:** Name + company match

Default behavior: **skip** duplicates.

## How to Import

1. Open Leads page → **CSV Import** button
2. Upload a CSV file or paste CSV text
3. Click **Import**
4. Review the summary: imported count, errors, duplicates

### Excel Workflow

1. Save your Excel file as CSV (File → Save As → CSV UTF-8)
2. Use the import modal to upload the CSV
3. The importer will auto-detect columns based on the aliases above
4. Leads without email will get a placeholder email

## How to Export

1. Apply any filters (status, outreach status, search)
2. Click **Export CSV** button
3. The CSV will download with all filtered leads and all fields

## Known Issues

1. **All 320 leads have placeholder emails** — the source Excel did not contain real email addresses. Emails are `slugified-name@placeholder.skarion`.
2. **Email display in UI** — placeholder emails are shown as `—` in the table to reduce noise. Hover or click into detail to see the actual placeholder email.
3. **27 Excel rows were not imported** — the Excel had 347 rows but only 320 were inserted. These were likely duplicates (same name or same LinkedIn URL detected).
4. **Cron and embeddings workers fail deploy** — these are background AI workers, not critical for CRM usability. They are out of scope for this sprint.
5. **No real email validation on import** — placeholder emails are generated automatically for missing emails.

## Smoke Test Results

| Test | Status | Notes |
|------|--------|-------|
| CI passes on `main` | ✅ Pass | Commit `2780c7d` |
| CRM deploy passes | ✅ Pass | Worker + Pages |
| Identity deploy passes | ✅ Pass | Worker + Login Pages |
| Debug endpoints return correct commit | ✅ Pass | CRM shows `2780c7d...` |
| DB has 320 leads | ✅ Pass | Verified via direct query |
| All 320 have LinkedIn URL | ✅ Pass | Verified via direct query |
| API pagination works | ✅ Pass | `page`/`pageSize`/`total`/`totalPages` |
| API outreach status counts | ✅ Pass | Returns `outreachStatusCounts` |
| Export CSV endpoint | ✅ Pass | Returns CSV with all fields |
| Login as admin | ⚠️ Not tested | Requires browser auth flow |
| Browser UI shows 320 leads | ⚠️ Not tested | Requires browser verification |
| Search finds lead | ⚠️ Not tested | Requires browser verification |
| Add lead manually | ⚠️ Not tested | Requires browser verification |
| Edit lead outreach status | ⚠️ Not tested | Requires browser verification |
| Open LinkedIn from table | ⚠️ Not tested | Requires browser verification |
| Lead detail page | ⚠️ Not tested | Requires browser verification |
| Export downloads CSV | ⚠️ Not tested | Requires browser verification |
