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
VALUES
  (
    'Manual URL prospects 2026-07-30',
    'manual-url-prospects-2026-07-30',
    'blue',
    'LinkedIn profile URLs supplied for manual prospect review on 2026-07-30.',
    false,
    'a77b7dc2-efab-478e-960b-3080e9d9b167'::uuid,
    now(),
    now()
  ),
  (
    'needs profile capture',
    'needs-profile-capture',
    'amber',
    'LinkedIn profile details still need to be captured.',
    true,
    NULL,
    now(),
    now()
  )
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint

INSERT INTO "crm"."import_batches" (
  "id",
  "workspace_id",
  "name",
  "imported_by_user_id",
  "source",
  "total_rows",
  "imported_count",
  "duplicates_skipped",
  "default_tags",
  "created_at"
)
VALUES (
  '9f2c4d6a-7b81-4d57-9ce2-073020260022'::uuid,
  '00000000-0000-4000-8000-000000000001'::uuid,
  'Manual URL prospects 2026-07-30',
  'a77b7dc2-efab-478e-960b-3080e9d9b167'::uuid,
  'linkedin',
  22,
  0,
  0,
  '["Manual URL prospects 2026-07-30", "needs profile capture"]'::jsonb,
  now()
)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

WITH input (
  source_row,
  linkedin_url,
  profile_key,
  first_name,
  last_name
) AS (
  VALUES
    (1, 'https://www.linkedin.com/in/fares-ibrahim-shehata', 'fares-ibrahim-shehata', 'Fares', 'Ibrahim Shehata'),
    (2, 'https://www.linkedin.com/in/muhammet-sefa-hundur', 'muhammet-sefa-hundur', 'Muhammet', 'Sefa Hundur'),
    (3, 'https://www.linkedin.com/in/lovesh-kumar', 'lovesh-kumar', 'Lovesh', 'Kumar'),
    (4, 'https://www.linkedin.com/in/fatehahmad71', 'fatehahmad71', 'Fateh', 'Ahmad'),
    (5, 'https://www.linkedin.com/in/rafael-vantuyl', 'rafael-vantuyl', 'Rafael', 'Vantuyl'),
    (6, 'https://www.linkedin.com/in/le-nguyen-089913211', 'le-nguyen-089913211', 'Le', 'Nguyen'),
    (7, 'https://www.linkedin.com/in/alexander-thao-3b1047261', 'alexander-thao-3b1047261', 'Alexander', 'Thao'),
    (8, 'https://www.linkedin.com/in/nafisanwar', 'nafisanwar', 'Nafis', 'Anwar'),
    (9, 'https://www.linkedin.com/in/prangon-majumder-893166265', 'prangon-majumder-893166265', 'Prangon', 'Majumder'),
    (10, 'https://www.linkedin.com/in/paramveer-singh-bhele', 'paramveer-singh-bhele', 'Paramveer', 'Singh Bhele'),
    (11, 'https://www.linkedin.com/in/tiana-capalbo-51661a293', 'tiana-capalbo-51661a293', 'Tiana', 'Capalbo'),
    (12, 'https://www.linkedin.com/in/camila-iberico', 'camila-iberico', 'Camila', 'Iberico'),
    (13, 'https://www.linkedin.com/in/zarin-tasnim-0850b41a1', 'zarin-tasnim-0850b41a1', 'Zarin', 'Tasnim'),
    (14, 'https://www.linkedin.com/in/kbmibrahim', 'kbmibrahim', 'Kbm', 'Ibrahim'),
    (15, 'https://www.linkedin.com/in/sazinbinnoor', 'sazinbinnoor', 'Sazin', 'Bin Noor'),
    (16, 'https://www.linkedin.com/in/nuhaid-taiseer-4b8999296', 'nuhaid-taiseer-4b8999296', 'Nuhaid', 'Taiseer'),
    (17, 'https://www.linkedin.com/in/faizanmustafasyed', 'faizanmustafasyed', 'Faizan Mustafa', 'Syed'),
    (18, 'https://www.linkedin.com/in/abanob-labib', 'abanob-labib', 'Abanob', 'Labib'),
    (19, 'https://www.linkedin.com/in/ayush-parida', 'ayush-parida', 'Ayush', 'Parida'),
    (20, 'https://www.linkedin.com/in/md-safwan-murshed-033ab41b6', 'md-safwan-murshed-033ab41b6', 'Md Safwan', 'Murshed'),
    (21, 'https://www.linkedin.com/in/shahriar-tasnim0013', 'shahriar-tasnim0013', 'Shahriar', 'Tasnim'),
    (22, 'https://www.linkedin.com/in/anas03', 'anas03', 'Anas', 'Candidate')
),
new_candidates AS (
  SELECT
    input.*,
    nextval('crm.lead_number_seq') AS lead_sequence
  FROM input
  WHERE NOT EXISTS (
    SELECT 1
    FROM "crm"."leads" existing
    WHERE existing."workspace_id" = '00000000-0000-4000-8000-000000000001'::uuid
      AND existing."linkedin_profile_key" = input.profile_key
      AND existing."deleted_at" IS NULL
  )
)
INSERT INTO "crm"."leads" (
  "workspace_id",
  "lead_number",
  "lead_sequence",
  "first_name",
  "last_name",
  "linkedin_url",
  "linkedin_profile_key",
  "prospect_source_context",
  "review_state",
  "profile_capture_status",
  "profile_normalization_status",
  "data_completeness",
  "source_sheet",
  "original_row_number",
  "tags",
  "batch_id",
  "source",
  "status",
  "journey_stage",
  "outreach_status",
  "owner_id",
  "idempotency_key"
)
SELECT
  '00000000-0000-4000-8000-000000000001'::uuid,
  'SK' || lpad(new_candidates.lead_sequence::text, 4, '0'),
  new_candidates.lead_sequence,
  new_candidates.first_name,
  new_candidates.last_name,
  new_candidates.linkedin_url,
  new_candidates.profile_key,
  jsonb_build_object(
    'importMode', 'url_only',
    'generatedName', true,
    'provisionalScoring', true
  ),
  'pending',
  'not_captured',
  'not_queued',
  40,
  'Manual URL prospects 2026-07-30',
  new_candidates.source_row,
  '["Manual URL prospects 2026-07-30", "needs profile capture"]'::jsonb,
  '9f2c4d6a-7b81-4d57-9ce2-073020260022'::uuid,
  'linkedin',
  'new',
  'new',
  'not_approached',
  'a77b7dc2-efab-478e-960b-3080e9d9b167'::uuid,
  'manual-url-prospect-2026-07-30:' || new_candidates.profile_key
