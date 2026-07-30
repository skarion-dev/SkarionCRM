DELETE FROM "crm"."lead_ai_assessments"
WHERE "lead_id" IN (
  SELECT lead."id"
  FROM "crm"."leads" lead
  WHERE lead."lead_number" = 'SK3807'
    AND lead."deleted_at" IS NULL
    AND lower(btrim(concat_ws(' ', lead."first_name", lead."last_name")))
      ~ '^\(?[0-9]+\)?[[:space:]]*(activity|recent activity|all activity)$'
);
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
WHERE lead."lead_number" = 'SK3807'
  AND lead."deleted_at" IS NULL
  AND lead."journey_stage" IN ('new', 'ready_to_reach_out')
  AND lower(btrim(concat_ws(' ', lead."first_name", lead."last_name")))
    ~ '^\(?[0-9]+\)?[[:space:]]*(activity|recent activity|all activity)$'
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

WITH prior_record AS (
  SELECT
    audit."resource_id"::uuid AS "lead_id",
    NULLIF(btrim(audit."before"->>'firstName'), '') AS "first_name",
    NULLIF(btrim(audit."before"->>'lastName'), '') AS "last_name",
    NULLIF(btrim(audit."before"->>'companyName'), '') AS "company_name"
  FROM "crm"."audit_log" audit
  JOIN "crm"."leads" lead ON lead."id"::text = audit."resource_id"
  WHERE lead."lead_number" = 'SK3807'
    AND audit."resource_type" = 'lead'
    AND audit."action" IN ('accept_prospect', 'disqualify_prospect')
  ORDER BY audit."created_at" DESC
  LIMIT 1
),
name_source AS (
  SELECT
    lead."id",
    prior."first_name" AS "prior_first_name",
    prior."last_name" AS "prior_last_name",
    prior."company_name" AS "prior_company_name",
    coalesce(
      lead."linkedin_profile_key",
      substring(lead."linkedin_url" from '/in/([^/?#]+)')
    ) AS "profile_key"
  FROM "crm"."leads" lead
  LEFT JOIN prior_record prior ON prior."lead_id" = lead."id"
  WHERE lead."lead_number" = 'SK3807'
    AND lead."deleted_at" IS NULL
    AND lower(btrim(concat_ws(' ', lead."first_name", lead."last_name")))
      ~ '^\(?[0-9]+\)?[[:space:]]*(activity|recent activity|all activity)$'
),
repair_values AS (
  SELECT
    source."id",
    CASE
      WHEN btrim(concat_ws(' ', source."prior_first_name", source."prior_last_name")) <> ''
        AND lower(btrim(concat_ws(' ', source."prior_first_name", source."prior_last_name")))
          !~ '^\(?[0-9]+\)?[[:space:]]*(activity|recent activity|all activity)$'
        THEN source."prior_first_name"
      WHEN source."profile_key" !~* '^(aemaa|acwaa)'
        THEN split_part(
          initcap(
            replace(
              regexp_replace(source."profile_key", '-[0-9][[:alnum:]-]*$', '', 'i'),
              '-',
              ' '
            )
          ),
          ' ',
          1
        )
      ELSE 'LinkedIn'
    END AS "first_name",
    CASE
      WHEN btrim(concat_ws(' ', source."prior_first_name", source."prior_last_name")) <> ''
        AND lower(btrim(concat_ws(' ', source."prior_first_name", source."prior_last_name")))
          !~ '^\(?[0-9]+\)?[[:space:]]*(activity|recent activity|all activity)$'
        THEN source."prior_last_name"
      WHEN source."profile_key" !~* '^(aemaa|acwaa)'
        THEN btrim(
          substring(
            initcap(
              replace(
                regexp_replace(source."profile_key", '-[0-9][[:alnum:]-]*$', '', 'i'),
                '-',
                ' '
              )
            )
            from position(
              ' ' in initcap(
                replace(
                  regexp_replace(source."profile_key", '-[0-9][[:alnum:]-]*$', '', 'i'),
                  '-',
                  ' '
                )
              )
            ) + 1
          )
        )
      ELSE concat(
        'Candidate ',
        upper(right(regexp_replace(coalesce(source."profile_key", ''), '[^a-z0-9]', '', 'gi'), 7))
      )
    END AS "last_name",
    CASE
      WHEN source."prior_company_name" IS NULL THEN NULL
      WHEN length(source."prior_company_name") > 120 THEN NULL
      WHEN source."prior_company_name"
        ~* '\m(full-time|part-time|self-employed|internship|contract|temporary|apprenticeship|seasonal)\M'
        THEN NULL
      ELSE source."prior_company_name"
    END AS "company_name"
  FROM name_source source
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
    WHERE lead."lead_number" = 'SK3807'
      AND lead."deleted_at" IS NULL
      AND lower(btrim(concat_ws(' ', lead."first_name", lead."last_name")))
        ~ '^\(?[0-9]+\)?[[:space:]]*(activity|recent activity|all activity)$'
  ) THEN
    RAISE EXCEPTION 'SK3807 still has a LinkedIn activity label as its name';
  END IF;
END $$;
