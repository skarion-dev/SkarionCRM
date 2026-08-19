CREATE TYPE "crm"."internal_applicant_document_type" AS ENUM('resume', 'portfolio', 'certificate', 'other');--> statement-breakpoint
CREATE TYPE "crm"."internal_applicant_status" AS ENUM('new', 'screening', 'shortlisted', 'interview', 'assessment', 'offer', 'hired', 'rejected', 'withdrawn', 'on_hold');--> statement-breakpoint

CREATE TABLE "crm"."internal_applicants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL,
  "applicant_number" text NOT NULL,
  "full_name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "roles_applied" jsonb NOT NULL,
  "source" text DEFAULT 'outlook' NOT NULL,
  "status" "crm"."internal_applicant_status" DEFAULT 'new' NOT NULL,
  "first_received_at" timestamp with time zone,
  "last_received_at" timestamp with time zone,
  "message_count" integer DEFAULT 0 NOT NULL,
  "university" text,
  "school" text,
  "education_location" text,
  "gpa" numeric(4, 2),
  "graduation_year" integer,
  "skills" jsonb NOT NULL,
  "skill_count" integer DEFAULT 0 NOT NULL,
  "culture_evidence_count" integer DEFAULT 0 NOT NULL,
  "school_outside_dhaka" boolean DEFAULT false NOT NULL,
  "location_proxy_adjustment" integer DEFAULT 0 NOT NULL,
  "project_evidence_count" integer DEFAULT 0 NOT NULL,
  "completeness_count" integer DEFAULT 0 NOT NULL,
  "resume_count" integer DEFAULT 0 NOT NULL,
  "skills_score" numeric(5, 2),
  "education_score" numeric(5, 2),
  "culture_score" numeric(5, 2),
  "overall_score" numeric(5, 2),
  "recommendation" text,
  "score_notes" text,
  "raw_email_text" text,
  "raw_text_truncated" boolean DEFAULT false NOT NULL,
  "resume_text" text,
  "source_message_ids" jsonb NOT NULL,
  "assigned_to" uuid,
  "tags" jsonb,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "deleted_by" uuid,
  CONSTRAINT "internal_applicants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "crm"."workspaces"("id")
);--> statement-breakpoint

CREATE TABLE "crm"."internal_applicant_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL,
  "applicant_id" uuid NOT NULL,
  "document_type" "crm"."internal_applicant_document_type" DEFAULT 'resume' NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text,
  "source_path" text,
  "storage_key" text,
  "source_message_id" text,
  "extracted_text" text,
  "file_size_bytes" integer,
  "sha256" text,
  "received_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "internal_applicant_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "crm"."workspaces"("id"),
  CONSTRAINT "internal_applicant_documents_applicant_id_internal_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "crm"."internal_applicants"("id") ON DELETE cascade
);--> statement-breakpoint

CREATE TABLE "crm"."internal_applicant_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001'::uuid NOT NULL,
  "applicant_id" uuid NOT NULL,
  "external_message_id" text NOT NULL,
  "message_file" text,
  "received_at" timestamp with time zone,
  "sender" text,
  "sender_name" text,
  "subject" text,
  "to_recipients" text,
  "cc_recipients" text,
  "body_content_type" text,
  "raw_email_text" text,
  "raw_truncated" boolean DEFAULT false NOT NULL,
  "has_attachments" boolean DEFAULT false NOT NULL,
  "outlook_link" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "internal_applicant_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "crm"."workspaces"("id"),
  CONSTRAINT "internal_applicant_messages_applicant_id_internal_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "crm"."internal_applicants"("id") ON DELETE cascade
);--> statement-breakpoint

CREATE UNIQUE INDEX "idx_internal_applicants_workspace_number" ON "crm"."internal_applicants" USING btree ("workspace_id", "applicant_number");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_internal_applicants_workspace_email" ON "crm"."internal_applicants" USING btree ("workspace_id", lower("email"));--> statement-breakpoint
CREATE INDEX "idx_internal_applicants_status" ON "crm"."internal_applicants" USING btree ("workspace_id", "status");--> statement-breakpoint
CREATE INDEX "idx_internal_applicants_score" ON "crm"."internal_applicants" USING btree ("workspace_id", "overall_score");--> statement-breakpoint
CREATE INDEX "idx_internal_applicants_received" ON "crm"."internal_applicants" USING btree ("workspace_id", "first_received_at");--> statement-breakpoint
CREATE INDEX "idx_internal_applicants_name" ON "crm"."internal_applicants" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "idx_internal_applicant_documents_applicant" ON "crm"."internal_applicant_documents" USING btree ("applicant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_internal_applicant_documents_checksum" ON "crm"."internal_applicant_documents" USING btree ("applicant_id", "sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_internal_applicant_messages_external_id" ON "crm"."internal_applicant_messages" USING btree ("external_message_id");--> statement-breakpoint
CREATE INDEX "idx_internal_applicant_messages_applicant_received" ON "crm"."internal_applicant_messages" USING btree ("applicant_id", "received_at");
