import { Activity, BarChart3, Clock3, KeyRound, Radio, Sparkles, UserRound } from 'lucide-react';
import { useState } from 'react';
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
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [hoveredCaptureDay, setHoveredCaptureDay] = useState<string | null>(null);
  const windows = ['24h', '7d', '30d']
    .map((label) => data.captureWindows.find((row) => row.label === label))
    .filter(Boolean) as DashboardProspectOperations['captureWindows'];
  const maxTrend = Math.max(1, ...data.captureTrend.map((row) => row.captures));
  const selectedToken = data.captureTokens.find((token) => token.id === selectedTokenId) ?? null;
  const selectedTokenTrend = selectedToken
    ? data.captureTokenTrend.filter((row) => row.tokenId === selectedToken.id)
    : [];
  const selectedTokenMax = Math.max(1, ...selectedTokenTrend.map((row) => row.captures));
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
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <KeyRound size={16} className="text-indigo-600" />
          <h3 className="text-sm font-semibold text-slate-900">
            Extension token performance - lifetime
          </h3>
          <span className="text-[11px] text-slate-400">Active tokens with captured profiles only</span>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[1290px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="pb-2">Token name</th>
                <th className="pb-2">Issued / status</th>
                <th className="pb-2">Last used</th>
                <th className="pb-2 text-right">All captures</th>
                <th className="pb-2 text-right">Fresh / unique</th>
                <th className="pb-2 text-right">New leads</th>
                <th className="pb-2 text-right">24h / 7d</th>
                <th className="pb-2">Last capture</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.captureTokens.map((token) => (
                <tr
                  key={token.id}
                  onClick={() => setSelectedTokenId(token.id)}
                  className={`cursor-pointer transition-colors hover:bg-indigo-50 ${selectedToken?.id === token.id ? 'bg-indigo-50' : ''}`}
                  title={`Show ${token.label}'s last 30 days of capture activity`}
                >
                  <td className="py-2">
                    <div className="flex items-center gap-2 font-semibold text-slate-800">
                      {token.label}
                      <BarChart3 size={13} className="text-indigo-500" />
                    </div>
                    {token.email && <div className="text-[11px] text-slate-400">{token.email}</div>}
                  </td>
                  <td className="py-2 text-slate-500">
                    <div>{dateTime(token.issuedAt)}</div>
                    <span className="mt-1 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Active</span>
                  </td>
                  <td className="py-2 text-slate-500">
                    {token.lastUsedAt ? dateTime(token.lastUsedAt) : 'Never used'}
                  </td>
                  <td className="py-2 text-right text-sm font-semibold text-slate-900">
                    {token.captures.toLocaleString()}
                  </td>
                  <td className="py-2 text-right text-slate-700">
                    <div className="font-semibold">{token.freshCaptures.toLocaleString()}</div>
                    <div className="text-[11px] text-slate-400">
                      {token.uniqueLeads.toLocaleString()} unique profiles
                    </div>
                  </td>
                  <td className="py-2 text-right font-semibold text-indigo-700">
                    {token.leadsCreated.toLocaleString()}
                  </td>
                  <td className="py-2 text-right text-slate-700">
                    {token.captures24h.toLocaleString()} / {token.captures7d.toLocaleString()}
                  </td>
                  <td className="py-2 text-slate-500">
                    {token.lastCaptureAt ? dateTime(token.lastCaptureAt) : 'No capture yet'}
                  </td>
                </tr>
              ))}
              {data.captureTokens.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-400">
                    No extension tokens are visible in this scope.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {selectedToken && (
        <div className="rounded-xl border border-indigo-100 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <BarChart3 size={16} className="text-indigo-600" />
                <h3 className="text-sm font-semibold text-slate-900">
                  {selectedToken.label} · capture history
                </h3>
              </div>
              <p className="mt-1 text-xs text-slate-500">Last 30 days · fresh / total captures</p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedTokenId(null)}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              Close
            </button>
          </div>
          <div
            className="grid gap-x-1 gap-y-3"
            style={{ gridTemplateColumns: 'repeat(30, minmax(0, 1fr))' }}
          >
            {selectedTokenTrend.map((row) => {
              const height = row.captures ? Math.max(6, (row.captures / selectedTokenMax) * 100) : 0;
              return (
                <div
                  key={row.day}
                  className="group relative flex min-w-0 flex-col justify-end"
                  onMouseEnter={() => setHoveredCaptureDay(row.day)}
                  onMouseLeave={() => setHoveredCaptureDay(null)}
                  onFocus={() => setHoveredCaptureDay(row.day)}
                  onBlur={() => setHoveredCaptureDay(null)}
                  tabIndex={0}
                  aria-label={`${dayLabel(row.day)}: ${row.captures} total captures, ${row.fresh} fresh captures`}
                >
                  {hoveredCaptureDay === row.day && (
                    <div className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-10 w-max -translate-x-1/2 rounded-md bg-slate-950 px-2 py-1.5 text-center text-[11px] text-white shadow-lg">
                      <div className="font-semibold">{dayLabel(row.day)}</div>
                      <div>{row.captures.toLocaleString()} total</div>
                      <div className="text-indigo-200">{row.fresh.toLocaleString()} fresh</div>
                    </div>
                  )}
                  <div className="flex h-28 items-end rounded-sm bg-slate-50 px-0.5">
                    <div className="w-full rounded-t-sm bg-indigo-500 transition-colors group-hover:bg-indigo-700" style={{ height: `${height}%` }} />
                  </div>
                  <span className="mt-1 truncate text-center text-[9px] text-slate-400">{new Date(row.day).getDate()}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex justify-between text-[11px] text-slate-500">
            <span>Hover a day for fresh and total counts.</span>
            <strong className="text-slate-700">{selectedTokenTrend.reduce((sum, row) => sum + row.captures, 0).toLocaleString()} captures</strong>
          </div>
        </div>
      )}
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
