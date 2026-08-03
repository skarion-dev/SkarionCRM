import { Link } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckSquare,
  Contact,
  RefreshCw,
  Send,
  Target,
  Users,
} from 'lucide-react';
import type { DashboardData, DashboardSummary } from '../api.js';
import {
  useDashboard,
  useDashboardProspectOperations,
  useDashboardSummary,
} from '../hooks/use-api.js';
import { useAuthStore } from '../stores/auth.js';
import { DashboardSkeleton } from '../components/dashboard/DashboardSkeleton.js';
import { StatCard } from '../components/dashboard/StatCard.js';
import { PipelineFunnel } from '../components/dashboard/PipelineFunnel.js';
import { JourneyFunnel } from '../components/dashboard/JourneyFunnel.js';
import { AiFunnelHealth } from '../components/dashboard/AiFunnelHealth.js';
import { SourceMix } from '../components/dashboard/SourceMix.js';
import { OutreachPulse } from '../components/dashboard/OutreachPulse.js';
import { RecentLeadsList } from '../components/dashboard/RecentLeadsList.js';
import { UpcomingCloses } from '../components/dashboard/UpcomingCloses.js';
import { TeamWorkload } from '../components/dashboard/TeamWorkload.js';
import { MyTasksCard } from '../components/dashboard/MyTasksCard.js';
import { MyOutreachDueCard } from '../components/dashboard/MyOutreachDueCard.js';
import { MyRecentLeadsCard } from '../components/dashboard/MyRecentLeadsCard.js';
import { ProspectsPendingTile } from '../components/dashboard/ProspectsPendingTile.js';
import { OperationsHealth, PriorityLeads } from '../components/dashboard/OperationsHealth.js';
import { ProspectOperations } from '../components/dashboard/ProspectOperations.js';

function pipelineValue(summary: DashboardSummary): string {
  const totals = new Map<string, number>();
  for (const row of summary.opportunitiesByStage) {
    const currency = row.currency ?? 'USD';
    totals.set(currency, (totals.get(currency) ?? 0) + (row.secondaryValue ?? 0));
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([currency, value]) => {
      if (value >= 1_000_000) return `${currency} ${(value / 1_000_000).toFixed(1)}M`;
      if (value >= 1_000) return `${currency} ${(value / 1_000).toFixed(0)}k`;
      return `${currency} ${value.toLocaleString()}`;
    })
    .join(' · ');
}

function ErrorState({ retry, error }: { retry: () => void; error: unknown }) {
  const detail = error instanceof Error ? error.message : 'The dashboard request failed.';
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
      <AlertCircle className="mx-auto text-red-500" size={28} />
      <h1 className="mt-3 font-semibold text-red-900">Dashboard data could not be loaded</h1>
      <p className="mt-1 text-sm text-red-700">
        Your CRM data is safe. Retry the live Neon queries.
      </p>
      <p className="mx-auto mt-2 max-w-2xl text-xs text-red-600">{detail}</p>
      <button
        type="button"
        onClick={retry}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800"
      >
        <RefreshCw size={15} />
        Retry
      </button>
    </div>
  );
}

