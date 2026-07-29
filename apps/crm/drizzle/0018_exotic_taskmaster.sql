CREATE TYPE "crm"."profile_normalization_status" AS ENUM('not_queued', 'pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "crm"."lead_profile_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "profile_summary" text;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "education_entries" jsonb;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "experience_entries" jsonb;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "skill_names" jsonb;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "profile_normalization_status" "crm"."profile_normalization_status" DEFAULT 'not_queued' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "profile_normalization_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "profile_normalization_warnings" jsonb;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "profile_normalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm"."lead_profile_jobs" ADD CONSTRAINT "lead_profile_jobs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "crm"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lead_profile_jobs_lead" ON "crm"."lead_profile_jobs" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_lead_profile_jobs_queue" ON "crm"."lead_profile_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_leads_profile_normalization" ON "crm"."leads" USING btree ("profile_normalization_status");--> statement-breakpoint
WITH latest_capture AS (
	SELECT DISTINCT ON ("lead_id")
		"lead_id",
		"payload"
	FROM "crm"."lead_profile_captures"
	ORDER BY "lead_id", "created_at" DESC
)
UPDATE "crm"."leads" AS lead
SET
	"headline" = COALESCE(NULLIF(lead."headline", ''), NULLIF(latest_capture."payload"->>'headline', '')),
	"location" = COALESCE(NULLIF(lead."location", ''), NULLIF(latest_capture."payload"->>'location', '')),
	"about" = COALESCE(NULLIF(lead."about", ''), NULLIF(latest_capture."payload"->>'about', '')),
	"experience" = COALESCE(NULLIF(lead."experience", ''), NULLIF(latest_capture."payload"->>'experience', '')),
	"education" = COALESCE(NULLIF(lead."education", ''), NULLIF(latest_capture."payload"->>'education', '')),
	"skills" = COALESCE(NULLIF(lead."skills", ''), NULLIF(latest_capture."payload"->>'skills', ''))
FROM latest_capture
WHERE latest_capture."lead_id" = lead."id";--> statement-breakpoint
UPDATE "crm"."leads"
SET "profile_normalization_status" = 'pending'
WHERE "deleted_at" IS NULL
	AND (
		NULLIF("headline", '') IS NOT NULL
		OR NULLIF("location", '') IS NOT NULL
		OR NULLIF("about", '') IS NOT NULL
		OR NULLIF("experience", '') IS NOT NULL
		OR NULLIF("education", '') IS NOT NULL
		OR NULLIF("skills", '') IS NOT NULL
		OR ("source" = 'linkedin' AND NULLIF("notes", '') IS NOT NULL)
	);--> statement-breakpoint
INSERT INTO "crm"."lead_profile_jobs" ("lead_id")
SELECT "id"
FROM "crm"."leads"
WHERE "profile_normalization_status" = 'pending'
ON CONFLICT ("lead_id") DO NOTHING;
