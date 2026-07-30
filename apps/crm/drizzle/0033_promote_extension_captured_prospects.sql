WITH extension_promotions AS (
  SELECT
    lead."id",
    latest_capture."actor_user_id",
    latest_capture."created_at"
  FROM "crm"."leads" lead
  CROSS JOIN LATERAL (
    SELECT audit."actor_user_id", audit."created_at"
    FROM "crm"."audit_log" audit
    WHERE audit."resource_type" = 'lead'
      AND audit."resource_id" = lead."id"::text
      AND audit."action" = 'enrich'
      AND audit."after"->>'source' = 'linkedin-extension'
      AND audit."before"->>'reviewState' = 'pending'
    ORDER BY audit."created_at" DESC
    LIMIT 1
  ) latest_capture
  WHERE lead."deleted_at" IS NULL
    AND lead."review_state" = 'pending'
)
UPDATE "crm"."leads" lead
SET
  "review_state" = 'accepted',
  "reviewed_at" = COALESCE(lead."reviewed_at", promotion."created_at", now()),
  "reviewed_by" = COALESCE(lead."reviewed_by", promotion."actor_user_id"),
  "row_version" = lead."row_version" + 1,
  "updated_at" = now()
FROM extension_promotions promotion
WHERE lead."id" = promotion."id";
--> statement-breakpoint

DELETE FROM "crm"."prospect_review_claims" claim
USING "crm"."leads" lead
WHERE claim."lead_id" = lead."id"
  AND lead."review_state" = 'accepted'
  AND EXISTS (
    SELECT 1
    FROM "crm"."audit_log" audit
    WHERE audit."resource_type" = 'lead'
      AND audit."resource_id" = lead."id"::text
      AND audit."action" = 'enrich'
      AND audit."after"->>'source' = 'linkedin-extension'
      AND audit."before"->>'reviewState' = 'pending'
  );
--> statement-breakpoint

INSERT INTO "crm"."lead_event_outbox" (
  "workspace_id",
  "lead_id",
  "event_type",
  "actor_user_id",
  "payload",
  "created_at"
)
SELECT
  lead."workspace_id",
  lead."id",
  'prospect.reviewed',
  latest_capture."actor_user_id",
  jsonb_build_object(
    'lead',
    to_jsonb(lead),
    'occurredAt',
    now()
  ),
  now()
FROM "crm"."leads" lead
CROSS JOIN LATERAL (
  SELECT audit."actor_user_id"
  FROM "crm"."audit_log" audit
  WHERE audit."resource_type" = 'lead'
    AND audit."resource_id" = lead."id"::text
    AND audit."action" = 'enrich'
    AND audit."after"->>'source' = 'linkedin-extension'
    AND audit."before"->>'reviewState' = 'pending'
  ORDER BY audit."created_at" DESC
  LIMIT 1
) latest_capture
WHERE lead."deleted_at" IS NULL
  AND lead."review_state" = 'accepted'
  AND NOT EXISTS (
    SELECT 1
    FROM "crm"."lead_event_outbox" event
    WHERE event."lead_id" = lead."id"
      AND event."event_type" = 'prospect.reviewed'
  );
