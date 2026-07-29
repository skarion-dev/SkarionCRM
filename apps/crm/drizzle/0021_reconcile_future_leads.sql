-- Reconcile legacy Future candidates that predate the Future journey stage.
-- Some historical imports used "Future Candidates" as the sheet/tag label,
-- so match the semantic label rather than only an exact "Future" tag.
WITH accepted_future_leads AS (
	SELECT l."id"
	FROM "crm"."leads" l
	WHERE l."deleted_at" IS NULL
		AND l."review_state" = 'accepted'
		AND (
			l."review_disposition" = 'future'
			OR lower(coalesce(l."source_sheet", '')) LIKE '%future%'
			OR EXISTS (
				SELECT 1
				FROM jsonb_array_elements_text(
					CASE
						WHEN jsonb_typeof(l."tags") = 'array' THEN l."tags"
						ELSE '[]'::jsonb
					END
				) AS tag(value)
				WHERE lower(trim(tag.value)) = 'future'
					OR lower(trim(tag.value)) LIKE 'future %'
			)
		)
)
UPDATE "crm"."leads" l
SET
	"journey_stage" = 'future',
	"status" = 'new',
	"outreach_status" = 'not_approached',
	"tags" = CASE
		WHEN EXISTS (
			SELECT 1
			FROM jsonb_array_elements_text(
				CASE
					WHEN jsonb_typeof(l."tags") = 'array' THEN l."tags"
					ELSE '[]'::jsonb
				END
			) AS tag(value)
			WHERE lower(trim(tag.value)) = 'future'
		)
			THEN l."tags"
		ELSE (
			CASE
				WHEN jsonb_typeof(l."tags") = 'array' THEN l."tags"
				ELSE '[]'::jsonb
			END
		) || '["Future"]'::jsonb
	END,
	"row_version" = l."row_version" + 1,
	"updated_at" = now()
FROM accepted_future_leads f
WHERE l."id" = f."id"
	AND (
		l."journey_stage" <> 'future'
		OR NOT EXISTS (
			SELECT 1
			FROM jsonb_array_elements_text(
				CASE
					WHEN jsonb_typeof(l."tags") = 'array' THEN l."tags"
					ELSE '[]'::jsonb
				END
			) AS tag(value)
			WHERE lower(trim(tag.value)) = 'future'
		)
	);
--> statement-breakpoint
-- Future is a holding stage, so it must not keep pending score work.
DELETE FROM "crm"."lead_score_jobs" AS job
USING "crm"."leads" AS lead
WHERE job."lead_id" = lead."id"
	AND lead."journey_stage" = 'future'
	AND job."status" IN ('pending', 'failed');
