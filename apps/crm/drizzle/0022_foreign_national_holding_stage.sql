ALTER TYPE "crm"."lead_journey_stage" ADD VALUE 'foreign_national' AFTER 'future';--> statement-breakpoint
ALTER TYPE "crm"."lead_review_disposition" ADD VALUE 'foreign_national' BEFORE 'disqualified';--> statement-breakpoint
INSERT INTO "crm"."tag_definitions" ("name", "slug", "color", "description", "is_system")
VALUES (
	'Foreign National',
	'foreign-national',
	'indigo',
	'Lower-priority international prospects held until the Bangladesh-first outreach queue is exhausted.',
	true
)
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
	IF NEW."review_state" = 'accepted'
		AND NEW."journey_stage" NOT IN ('future', 'foreign_national') THEN
		INSERT INTO "crm"."lead_score_jobs" ("lead_id")
		VALUES (NEW."id")
		ON CONFLICT ("lead_id") DO NOTHING;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
UPDATE "crm"."leads" lead
SET
	"journey_stage" = 'foreign_national',
	"status" = 'new',
	"outreach_status" = 'not_approached',
	"row_version" = "row_version" + 1,
	"updated_at" = now()
WHERE "deleted_at" IS NULL
	AND "review_state" = 'accepted'
	AND EXISTS (
		SELECT 1
		FROM jsonb_array_elements_text(
			CASE
				WHEN jsonb_typeof(lead."tags") = 'array' THEN lead."tags"
				ELSE '[]'::jsonb
			END
		) AS tag(value)
		WHERE lower(trim(tag.value)) = 'foreign national'
			OR lower(trim(tag.value)) LIKE 'foreign national %'
	);--> statement-breakpoint
DELETE FROM "crm"."lead_score_jobs" AS job
USING "crm"."leads" AS lead
WHERE job."lead_id" = lead."id"
	AND lead."journey_stage" = 'foreign_national'
	AND job."status" IN ('pending', 'failed');
