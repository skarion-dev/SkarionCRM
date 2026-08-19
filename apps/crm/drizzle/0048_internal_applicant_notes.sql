DO $$ BEGIN
  CREATE TYPE "crm"."internal_applicant_note_type" AS ENUM('screening', 'email');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TABLE "crm"."internal_applicants"
  ADD COLUMN IF NOT EXISTS "screened_at" timestamp with time zone;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "crm"."internal_applicant_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL,
  "applicant_id" uuid NOT NULL,
  "note_type" "crm"."internal_applicant_note_type" NOT NULL,
  "note" text NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "internal_applicant_notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "crm"."workspaces"("id"),
  CONSTRAINT "internal_applicant_notes_applicant_id_internal_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "crm"."internal_applicants"("id") ON DELETE cascade
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_internal_applicant_notes_applicant_occurred"
  ON "crm"."internal_applicant_notes" USING btree ("applicant_id", "occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_internal_applicant_notes_workspace_type"
  ON "crm"."internal_applicant_notes" USING btree ("workspace_id", "note_type");
