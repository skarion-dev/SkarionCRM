-- Adds a database sequence backing the human-readable "SK0001"-style lead
-- number, and backfills existing rows in creation order so history gets
-- numbers too. A sequence (not an app-level counter table) because it's
-- atomic under concurrent Workers with zero app-level locking; gaps on
-- rollback are cosmetically fine for a lead-facing display ID.

CREATE SEQUENCE IF NOT EXISTS "crm"."lead_number_seq" AS bigint START WITH 1;
--> statement-breakpoint

-- Backfill in creation order (oldest gets SK0001). Soft-deleted rows still
-- get a number — this is a stable historical record, not a live-rows-only
-- index, so deleted_at is deliberately not filtered here.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM "crm"."leads"
  WHERE lead_number IS NULL
)
UPDATE "crm"."leads" l
SET lead_number = 'SK' || lpad(o.rn::text, 4, '0')
FROM ordered o
WHERE l.id = o.id;
--> statement-breakpoint

-- Advance the sequence past the backfilled count so the next
-- app-generated number doesn't collide with a backfilled one.
SELECT setval('crm.lead_number_seq', GREATEST((SELECT count(*) FROM "crm"."leads"), 1), true);
