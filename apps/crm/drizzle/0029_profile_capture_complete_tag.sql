INSERT INTO "crm"."tag_definitions" (
  "name",
  "slug",
  "color",
  "description",
  "is_system",
  "created_by",
  "created_at",
  "updated_at"
)
VALUES (
  'profile capture complete',
  'profile-capture-complete',
  'emerald',
  'LinkedIn profile data has been captured and sent to the CRM.',
  true,
  NULL,
  now(),
  now()
)
ON CONFLICT ("slug") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "is_system" = true,
  "updated_at" = now();
--> statement-breakpoint

UPDATE "crm"."leads" lead
SET
  "tags" = (
    COALESCE(
      (
        SELECT jsonb_agg(tag_value ORDER BY tag_order)
        FROM jsonb_array_elements_text(COALESCE(lead."tags", '[]'::jsonb))
          WITH ORDINALITY AS existing_tag(tag_value, tag_order)
        WHERE lower(trim(tag_value)) NOT IN (
          'needs profile capture',
          'profile capture complete'
        )
      ),
      '[]'::jsonb
    ) || '["profile capture complete"]'::jsonb
  ),
  "updated_at" = now()
WHERE lead."deleted_at" IS NULL
  AND lead."profile_capture_status" = 'captured';
