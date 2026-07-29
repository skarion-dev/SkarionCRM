CREATE TABLE "crm"."lead_ai_assessments" (
	"lead_id" uuid PRIMARY KEY NOT NULL,
	"overall_score" integer NOT NULL,
	"raw_score" integer NOT NULL,
	"classification" text NOT NULL,
	"confidence_level" text NOT NULL,
	"score_breakdown" jsonb NOT NULL,
	"verified_positive_signals" jsonb NOT NULL,
	"risks_or_missing_information" jsonb NOT NULL,
	"hard_disqualifier" boolean DEFAULT false NOT NULL,
	"hard_disqualifier_reason" text,
	"campaign_matches" jsonb NOT NULL,
	"recommended_action" text NOT NULL,
	"best_outreach_angle" text NOT NULL,
	"qualification_questions" jsonb NOT NULL,
	"reasoning_summary" text NOT NULL,
	"connection_note" text NOT NULL,
	"connection_note_character_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm"."lead_ai_assessments" ADD CONSTRAINT "lead_ai_assessments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "crm"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_lead_ai_assessments_score" ON "crm"."lead_ai_assessments" USING btree ("overall_score");--> statement-breakpoint
CREATE INDEX "idx_lead_ai_assessments_classification" ON "crm"."lead_ai_assessments" USING btree ("classification");
