WITH captured_pairs AS (
  SELECT
    pending."id" AS pending_id,
    captured."id" AS captured_id,
    pending."lead_number" AS pending_lead_number,
    pending."lead_sequence" AS pending_lead_sequence,
    pending."batch_id" AS pending_batch_id,
    pending."source_sheet" AS pending_source_sheet,
    pending."original_row_number" AS pending_original_row_number,
    pending."tags" AS pending_tags
  FROM "crm"."leads" pending
  JOIN LATERAL (
    SELECT accepted.*
    FROM "crm"."leads" accepted
    WHERE accepted."workspace_id" = pending."workspace_id"
      AND accepted."id" <> pending."id"
      AND accepted."deleted_at" IS NULL
      AND accepted."review_state" = 'accepted'
      AND accepted."last_captured_at" IS NOT NULL
      AND accepted."created_at" >= pending."created_at"
      AND lower(btrim(accepted."first_name")) = lower(btrim(pending."first_name"))
      AND lower(btrim(accepted."last_name")) = lower(btrim(pending."last_name"))
    ORDER BY accepted."last_captured_at" DESC
    LIMIT 1
  ) captured ON true
  WHERE pending."deleted_at" IS NULL
    AND pending."review_state" = 'pending'
    AND pending."lead_number" IN ('SK3668', 'SK3641', 'SK3642', 'SK3634')
)
UPDATE "crm"."leads" captured
SET
  "lead_number" = pair.pending_lead_number,
  "lead_sequence" = pair.pending_lead_sequence,
  "batch_id" = COALESCE(captured."batch_id", pair.pending_batch_id),
  "source_sheet" = COALESCE(captured."source_sheet", pair.pending_source_sheet),
  "original_row_number" = COALESCE(
    captured."original_row_number",
    pair.pending_original_row_number
  ),
  "tags" = (
    SELECT COALESCE(jsonb_agg(DISTINCT merged.tag), '[]'::jsonb)
    FROM (
      SELECT jsonb_array_elements_text(COALESCE(captured."tags", '[]'::jsonb)) AS tag
      UNION ALL
      SELECT jsonb_array_elements_text(COALESCE(pair.pending_tags, '[]'::jsonb)) AS tag
    ) merged
  ),
  "row_version" = captured."row_version" + 1,
  "updated_at" = now()
FROM captured_pairs pair
WHERE captured."id" = pair.captured_id;
--> statement-breakpoint

WITH captured_pairs AS (
  SELECT pending."id" AS pending_id, captured."id" AS captured_id
  FROM "crm"."leads" pending
  JOIN LATERAL (
    SELECT accepted."id"
    FROM "crm"."leads" accepted
    WHERE accepted."workspace_id" = pending."workspace_id"
      AND accepted."id" <> pending."id"
      AND accepted."deleted_at" IS NULL
      AND accepted."review_state" = 'accepted'
      AND accepted."last_captured_at" IS NOT NULL
      AND accepted."created_at" >= pending."created_at"
      AND lower(btrim(accepted."first_name")) = lower(btrim(pending."first_name"))
      AND lower(btrim(accepted."last_name")) = lower(btrim(pending."last_name"))
    ORDER BY accepted."last_captured_at" DESC
    LIMIT 1
  ) captured ON true
  WHERE pending."deleted_at" IS NULL
    AND pending."review_state" = 'pending'
    AND pending."lead_number" IN ('SK3668', 'SK3641', 'SK3642', 'SK3634')
)
INSERT INTO "crm"."lead_import_memberships" (
  "workspace_id",
  "lead_id",
  "batch_id",
  "source_row",
  "created_at"
)
SELECT
  membership."workspace_id",
  pair.captured_id,
  membership."batch_id",
  membership."source_row",
  membership."created_at"
FROM captured_pairs pair
JOIN "crm"."lead_import_memberships" membership
  ON membership."lead_id" = pair.pending_id
ON CONFLICT ("lead_id", "batch_id") DO NOTHING;
--> statement-breakpoint

