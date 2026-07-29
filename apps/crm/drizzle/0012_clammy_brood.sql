CREATE TABLE "crm"."linkedin_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_conversation_id" text NOT NULL,
	"lead_id" uuid,
	"other_party_name" text NOT NULL,
	"other_party_profile_url" text,
	"owner_profile_url" text NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"outbound_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"last_message_from_us" boolean DEFAULT false NOT NULL,
	"messages" jsonb NOT NULL,
	"imported_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm"."linkedin_conversations" ADD CONSTRAINT "linkedin_conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "crm"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_linkedin_conversations_importer_external" ON "crm"."linkedin_conversations" USING btree ("imported_by","external_conversation_id");--> statement-breakpoint
CREATE INDEX "idx_linkedin_conversations_lead" ON "crm"."linkedin_conversations" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_linkedin_conversations_last_message" ON "crm"."linkedin_conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "idx_linkedin_conversations_profile_url" ON "crm"."linkedin_conversations" USING btree ("other_party_profile_url");
