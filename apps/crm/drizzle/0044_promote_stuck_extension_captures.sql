-- Extension captures are verified profile data. Any active prospect that has
-- been captured by an authenticated extension key must not remain in the
-- pending review queue indefinitely.
UPDATE "crm"."leads"
SET
  "review_state" = 'accepted',
  "reviewed_at" = COALESCE("reviewed_at", "last_captured_at", now()),
  "reviewed_by" = COALESCE("reviewed_by", "owner_id"),
  "row_version" = "row_version" + 1,
  "updated_at" = now()
WHERE "deleted_at" IS NULL
  AND "review_state" = 'pending'
  AND "captured_by_api_key_id" IS NOT NULL
  AND "profile_capture_status" IN ('captured', 'partial');
--> statement-breakpoint

DELETE FROM "crm"."prospect_review_claims" claim
USING "crm"."leads" lead
WHERE claim."lead_id" = lead."id"
  AND lead."review_state" = 'accepted'
  AND lead."captured_by_api_key_id" IS NOT NULL
  AND lead."profile_capture_status" IN ('captured', 'partial');