WITH captured_pairs AS (
  SELECT pending."id" AS pending_id, captured."id" AS captured_id
  FROM "crm"."leads" pending
  JOIN LATERAL (
    SELECT accepted."id"
    FROM "crm"."leads" accepted
    WHERE accepted."workspace_id" = pending."workspace_id"
      AND accepted."id" <> pending."id"
      AND accepted."deleted_at" IS NULL
      AND accepted."review_state" = 'accepted'
      AND accepted."last_captured_at" IS NOT NULL
      AND accepted."created_at" >= pending."created_at"
      AND lower(btrim(accepted."first_name")) = lower(btrim(pending."first_name"))
      AND lower(btrim(accepted."last_name")) = lower(btrim(pending."last_name"))
    ORDER BY accepted."last_captured_at" DESC
    LIMIT 1
  ) captured ON true
  WHERE pending."deleted_at" IS NULL
    AND pending."review_state" = 'pending'
    AND pending."lead_number" IN ('SK3668', 'SK3641', 'SK3642', 'SK3634')
)
UPDATE "crm"."lead_ai_assessments" assessment
SET "lead_id" = pair.captured_id
FROM captured_pairs pair
WHERE assessment."lead_id" = pair.pending_id
  AND NOT EXISTS (
    SELECT 1
    FROM "crm"."lead_ai_assessments" captured_assessment
    WHERE captured_assessment."lead_id" = pair.captured_id
  );
--> statement-breakpoint

WITH captured_pairs AS (
  SELECT pending."id" AS pending_id, captured."id" AS captured_id
  FROM "crm"."leads" pending
  JOIN LATERAL (
    SELECT accepted."id"
    FROM "crm"."leads" accepted
    WHERE accepted."workspace_id" = pending."workspace_id"
      AND accepted."id" <> pending."id"
      AND accepted."deleted_at" IS NULL
      AND accepted."review_state" = 'accepted'
      AND accepted."last_captured_at" IS NOT NULL
      AND accepted."created_at" >= pending."created_at"
      AND lower(btrim(accepted."first_name")) = lower(btrim(pending."first_name"))
      AND lower(btrim(accepted."last_name")) = lower(btrim(pending."last_name"))
    ORDER BY accepted."last_captured_at" DESC
    LIMIT 1
  ) captured ON true
  WHERE pending."deleted_at" IS NULL
    AND pending."review_state" = 'pending'
    AND pending."lead_number" IN ('SK3668', 'SK3641', 'SK3642', 'SK3634')
)
DELETE FROM "crm"."prospect_review_claims" claim
USING captured_pairs pair
WHERE claim."lead_id" = pair.pending_id;
--> statement-breakpoint

WITH captured_pairs AS (
  SELECT
    pending."id" AS pending_id,
    captured."id" AS captured_id,
    captured."reviewed_by" AS actor_user_id,
    to_jsonb(pending) AS pending_before,
    to_jsonb(captured) AS captured_after
  FROM "crm"."leads" pending
  JOIN LATERAL (
    SELECT accepted.*
    FROM "crm"."leads" accepted
    WHERE accepted."workspace_id" = pending."workspace_id"
      AND accepted."id" <> pending."id"
      AND accepted."deleted_at" IS NULL
      AND accepted."review_state" = 'accepted'
      AND accepted."last_captured_at" IS NOT NULL
      AND accepted."created_at" >= pending."created_at"
      AND lower(btrim(accepted."first_name")) = lower(btrim(pending."first_name"))
      AND lower(btrim(accepted."last_name")) = lower(btrim(pending."last_name"))
    ORDER BY accepted."last_captured_at" DESC
    LIMIT 1
  ) captured ON true
  WHERE pending."deleted_at" IS NULL
    AND pending."review_state" = 'pending'
    AND pending."lead_number" IN ('SK3668', 'SK3641', 'SK3642', 'SK3634')
)
INSERT INTO "crm"."audit_log" (
  "actor_user_id",
  "app",
  "action",
  "resource_type",
  "resource_id",
  "before",
  "after",
  "created_at"
)
SELECT
  pair.actor_user_id,
  'crm',
  'reconcile_extension_duplicate',
  'lead',
  pair.captured_id::text,
  pair.pending_before,
  pair.captured_after || jsonb_build_object('mergedPendingLeadId', pair.pending_id),
  now()
