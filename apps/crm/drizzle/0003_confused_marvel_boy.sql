CREATE TYPE "crm"."document_import_status" AS ENUM('pending', 'converted', 'failed', 'linked');--> statement-breakpoint
CREATE TABLE "crm"."document_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_hash" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"source" "crm"."lead_source" DEFAULT 'other' NOT NULL,
	"markdown_preview" text,
	"conversion_status" "crm"."document_import_status" DEFAULT 'pending' NOT NULL,
	"conversion_warnings" jsonb,
	"estimated_tokens" integer,
	"char_count" integer,
	"used_fallback" boolean DEFAULT false NOT NULL,
	"fallback_reason" text,
	"lead_id" uuid,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_document_imports_hash" ON "crm"."document_imports" USING btree ("file_hash");--> statement-breakpoint
CREATE INDEX "idx_document_imports_lead" ON "crm"."document_imports" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_document_imports_owner" ON "crm"."document_imports" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_document_imports_status" ON "crm"."document_imports" USING btree ("conversion_status");