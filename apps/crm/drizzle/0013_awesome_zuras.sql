CREATE TYPE "crm"."lead_journey_stage" AS ENUM('new', 'ready_to_reach_out', 'connection_sent', 'connected', 'engaged', 'qualified', 'meeting_booked', 'opportunity', 'converted', 'nurture', 'no_response', 'disqualified', 'lost');--> statement-breakpoint
CREATE TABLE "crm"."tag_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"color" text DEFAULT 'slate' NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tag_definitions_slug" ON "crm"."tag_definitions" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_tag_definitions_name" ON "crm"."tag_definitions" USING btree ("name");--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "journey_stage" "crm"."lead_journey_stage" DEFAULT 'new' NOT NULL;--> statement-breakpoint
-- Collapse the former lead-status and outreach-status fields into one customer
-- journey. The old columns remain during the compatibility window, but all new
-- CRM screens and reporting read journey_stage.
UPDATE "crm"."leads" AS l
SET "journey_stage" = (
	CASE
		WHEN l."status" = 'converted' THEN 'converted'
		WHEN l."status" = 'disqualified' OR l."outreach_status" = 'bad_fit' THEN 'disqualified'
		WHEN EXISTS (
			SELECT 1 FROM "crm"."lead_channels" lc
			WHERE lc."lead_id" = l."id" AND lc."stage" = 'booked_call'
		) OR l."outreach_status" = 'booked_call' THEN 'meeting_booked'
		WHEN l."status" = 'qualified' THEN 'qualified'
		WHEN EXISTS (
			SELECT 1 FROM "crm"."lead_channels" lc
			WHERE lc."lead_id" = l."id" AND lc."stage" IN ('replied', 'in_conversation')
		) OR l."outreach_status" IN ('replied', 'in_conversation', 'connected') THEN 'engaged'
		WHEN EXISTS (
			SELECT 1 FROM "crm"."lead_channels" lc
			WHERE lc."lead_id" = l."id"
				AND lc."stage" IN ('connection_accepted', 'message_sent', 'awaiting_reply')
		) OR l."outreach_status" = 'approached' THEN 'connected'
		WHEN EXISTS (
			SELECT 1 FROM "crm"."lead_channels" lc
			WHERE lc."lead_id" = l."id" AND lc."stage" = 'connection_request_sent'
		) OR l."outreach_status" = 'connection_request_sent' THEN 'connection_sent'
		WHEN l."outreach_status" = 'not_interested' THEN 'nurture'
		WHEN l."status" = 'contacted' THEN 'connected'
		WHEN EXISTS (
			SELECT 1 FROM "crm"."lead_ai_assessments" la
			WHERE la."lead_id" = l."id"
		) THEN 'ready_to_reach_out'
		ELSE 'new'
	END
)::"crm"."lead_journey_stage";--> statement-breakpoint
-- Preserve useful legacy context as multi-value tags. Row numbers stay as
-- import metadata; they are not meaningful business tags.
UPDATE "crm"."leads" AS l
SET "tags" = (
	SELECT COALESCE(jsonb_agg(DISTINCT tag_value), '[]'::jsonb)
	FROM (
		SELECT jsonb_array_elements_text(COALESCE(l."tags", '[]'::jsonb)) AS tag_value
		UNION ALL
		SELECT CASE
			WHEN l."connection_status" IS NOT NULL AND btrim(l."connection_status") <> ''
			THEN 'Connection: ' || btrim(l."connection_status")
		END
		UNION ALL
		SELECT CASE
			WHEN l."source_sheet" IS NOT NULL AND btrim(l."source_sheet") <> ''
			THEN 'Source Sheet: ' || btrim(l."source_sheet")
		END
		UNION ALL
		SELECT CASE WHEN l."outreach_status" = 'bad_fit' THEN 'Bad Fit' END
		UNION ALL
		SELECT CASE WHEN l."outreach_status" = 'not_interested' THEN 'Not Interested' END
		UNION ALL
		SELECT CASE
			WHEN ib."name" ~* '^(batch|set)[[:space:]#:_-]*.+'
			THEN 'Batch ' || regexp_replace(
				ib."name",
				'^(batch|set)[[:space:]#:_-]*',
				'',
				'i'
			)
		END
	) migrated_tags
	WHERE tag_value IS NOT NULL AND btrim(tag_value) <> ''
)
FROM "crm"."import_batches" ib
WHERE l."batch_id" = ib."id";--> statement-breakpoint
-- Leads without an import batch still need their other legacy fields converted.
UPDATE "crm"."leads" AS l
SET "tags" = (
	SELECT COALESCE(jsonb_agg(DISTINCT tag_value), '[]'::jsonb)
	FROM (
		SELECT jsonb_array_elements_text(COALESCE(l."tags", '[]'::jsonb)) AS tag_value
		UNION ALL
		SELECT CASE
			WHEN l."connection_status" IS NOT NULL AND btrim(l."connection_status") <> ''
			THEN 'Connection: ' || btrim(l."connection_status")
		END
		UNION ALL
		SELECT CASE
			WHEN l."source_sheet" IS NOT NULL AND btrim(l."source_sheet") <> ''
			THEN 'Source Sheet: ' || btrim(l."source_sheet")
		END
		UNION ALL
		SELECT CASE WHEN l."outreach_status" = 'bad_fit' THEN 'Bad Fit' END
		UNION ALL
		SELECT CASE WHEN l."outreach_status" = 'not_interested' THEN 'Not Interested' END
	) migrated_tags
	WHERE tag_value IS NOT NULL AND btrim(tag_value) <> ''
)
WHERE l."batch_id" IS NULL;--> statement-breakpoint
-- Seed a reusable tag catalog, then register every distinct tag already in use.
INSERT INTO "crm"."tag_definitions" ("name", "slug", "color", "is_system")
VALUES
	('Hot Lead', 'hot-lead', 'red', true),
	('Warm Lead', 'warm-lead', 'amber', true),
	('Cold Lead', 'cold-lead', 'blue', true),
	('Decision Maker', 'decision-maker', 'violet', true),
	('Enterprise', 'enterprise', 'violet', true),
	('SMB', 'smb', 'cyan', true),
	('Startup', 'startup', 'emerald', true),
	('Referral', 'referral', 'green', true),
	('Inbound', 'inbound', 'cyan', true),
	('Outbound', 'outbound', 'blue', true),
	('Follow-up', 'follow-up', 'amber', true),
	('Nurture', 'nurture', 'pink', true),
	('Qualified', 'qualified', 'green', true),
	('Unqualified', 'unqualified', 'slate', true),
	('Competitor', 'competitor', 'red', true)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
INSERT INTO "crm"."tag_definitions" ("name", "slug", "is_system")
SELECT DISTINCT
	tag_name,
	left(trim(both '-' from regexp_replace(lower(tag_name), '[^a-z0-9]+', '-', 'g')), 80),
	(tag_name LIKE 'Batch %' OR tag_name LIKE 'Connection: %' OR tag_name LIKE 'Source Sheet: %')
FROM "crm"."leads" l
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(l."tags", '[]'::jsonb)) AS tag_name
WHERE btrim(tag_name) <> ''
	AND trim(both '-' from regexp_replace(lower(tag_name), '[^a-z0-9]+', '-', 'g')) <> ''
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
CREATE INDEX "idx_leads_journey_stage" ON "crm"."leads" USING btree ("journey_stage");