FROM captured_pairs pair;
--> statement-breakpoint

WITH captured_pairs AS (
  SELECT pending."id" AS pending_id, captured."id" AS captured_id
  FROM "crm"."leads" pending
  JOIN LATERAL (
    SELECT accepted."id"
    FROM "crm"."leads" accepted
    WHERE accepted."workspace_id" = pending."workspace_id"
      AND accepted."id" <> pending."id"
      AND accepted."deleted_at" IS NULL
      AND accepted."review_state" = 'accepted'
      AND accepted."last_captured_at" IS NOT NULL
      AND accepted."created_at" >= pending."created_at"
      AND lower(btrim(accepted."first_name")) = lower(btrim(pending."first_name"))
      AND lower(btrim(accepted."last_name")) = lower(btrim(pending."last_name"))
    ORDER BY accepted."last_captured_at" DESC
    LIMIT 1
  ) captured ON true
  WHERE pending."deleted_at" IS NULL
    AND pending."review_state" = 'pending'
    AND pending."lead_number" IN ('SK3668', 'SK3641', 'SK3642', 'SK3634')
)
DELETE FROM "crm"."lead_import_memberships" membership
USING captured_pairs pair
WHERE membership."lead_id" = pair.pending_id;
--> statement-breakpoint

WITH captured_pairs AS (
  SELECT
    pending."id" AS pending_id,
    pending."workspace_id",
    captured."id" AS captured_id,
    captured."reviewed_at",
    captured."reviewed_by",
    captured."review_disposition"
  FROM "crm"."leads" pending
  JOIN LATERAL (
    SELECT accepted.*
    FROM "crm"."leads" accepted
    WHERE accepted."workspace_id" = pending."workspace_id"
      AND accepted."id" <> pending."id"
      AND accepted."deleted_at" IS NULL
      AND accepted."review_state" = 'accepted'
      AND accepted."last_captured_at" IS NOT NULL
      AND accepted."created_at" >= pending."created_at"
      AND lower(btrim(accepted."first_name")) = lower(btrim(pending."first_name"))
      AND lower(btrim(accepted."last_name")) = lower(btrim(pending."last_name"))
    ORDER BY accepted."last_captured_at" DESC
    LIMIT 1
  ) captured ON true
  WHERE pending."deleted_at" IS NULL
    AND pending."review_state" = 'pending'
    AND pending."lead_number" IN ('SK3668', 'SK3641', 'SK3642', 'SK3634')
),
archived AS (
  UPDATE "crm"."leads" pending
  SET
    "review_state" = 'accepted',
    "review_disposition" = pair.review_disposition,
    "reviewed_at" = pair.reviewed_at,
    "reviewed_by" = pair.reviewed_by,
    "deleted_at" = now(),
    "row_version" = pending."row_version" + 1,
    "updated_at" = now()
  FROM captured_pairs pair
  WHERE pending."id" = pair.pending_id
  RETURNING pending."id", pending."workspace_id", pair.reviewed_by
)
INSERT INTO "crm"."lead_event_outbox" (
  "workspace_id",
  "lead_id",
  "event_type",
  "actor_user_id",
  "payload",
  "created_at"
)
SELECT
  archived."workspace_id",
  archived."id",
  'prospect.reviewed',
  archived."reviewed_by",
  jsonb_build_object(
    'lead',
    jsonb_build_object(
      'id',
      archived."id",
      'reviewState',
      'accepted',
      'deletedAt',
      now()
    ),
    'occurredAt',
    now()
  ),
  now()
FROM archived;
