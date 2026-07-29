import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  CheckSquare,
  Clock3,
  ExternalLink,
  Gauge,
  Inbox,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import { useDashboard } from '../hooks/use-api.js';
import { useAuthStore } from '../stores/auth.js';
import { cn } from '../lib/utils.js';
import { journeyBadgeClass, journeyLabel } from '../lib/leadJourney.js';
import type { DashboardQueueSummary, LeadJourneyStage } from '../api.js';

const PIPELINE_STAGES: LeadJourneyStage[] = [
  'future',
  'foreign_national',
  'new',
  'ready_to_reach_out',
  'connection_sent',
  'connected',
  'engaged',
  'qualified',
  'meeting_booked',
  'opportunity',
  'follow_up',
  'converted',
];

function number(value: number | null | undefined): string {
  return new Intl.NumberFormat().format(Number(value ?? 0));
}

function relativeTime(value: string | null | undefined): string {
  if (!value) return 'No completed run yet';
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return 'Completed just now';
  if (minutes < 60) return `Completed ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Completed ${hours}h ago`;
  return `Completed ${Math.floor(hours / 24)}d ago`;
}

function dueLabel(value: string | null): { label: string; overdue: boolean } {
  if (!value) return { label: 'No due date', overdue: false };
  const date = new Date(value);
  return {
    label: date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
    overdue: date.getTime() < Date.now(),
  };
}

function StatCard({
  icon: Icon,
  label,
  value,
  note,
  tone = 'blue',
  to,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number;
  note: string;
  tone?: 'blue' | 'violet' | 'emerald' | 'amber';
  to: string;
}) {
  const tones = {
    blue: 'bg-blue-50 text-blue-700',
    violet: 'bg-violet-50 text-violet-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  return (
    <Link
      to={to}
      className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <div className={cn('rounded-lg p-2.5', tones[tone])}>
          <Icon size={19} />
        </div>
        <ArrowRight
          size={16}
          className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-600"
        />
      </div>
      <div className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
        {number(value)}
      </div>
      <div className="mt-1 text-sm font-medium text-slate-700">{label}</div>
      <div className="mt-1 text-xs text-slate-500">{note}</div>
    </Link>
  );
}

function QueueCard({
  name,
  description,
  queue,
}: {
  name: string;
  description: string;
  queue: DashboardQueueSummary;
}) {
  const hasErrors = queue.retrying > 0;
  const isWorking = queue.processing > 0;
  return (
    <div className="rounded-lg border border-slate-200 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                hasErrors
                  ? 'bg-red-500'
                  : isWorking
                    ? 'animate-pulse bg-emerald-500'
                    : 'bg-slate-300'
              )}
            />
            <p className="text-sm font-semibold text-slate-900">{name}</p>
          </div>
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        </div>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
          {number(queue.active)} active
        </span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        {[
          ['Waiting', queue.waiting],
          ['Running', queue.processing],
          ['Retrying', queue.retrying],
          ['Done 24h', queue.completed24h],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-md bg-slate-50 px-2 py-2">
            <div className="text-sm font-semibold text-slate-900">{number(Number(value))}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">{relativeTime(queue.latestCompletedAt)}</p>
    </div>
  );
}

