-- Reconcile PhD prospects that were already queued before deterministic
-- ingestion-time disqualification was introduced. This consumes no AI tokens.
WITH phd_prospects AS (
	SELECT lead."id"
	FROM "crm"."leads" lead
	WHERE lead."deleted_at" IS NULL
		AND lead."review_state" = 'pending'
		AND (
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
	"review_state" = 'rejected',
	"review_disposition" = 'disqualified',
	"reviewed_at" = now(),
	"journey_stage" = 'disqualified',
	"status" = 'disqualified',
	"outreach_status" = 'bad_fit',
	"tags" = (
		SELECT coalesce(jsonb_agg(tag.value), '[]'::jsonb)
		FROM jsonb_array_elements_text(
			CASE
				WHEN jsonb_typeof(lead."tags") = 'array' THEN lead."tags"
				ELSE '[]'::jsonb
			END
		) AS tag(value)
		WHERE lower(trim(tag.value)) NOT IN (
			'excellent fit',
			'worth trying',
			'maybe',
			'future',
			'foreign national',
			'needs profile capture',
			'disqualified'
		)
	) || '["Disqualified"]'::jsonb,
	"profile_normalization_status" = 'not_queued',
	"profile_normalization_warnings" =
		'["PhD profile — automatically disqualified by prospecting policy. Score forced to 0; no AI tokens used."]'::jsonb,
	"row_version" = lead."row_version" + 1,
	"updated_at" = now()
FROM phd_prospects phd
WHERE lead."id" = phd."id";
--> statement-breakpoint
UPDATE "crm"."lead_profile_jobs" job
SET
	"status" = 'completed',
	"completed_at" = now(),
	"locked_at" = NULL,
	"last_error" =
		'PhD profile — automatically disqualified by prospecting policy. Score forced to 0; no AI tokens used.',
	"updated_at" = now()
FROM "crm"."leads" lead
WHERE job."lead_id" = lead."id"
	AND lead."review_state" = 'rejected'
	AND lead."review_disposition" = 'disqualified'
	AND lead."profile_normalization_warnings" @>
		'["PhD profile — automatically disqualified by prospecting policy. Score forced to 0; no AI tokens used."]'::jsonb;
--> statement-breakpoint
UPDATE "crm"."lead_score_jobs" job
SET
	"status" = 'completed',
	"completed_at" = now(),
	"locked_at" = NULL,
	"last_error" =
		'PhD profile — automatically disqualified by prospecting policy. Score forced to 0; no AI tokens used.',
	"updated_at" = now()
FROM "crm"."leads" lead
WHERE job."lead_id" = lead."id"
	AND lead."review_state" = 'rejected'
	AND lead."review_disposition" = 'disqualified'
	AND lead."profile_normalization_warnings" @>
		'["PhD profile — automatically disqualified by prospecting policy. Score forced to 0; no AI tokens used."]'::jsonb;
--> statement-breakpoint
DELETE FROM "crm"."prospect_review_claims" claim
USING "crm"."leads" lead
WHERE claim."lead_id" = lead."id"
	AND lead."review_state" = 'rejected'
	AND lead."review_disposition" = 'disqualified'
	AND lead."profile_normalization_warnings" @>
		'["PhD profile — automatically disqualified by prospecting policy. Score forced to 0; no AI tokens used."]'::jsonb;
