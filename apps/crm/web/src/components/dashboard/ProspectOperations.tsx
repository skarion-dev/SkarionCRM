import {
  Activity,
  BarChart3,
  Clock3,
  Database,
  FileUp,
  TimerReset,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { DashboardProspectOperations } from '../../api.js';

function dateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function hourLabel(value: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function Panel({
  title,
  icon: Icon,
  children,
  className = '',
  updatedAt,
}: {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
  className?: string;
  updatedAt?: string;
}) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-4 flex items-center gap-2">
        <Icon size={17} className="text-indigo-600" />
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {updatedAt ? (
          <span className="ml-auto text-[10px] text-slate-400">As of {dateTime(updatedAt)}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function ProspectOperations({ data }: { data: DashboardProspectOperations }) {
  const windows = ['24h', '12h', '3d', '7d']
    .map((label) => data.windows.find((row) => row.label === label))
    .filter((row): row is DashboardProspectOperations['windows'][number] => Boolean(row));
  const maxBand = Math.max(1, ...data.scoreBands.map((row) => row.count));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Prospect operations</h2>
          <p className="text-xs text-slate-500">
            Ingestion, review throughput, scoring distribution, and queue health ·{' '}
            {data.scope === 'team' ? 'team scope' : 'your scope'}
          </p>
        </div>
        <span className="text-[11px] text-slate-400">Updated {dateTime(data.generatedAt)}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {windows.map((row) => (
          <div key={row.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <span>Last {row.label}</span>
              <Clock3 size={14} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-y-2 text-xs">
              <span className="text-slate-500">Ingested</span>
              <strong className="text-right text-slate-900">{row.ingested.toLocaleString()}</strong>
              <span className="text-slate-500">Reviewed</span>
              <strong className="text-right text-slate-900">{row.reviewed.toLocaleString()}</strong>
              <span className="text-slate-500">Accepted</span>
              <strong className="text-right text-emerald-700">
                {row.accepted.toLocaleString()}
              </strong>
              <span className="text-slate-500">Disqualified</span>
              <strong className="text-right text-red-600">
                {row.disqualified.toLocaleString()}
              </strong>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Panel
          title="Score bands · reviewed last 24h"
          icon={BarChart3}
          className="xl:col-span-2"
          updatedAt={data.generatedAt}
        >
          <div className="space-y-3">
            {data.scoreBands.length === 0 ? (
              <p className="text-sm text-slate-500">No reviews in the last 24 hours.</p>
            ) : (
              data.scoreBands.map((row) => (
                <div key={row.band}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-medium text-slate-600">{row.band}</span>
                    <span className="font-semibold text-slate-900">
                      {row.count.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-indigo-500"
                      style={{ width: `${Math.max(4, (row.count / maxBand) * 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel
          title="Queue snapshot"
          icon={Database}
          className="xl:col-span-3"
          updatedAt={data.generatedAt}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ['Pending review', data.queue.pendingReview, 'text-amber-700'],
              ['Cleanup active', data.queue.cleanupActive, 'text-indigo-700'],
              ['Cleanup done', data.queue.cleanupCompleted, 'text-emerald-700'],
              ['Accepted', data.queue.accepted, 'text-slate-900'],
              ['Accepted unscored', data.queue.acceptedUnscored, 'text-red-700'],
            ].map(([label, value, color]) => (
              <div key={String(label)} className="rounded-lg bg-slate-50 p-3">
                <p className="text-[11px] text-slate-500">{label}</p>
                <p className={`mt-1 text-xl font-semibold ${color}`}>
                  {Number(value).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel
          title="Recent ingestion by person and hour"
          icon={Activity}
          updatedAt={data.generatedAt}
        >
          {data.ingestion.length === 0 ? (
            <p className="text-sm text-slate-500">No prospects ingested in the last 24 hours.</p>
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white text-[10px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="pb-2">Time</th>
                    <th className="pb-2">Added by</th>
                    <th className="pb-2 text-right">Count</th>
                    <th className="pb-2 text-right">Range</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.ingestion.map((row) => (
                    <tr key={`${row.hour}-${row.actor}`}>
                      <td className="py-2 text-slate-500">{hourLabel(row.hour)}</td>
                      <td className="py-2 font-medium text-slate-700">
                        <span className="inline-flex items-center gap-1.5">
                          <UserRound size={13} />
                          {row.actor}
                        </span>
                      </td>
                      <td className="py-2 text-right font-semibold text-slate-900">
                        {row.count.toLocaleString()}
                      </td>
                      <td className="py-2 text-right text-slate-400">
                        {dateTime(row.firstAt)}–{dateTime(row.lastAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Recent import jobs" icon={FileUp} updatedAt={data.generatedAt}>
          {data.imports.length === 0 ? (
            <p className="text-sm text-slate-500">No import jobs found.</p>
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white text-[10px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="pb-2">Import</th>
                    <th className="pb-2">Added by</th>
                    <th className="pb-2 text-right">Created</th>
                    <th className="pb-2 text-right">Started</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.imports.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2">
                        <p className="max-w-48 truncate font-medium text-slate-700">{row.name}</p>
                        <p className="text-[10px] text-slate-400">
                          {row.status} · {row.duplicateCount.toLocaleString()} duplicates
                        </p>
                      </td>
                      <td className="py-2 text-slate-500">{row.actor}</td>
                      <td className="py-2 text-right font-semibold text-slate-900">
                        {row.createdCount.toLocaleString()}
                      </td>
                      <td className="py-2 text-right text-slate-400">{dateTime(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs text-indigo-900">
        <span className="inline-flex items-center gap-2 font-medium">
          <TimerReset size={14} />
          Review throughput is measured from each prospect's review timestamp; ingestion is measured
          from the prospect creation timestamp.
        </span>
        <span className="ml-1 text-indigo-700">
          This keeps imports and human/automated review activity distinguishable.
        </span>
      </div>
    </div>
  );
}
