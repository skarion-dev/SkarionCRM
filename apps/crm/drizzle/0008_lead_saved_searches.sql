CREATE TABLE "crm"."lead_saved_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"sort_by" text,
	"sort_order" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_lead_saved_searches_owner" ON "crm"."lead_saved_searches" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_lead_saved_searches_owner_name" ON "crm"."lead_saved_searches" USING btree ("owner_id","name");