function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="font-semibold text-slate-950">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function Dashboard() {
  const user = useAuthStore((state) => state.user);
  const dashboard = useDashboard();
  const data = dashboard.data;

  if (dashboard.isLoading) {
    return (
      <div className="space-y-5">
        <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-40 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  if (dashboard.isError || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <AlertCircle className="mx-auto text-red-500" size={28} />
        <h1 className="mt-3 font-semibold text-red-900">Dashboard data could not be loaded</h1>
        <p className="mt-1 text-sm text-red-700">
          Your CRM data is safe. Retry the live Neon query.
        </p>
        <button
          type="button"
          onClick={() => dashboard.refetch()}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white"
        >
          <RefreshCw size={15} />
          Retry
        </button>
      </div>
    );
  }

  const maxJourneyCount = Math.max(1, ...data.journey.map((item) => item.count));
  const visibleJourney = PIPELINE_STAGES.map(
    (stage) => data.journey.find((item) => item.stage === stage) ?? { stage, count: 0 }
  );
  const captureRate = data.prospectReview.pending
    ? Math.round((data.prospectReview.captured / data.prospectReview.pending) * 100)
    : 100;
  const scored = Math.max(0, data.prospectReview.pending - data.prospectReview.unscored);
  const scoreRate = data.prospectReview.pending
    ? Math.round((scored / data.prospectReview.pending) * 100)
    : 100;

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
              Good{' '}
              {new Date().getHours() < 12
                ? 'morning'
                : new Date().getHours() < 18
                  ? 'afternoon'
                  : 'evening'}
              {user?.name ? `, ${user.name.split(' ')[0]}` : ''}
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Neon live
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Prospect review, outreach progress, and AI operations in one accurate view.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <RefreshCw size={13} className={dashboard.isFetching ? 'animate-spin' : ''} />
          Updated{' '}
          {new Date(data.observedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          <span>· refreshes every 15s</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Inbox}
          label="Prospects to review"
          value={data.kpis.pendingProspects}
          note={`${number(data.kpis.availableProspects)} available to claim`}
          tone="violet"
          to="/prospects"
        />
        <StatCard
          icon={Target}
          label="Active leads"
          value={data.kpis.activeLeads}
          note={`${number(data.kpis.readyToReachOut)} ready to reach out`}
          to="/leads"
        />
        <StatCard
          icon={Send}
          label="Connections sent"
          value={data.kpis.connectionSent}
          note={`${number(data.kpis.engaged)} actively engaged`}
          tone="emerald"
          to="/leads"
        />
        <StatCard
          icon={CheckSquare}
          label="Open tasks"
          value={data.kpis.openTasks}
          note={`${number(data.kpis.overdueTasks)} overdue`}
          tone={data.kpis.overdueTasks > 0 ? 'amber' : 'blue'}
          to="/tasks"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Section
          title="Lead journey"
          description="Accepted leads by current outreach stage"
          action={
            <Link to="/leads" className="text-xs font-medium text-blue-600 hover:text-blue-700">
              View all leads
            </Link>
          }
          className="xl:col-span-3"
        >
          <div className="space-y-2.5 p-5">
            {visibleJourney.map((item) => (
              <div key={item.stage} className="grid grid-cols-[132px_1fr_42px] items-center gap-3">
                <span className="truncate text-xs font-medium text-slate-600">
                  {journeyLabel(item.stage)}
                </span>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn(
                      'h-full min-w-0 rounded-full transition-all',
                      item.stage === 'future'
                        ? 'bg-cyan-400'
                        : item.stage === 'foreign_national'
                          ? 'bg-indigo-400'
                          : item.stage === 'converted'
                            ? 'bg-emerald-500'
                            : 'bg-blue-500'
                    )}
                    style={{
                      width: `${item.count ? Math.max(2, (item.count / maxJourneyCount) * 100) : 0}%`,
                    }}
                  />
                </div>
                <span className="text-right text-xs font-semibold tabular-nums text-slate-700">
                  {number(item.count)}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Prospect readiness"
          description="What the team can review next"
          action={
            <Link
              to="/prospects"
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Review prospects
              <ArrowRight size={13} />
            </Link>
          }
          className="xl:col-span-2"
        >
          <div className="space-y-5 p-5">
            <div className="grid grid-cols-3 gap-3">
              {[
                ['Available', data.prospectReview.available],
                ['Need capture', data.prospectReview.needsCapture],
                ['Avg. score', data.prospectReview.averageScore],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg bg-slate-50 p-3 text-center">
                  <div className="text-xl font-semibold text-slate-950">
                    {number(Number(value))}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">{label}</div>
                </div>
              ))}
            </div>
            {[
              [
                'Profiles captured',
                captureRate,
                `${number(data.prospectReview.captured)} of ${number(data.prospectReview.pending)}`,
              ],
              [
                'Prospects scored',
                scoreRate,
                `${number(scored)} of ${number(data.prospectReview.pending)}`,
              ],
            ].map(([label, percentage, detail]) => (
              <div key={String(label)}>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">{label}</span>
                  <span className="text-slate-500">{detail}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: `${Math.min(100, Number(percentage))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Section
          title="AI operations"
          description="Live Neon queues · all text agents default to coding-cheap"
          action={
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <Sparkles size={13} />
              Vertex proxy
            </div>
          }
          className="xl:col-span-2"
        >
          <div className="space-y-3 p-5">
            <QueueCard
              name="Profile Cleanup Agent"
              description="Structures LinkedIn profile data"
              queue={data.queues.profile}
            />
            <QueueCard
              name="Lead Scoring Agent"
              description="Scores clean profiles independently"
              queue={data.queues.scoring}
            />
            {data.aiUsage && (
              <div className="rounded-lg bg-slate-950 p-4 text-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bot size={16} className="text-blue-300" />
                    <span className="text-xs font-semibold">{data.aiUsage.period} AI usage</span>
                  </div>
                  <span className="rounded bg-white/10 px-2 py-1 text-[10px] text-slate-300">
                    {data.aiUsage.defaultModel}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-lg font-semibold">{number(data.aiUsage.requests)}</div>
                    <div className="text-[10px] text-slate-400">requests</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">{number(data.aiUsage.tokens)}</div>
                    <div className="text-[10px] text-slate-400">tokens</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">
                      ${Number(data.aiUsage.costUsd).toFixed(3)}
                    </div>
                    <div className="text-[10px] text-slate-400">estimated cost</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Section>

        <Section
          title="Priority leads"
          description="Highest-scored leads ready for attention"
          action={<Gauge size={17} className="text-slate-400" />}
          className="xl:col-span-3"
        >
          <div className="divide-y divide-slate-100">
            {data.priorityLeads.map((lead) => (
              <Link
                key={lead.id}
                to={`/leads/${lead.id}`}
                className="group flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">
                  {lead.score}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {lead.firstName} {lead.lastName}
                    </p>
                    {lead.leadNumber && (
                      <span className="text-[10px] font-medium text-slate-400">
                        {lead.leadNumber}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {lead.reasoningSummary || lead.headline || lead.recommendedAction}
                  </p>
                </div>
                <span
                  className={cn(
                    'hidden rounded-full px-2 py-1 text-[10px] font-semibold sm:block',
                    journeyBadgeClass(lead.journeyStage)
                  )}
                >
                  {journeyLabel(lead.journeyStage)}
                </span>
                <ArrowRight
                  size={15}
                  className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-600"
                />
              </Link>
            ))}
            {data.priorityLeads.length === 0 && (
              <div className="px-5 py-12 text-center text-sm text-slate-400">
                Scored priority leads will appear here.
              </div>
            )}
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Section
          title="Recently added"
          description="Latest accepted leads"
          action={<Users size={17} className="text-slate-400" />}
        >
          <div className="divide-y divide-slate-100">
            {data.recentLeads.map((lead) => (
              <div key={lead.id} className="flex items-center gap-3 px-5 py-3">
                <Link
                  to={`/leads/${lead.id}`}
                  className="min-w-0 flex-1 text-sm font-medium text-slate-900 hover:text-blue-700"
                >
                  <span className="block truncate">
                    {lead.firstName} {lead.lastName}
                  </span>
                  <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
                    {lead.leadNumber ?? 'No lead number'} ·{' '}
                    {new Date(lead.createdAt).toLocaleDateString()}
                  </span>
                </Link>
                {lead.aiScore !== null && (
                  <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                    {lead.aiScore}
                  </span>
                )}
                <span
                  className={cn(
                    'rounded-full px-2 py-1 text-[10px] font-semibold',
                    journeyBadgeClass(lead.journeyStage)
                  )}
                >
                  {journeyLabel(lead.journeyStage)}
                </span>
                {lead.linkedinUrl && (
                  <a
                    href={lead.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open LinkedIn profile"
                    className="text-slate-400 hover:text-blue-600"
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Open tasks"
          description="Due soon and unassigned work"
          action={
            <Link to="/tasks" className="text-xs font-medium text-blue-600 hover:text-blue-700">
              Task board
            </Link>
          }
        >
          <div className="divide-y divide-slate-100">
            {data.tasks.map((task) => {
              const due = dueLabel(task.dueDate);
              return (
                <Link
                  key={task.id}
                  to="/tasks"
                  className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50"
                >
                  <div
                    className={cn(
                      'rounded-lg p-2',
                      task.priority === 'high'
                        ? 'bg-red-50 text-red-600'
                        : task.priority === 'medium'
                          ? 'bg-amber-50 text-amber-600'
                          : 'bg-blue-50 text-blue-600'
                    )}
                  >
                    {due.overdue ? <AlertCircle size={16} /> : <Clock3 size={16} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{task.title}</p>
                    <p
                      className={cn(
                        'mt-0.5 text-xs',
                        due.overdue ? 'text-red-600' : 'text-slate-500'
                      )}
                    >
                      {due.overdue ? 'Overdue · ' : ''}
                      {due.label}
                      {!task.assigneeId ? ' · Unassigned' : ''}
                    </p>
                  </div>
                  <CheckCircle2 size={16} className="text-slate-300" />
                </Link>
              );
            })}
            {data.tasks.length === 0 && (
              <div className="px-5 py-12 text-center">
                <Activity className="mx-auto text-emerald-500" size={22} />
                <p className="mt-2 text-sm text-slate-500">No open tasks. You are caught up.</p>
              </div>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
