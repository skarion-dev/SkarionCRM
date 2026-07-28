-- Hardens the LinkedIn extension's lead ingestion against duplicates.
-- Order matters: normalize/backfill data first, then add the constraints
-- that depend on it being clean, since a unique index over dirty data would
-- fail to create.

-- 1. Canonicalize existing leads.linkedin_url values (lowercase, strip
--    query string/fragment/trailing slash, fold m./mobile. hosts to
--    www.linkedin.com) so the unique index below has a consistent key to
--    enforce. Where two leads normalize to the same value, keep the older
--    one's URL and null out the rest rather than fail the migration.
WITH normalized AS (
  SELECT
    id,
    created_at,
    lower(
      regexp_replace(
        regexp_replace(
          regexp_replace(linkedin_url, '[?#].*$', ''),
          '/+$', ''
        ),
        '^https?://(m\.|mobile\.)?linkedin\.com', 'https://www.linkedin.com'
      )
    ) AS canon
  FROM "crm"."leads"
  WHERE linkedin_url IS NOT NULL AND deleted_at IS NULL
),
ranked AS (
  SELECT id, canon, row_number() OVER (PARTITION BY canon ORDER BY created_at ASC) AS rn
  FROM normalized
)
UPDATE "crm"."leads" l
SET linkedin_url = CASE WHEN r.rn = 1 THEN r.canon ELSE NULL END
FROM ranked r
WHERE l.id = r.id;
--> statement-breakpoint

-- 2. Drop the old non-unique index it replaces.
DROP INDEX IF EXISTS "crm"."idx_leads_linkedin";
--> statement-breakpoint

-- 3. Enforce canonical-URL uniqueness at the database level (closes the
--    SELECT-then-INSERT race two concurrent captures could otherwise win).
CREATE UNIQUE INDEX "idx_leads_linkedin_unique" ON "crm"."leads" (lower(linkedin_url)) WHERE linkedin_url IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint

-- 4. Email is no longer guaranteed - LinkedIn captures may have none.
ALTER TABLE "crm"."leads" ALTER COLUMN "email" DROP NOT NULL;
--> statement-breakpoint

-- 5. Idempotency key for retried extension POSTs.
ALTER TABLE "crm"."leads" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_leads_idempotency_key" ON "crm"."leads" (idempotency_key) WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint

-- 6. contacts had no LinkedIn column at all, so a lead that had already been
--    converted to a contact was invisible to duplicate checks. Add it, backfill
--    from already-converted leads, and enforce the same uniqueness.
ALTER TABLE "crm"."contacts" ADD COLUMN "linkedin_url" text;
--> statement-breakpoint
WITH lead_li AS (
  SELECT DISTINCT ON (converted_to_contact_id)
    converted_to_contact_id AS contact_id,
    linkedin_url
  FROM "crm"."leads"
  WHERE converted_to_contact_id IS NOT NULL AND linkedin_url IS NOT NULL
  ORDER BY converted_to_contact_id, created_at ASC
)
UPDATE "crm"."contacts" c
SET linkedin_url = ll.linkedin_url
FROM lead_li ll
WHERE c.id = ll.contact_id AND c.linkedin_url IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_contacts_linkedin_unique" ON "crm"."contacts" (lower(linkedin_url)) WHERE linkedin_url IS NOT NULL AND deleted_at IS NULL;