FROM new_candidates
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "crm"."lead_import_memberships" (
  "workspace_id",
  "lead_id",
  "batch_id",
  "source_row",
  "created_at"
)
SELECT
  lead."workspace_id",
  lead."id",
  '9f2c4d6a-7b81-4d57-9ce2-073020260022'::uuid,
  lead."original_row_number",
  now()
FROM "crm"."leads" lead
WHERE lead."batch_id" = '9f2c4d6a-7b81-4d57-9ce2-073020260022'::uuid
ON CONFLICT ("lead_id", "batch_id") DO NOTHING;
--> statement-breakpoint

UPDATE "crm"."import_batches" batch
SET
  "imported_count" = (
    SELECT count(*)::integer
    FROM "crm"."leads" lead
    WHERE lead."batch_id" = batch."id"
      AND lead."deleted_at" IS NULL
  ),
  "duplicates_skipped" = 22 - (
    SELECT count(*)::integer
    FROM "crm"."leads" lead
    WHERE lead."batch_id" = batch."id"
      AND lead."deleted_at" IS NULL
  )
WHERE batch."id" = '9f2c4d6a-7b81-4d57-9ce2-073020260022'::uuid;
--> statement-breakpoint

INSERT INTO "crm"."lead_score_jobs" (
  "lead_id",
  "status",
  "attempts",
  "next_attempt_at",
  "locked_at",
  "completed_at",
  "last_error",
  "created_at",
  "updated_at"
)
SELECT
  lead."id",
  'pending',
  0,
  now(),
  NULL,
  NULL,
  NULL,
  now(),
  now()
FROM "crm"."leads" lead
WHERE lead."review_state" = 'pending'
  AND lead."deleted_at" IS NULL
  AND lead."linkedin_url" IS NOT NULL
  AND lead."profile_normalization_status" = 'not_queued'
  AND btrim(concat_ws(
    ' ',
    lead."headline",
    lead."location",
    lead."about",
    lead."experience",
    lead."education",
    lead."skills",
    lead."current_role",
    lead."current_role_dates",
    lead."notes"
  )) = ''
  AND NOT EXISTS (
    SELECT 1
    FROM "crm"."lead_ai_assessments" assessment
    WHERE assessment."lead_id" = lead."id"
  )
ON CONFLICT ("lead_id") DO UPDATE SET
  "status" = 'pending',
  "attempts" = 0,
  "next_attempt_at" = now(),
  "locked_at" = NULL,
  "completed_at" = NULL,
  "last_error" = NULL,
  "updated_at" = now();
