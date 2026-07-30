DELETE FROM "crm"."lead_ai_assessments" assessment
USING "crm"."leads" lead
WHERE assessment."lead_id" = lead."id"
  AND lead."deleted_at" IS NULL
  AND lead."journey_stage" IN ('new', 'ready_to_reach_out')
  AND lower(btrim(concat_ws(' ', lead."first_name", lead."last_name")))
    ~ '^([(][0-9]+[)][[:space:]]*)?(activity|recent activity|all activity|posts?|comments?|reactions?|followers?|connections?|notifications?|messaging|jobs?|home|feed|my network|linkedin)$';
--> statement-breakpoint

INSERT INTO "crm"."lead_score_jobs" AS score_job (
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
  AND lead."journey_stage" IN ('new', 'ready_to_reach_out')
  AND lower(btrim(concat_ws(' ', lead."first_name", lead."last_name")))
    ~ '^([(][0-9]+[)][[:space:]]*)?(activity|recent activity|all activity|posts?|comments?|reactions?|followers?|connections?|notifications?|messaging|jobs?|home|feed|my network|linkedin)$'
ON CONFLICT ("lead_id") DO UPDATE
SET
  "status" = 'pending',
  "attempts" = 0,
  "next_attempt_at" = now(),
  "locked_at" = NULL,
  "completed_at" = NULL,
  "last_error" = NULL,
  "updated_at" = now();
--> statement-breakpoint

WITH malformed AS (
  SELECT
    lead."id",
    lead."first_name",
    lead."last_name",
    lead."company_name",
    coalesce(
      lead."linkedin_profile_key",
      substring(lead."linkedin_url" from '/in/([^/?#]+)')
    ) AS "profile_key"
  FROM "crm"."leads" lead
  WHERE lead."deleted_at" IS NULL
    AND lower(btrim(concat_ws(' ', lead."first_name", lead."last_name")))
      ~ '^([(][0-9]+[)][[:space:]]*)?(activity|recent activity|all activity|posts?|comments?|reactions?|followers?|connections?|notifications?|messaging|jobs?|home|feed|my network|linkedin)$'
),
repair_sources AS (
  SELECT
    malformed.*,
    prior."first_name" AS "prior_first_name",
    prior."last_name" AS "prior_last_name",
    prior."company_name" AS "prior_company_name",
    regexp_replace(
      replace(coalesce(malformed."profile_key", ''), '_', '-'),
      '-[0-9][[:alnum:]-]*$',
      '',
      'i'
    ) AS "public_slug"
  FROM malformed
  LEFT JOIN LATERAL (
    SELECT
      NULLIF(btrim(audit."before"->>'firstName'), '') AS "first_name",
      NULLIF(btrim(audit."before"->>'lastName'), '') AS "last_name",
      NULLIF(btrim(audit."before"->>'companyName'), '') AS "company_name"
    FROM "crm"."audit_log" audit
    WHERE audit."resource_type" = 'lead'
      AND audit."resource_id" = malformed."id"::text
      AND btrim(
        concat_ws(
          ' ',
          audit."before"->>'firstName',
          audit."before"->>'lastName'
        )
      ) <> ''
      AND lower(
        btrim(
          concat_ws(
            ' ',
            audit."before"->>'firstName',
            audit."before"->>'lastName'
          )
        )
      ) !~ '^([(][0-9]+[)][[:space:]]*)?(activity|recent activity|all activity|posts?|comments?|reactions?|followers?|connections?|notifications?|messaging|jobs?|home|feed|my network|linkedin)$'
    ORDER BY audit."created_at" DESC
    LIMIT 1
  ) prior ON true
),
repair_values AS (
  SELECT
    source."id",
    CASE
      WHEN btrim(concat_ws(' ', source."prior_first_name", source."prior_last_name")) <> ''
        THEN source."prior_first_name"
      WHEN source."profile_key" IS NULL OR source."profile_key" ~* '^(aemaa|acwaa)'
        THEN 'LinkedIn'
      ELSE split_part(
        initcap(replace(source."public_slug", '-', ' ')),
        ' ',
        1
      )
    END AS "first_name",
    CASE
      WHEN btrim(concat_ws(' ', source."prior_first_name", source."prior_last_name")) <> ''
        THEN source."prior_last_name"
      WHEN source."profile_key" IS NULL OR source."profile_key" ~* '^(aemaa|acwaa)'
        THEN concat(
          'Candidate ',
          upper(
            coalesce(
              NULLIF(
                right(
                  regexp_replace(coalesce(source."profile_key", ''), '[^a-z0-9]', '', 'gi'),
                  7
                ),
                ''
              ),
              'UNKNOWN'
            )
          )
        )
      WHEN position(' ' in initcap(replace(source."public_slug", '-', ' '))) > 0
        THEN btrim(
          substring(
            initcap(replace(source."public_slug", '-', ' '))
            from position(' ' in initcap(replace(source."public_slug", '-', ' '))) + 1
          )
        )
      ELSE 'Candidate'
    END AS "last_name",
    CASE
      WHEN source."prior_company_name" IS NOT NULL
        AND length(source."prior_company_name") <= 120
        AND source."prior_company_name"
          !~* '\m(full-time|part-time|self-employed|internship|contract|temporary|apprenticeship|seasonal)\M'
        THEN source."prior_company_name"
      WHEN source."company_name" IS NOT NULL
        AND length(source."company_name") <= 120
        AND source."company_name"
          !~* '\m(full-time|part-time|self-employed|internship|contract|temporary|apprenticeship|seasonal)\M'
        AND source."company_name"
          !~* '\m(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[[:space:]]+[0-9]{4}\M'
        THEN source."company_name"
      ELSE NULL
    END AS "company_name"
  FROM repair_sources source
)
UPDATE "crm"."leads" lead
SET
  "first_name" = coalesce(NULLIF(repair."first_name", ''), 'LinkedIn'),
  "last_name" = coalesce(NULLIF(repair."last_name", ''), 'Candidate'),
  "company_name" = repair."company_name",
  "row_version" = lead."row_version" + 1,
  "updated_at" = now()
FROM repair_values repair
WHERE lead."id" = repair."id";
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "crm"."leads" lead
    WHERE lead."deleted_at" IS NULL
      AND lower(btrim(concat_ws(' ', lead."first_name", lead."last_name")))
        ~ '^([(][0-9]+[)][[:space:]]*)?(activity|recent activity|all activity|posts?|comments?|reactions?|followers?|connections?|notifications?|messaging|jobs?|home|feed|my network|linkedin)$'
  ) THEN
    RAISE EXCEPTION 'One or more LinkedIn navigation labels still remain as CRM lead names';
  END IF;
END $$;
