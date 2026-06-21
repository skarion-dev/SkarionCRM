ALTER TYPE "crm"."lead_source" ADD VALUE 'pdf_upload' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "crm"."chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"context_ids" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"content" text NOT NULL,
	"embedding" jsonb NOT NULL,
	"owner_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_chat_messages_user" ON "crm"."chat_messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_chat_messages_created" ON "crm"."chat_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_embeddings_resource" ON "crm"."embeddings" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "idx_embeddings_owner" ON "crm"."embeddings" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_embeddings_unique" ON "crm"."embeddings" USING btree ("resource_type","resource_id");