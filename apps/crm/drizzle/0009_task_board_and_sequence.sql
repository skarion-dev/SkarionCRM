-- Supports an open-claim task board and a multi-step outreach-stale
-- sequence (see apps/workers/workflow-runner's evaluateOutreachSequence).

-- 1. A task with no assignee sits in the open-claim pool until a teammate
--    picks it up via PUT /api/tasks/:id/claim.
ALTER TABLE "crm"."tasks" ALTER COLUMN "assignee_id" DROP NOT NULL;
--> statement-breakpoint

-- 2. Tracks which step of a multi-step sequence has already fired for a
--    given lead+channel, so step 2 doesn't re-fire step 1 and a completed
--    step doesn't block the next one from ever running.
ALTER TABLE "crm"."lead_channels" ADD COLUMN "followup_stage" integer NOT NULL DEFAULT 0;
