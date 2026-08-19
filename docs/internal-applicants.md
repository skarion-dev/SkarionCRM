# Skarion Internal Applicants

The internal applicant tracker is a separate recruiting domain inside the CRM. It is intentionally not modeled as sales leads: applicant records contain employment application data, resumes, raw email text, education details, and hiring workflow state.

## Data model

- `crm.internal_applicants` — one normalized row per applicant, keyed by workspace + `applicant_number` (`SKR-####`) and normalized email. Stores roles, contact details, education, normalized skills, score components, recommendation, source message IDs, raw email text, extracted resume text, workflow status, notes, tags, and optional assignee.
- `crm.internal_applicant_documents` — resume/portfolio metadata, checksum, source path, extracted text, and a future `storage_key` for R2-backed downloads. The current import preserves the uniquely prefixed resume file path and text; binary upload to R2 can be added without changing the applicant record.
- `crm.internal_applicant_messages` — applicant-linked Outlook messages with sender, recipients, subject, raw body, Outlook link, and attachment flag. Message IDs are unique for idempotent imports.

## Access and workflow

The `/internal-applicants` page and `/api/internal-applicants*` endpoints require a CRM manager role or superadmin because the data is sensitive. The page supports searching, stage/recommendation filters, detail review, source-document/message inspection, workflow-stage updates, and hiring notes.

## Scoring

Scores are imported from the tracker rubric: 50% skills, 30% education, and 20% observable culture-fit evidence. The outside-Dhaka school/location factor is stored separately as a small `-5` proxy adjustment and is not a culture judgment. Blank source fields are treated as missing evidence, not negative evidence. Scores are screening aids and require human review.

## Import

The idempotent importer is `apps/crm/src/scripts/importInternalApplicants.ts`. It expects `DATABASE_URL`, `APPLICANT_JSON`, `RAW_EMAIL_JSON`, and `SOURCE_ROOT` environment variables. It upserts applicant numbers, message IDs, and document checksums, so rerunning it refreshes the same records instead of duplicating them.
