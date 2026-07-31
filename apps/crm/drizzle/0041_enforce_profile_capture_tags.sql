INSERT INTO "crm"."tag_definitions" ("name", "slug", "color", "description", "is_system")
VALUES (
	'profile capture complete',
	'profile-capture-complete',
	'emerald',
	'LinkedIn profile data has been captured and sent to the CRM.',
	true
)
ON CONFLICT ("slug") DO UPDATE SET
	"name" = EXCLUDED."name",
	"color" = EXCLUDED."color",
	"description" = EXCLUDED."description",
	"is_system" = true,
	"updated_at" = now();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "crm"."enforce_profile_capture_tags"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."profile_capture_status" = 'captured' OR NEW."last_captured_at" IS NOT NULL THEN
		NEW."tags" := COALESCE(
			(
				SELECT jsonb_agg(tag_value ORDER BY tag_order)
				FROM jsonb_array_elements_text(
					CASE
						WHEN jsonb_typeof(NEW."tags") = 'array' THEN NEW."tags"
						ELSE '[]'::jsonb
					END
				) WITH ORDINALITY AS existing_tag(tag_value, tag_order)
				WHERE regexp_replace(lower(trim(tag_value)), '[-_[:space:]]+', ' ', 'g') NOT IN (
					'needs profile capture',
					'profile capture needed',
					'profile capture required',
					'profile capture pending',
					'needs linkedin profile capture',
					'linkedin profile capture needed',
					'profile capture complete'
				)
			),
			'[]'::jsonb
		) || '["profile capture complete"]'::jsonb;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_enforce_profile_capture_tags" ON "crm"."leads";--> statement-breakpoint
CREATE TRIGGER "trg_enforce_profile_capture_tags"
BEFORE INSERT OR UPDATE OF "profile_capture_status", "last_captured_at", "tags"
ON "crm"."leads"
FOR EACH ROW
EXECUTE FUNCTION "crm"."enforce_profile_capture_tags"();--> statement-breakpoint
UPDATE "crm"."leads"
SET
	"tags" = "tags",
	"updated_at" = now()
WHERE "deleted_at" IS NULL
	AND (
		"profile_capture_status" = 'captured'
		OR "last_captured_at" IS NOT NULL
	);
