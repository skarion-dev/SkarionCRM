ALTER TABLE "crm"."leads"
  ADD COLUMN "captured_by_api_key_id" uuid,
  ADD COLUMN "captured_by_api_key_label" text;
--> statement-breakpoint

ALTER TABLE "crm"."lead_profile_captures"
  ADD COLUMN "captured_by_api_key_id" uuid,
  ADD COLUMN "captured_by_api_key_label" text;
--> statement-breakpoint

CREATE INDEX "idx_leads_capture_api_key"
  ON "crm"."leads" USING btree ("captured_by_api_key_id");
--> statement-breakpoint

-- Historical attribution is only safe when the owning user has exactly one
-- API key. Users with multiple keys remain unlabelled because guessing which
-- key performed an old capture would create false ownership data.
WITH unambiguous_keys AS (
  SELECT
    user_id,
    min(id::text)::uuid AS key_id,
    min(label) AS key_label
  FROM "identity"."api_keys"
  GROUP BY user_id
  HAVING count(*) = 1
)
UPDATE "crm"."leads" lead
SET
  "captured_by_api_key_id" = key_record.key_id,
  "captured_by_api_key_label" = key_record.key_label
FROM unambiguous_keys key_record
WHERE lead."owner_id" = key_record.user_id
  AND lead."last_captured_at" IS NOT NULL
  AND lead."captured_by_api_key_id" IS NULL;
