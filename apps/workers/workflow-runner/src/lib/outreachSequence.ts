// apps/workers/workflow-runner/src/lib/outreachSequence.ts
//
// Multi-step, any-channel outreach-stale sequence — additive to the
// existing single-step evaluateOutreachStale (index.ts). A `workflow_rules`
// row with `actions.kind === 'sequence_followup'` uses this path instead;
// old rules (`actions.kind === 'escalate_to_next_channel_task'`, or no kind
// at all) keep using the original function untouched.
//
// Kept separate from index.ts so the due/not-due decision is testable
// without a database.

import { and, eq, sql } from 'drizzle-orm';
import { withAudit } from '@skarion/db-kit';
import * as schema from '@skarion/crm/db/schema';
import type { CrmDb } from '@skarion/crm/db/types';

export interface SequenceStep {
  afterDays: number;
  title: string;
  priority?: string;
}

export interface SequenceConditions {
  // null/omitted = any channel ("all outreach channels").
  channel?: string | null;
  steps: SequenceStep[];
}

// Terminal stages mean the lead is already engaged or resolved — never
// stale-flag these regardless of how much time has passed.
const TERMINAL_STAGES = new Set(['replied', 'in_conversation', 'booked_call']);

export function isChannelStageTerminal(stage: string): boolean {
  return TERMINAL_STAGES.has(stage);
}

export interface StepDueResult {
  due: boolean;
  step?: SequenceStep;
  stepIndex?: number;
}

/**
 * Decides whether the NEXT step in the sequence (steps[followupStage]) is
 * due yet. Falls back to the channel's createdAt when lastAttemptAt is null
 * — most leads never get a manually-logged outreach attempt, so without
 * this fallback the sequence would silently never fire for them at all.
 */
export function isSequenceStepDue(input: {
  followupStage: number;
  steps: SequenceStep[];
  lastAttemptAt: Date | null;
  createdAt: Date;
  now: Date;
}): StepDueResult {
  const { followupStage, steps, lastAttemptAt, createdAt, now } = input;
  if (followupStage >= steps.length) return { due: false };
  const step = steps[followupStage];
  if (!step) return { due: false };
  const baseline = lastAttemptAt ?? createdAt;
  const dueAt = new Date(baseline.getTime() + step.afterDays * 24 * 60 * 60 * 1000);
  return { due: now.getTime() >= dueAt.getTime(), step, stepIndex: followupStage };
}

function fillTemplate(
  title: string,
  vars: { firstName: string; lastName: string; channel: string; step: number }
): string {
  return title
    .replace(/\{\{lead\.first_name\}\}/g, vars.firstName)
    .replace(/\{\{lead\.last_name\}\}/g, vars.lastName)
    .replace(/\{\{channel\}\}/g, vars.channel)
    .replace(/\{\{step\}\}/g, String(vars.step));
}

/**
 * Runs one `sequence_followup` workflow_rules row: finds every non-terminal
 * leadChannels row (optionally scoped to one channel) whose next sequence
 * step is due, creates an UNASSIGNED task (open-claim pool — this is what
 * makes it a team board rather than always the lead's current owner), and
 * advances followupStage so the same step never re-fires and the next step
 * isn't blocked once this one is done.
 */
export async function evaluateOutreachSequence(
  db: CrmDb,
  rule: typeof schema.workflowRules.$inferSelect
): Promise<number> {
  const conditions = rule.conditions as SequenceConditions;
  const steps = conditions.steps ?? [];
  if (steps.length === 0) return 0;
  const channel = conditions.channel ?? null;

  const whereClauses = [
    sql`${schema.leadChannels.stage} not in ('replied','in_conversation','booked_call')`,
    sql`${schema.leadChannels.followupStage} < ${steps.length}`,
  ];
  if (channel) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    whereClauses.push(eq(schema.leadChannels.channel, channel as any));
  }

  const candidates = await db
    .select()
    .from(schema.leadChannels)
    .where(and(...whereClauses));

  const now = new Date();
  let executed = 0;

  for (const ch of candidates) {
    const result = isSequenceStepDue({
      followupStage: ch.followupStage,
      steps,
      lastAttemptAt: ch.lastAttemptAt,
      createdAt: ch.createdAt,
      now,
    });
    if (!result.due || !result.step || result.stepIndex === undefined) continue;

    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, ch.leadId));
    if (!lead) continue;

    const taskTitle = fillTemplate(result.step.title, {
      firstName: lead.firstName,
      lastName: lead.lastName,
      channel: ch.channel,
      step: result.stepIndex + 1,
    });

    const [task] = await db
      .insert(schema.tasks)
      .values({
        type: `outreach_followup_step_${result.stepIndex + 1}`,
        title: taskTitle,
        leadId: ch.leadId,
        assigneeId: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        priority: (result.step.priority ?? 'medium') as any,
        dueDate: now,
      })
      .returning();

    await db
      .update(schema.leadChannels)
      .set({ followupStage: result.stepIndex + 1, updatedAt: now })
      .where(eq(schema.leadChannels.id, ch.id));

    await withAudit(db, schema.auditLog, {
      actorUserId: null,
      action: 'workflow_escalate',
      resourceType: 'lead',
      resourceId: ch.leadId,
      before: { channelId: ch.id, channel: ch.channel, followupStage: result.stepIndex },
      after: {
        channelId: ch.id,
        channel: ch.channel,
        followupStage: result.stepIndex + 1,
        taskId: task?.id ?? null,
      },
      app: 'crm',
    });

    executed++;
  }

  return executed;
}
