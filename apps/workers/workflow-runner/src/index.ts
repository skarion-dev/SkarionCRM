// apps/workers/workflow-runner/src/index.ts
// Evaluates CRM workflow rules and executes actions. Triggered by:
// - Cron worker (time-based rules: opportunity_stale, task_due_soon, outreach_stale)
// - CRM API webhooks (event-based rules: lead_created)

import { Hono } from 'hono';
import { getDb, withAudit } from '@skarion/db-kit';
import * as schema from '@skarion/crm/db/schema';
import { eq, and, isNull, gte, lte, sql } from 'drizzle-orm';
import type { CrmDb } from '@skarion/crm/db/types';
import { evaluateOutreachSequence } from './lib/outreachSequence.js';

interface Env {
  DATABASE_URL: string;
  CRM_API_URL: string;
  WORKFLOW_RUNNER_SECRET?: string; // optional shared secret for cron-worker auth
}

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok', service: 'skarion-workflow-runner' }));

// Simple shared-secret auth for cron-worker calls. CRM API calls (evaluate-event)
// don't send a secret and are allowed through — they come from the same account.
app.use('/evaluate/*', async (c, next) => {
  const secret = c.env.WORKFLOW_RUNNER_SECRET;
  if (!secret) return next(); // not configured → allow all
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${secret}`) {
    return c.json({ error: 'Unauthorized.' }, 401);
  }
  await next();
});

// ── Evaluate time-based rules (called by cron worker) ──
app.post('/evaluate/:trigger', async (c) => {
  const trigger = c.req.param('trigger') as
    | 'opportunity_stale'
    | 'task_due_soon'
    | 'outreach_stale';
  const db = getDb(c.env, schema) as CrmDb;

  const rules = await db
    .select()
    .from(schema.workflowRules)
    .where(and(eq(schema.workflowRules.trigger, trigger), eq(schema.workflowRules.enabled, true)));

  const results: { ruleId: string; ruleName: string; executed: number }[] = [];

  for (const rule of rules) {
    let executed = 0;
    if (trigger === 'opportunity_stale') {
      executed = await evaluateOpportunityStale(db, rule);
    } else if (trigger === 'task_due_soon') {
      executed = await evaluateTaskDueSoon(db, rule);
    } else if (trigger === 'outreach_stale') {
      // New multi-step, any-channel shape lives in evaluateOutreachSequence;
      // rules created before that existed (or via the old single-channel UI
      // form) have no `actions.kind` at all and keep using the original
      // single-step evaluateOutreachStale below.
      const actions = rule.actions as { kind?: string };
      executed =
        actions.kind === 'sequence_followup'
          ? await evaluateOutreachSequence(db, rule)
          : await evaluateOutreachStale(db, rule);
    }
    results.push({ ruleId: rule.id, ruleName: rule.name, executed });
  }

  return c.json({ evaluated: rules.length, results });
});

// ── Evaluate event-based rules (called by CRM API after mutations) ──
app.post('/evaluate-event', async (c) => {
  const body = await c.req.json<{ trigger: string; payload: Record<string, unknown> }>();
  const db = getDb(c.env, schema) as CrmDb;

  const rules = await db
    .select()
    .from(schema.workflowRules)
    .where(
      and(
        eq(schema.workflowRules.trigger, body.trigger as 'lead_created'),
        eq(schema.workflowRules.enabled, true)
      )
    );

  const results: { ruleId: string; ruleName: string; matched: boolean }[] = [];

  for (const rule of rules) {
    let matched = false;
    if (body.trigger === 'lead_created') {
      matched = await evaluateLeadCreated(db, rule, body.payload);
    }
    results.push({ ruleId: rule.id, ruleName: rule.name, matched });
  }

  return c.json({ evaluated: rules.length, results });
});

// ── Rule evaluators ──

async function evaluateOpportunityStale(
  db: CrmDb,
  rule: typeof schema.workflowRules.$inferSelect
): Promise<number> {
  const conditions = rule.conditions as { stage?: string; daysInStage?: number };
  const actions = rule.actions as { createTask?: { title: string; description?: string } };
  const days = conditions.daysInStage ?? 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const staleOpportunities = await db
    .select()
    .from(schema.opportunities)
    .where(
      and(
        isNull(schema.opportunities.deletedAt),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        eq(schema.opportunities.stage, conditions.stage as any),
        lte(schema.opportunities.updatedAt, cutoff)
      )
    );

  let created = 0;
  if (actions.createTask) {
    for (const opp of staleOpportunities) {
      const [existingTask] = await db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.type, 'opportunity_followup'),
            eq(schema.tasks.opportunityId, opp.id),
            isNull(schema.tasks.completedAt),
            isNull(schema.tasks.deletedAt)
          )
        )
        .limit(1);
      if (existingTask) continue;

      await db.insert(schema.tasks).values({
        type: 'opportunity_followup',
        title: actions.createTask.title.replace(/\{\{name\}\}/g, opp.name),
        description: (actions.createTask.description ?? `Follow up on ${opp.name}`).replace(
          /\{\{name\}\}/g,
          opp.name
        ),
        assigneeId: opp.ownerId,
        opportunityId: opp.id,
        companyId: opp.companyId,
        contactId: opp.contactId,
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      created++;
    }
  }
  return created;
}

async function evaluateTaskDueSoon(
  db: CrmDb,
  rule: typeof schema.workflowRules.$inferSelect
): Promise<number> {
  const conditions = rule.conditions as { hoursBeforeDue?: number };
  const actions = rule.actions as { sendEmail?: boolean; createNotification?: boolean };
  const hours = conditions.hoursBeforeDue ?? 24;
  const now = new Date();
  const windowEnd = new Date(Date.now() + hours * 60 * 60 * 1000);

  const dueTasks = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        isNull(schema.tasks.deletedAt),
        isNull(schema.tasks.completedAt),
        gte(schema.tasks.dueDate, now),
        lte(schema.tasks.dueDate, windowEnd)
      )
    );

  if (!actions.sendEmail && !actions.createNotification) return 0;

  let created = 0;
  for (const task of dueTasks) {
    if (!task.assigneeId) continue;
    const [existingNotification] = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.type, 'task_due_soon'),
          eq(schema.notifications.resourceType, 'task'),
          eq(schema.notifications.resourceId, task.id)
        )
      )
      .limit(1);
    if (existingNotification) continue;

    await db.insert(schema.notifications).values({
      userId: task.assigneeId,
      type: 'task_due_soon',
      title: 'Task due soon',
      message: task.dueDate
        ? `${task.title} is due ${task.dueDate.toISOString()}.`
        : `${task.title} is due soon.`,
      resourceType: 'task',
      resourceId: task.id,
    });
    created++;
  }
  return created;
}

async function evaluateLeadCreated(
  db: CrmDb,
  rule: typeof schema.workflowRules.$inferSelect,
  payload: Record<string, unknown>
): Promise<boolean> {
  const conditions = rule.conditions as { source?: string };
  const actions = rule.actions as { assignTo?: string };

  const leadSource = payload.source as string | undefined;
  if (conditions.source && leadSource !== conditions.source) return false;

  const leadId = payload.id as string | undefined;
  if (!leadId || !actions.assignTo) return false;

  await db
    .update(schema.leads)
    .set({ ownerId: actions.assignTo })
    .where(eq(schema.leads.id, leadId));
  return true;
}

async function evaluateOutreachStale(
  db: CrmDb,
  rule: typeof schema.workflowRules.$inferSelect
): Promise<number> {
  const conditions = rule.conditions as {
    channel?: string;
    afterAttempts?: number;
    waitDays?: number;
    nextChannel?: string;
  };
  const actions = rule.actions as {
    taskTitle?: string;
    taskDescription?: string;
    priority?: string;
  };

  const channel = conditions.channel;
  const afterAttempts = conditions.afterAttempts ?? 3;
  const waitDays = conditions.waitDays ?? 7;
  const nextChannel = conditions.nextChannel;
  if (!channel) return 0;

  const cutoff = new Date(Date.now() - waitDays * 24 * 60 * 60 * 1000);

  // Find stale channels matching conditions. Exclude channels already in a
  // terminal/active stage (replied, in_conversation, booked_call, no_response).
  const staleChannels = await db
    .select()
    .from(schema.leadChannels)
    .where(
      and(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        eq(schema.leadChannels.channel, channel as any),
        gte(schema.leadChannels.attemptCount, afterAttempts),
        lte(schema.leadChannels.lastAttemptAt, cutoff),
        sql`${schema.leadChannels.stage} not in ('replied','in_conversation','booked_call','no_response')`
      )
    );

  let executed = 0;
  for (const ch of staleChannels) {
    // Mark the channel as no_response
    await db
      .update(schema.leadChannels)
      .set({ stage: 'no_response', updatedAt: new Date() })
      .where(eq(schema.leadChannels.id, ch.id));

    // Fetch the lead for templating / ownership
    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, ch.leadId));
    if (!lead) continue;

    // Ensure the next-channel row exists (not_started); create if missing.
    if (nextChannel) {
      const [next] = await db
        .select()
        .from(schema.leadChannels)
        .where(
          and(
            eq(schema.leadChannels.leadId, ch.leadId),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            eq(schema.leadChannels.channel, nextChannel as any)
          )
        );
      if (!next) {
        const maxSeqRows = await db
          .select({ seq: schema.leadChannels.sequence })
          .from(schema.leadChannels)
          .where(eq(schema.leadChannels.leadId, ch.leadId));
        const maxSeq = maxSeqRows.reduce((m, r) => Math.max(m, r.seq), 0);
        await db.insert(schema.leadChannels).values({
          leadId: ch.leadId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          channel: nextChannel as any,
          stage: 'not_started',
          sequence: maxSeq + 1,
          ownerId: lead.ownerId,
        });
      }
    }

    // Idempotency: skip if a pending outreach_followup task already exists for this lead.
    const [existingTask] = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.type, 'outreach_followup'),
          eq(schema.tasks.leadId, ch.leadId),
          isNull(schema.tasks.completedAt)
        )
      )
      .limit(1);
    if (existingTask) continue;

    const taskTitle = (
      actions.taskTitle ??
      'Follow up with {{lead.first_name}} {{lead.last_name}} (stale after {{wait_days}}d)'
    )
      .replace(/\{\{lead\.first_name\}\}/g, lead.firstName)
      .replace(/\{\{lead\.last_name\}\}/g, lead.lastName)
      .replace(/\{\{wait_days\}\}/g, String(waitDays));

    const [task] = await db
      .insert(schema.tasks)
      .values({
        type: 'outreach_followup',
        title: taskTitle,
        description: actions.taskDescription ?? null,
        leadId: ch.leadId,
        assigneeId: lead.ownerId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        priority: (actions.priority ?? 'medium') as any,
        dueDate: new Date(),
      })
      .returning();

    await withAudit(db, schema.auditLog, {
      actorUserId: null,
      action: 'workflow_escalate',
      resourceType: 'lead',
      resourceId: ch.leadId,
      before: { channelId: ch.id, channel: ch.channel, stage: ch.stage },
      after: {
        channelId: ch.id,
        channel: ch.channel,
        stage: 'no_response',
        taskId: task?.id ?? null,
      },
      app: 'crm',
    });

    executed++;
  }

  return executed;
}

export default app;
