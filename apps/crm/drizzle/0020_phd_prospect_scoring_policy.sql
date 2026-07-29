-- PhD profiles are a deterministic zero-score segment in Prospect Review.
-- Apply the policy immediately so the UI does not wait for an AI queue drain.
WITH phd_leads AS (
	SELECT l."id"
	FROM "crm"."leads" l
	WHERE l."deleted_at" IS NULL
		AND l."source" = 'linkedin'
		AND (
			lower(concat_ws(
				' ',
				l."first_name",
				l."last_name",
				l."headline",
				l."about",
				l."experience",
				l."education",
				l."skills",
				l."current_role",
				l."current_role_dates",
				l."profile_summary",
				l."education_entries"::text,
				l."experience_entries"::text,
				l."notes"
			)) ~ '(^|[^[:alpha:]])ph[.]?[[:space:]]*d[.]?([^[:alpha:]]|$)'
			OR lower(concat_ws(
				' ',
				l."first_name",
				l."last_name",
				l."headline",
				l."about",
				l."experience",
				l."education",
				l."skills",
				l."current_role",
				l."current_role_dates",
				l."profile_summary",
				l."education_entries"::text,
				l."experience_entries"::text,
				l."notes"
			)) LIKE '%doctor of philosophy%'
		)
)
INSERT INTO "crm"."lead_ai_assessments" (
	"lead_id",
	"overall_score",
	"raw_score",
	"classification",
	"confidence_level",
	"profile_evidence_quality",
	"market_entry_timing",
	"candidate_need_evidence",
	"score_breakdown",
	"verified_positive_signals",
	"risks_or_missing_information",
	"hard_disqualifier",
	"hard_disqualifier_reason",
	"campaign_matches",
	"recommended_action",
	"best_outreach_angle",
	"qualification_questions",
	"reasoning_summary",
	"connection_note",
	"connection_note_character_count",
	"created_at",
	"updated_at"
)
SELECT
	p."id",
	0,
	0,
	'REJECT OR LOW PRIORITY',
	'high',
	'usable',
	'unknown',
	'none',
	'{"careerStage":0,"jobSearchNeed":0,"pathwayFit":0,"usPositioningGap":0,"relocation":0,"internationalGraduateContext":0,"coachability":0,"bangladeshAffinity":0,"marketRealism":0}'::jsonb,
	'[]'::jsonb,
	'["PhD profile — excluded by the current prospecting policy. Score forced to 0."]'::jsonb,
	true,
	'PhD profile — excluded by the current prospecting policy. Score forced to 0.',
	'[]'::jsonb,
	'Do not include this profile in the active LinkedIn outreach queue.',
	'',
	'[]'::jsonb,
	'PhD profile — excluded by the current prospecting policy. Score forced to 0.',
	NULL,
	0,
	now(),
	now()
FROM phd_leads p
ON CONFLICT ("lead_id") DO UPDATE SET
	"overall_score" = 0,
	"raw_score" = 0,
	"classification" = 'REJECT OR LOW PRIORITY',
	"confidence_level" = 'high',
	"profile_evidence_quality" = 'usable',
	"market_entry_timing" = 'unknown',
	"candidate_need_evidence" = 'none',
	"score_breakdown" = EXCLUDED."score_breakdown",
	"verified_positive_signals" = '[]'::jsonb,
	"risks_or_missing_information" = EXCLUDED."risks_or_missing_information",
	"hard_disqualifier" = true,
	"hard_disqualifier_reason" = EXCLUDED."hard_disqualifier_reason",
	"campaign_matches" = '[]'::jsonb,
	"recommended_action" = EXCLUDED."recommended_action",
	"best_outreach_angle" = '',
	"qualification_questions" = '[]'::jsonb,
	"reasoning_summary" = EXCLUDED."reasoning_summary",
	"updated_at" = now();
--> statement-breakpoint
-- Any imported prospect with profile evidence but no assessment must enter the
-- separate Lead Scoring Agent queue. The scorer waits for Profile Cleanup when
-- normalization is still pending.
INSERT INTO "crm"."lead_score_jobs" AS existing_job ("lead_id", "status", "next_attempt_at")
SELECT l."id", 'pending', now()
FROM "crm"."leads" l
LEFT JOIN "crm"."lead_ai_assessments" a ON a."lead_id" = l."id"
WHERE l."deleted_at" IS NULL
	AND l."review_state" = 'pending'
	AND a."lead_id" IS NULL
	AND (
		btrim(coalesce(l."headline", '')) <> ''
		OR btrim(coalesce(l."about", '')) <> ''
		OR btrim(coalesce(l."experience", '')) <> ''
		OR btrim(coalesce(l."education", '')) <> ''
		OR btrim(coalesce(l."skills", '')) <> ''
		OR btrim(coalesce(l."current_role", '')) <> ''
		OR btrim(coalesce(l."notes", '')) <> ''
	)
ON CONFLICT ("lead_id") DO UPDATE SET
	"status" = CASE
		WHEN existing_job."status" = 'processing' THEN 'processing'
		ELSE 'pending'
	END,
	"next_attempt_at" = now(),
	"completed_at" = NULL,
	"last_error" = NULL,
	"updated_at" = now();
--> statement-breakpoint
-- A PhD assessment is already complete without an AI request.
UPDATE "crm"."lead_score_jobs" j
SET
	"status" = 'completed',
	"completed_at" = now(),
	"locked_at" = NULL,
	"last_error" = NULL,
	"updated_at" = now()
FROM "crm"."lead_ai_assessments" a
WHERE a."lead_id" = j."lead_id"
	AND a."hard_disqualifier_reason" =
		'PhD profile — excluded by the current prospecting policy. Score forced to 0.';
