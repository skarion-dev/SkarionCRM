UPDATE "crm"."lead_score_jobs" score_job
SET
  "status" = 'completed',
  "completed_at" = now(),
  "locked_at" = NULL,
  "last_error" = 'Scoring waits until profile capture and cleanup are complete.',
  "updated_at" = now()
FROM "crm"."leads" lead
WHERE lead."id" = score_job."lead_id"
  AND score_job."status" IN ('pending', 'processing', 'failed')
  AND (
    lead."deleted_at" IS NOT NULL
    OR lead."review_state" = 'rejected'
    OR lead."profile_normalization_status" <> 'completed'
  );
