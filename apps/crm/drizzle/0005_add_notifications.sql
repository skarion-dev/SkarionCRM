CREATE TABLE "crm"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"resource_type" text,
	"resource_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "crm"."notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_resource" ON "crm"."notifications" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_read" ON "crm"."notifications" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_created" ON "crm"."notifications" USING btree ("created_at");
