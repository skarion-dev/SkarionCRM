import { useAuthStore } from '../stores/auth.js';
import { useDashboardSummary } from '../hooks/use-api.js';
import {
  RefreshCw,
  Building2,
  Target,
  Contact,
  Users,
  CheckSquare,
  AlertTriangle,
} from 'lucide-react';
import { StatCard } from '../components/dashboard/StatCard.js';
import { DashboardSkeleton } from '../components/dashboard/DashboardSkeleton.js';
import { PipelineFunnel } from '../components/dashboard/PipelineFunnel.js';
import { JourneyFunnel } from '../components/dashboard/JourneyFunnel.js';
import { AiFunnelHealth } from '../components/dashboard/AiFunnelHealth.js';
import { SourceMix } from '../components/dashboard/SourceMix.js';
import { OutreachPulse } from '../components/dashboard/OutreachPulse.js';
import { RecentLeadsList } from '../components/dashboard/RecentLeadsList.js';
import { UpcomingCloses } from '../components/dashboard/UpcomingCloses.js';
import { MyTasksCard } from '../components/dashboard/MyTasksCard.js';
import { MyOutreachDueCard } from '../components/dashboard/MyOutreachDueCard.js';
import { MyRecentLeadsCard } from '../components/dashboard/MyRecentLeadsCard.js';
import { ProspectsPendingTile } from '../components/dashboard/ProspectsPendingTile.js';
import { TeamWorkload } from '../components/dashboard/TeamWorkload.js';

export default function Dashboard() {
  const role = useAuthStore((s) => s.user?.role ?? '');
  const isSuperadmin = useAuthStore((s) => s.user?.isSuperadmin ?? false);
  const { data: summary, isPending, isFetching, refetch } = useDashboardSummary();

  const isManagerView = isSuperadmin || role === 'manager';

  const roleLabel = isSuperadmin
    ? 'Superadmin'
    : role
      ? role.charAt(0).toUpperCase() + role.slice(1)
      : '';

  if (isPending || !summary) {
    return <DashboardSkeleton />;
  }

  const currencyTotalLabel = (() => {
    const byCur = new Map<string, number>();
    for (const row of summary.opportunitiesByStage) {
      const cur = row.currency ?? 'USD';
      byCur.set(cur, (byCur.get(cur) ?? 0) + (row.secondaryValue ?? 0));
    }
    return [...byCur.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cur, val]) => {
        const v = val || 0;
        if (v >= 1_000_000) return `${cur} ${(v / 1_000_000).toFixed(1)}M`;
        return `${cur} ${(v / 1_000).toFixed(0)}k`;
      })
      .join(' · ');
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">
            Welcome back{roleLabel && ` — ${roleLabel} view`}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {isManagerView ? (
        <ManagerView summary={summary} currencyTotalLabel={currencyTotalLabel} />
      ) : (
        <MemberView summary={summary} currencyTotalLabel={currencyTotalLabel} />
      )}
    </div>
  );
}

function ManagerView({
  summary,
  currencyTotalLabel,
}: {
  summary: NonNullable<ReturnType<typeof useDashboardSummary>['data']>;
  currencyTotalLabel: string;
}) {
  const t = summary.totals;
  const isSuperadmin = useAuthStore((s) => s.user?.isSuperadmin ?? false);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard icon={Target} label="Accepted Leads" value={String(t.leads)} />
        <StatCard
          icon={Users}
          label="Avg AI Score"
          value={t.averageLeadScore === null ? '—' : String(Math.round(t.averageLeadScore))}
        />
        <StatCard icon={Building2} label="Open Pipeline" value={currencyTotalLabel || '—'} />
        <StatCard icon={CheckSquare} label="Open Tasks" value={String(t.openTasks)} />
        <StatCard icon={AlertTriangle} label="Overdue Tasks" value={String(t.overdueTasks)} />
        <StatCard
          icon={Contact}
          label="Prospects Pending"
          value={String(summary.prospectsPendingReview)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PipelineFunnel summary={summary} />
        <JourneyFunnel summary={summary} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <AiFunnelHealth summary={summary} />
        <SourceMix summary={summary} />
        <TeamWorkload summary={summary} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentLeadsList summary={summary} />
        <UpcomingCloses summary={summary} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <OutreachPulse summary={summary} />
        {isSuperadmin ? (
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm flex flex-col items-center justify-center gap-3">
            <div className="text-slate-500 text-sm text-center">
              Ask Skarion's Reporting CEO for a plain-language read on any of these numbers.
            </div>
            <a
              href="/ceo-chat"
              className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800"
            >
              Open Reporting CEO →
            </a>
          </div>
        ) : null}
      </div>
    </>
  );
}

function MemberView({
  summary,
  currencyTotalLabel,
}: {
  summary: NonNullable<ReturnType<typeof useDashboardSummary>['data']>;
  currencyTotalLabel: string;
}) {
  const m = summary.mine;
  const t = summary.totals;

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <MyTasksCard summary={summary} />
        <MyOutreachDueCard summary={summary} />
        <ProspectsPendingTile summary={summary} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard icon={CheckSquare} label="My Open Tasks" value={String(m.openTasks)} />
          <StatCard icon={AlertTriangle} label="My Overdue" value={String(m.overdueTasks)} />
        </div>
        <MyRecentLeadsCard summary={summary} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={Target} label="Team Leads" value={String(t.leads)} />
        <StatCard
          icon={Users}
          label="Avg AI Score"
          value={t.averageLeadScore === null ? '—' : String(Math.round(t.averageLeadScore))}
        />
        <StatCard icon={Building2} label="Open Pipeline" value={currencyTotalLabel || '—'} />
        <StatCard
          icon={Contact}
          label="Prospects Pending"
          value={String(summary.prospectsPendingReview)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PipelineFunnel summary={summary} />
        <JourneyFunnel summary={summary} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AiFunnelHealth summary={summary} />
        <SourceMix summary={summary} />
      </div>
    </>
  );
}
