ALTER TYPE "crm"."lead_journey_stage" ADD VALUE 'future' BEFORE 'new';--> statement-breakpoint
INSERT INTO "crm"."tag_definitions" ("name", "slug", "color", "description", "is_system")
VALUES ('Future', 'future', 'cyan', 'Leads intentionally held for future review or outreach.', true)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "is_system" = true,
  "updated_at" = now();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "crm"."enqueue_lead_score_job"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."review_state" = 'accepted' AND NEW."journey_stage" <> 'future' THEN
    INSERT INTO "crm"."lead_score_jobs" ("lead_id")
    VALUES (NEW."id")
    ON CONFLICT ("lead_id") DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
UPDATE "crm"."leads"
SET
  "journey_stage" = 'future',
  "status" = 'new',
  "outreach_status" = 'not_approached',
  "row_version" = "row_version" + 1,
  "updated_at" = now()
WHERE "deleted_at" IS NULL
  AND "review_state" = 'accepted'
  AND (
    "review_disposition" = 'future'
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof("tags") = 'array' THEN "tags"
          ELSE '[]'::jsonb
        END
      ) AS tag(value)
      WHERE lower(trim(tag.value)) = 'future'
    )
  );--> statement-breakpoint
DELETE FROM "crm"."lead_score_jobs" AS job
USING "crm"."leads" AS lead
WHERE job."lead_id" = lead."id"
  AND lead."journey_stage" = 'future'
  AND job."status" IN ('pending', 'failed');
