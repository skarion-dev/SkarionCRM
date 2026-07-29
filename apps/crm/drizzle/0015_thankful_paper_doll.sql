CREATE TYPE "crm"."lead_review_disposition" AS ENUM('excellent_fit', 'maybe', 'worth_trying', 'future', 'disqualified');--> statement-breakpoint
CREATE TYPE "crm"."lead_review_state" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "crm"."profile_capture_status" AS ENUM('not_captured', 'processing', 'captured', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "crm"."lead_event_outbox" (
	"sequence" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL,
	"lead_id" uuid,
	"event_type" text NOT NULL,
	"actor_user_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."lead_import_memberships" (
	"workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"source_row" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_import_memberships_lead_id_batch_id_pk" PRIMARY KEY("lead_id","batch_id")
);
--> statement-breakpoint
CREATE TABLE "crm"."lead_profile_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"captured_by" uuid NOT NULL,
	"source" text DEFAULT 'linkedin-extension' NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."prospect_import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL,
	"batch_id" uuid,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"invalid_count" integer DEFAULT 0 NOT NULL,
	"error_rows" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."prospect_review_claims" (
	"lead_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL,
	"claimed_by" uuid NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "crm"."workspaces" ("id", "name", "slug")
VALUES ('00000000-0000-4000-8000-000000000001', 'Skarion', 'skarion')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
DROP INDEX "crm"."idx_leads_linkedin_unique";--> statement-breakpoint
ALTER TABLE "crm"."import_batches" ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "lead_sequence" bigint;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "linkedin_profile_key" text;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "review_state" "crm"."lead_review_state" DEFAULT 'accepted' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "review_disposition" "crm"."lead_review_disposition";--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "profile_capture_status" "crm"."profile_capture_status" DEFAULT 'not_captured' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "last_captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "data_completeness" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "row_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE "crm"."leads"
SET
  "lead_sequence" = NULLIF(regexp_replace(COALESCE("lead_number", ''), '\D', '', 'g'), '')::bigint,
  "review_state" = CASE
    WHEN "journey_stage" IN ('disqualified', 'lost') THEN 'rejected'::"crm"."lead_review_state"
    ELSE 'accepted'::"crm"."lead_review_state"
  END,
  "review_disposition" = CASE
    WHEN "journey_stage" IN ('disqualified', 'lost')
      THEN 'disqualified'::"crm"."lead_review_disposition"
    ELSE NULL
  END,
  "reviewed_at" = COALESCE("updated_at", "created_at"),
  "data_completeness" =
    (CASE WHEN "first_name" <> '' THEN 15 ELSE 0 END) +
    (CASE WHEN "last_name" <> '' THEN 15 ELSE 0 END) +
    (CASE WHEN "linkedin_url" IS NOT NULL THEN 25 ELSE 0 END) +
    (CASE WHEN "company_name" IS NOT NULL THEN 15 ELSE 0 END) +
    (CASE WHEN "email" IS NOT NULL THEN 15 ELSE 0 END) +
    (CASE WHEN "phone" IS NOT NULL THEN 15 ELSE 0 END);--> statement-breakpoint
WITH canonical AS (
  SELECT
    "id",
    lower((regexp_match("linkedin_url", '/in/([^/?#]+)', 'i'))[1]) AS profile_key,
    row_number() OVER (
      PARTITION BY "workspace_id", lower((regexp_match("linkedin_url", '/in/([^/?#]+)', 'i'))[1])
      ORDER BY "created_at", "id"
    ) AS duplicate_rank
  FROM "crm"."leads"
  WHERE "linkedin_url" ~* '/in/[^/?#]+'
    AND "deleted_at" IS NULL
)
UPDATE "crm"."leads" AS lead
SET "linkedin_profile_key" = CASE
  WHEN canonical.duplicate_rank = 1 THEN canonical.profile_key
  ELSE NULL
END
FROM canonical
WHERE lead."id" = canonical."id";--> statement-breakpoint
INSERT INTO "crm"."lead_import_memberships" ("workspace_id", "lead_id", "batch_id", "source_row")
SELECT "workspace_id", "id", "batch_id", "original_row_number"
FROM "crm"."leads"
WHERE "batch_id" IS NOT NULL
ON CONFLICT ("lead_id", "batch_id") DO NOTHING;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "crm"."enqueue_lead_score_job"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."review_state" = 'accepted' THEN
    INSERT INTO "crm"."lead_score_jobs" ("lead_id")
    VALUES (NEW."id")
    ON CONFLICT ("lead_id") DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
ALTER TABLE "crm"."lead_event_outbox" ADD CONSTRAINT "lead_event_outbox_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "crm"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."lead_event_outbox" ADD CONSTRAINT "lead_event_outbox_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "crm"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."lead_import_memberships" ADD CONSTRAINT "lead_import_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "crm"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."lead_import_memberships" ADD CONSTRAINT "lead_import_memberships_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "crm"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."lead_import_memberships" ADD CONSTRAINT "lead_import_memberships_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "crm"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."lead_profile_captures" ADD CONSTRAINT "lead_profile_captures_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "crm"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."lead_profile_captures" ADD CONSTRAINT "lead_profile_captures_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "crm"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."prospect_import_jobs" ADD CONSTRAINT "prospect_import_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "crm"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."prospect_import_jobs" ADD CONSTRAINT "prospect_import_jobs_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "crm"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."prospect_review_claims" ADD CONSTRAINT "prospect_review_claims_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "crm"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."prospect_review_claims" ADD CONSTRAINT "prospect_review_claims_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "crm"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_lead_event_outbox_workspace_sequence" ON "crm"."lead_event_outbox" USING btree ("workspace_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_lead_event_outbox_created" ON "crm"."lead_event_outbox" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_lead_import_memberships_batch" ON "crm"."lead_import_memberships" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_lead_profile_captures_lead" ON "crm"."lead_profile_captures" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_lead_profile_captures_workspace" ON "crm"."lead_profile_captures" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_prospect_import_jobs_workspace" ON "crm"."prospect_import_jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_prospect_import_jobs_status" ON "crm"."prospect_import_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_prospect_review_claims_workspace" ON "crm"."prospect_review_claims" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_prospect_review_claims_expiry" ON "crm"."prospect_review_claims" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workspaces_slug" ON "crm"."workspaces" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "crm"."import_batches" ADD CONSTRAINT "import_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "crm"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD CONSTRAINT "leads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "crm"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_leads_lead_sequence" ON "crm"."leads" USING btree ("lead_sequence");--> statement-breakpoint
CREATE INDEX "idx_leads_review_queue" ON "crm"."leads" USING btree ("workspace_id","review_state","created_at");--> statement-breakpoint
CREATE INDEX "idx_leads_capture_status" ON "crm"."leads" USING btree ("profile_capture_status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_leads_workspace_linkedin_key_unique" ON "crm"."leads" USING btree ("workspace_id","linkedin_profile_key") WHERE "crm"."leads"."linkedin_profile_key" IS NOT NULL AND "crm"."leads"."deleted_at" IS NULL;
