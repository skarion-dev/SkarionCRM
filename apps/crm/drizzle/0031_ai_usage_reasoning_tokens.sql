ALTER TABLE "crm"."ai_usage_events"
ADD COLUMN IF NOT EXISTS "reasoning_tokens" integer DEFAULT 0 NOT NULL;
