import { useAuthStore } from '../stores/auth.js';
import { useCompanies, useLeads, useContacts, useOpportunities, useTasks } from '../hooks/use-api.js';
import { Target, Building2, Contact, Users, CheckSquare, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '../lib/utils.js';

interface TrendData {
  value: number;
  label: string;
}

function calculateTrend(items: Array<{ createdAt: string; deletedAt: string | null }>): TrendData | undefined {
  const now = new Date();
  const last7DaysStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prev7DaysStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const activeItems = items.filter((i) => !i.deletedAt);
  const current = activeItems.filter((i) => new Date(i.createdAt) >= last7DaysStart).length;
  const previous = activeItems.filter((i) => {
    const d = new Date(i.createdAt);
    return d >= prev7DaysStart && d < last7DaysStart;
  }).length;

  if (previous === 0) {
    if (current === 0) return undefined;
    return { value: 100, label: '+100%' };
  }

  const pct = Math.round(((current - previous) / previous) * 100);
  return { value: pct, label: `${pct >= 0 ? '+' : ''}${pct}%` };
}

function StatCard({
  icon: Icon,
  label,
  value,
  trend,
}: {
  icon: React.ComponentType<{ size: number; className?: string }>;
  label: string;
  value: string;
  trend?: TrendData;
}) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="p-2 bg-slate-100 rounded-md">
          <Icon size={18} className="text-slate-600" />
        </div>
        {trend && (
          <span
            className={cn(
              'text-xs font-medium flex items-center gap-0.5',
              trend.value >= 0 ? 'text-green-600' : 'text-red-600'
            )}
          >
            {trend.value >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {trend.label}
          </span>
        )}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-slate-500 text-sm">{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const role = useAuthStore((s) => s.user?.role ?? '');
  const { data: companies } = useCompanies();
  const { data: leads } = useLeads();
  const { data: contacts } = useContacts();
  const { data: opportunities } = useOpportunities();
  const { data: tasks } = useTasks();

  const openTasks = tasks?.tasks.filter((t) => !t.completedAt && !t.deletedAt).length ?? 0;
  const totalValue = opportunities?.opportunities
    .filter((o) => !o.deletedAt && o.stage !== 'closed_lost')
    .reduce((sum, o) => sum + (parseFloat(o.amount ?? '0') || 0), 0) ?? 0;

  const activeLeads = leads?.leads.filter((l) => !l.deletedAt) ?? [];
  const activeOpportunities = opportunities?.opportunities.filter((o) => !o.deletedAt) ?? [];

  const leadTrend = calculateTrend(activeLeads);
  const opportunityTrend = calculateTrend(activeOpportunities);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Welcome back{role && ` — ${role} view`}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard icon={Building2} label="Companies" value={String(companies?.companies.length ?? 0)} />
        <StatCard icon={Target} label="Leads" value={String(activeLeads.length)} trend={leadTrend} />
        <StatCard icon={Contact} label="Contacts" value={String(contacts?.contacts.length ?? 0)} />
        <StatCard
          icon={Users}
          label="Opportunities"
          value={`$${(totalValue / 1000).toFixed(1)}k`}
          trend={opportunityTrend}
        />
        <StatCard icon={CheckSquare} label="Open Tasks" value={String(openTasks)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <h2 className="font-semibold mb-4">Recent Leads</h2>
          <div className="space-y-2">
            {activeLeads.slice(0, 5).map((lead) => (
              <div key={lead.id} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded">
                <div>
                  <div className="font-medium text-sm">{lead.firstName} {lead.lastName}</div>
                  <div className="text-slate-500 text-xs">{lead.email}</div>
                </div>
                <span className={
                  lead.status === 'new' ? 'px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700' :
                  lead.status === 'contacted' ? 'px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700' :
                  lead.status === 'qualified' ? 'px-2 py-0.5 rounded text-xs bg-green-100 text-green-700' :
                  'px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600'
                }>
                  {lead.status}
                </span>
              </div>
            ))}
            {(!activeLeads.length) && <div className="text-slate-400 text-sm text-center py-8">No leads yet</div>}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <h2 className="font-semibold mb-4">Pipeline Overview</h2>
          <div className="space-y-3">
            {(['prospecting', 'qualification', 'proposal', 'negotiation'] as const).map((stage) => {
              const count = activeOpportunities.filter(o => o.stage === stage).length;
              const stageValue = activeOpportunities
                .filter(o => o.stage === stage)
                .reduce((s, o) => s + (parseFloat(o.amount ?? '0') || 0), 0);
              return (
                <div key={stage} className="flex items-center gap-3">
                  <div className="w-28 text-sm capitalize">{stage.replace('_', ' ')}</div>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${Math.max(2, (count / (activeOpportunities.length || 1)) * 100)}%` }}
                    />
                  </div>
                  <div className="text-sm text-slate-600 w-24 text-right">
                    {count} · ${(stageValue / 1000).toFixed(0)}k
                  </div>
                </div>
              );
            })}
            {(!activeOpportunities.length) && <div className="text-slate-400 text-sm text-center py-8">No opportunities yet</div>}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h2 className="font-semibold mb-4">My Tasks</h2>
        <div className="space-y-2">
          {tasks?.tasks.filter(t => !t.completedAt && !t.deletedAt).slice(0, 5).map((task) => (
            <div key={task.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded">
              <div className={`w-2 h-2 rounded-full ${task.priority === 'high' ? 'bg-red-500' : task.priority === 'medium' ? 'bg-amber-500' : 'bg-blue-500'}`} />
              <div className="flex-1">
                <div className="text-sm font-medium">{task.title}</div>
                <div className="text-xs text-slate-500">
                  {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No due date'}
                </div>
              </div>
            </div>
          ))}
          {(!tasks?.tasks.filter(t => !t.completedAt && !t.deletedAt).length) && <div className="text-slate-400 text-sm text-center py-8">No open tasks</div>}
        </div>
      </div>
    </div>
  );
}
