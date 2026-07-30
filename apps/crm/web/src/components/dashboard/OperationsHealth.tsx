import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Database,
  MessageSquareText,
  Sparkles,
} from 'lucide-react';
import type { DashboardData, DashboardQueueSummary } from '../../api.js';
import { cn } from '../../lib/utils.js';

const count = (value: number | null | undefined) =>
  new Intl.NumberFormat().format(Number(value ?? 0));

function completedLabel(value: string | null): string {
  if (!value) return 'No completed run yet';
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Completed just now';
  if (minutes < 60) return `Completed ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Completed ${hours}h ago`;
  return `Completed ${Math.floor(hours / 24)}d ago`;
}

function QueueRow({
  label,
  description,
  queue,
}: {
  label: string;
  description: string;
  queue: DashboardQueueSummary;
}) {
  const unhealthy = queue.retrying > 0;
  const running = queue.processing > 0;
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                unhealthy ? 'bg-red-500' : running ? 'animate-pulse bg-emerald-500' : 'bg-slate-300'
              )}
            />
            <p className="truncate text-sm font-semibold text-slate-900">{label}</p>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold',
            unhealthy
              ? 'bg-red-50 text-red-700'
              : running
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-slate-100 text-slate-600'
          )}
        >
          {unhealthy ? `${count(queue.retrying)} retrying` : `${count(queue.active)} active`}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5 text-center">
        {[
          ['Waiting', queue.waiting],
          ['Running', queue.processing],
          ['Retry', queue.retrying],
          ['Done 24h', queue.completed24h],
        ].map(([name, value]) => (
          <div key={String(name)} className="rounded-md bg-slate-50 px-1.5 py-2">
            <div className="text-sm font-semibold tabular-nums text-slate-900">
              {count(Number(value))}
            </div>
            <div className="mt-0.5 text-[9px] uppercase tracking-wide text-slate-500">{name}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-slate-400">{completedLabel(queue.latestCompletedAt)}</p>
    </div>
  );
}

export function OperationsHealth({ data }: { data: DashboardData }) {
  const reconciliation = data.linkedinSync.messageReconciliation;
  const importExists = Boolean(data.linkedinSync.lastMessageDump);
  const messageVisibilityHealthy =
    !importExists ||
    reconciliation.conversationMessages === 0 ||
    reconciliation.visibleActivities > 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-slate-950">
            <Sparkles size={17} className="text-violet-500" />
            Automation health
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Live agent queues, LinkedIn ingestion, and CRM-tracked Vertex usage.
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Vertex proxy connected
        </span>
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[1.35fr_1fr]">
        <div className="grid gap-3 sm:grid-cols-2">
          <QueueRow
            label="Profile Cleanup"
            description="Structures captured LinkedIn profiles"
            queue={data.queues.profile}
          />
          <QueueRow
            label="Lead Scoring"
            description="Scores clean profiles on the cheap Flash tier"
            queue={data.queues.scoring}
          />
          <QueueRow
            label="Message Updater"
            description="Adds only new Skarion-related messages"
            queue={data.linkedinSync.queues.messages}
          />
          <QueueRow
            label="Invitation Reconciler"
            description="Updates pending and accepted connections"
            queue={data.linkedinSync.queues.invitations}
          />
        </div>

        <div className="space-y-3">
          <div
            className={cn(
              'rounded-lg border p-4',
              messageVisibilityHealthy ? 'border-slate-200 bg-slate-50' : 'border-red-200 bg-red-50'
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {messageVisibilityHealthy ? (
                  <CheckCircle2 size={16} className="text-emerald-600" />
                ) : (
                  <AlertTriangle size={16} className="text-red-600" />
                )}
                <p className="text-sm font-semibold text-slate-900">LinkedIn message visibility</p>
              </div>
              <Link
                to="/ceo-chat"
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                Manage imports
              </Link>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Parsed chats', reconciliation.conversations],
                ['Stored messages', reconciliation.storedMessages],
                ['Visible logs', reconciliation.visibleActivities],
                ['Unlinked chats', reconciliation.unlinkedConversations],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-md bg-white/80 p-2">
                  <div className="text-lg font-semibold tabular-nums text-slate-950">
                    {count(Number(value))}
                  </div>
                  <div className="text-[10px] text-slate-500">{label}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Clock3 size={11} />
                Last message dump:{' '}
                {data.linkedinSync.lastMessageDump
                  ? new Date(data.linkedinSync.lastMessageDump.createdAt).toLocaleString()
                  : 'never'}
              </span>
              <span>{count(data.linkedinSync.openFlags)} review flags</span>
            </div>
          </div>

          {data.aiUsage ? (
            <div className="rounded-lg bg-slate-950 p-4 text-white">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Bot size={16} className="text-blue-300" />
                  <span className="text-sm font-semibold">{data.aiUsage.period} AI usage</span>
                </div>
                <span className="rounded bg-white/10 px-2 py-1 text-[10px] text-slate-300">
                  Estimate
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div>
                  <div className="text-lg font-semibold">{count(data.aiUsage.requests)}</div>
                  <div className="text-[10px] text-slate-400">requests</div>
                </div>
                <div>
                  <div className="text-lg font-semibold">{count(data.aiUsage.tokens)}</div>
                  <div className="text-[10px] text-slate-400">tokens</div>
                </div>
                <div>
                  <div className="text-lg font-semibold">
                    ${Number(data.aiUsage.costUsd).toFixed(3)}
                  </div>
                  <div className="text-[10px] text-slate-400">CRM estimate</div>
                </div>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-400">
                <Database size={11} />
                Google Cloud Billing remains the source of truth for charged cost.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 p-4 text-sm text-slate-500">
              AI cost details are restricted to managers and superadmins.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function PriorityLeads({ data }: { data: DashboardData }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="font-semibold text-slate-950">Priority leads</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Highest-scored accepted leads that still need outreach attention.
          </p>
        </div>
        <Link to="/leads" className="text-xs font-medium text-blue-600 hover:text-blue-700">
          Open lead list
        </Link>
      </div>
      <div className="divide-y divide-slate-100">
        {data.priorityLeads.map((lead) => (
          <Link
            key={lead.id}
            to={`/leads/${lead.id}`}
            className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">
              {lead.score}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">
                {lead.firstName} {lead.lastName}
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {lead.reasoningSummary || lead.headline || lead.recommendedAction}
              </p>
            </div>
            <MessageSquareText size={15} className="shrink-0 text-slate-300" />
          </Link>
        ))}
        {data.priorityLeads.length === 0 && (
          <div className="px-5 py-10 text-center text-sm text-slate-400">
            No scored leads currently need attention.
          </div>
        )}
      </div>
    </section>
  );
}
