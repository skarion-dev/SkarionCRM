# Skarion Internal Applicants

The internal applicant tracker is a separate recruiting domain inside the CRM. It is intentionally not modeled as sales leads: applicant records contain employment application data, resumes, raw email text, education details, and hiring workflow state.

## Data model

- `crm.internal_applicants` — one normalized row per applicant, keyed by workspace + `applicant_number` (`SKR-####`) and normalized email. Stores roles, contact details, education, normalized skills, score components, recommendation, source message IDs, raw email text, extracted resume text, workflow status, notes, tags, and optional assignee.
- `crm.internal_applicant_documents` — resume/portfolio metadata, checksum, source path, and extracted text. Resume binaries are stored in the spare-PC Postgres `audit_db.resume_documents` table and served by the authenticated `audit-db.skarion.com` bridge; the CRM proxy keeps the bearer token server-side.
- `crm.internal_applicant_messages` — applicant-linked Outlook messages with sender, recipients, subject, raw body, Outlook link, and attachment flag. Message IDs are unique for idempotent imports.

## Access and workflow

The `/internal-applicants` page and `/api/internal-applicants*` endpoints require a CRM manager role or superadmin because the data is sensitive. The page supports searching, stage/recommendation filters, detail review, source-document/message inspection, resume downloads, workflow-stage updates, and hiring notes.

## Scoring

Scores are imported from the tracker rubric: 50% skills, 30% education, and 20% observable culture-fit evidence. The outside-Dhaka school/location factor is stored separately as a small `-5` proxy adjustment and is not a culture judgment. Blank source fields are treated as missing evidence, not negative evidence. Scores are screening aids and require human review.

## Import

The idempotent importer is `apps/crm/src/scripts/importInternalApplicants.ts`. It expects `DATABASE_URL`, `APPLICANT_JSON`, `RAW_EMAIL_JSON`, and `SOURCE_ROOT` environment variables. It upserts applicant numbers, message IDs, and document checksums, so rerunning it refreshes the same records instead of duplicating them. The spare-PC migration uses the same applicant-number prefix (`SKR-####`) and SHA-256 to make binary imports idempotent.

## Resume storage operations

The production Worker uses `RESUME_STORAGE_URL=https://audit-db.skarion.com` and the `RESUME_STORAGE_TOKEN` Worker secret. The Cloudflare tunnel route and Postgres bridge already exist on the spare PC; the resume migration only adds the `resume_documents` table and `/resumes/...` endpoints, leaving the existing audit, jobs, and LLM routes unchanged.