export default function Dashboard() {
  const user = useAuthStore((state) => state.user);
  const summaryQuery = useDashboardSummary();
  const liveQuery = useDashboard();
  const prospectOperationsQuery = useDashboardProspectOperations();
  const isManagerView = Boolean(user?.isSuperadmin) || user?.role === 'manager';

  if (!summaryQuery.data && liveQuery.data) {
    return (
      <LiveDashboard
        data={liveQuery.data}
        refreshing={summaryQuery.isFetching || liveQuery.isFetching}
        retry={() => {
          void summaryQuery.refetch();
          void liveQuery.refetch();
        }}
      />
    );
  }
  if (summaryQuery.isError && liveQuery.isError) {
    return (
      <ErrorState
        error={summaryQuery.error ?? liveQuery.error}
        retry={() => {
          void summaryQuery.refetch();
          void liveQuery.refetch();
        }}
      />
    );
  }
  if (summaryQuery.isPending || !summaryQuery.data) {
    return <DashboardSkeleton />;
  }

  const summary = summaryQuery.data;
  const refreshing = summaryQuery.isFetching || liveQuery.isFetching;
  const roleLabel = user?.isSuperadmin
    ? 'Superadmin'
    : user?.role === 'manager'
      ? 'Manager'
      : 'My work';
  const refresh = () => {
    void summaryQuery.refetch();
    void liveQuery.refetch();
  };

  return (
    <div className="space-y-6 pb-8">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
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
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Neon live
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
              {roleLabel} · {summary.scope === 'team' ? 'team scope' : 'personal scope'}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {isManagerView
              ? 'Revenue, outreach, team workload, and agent operations in one accurate view.'
              : 'Your leads, outreach, tasks, and next actions—without exposing team-wide records.'}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm hover:border-slate-300 hover:text-slate-900 disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          Updated{' '}
          {new Date(summary.generatedAt).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </button>
      </header>

      {isManagerView ? (
        <ManagerDashboard
          summary={summary}
          live={liveQuery.data}
          liveError={liveQuery.isError}
          prospectOperations={prospectOperationsQuery.data}
          prospectOperationsError={prospectOperationsQuery.isError}
        />
      ) : (
        <MemberDashboard
          summary={summary}
          prospectOperations={prospectOperationsQuery.data}
          prospectOperationsError={prospectOperationsQuery.isError}
        />
      )}
    </div>
  );
}

function LiveDashboard({
  data,
  refreshing,
  retry,
}: {
  data: DashboardData;
  refreshing: boolean;
  retry: () => void;
}) {
  const user = useAuthStore((state) => state.user);
  return (
    <div className="space-y-6 pb-8">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
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
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Neon live
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Live CRM and agent operations. Extended reporting is loading independently.
          </p>
        </div>
        <button
          type="button"
          onClick={retry}
          disabled={refreshing}
          className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm hover:border-slate-300 hover:text-slate-900 disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          Updated{' '}
          {new Date(data.observedAt).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Target} label="Active leads" value={String(data.kpis.activeLeads)} />
        <StatCard
          icon={Send}
          label="Ready to reach out"
          value={String(data.kpis.readyToReachOut)}
        />
        <StatCard icon={Users} label="Connection sent" value={String(data.kpis.connectionSent)} />
        <StatCard icon={Contact} label="Engaged" value={String(data.kpis.engaged)} />
        <StatCard icon={CheckSquare} label="Open tasks" value={String(data.kpis.openTasks)} />
        <StatCard
          icon={AlertTriangle}
          label="Prospects pending"
          value={String(data.kpis.pendingProspects)}
        />
      </div>

      <OperationsHealth data={data} />
      <PriorityLeads data={data} />
    </div>
  );
}

function ManagerDashboard({
  summary,
  live,
  liveError,
  prospectOperations,
  prospectOperationsError,
}: {
  summary: DashboardSummary;
  live: ReturnType<typeof useDashboard>['data'];
  liveError: boolean;
  prospectOperations: ReturnType<typeof useDashboardProspectOperations>['data'];
  prospectOperationsError: boolean;
}) {
  const totals = summary.totals;
  const isSuperadmin = useAuthStore((state) => state.user?.isSuperadmin ?? false);
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Target} label="Accepted leads" value={String(totals.leads)} />
        <StatCard
          icon={Users}
          label="Average AI score"
          value={
            totals.averageLeadScore === null ? '—' : String(Math.round(totals.averageLeadScore))
          }
        />
        <StatCard icon={Building2} label="Open pipeline" value={pipelineValue(summary) || '—'} />
        <StatCard icon={CheckSquare} label="Open tasks" value={String(totals.openTasks)} />
        <StatCard icon={AlertTriangle} label="Overdue tasks" value={String(totals.overdueTasks)} />
        <StatCard
          icon={Contact}
          label="Prospects pending"
          value={String(summary.prospectsPendingReview)}
        />
      </div>

      {live ? (
        <OperationsHealth data={live} />
      ) : liveError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Business metrics loaded, but live automation health is temporarily unavailable.
        </div>
      ) : (
        <div className="h-48 animate-pulse rounded-xl bg-slate-100" />
      )}

      {prospectOperations ? (
        <ProspectOperations data={prospectOperations} />
      ) : prospectOperationsError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Prospect operations detail is temporarily unavailable; the core dashboard metrics are
          still live.
        </div>
      ) : (
        <div className="h-96 animate-pulse rounded-xl bg-slate-100" />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PipelineFunnel summary={summary} />
        <JourneyFunnel summary={summary} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <AiFunnelHealth summary={summary} />
        <SourceMix summary={summary} />
        <TeamWorkload summary={summary} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {live ? <PriorityLeads data={live} /> : <RecentLeadsList summary={summary} />}
        <UpcomingCloses summary={summary} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecentLeadsList summary={summary} />
        <OutreachPulse summary={summary} />
      </div>

      {isSuperadmin && (
        <div className="flex flex-col items-start justify-between gap-3 rounded-xl bg-slate-950 p-5 text-white sm:flex-row sm:items-center">
          <div>
            <p className="font-semibold">Need the executive interpretation?</p>
            <p className="mt-1 text-sm text-slate-400">
              Ask Reporting CEO to explain these verified CRM numbers or build a chart.
            </p>
          </div>
          <Link
            to="/ceo-chat"
            className="shrink-0 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-100"
          >
            Open Reporting CEO
          </Link>
        </div>
      )}
    </>
  );
}

function MemberDashboard({
  summary,
  prospectOperations,
  prospectOperationsError,
}: {
  summary: DashboardSummary;
  prospectOperations: ReturnType<typeof useDashboardProspectOperations>['data'];
  prospectOperationsError: boolean;
}) {
  const mine = summary.mine;
  const totals = summary.totals;
  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <MyTasksCard summary={summary} />
        <MyOutreachDueCard summary={summary} />
        <ProspectsPendingTile summary={summary} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Target} label="My accepted leads" value={String(totals.leads)} />
        <StatCard
          icon={Users}
          label="My average score"
          value={
            totals.averageLeadScore === null ? '—' : String(Math.round(totals.averageLeadScore))
          }
        />
        <StatCard icon={CheckSquare} label="My open tasks" value={String(mine.openTasks)} />
        <StatCard icon={AlertTriangle} label="My overdue" value={String(mine.overdueTasks)} />
        <StatCard icon={Send} label="Outreach due" value={String(mine.outreachDue.length)} />
        <StatCard
          icon={Contact}
          label="Review queue"
          value={String(summary.prospectsPendingReview)}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <JourneyFunnel summary={summary} />
        <AiFunnelHealth summary={summary} />
      </div>

      {prospectOperations ? (
        <ProspectOperations data={prospectOperations} />
      ) : prospectOperationsError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Prospect operations detail is temporarily unavailable.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SourceMix summary={summary} />
        <MyRecentLeadsCard summary={summary} />
      </div>
    </>
  );
}
