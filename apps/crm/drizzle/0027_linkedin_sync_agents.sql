ALTER TABLE "crm"."activities" ADD COLUMN "external_source" text;
--> statement-breakpoint
ALTER TABLE "crm"."activities" ADD COLUMN "external_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_activities_external_source_id"
  ON "crm"."activities" USING btree ("external_source", "external_id")
  WHERE "external_source" IS NOT NULL AND "external_id" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE "crm"."linkedin_sync_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "file_hash" text NOT NULL,
  "original_filename" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "total_rows" integer DEFAULT 0 NOT NULL,
  "new_items" integer DEFAULT 0 NOT NULL,
  "matched_items" integer DEFAULT 0 NOT NULL,
  "ignored_items" integer DEFAULT 0 NOT NULL,
  "flagged_items" integer DEFAULT 0 NOT NULL,
  "imported_by" uuid NOT NULL,
  "owner_profile_url" text,
  "source_timezone" text,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_linkedin_sync_import_file"
  ON "crm"."linkedin_sync_imports" USING btree ("imported_by", "kind", "file_hash");
--> statement-breakpoint
CREATE INDEX "idx_linkedin_sync_import_kind_created"
  ON "crm"."linkedin_sync_imports" USING btree ("kind", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_linkedin_sync_import_status"
  ON "crm"."linkedin_sync_imports" USING btree ("status");
--> statement-breakpoint

CREATE TABLE "crm"."linkedin_sync_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "external_key" text NOT NULL,
  "lead_id" uuid,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "linkedin_sync_jobs_import_id_fk" FOREIGN KEY ("import_id")
    REFERENCES "crm"."linkedin_sync_imports"("id") ON DELETE cascade,
  CONSTRAINT "linkedin_sync_jobs_lead_id_fk" FOREIGN KEY ("lead_id")
    REFERENCES "crm"."leads"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_linkedin_sync_jobs_import_key"
  ON "crm"."linkedin_sync_jobs" USING btree ("import_id", "kind", "external_key");
--> statement-breakpoint
CREATE INDEX "idx_linkedin_sync_jobs_queue"
  ON "crm"."linkedin_sync_jobs" USING btree ("status", "next_attempt_at");
--> statement-breakpoint
CREATE INDEX "idx_linkedin_sync_jobs_import"
  ON "crm"."linkedin_sync_jobs" USING btree ("import_id");
--> statement-breakpoint

CREATE TABLE "crm"."linkedin_message_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_id" uuid NOT NULL,
  "external_message_key" text NOT NULL,
  "external_conversation_id" text NOT NULL,
  "lead_id" uuid NOT NULL,
  "direction" text NOT NULL,
  "sender_name" text NOT NULL,
  "sender_profile_url" text,
  "content" text NOT NULL,
  "subject" text DEFAULT '' NOT NULL,
  "sent_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "linkedin_message_records_import_id_fk" FOREIGN KEY ("import_id")
    REFERENCES "crm"."linkedin_sync_imports"("id") ON DELETE restrict,
  CONSTRAINT "linkedin_message_records_lead_id_fk" FOREIGN KEY ("lead_id")
    REFERENCES "crm"."leads"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_linkedin_message_external_key"
  ON "crm"."linkedin_message_records" USING btree ("external_message_key");
--> statement-breakpoint
CREATE INDEX "idx_linkedin_message_lead_sent"
  ON "crm"."linkedin_message_records" USING btree ("lead_id", "sent_at");
--> statement-breakpoint
CREATE INDEX "idx_linkedin_message_import"
  ON "crm"."linkedin_message_records" USING btree ("import_id");
--> statement-breakpoint

CREATE TABLE "crm"."linkedin_sync_flags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_id" uuid NOT NULL,
  "external_conversation_id" text NOT NULL,
  "other_party_name" text NOT NULL,
  "other_party_profile_url" text,
  "message_count" integer DEFAULT 0 NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "linkedin_sync_flags_import_id_fk" FOREIGN KEY ("import_id")
    REFERENCES "crm"."linkedin_sync_imports"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_linkedin_sync_flag_import_conversation"
  ON "crm"."linkedin_sync_flags" USING btree ("import_id", "external_conversation_id");
--> statement-breakpoint
CREATE INDEX "idx_linkedin_sync_flag_status"
  ON "crm"."linkedin_sync_flags" USING btree ("status", "created_at");
--> statement-breakpoint

CREATE TABLE "crm"."linkedin_invitation_snapshot_entries" (
  "import_id" uuid NOT NULL,
  "other_party_profile_url" text NOT NULL,
  "other_party_name" text NOT NULL,
  "sent_at" timestamp with time zone NOT NULL,
  "lead_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "linkedin_invitation_snapshot_entries_import_id_fk" FOREIGN KEY ("import_id")
    REFERENCES "crm"."linkedin_sync_imports"("id") ON DELETE cascade,
  CONSTRAINT "linkedin_invitation_snapshot_entries_lead_id_fk" FOREIGN KEY ("lead_id")
    REFERENCES "crm"."leads"("id") ON DELETE set null,
  CONSTRAINT "linkedin_invitation_snapshot_entries_pk"
    PRIMARY KEY ("import_id", "other_party_profile_url")
);
--> statement-breakpoint
CREATE INDEX "idx_linkedin_invitation_snapshot_lead"
  ON "crm"."linkedin_invitation_snapshot_entries" USING btree ("lead_id");
