ALTER TYPE "crm"."lead_journey_stage" ADD VALUE 'stem' AFTER 'foreign_national';--> statement-breakpoint
INSERT INTO "crm"."tag_definitions" ("name", "slug", "color", "description", "is_system")
VALUES (
	'STEM',
	'stem',
	'teal',
	'STEM prospects held as a dedicated pre-outreach segment.',
	true
)
ON CONFLICT ("slug") DO UPDATE SET
	"name" = EXCLUDED."name",
	"color" = EXCLUDED."color",
	"description" = EXCLUDED."description",
	"is_system" = true,
	"updated_at" = now();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "crm"."enqueue_lead_score_job"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."review_state" = 'accepted'
		AND NEW."journey_stage" NOT IN ('future', 'foreign_national', 'stem') THEN
		INSERT INTO "crm"."lead_score_jobs" ("lead_id")
		VALUES (NEW."id")
		ON CONFLICT ("lead_id") DO NOTHING;
	END IF;
	RETURN NEW;
END;
$$;
