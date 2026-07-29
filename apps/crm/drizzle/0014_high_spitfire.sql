ALTER TYPE "crm"."lead_journey_stage" ADD VALUE 'follow_up' BEFORE 'converted';--> statement-breakpoint
CREATE TABLE "crm"."lead_score_jobs" (
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
ALTER TABLE "crm"."lead_ai_assessments" ALTER COLUMN "connection_note" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."lead_ai_assessments" ALTER COLUMN "connection_note_character_count" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "crm"."lead_score_jobs" ADD CONSTRAINT "lead_score_jobs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "crm"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lead_score_jobs_lead" ON "crm"."lead_score_jobs" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_lead_score_jobs_queue" ON "crm"."lead_score_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
-- Seed every currently unscored lead into the durable queue.
INSERT INTO "crm"."lead_score_jobs" ("lead_id")
SELECT l."id"
FROM "crm"."leads" l
LEFT JOIN "crm"."lead_ai_assessments" a ON a."lead_id" = l."id"
WHERE l."deleted_at" IS NULL AND a."lead_id" IS NULL
ON CONFLICT ("lead_id") DO NOTHING;--> statement-breakpoint
-- Keep future ingestion paths covered at the database boundary, including
-- imports, extensions, and other workers that insert leads directly.
CREATE OR REPLACE FUNCTION "crm"."enqueue_lead_score_job"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	INSERT INTO "crm"."lead_score_jobs" ("lead_id")
	VALUES (NEW."id")
	ON CONFLICT ("lead_id") DO NOTHING;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "trg_enqueue_lead_score_job"
AFTER INSERT ON "crm"."leads"
FOR EACH ROW EXECUTE FUNCTION "crm"."enqueue_lead_score_job"();
