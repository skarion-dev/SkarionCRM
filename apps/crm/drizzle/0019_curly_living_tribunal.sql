ALTER TABLE "crm"."lead_ai_assessments" ADD COLUMN "profile_evidence_quality" text DEFAULT 'insufficient' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."lead_ai_assessments" ADD COLUMN "market_entry_timing" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."lead_ai_assessments" ADD COLUMN "candidate_need_evidence" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "current_role" text;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "current_role_dates" text;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "open_to_work" boolean;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "years_experience" text;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "connection_degree" text;--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "prospect_source_context" jsonb;