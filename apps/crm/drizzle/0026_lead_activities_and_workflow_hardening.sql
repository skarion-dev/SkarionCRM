ALTER TABLE "crm"."activities" ADD COLUMN "lead_id" uuid;
--> statement-breakpoint
ALTER TABLE "crm"."activities" ADD CONSTRAINT "activities_lead_id_leads_id_fk"
  FOREIGN KEY ("lead_id") REFERENCES "crm"."leads"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_activities_lead" ON "crm"."activities" USING btree ("lead_id");
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_embeddings_content_trgm"
  ON "crm"."embeddings" USING gin ("content" gin_trgm_ops);
--> statement-breakpoint

-- Preserve outreach activities written before activities had a first-class
-- lead relation. Only valid UUID values that still reference a live lead are
-- migrated; malformed legacy content remains untouched.
UPDATE "crm"."activities" activity
SET "lead_id" = substring(
  activity."content"
  from '"leadId"\s*:\s*"([0-9a-fA-F-]{36})"'
)::uuid
WHERE activity."lead_id" IS NULL
  AND substring(
    activity."content"
    from '"leadId"\s*:\s*"([0-9a-fA-F-]{36})"'
  ) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1
    FROM "crm"."leads" lead
    WHERE lead."id" = substring(
      activity."content"
      from '"leadId"\s*:\s*"([0-9a-fA-F-]{36})"'
    )::uuid
  );
