import { Activity, Clock3, Radio, Sparkles, UserRound } from 'lucide-react';
import type { DashboardProspectOperations } from '../../api.js';

const dateTime = (value: string) =>
  value
    ? new Date(value).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';
const dayLabel = (value: string) =>
  value
    ? new Date(value).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
    : '—';

export function CaptureIntelligence({ data }: { data: DashboardProspectOperations }) {
  const windows = ['24h', '7d', '30d']
    .map((label) => data.captureWindows.find((row) => row.label === label))
    .filter(Boolean) as DashboardProspectOperations['captureWindows'];
  const maxTrend = Math.max(1, ...data.captureTrend.map((row) => row.captures));
  return (
    <section className="space-y-5 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Radio size={18} className="text-indigo-600" />
            <h2 className="text-lg font-semibold text-slate-950">Capture intelligence</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Fresh first-time captures are separated from repeat profile updates. All times are
            system time.
          </p>
        </div>
        <span className="text-[11px] text-slate-500">As of {dateTime(data.generatedAt)}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {windows.map((row) => (
          <div key={row.label} className="rounded-xl border border-white bg-white p-4 shadow-sm">
            <div className="flex justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <span>Last {row.label}</span>
              <Clock3 size={14} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-y-2 text-xs">
              <span className="text-slate-500">Total captures</span>
              <strong className="text-right text-slate-950">{row.captures.toLocaleString()}</strong>
              <span className="text-slate-500">Fresh profiles</span>
              <strong className="text-right text-emerald-700">{row.fresh.toLocaleString()}</strong>
              <span className="text-slate-500">Recaptures</span>
              <strong className="text-right text-indigo-700">
                {row.recaptures.toLocaleString()}
              </strong>
              <span className="text-slate-500">Avg. lead latency</span>
              <strong className="text-right text-slate-700">
                {row.avgLatencyMinutes < 60
                  ? `${Math.round(row.avgLatencyMinutes)}m`
                  : `${(row.avgLatencyMinutes / 60).toFixed(1)}h`}
              </strong>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="rounded-xl border border-white bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Activity size={16} className="text-indigo-600" />
            <h3 className="text-sm font-semibold text-slate-900">Seven-day capture pulse</h3>
          </div>
          <div className="space-y-2">
            {data.captureTrend.map((row) => (
              <div
                key={row.day}
                className="grid grid-cols-[70px_1fr_50px] items-center gap-2 text-xs"
              >
                <span className="text-slate-500">{dayLabel(row.day)}</span>
                <div className="h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-indigo-500"
                    style={{
                      width: `${Math.max(row.captures ? 5 : 0, (row.captures / maxTrend) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-right font-semibold text-slate-800">{row.captures}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-white bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <UserRound size={16} className="text-indigo-600" />
            <h3 className="text-sm font-semibold text-slate-900">Capture activity · last 24h</h3>
          </div>
          <div className="max-h-56 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="pb-2">Time</th>
                  <th className="pb-2">Operator</th>
                  <th className="pb-2 text-right">Fresh / total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.captureActivity.map((row) => (
                  <tr key={`${row.hour}-${row.actor}`}>
                    <td className="py-2 text-slate-500">{dateTime(row.hour)}</td>
                    <td className="py-2 font-medium text-slate-700">{row.actor}</td>
                    <td className="py-2 text-right font-semibold text-slate-900">
                      {row.fresh} / {row.captures}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-white bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles size={16} className="text-indigo-600" />
          <h3 className="text-sm font-semibold text-slate-900">Recently captured profiles</h3>
          <span className="ml-auto text-[11px] text-slate-400">Newest first · captured at</span>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="pb-2">Prospect</th>
                <th className="pb-2">Captured</th>
                <th className="pb-2">By</th>
                <th className="pb-2">Type</th>
                <th className="pb-2 text-right">Completeness</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.recentCaptures.map((row) => (
                <tr key={row.id}>
                  <td className="py-2">
                    <div className="font-medium text-slate-800">{row.name}</div>
                    <div className="text-[11px] text-slate-400">{row.company || row.source}</div>
                  </td>
                  <td className="py-2 text-slate-500">{dateTime(row.capturedAt)}</td>
                  <td className="py-2 text-slate-600">{row.actor}</td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-semibold ${row.isFresh ? 'bg-emerald-50 text-emerald-700' : 'bg-indigo-50 text-indigo-700'}`}
                    >
                      {row.isFresh ? 'Fresh' : 'Recapture'}
                    </span>
                  </td>
                  <td className="py-2 text-right font-semibold text-slate-700">
                    {row.dataCompleteness}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
