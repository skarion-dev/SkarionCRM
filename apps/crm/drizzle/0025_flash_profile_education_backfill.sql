ALTER TABLE "crm"."leads" ADD COLUMN "most_recent_school" text;
--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "most_recent_degree" text;
--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "most_recent_field_of_study" text;
--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "most_recent_education_start_date" text;
--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "most_recent_graduation_date" text;
--> statement-breakpoint
ALTER TABLE "crm"."leads" ADD COLUMN "most_recent_graduation_year" integer;
--> statement-breakpoint

-- Make existing structured profiles useful immediately. Version 2 cleanup
-- below will replace these best-effort values from the full captured text.
WITH ranked_education AS (
  SELECT
    lead."id" AS lead_id,
    education.entry,
    row_number() OVER (
      PARTITION BY lead."id"
      ORDER BY
        CASE
          WHEN lower(coalesce(education.entry ->> 'endDate', '')) ~
            '(present|current|expected|ongoing)' THEN 9999
          ELSE coalesce(
            nullif(substring(education.entry ->> 'endDate' from '((19|20)[0-9]{2})'), '')::integer,
            nullif(substring(education.entry ->> 'startDate' from '((19|20)[0-9]{2})'), '')::integer,
            0
          )
        END DESC,
        education.position ASC
    ) AS recency
  FROM "crm"."leads" lead
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(lead."education_entries") = 'array' THEN lead."education_entries"
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS education(entry, position)
  WHERE lead."deleted_at" IS NULL
),
recent AS (
  SELECT lead_id, entry
  FROM ranked_education
  WHERE recency = 1
)
UPDATE "crm"."leads" lead
SET
  "most_recent_school" = recent.entry ->> 'institution',
  "most_recent_degree" = recent.entry ->> 'degree',
  "most_recent_field_of_study" = recent.entry ->> 'fieldOfStudy',
  "most_recent_education_start_date" = recent.entry ->> 'startDate',
  "most_recent_graduation_date" = recent.entry ->> 'endDate',
  "most_recent_graduation_year" = nullif(
    substring(recent.entry ->> 'endDate' from '((19|20)[0-9]{2})'),
    ''
  )::integer,
  "updated_at" = now()
FROM recent
WHERE lead."id" = recent.lead_id;
--> statement-breakpoint

-- Route the three enrichment agents through the fast Flash alias. All other
-- routine text agents retain the cheaper default from migration 0024.
UPDATE "crm"."integration_configs"
SET
  "settings" = jsonb_set(
    jsonb_set(
      jsonb_set(
        coalesce("settings", '{}'::jsonb),
        '{agentModels,prospect-profile}',
        '"coding-fast"'::jsonb,
        true
      ),
      '{agentModels,profile-normalizer}',
      '"coding-fast"'::jsonb,
      true
    ),
    '{agentModels,lead-scorer}',
    '"coding-fast"'::jsonb,
    true
  ),
  "updated_at" = now()
WHERE "provider" = 'ai_runtime';
--> statement-breakpoint

-- Version 2 has explicit latest-education fields. Requeue every captured,
-- non-rejected, non-PhD profile so old captures receive the new schema too.
WITH eligible AS (
  SELECT lead."id"
  FROM "crm"."leads" lead
  WHERE lead."deleted_at" IS NULL
    AND lead."review_state" <> 'rejected'
    AND lead."profile_capture_status" IN ('captured', 'partial')
    AND NOT (
      lower(concat_ws(
        ' ',
        lead."first_name",
        lead."last_name",
        lead."headline",
        lead."about",
        lead."experience",
        lead."education",
        lead."skills",
        lead."current_role",
        lead."current_role_dates",
        lead."profile_summary",
        lead."education_entries"::text,
        lead."experience_entries"::text,
        lead."notes"
      )) ~ '(^|[^[:alpha:]])ph[.]?[[:space:]]*d[.]?([^[:alpha:]]|$)'
      OR lower(concat_ws(
        ' ',
        lead."first_name",
        lead."last_name",
        lead."headline",
        lead."about",
        lead."experience",
        lead."education",
        lead."skills",
        lead."current_role",
        lead."current_role_dates",
        lead."profile_summary",
        lead."education_entries"::text,
        lead."experience_entries"::text,
        lead."notes"
      )) LIKE '%doctor of philosophy%'
    )
)
UPDATE "crm"."leads" lead
SET
  "profile_normalization_status" = 'pending',
  "profile_normalization_version" = 0,
  "profile_normalization_warnings" = NULL,
  "updated_at" = now()
FROM eligible
WHERE lead."id" = eligible."id";
--> statement-breakpoint

INSERT INTO "crm"."lead_profile_jobs" (
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
WHERE lead."deleted_at" IS NULL
  AND lead."review_state" <> 'rejected'
  AND lead."profile_normalization_status" = 'pending'
  AND lead."profile_capture_status" IN ('captured', 'partial')
ON CONFLICT ("lead_id") DO UPDATE SET
  "status" = 'pending',
  "attempts" = 0,
  "next_attempt_at" = now(),
  "locked_at" = NULL,
  "completed_at" = NULL,
  "last_error" = NULL,
  "updated_at" = now();
