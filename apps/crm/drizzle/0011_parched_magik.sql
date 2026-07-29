CREATE TABLE "crm"."ai_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"backing_model" text NOT NULL,
	"agent_id" text,
	"request_type" text NOT NULL,
	"status" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(16, 8) DEFAULT '0' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"usage_source" text DEFAULT 'unavailable' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_ai_usage_created" ON "crm"."ai_usage_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_agent_created" ON "crm"."ai_usage_events" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_model_created" ON "crm"."ai_usage_events" USING btree ("backing_model","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_provider_created" ON "crm"."ai_usage_events" USING btree ("provider","created_at");