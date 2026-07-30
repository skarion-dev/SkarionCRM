UPDATE "crm"."leads"
SET
  "journey_stage" = 'ready_to_reach_out',
  "status" = 'new',
  "outreach_status" = 'not_approached',
  "row_version" = "row_version" + 1,
  "updated_at" = now()
WHERE "deleted_at" IS NULL
  AND "review_state" = 'accepted'
  AND "review_disposition" IN ('excellent_fit', 'maybe', 'worth_trying')
  AND "journey_stage" = 'new';
