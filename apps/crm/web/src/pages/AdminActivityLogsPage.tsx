import { useEffect, useMemo, useState } from 'react';
import { Activity, CalendarDays, ChevronLeft, ChevronRight, Filter, Search } from 'lucide-react';
import { useActivityLogs, useIdentityUsers } from '../hooks/use-api.js';

function label(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function snapshot(value: unknown): string {
  if (value === null || value === undefined) return 'No snapshot recorded';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return 'Snapshot unavailable';
  }
}

export default function AdminActivityLogsPage({ embedded = false }: { embedded?: boolean }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [actorUserId, setActorUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const pageSize = 50;
  const filters = useMemo(
    () => ({ page, pageSize, search, action, resourceType, actorUserId, from, to }),
    [page, search, action, resourceType, actorUserId, from, to]
  );
  const { data, isLoading, error } = useActivityLogs(filters);
  const { data: users = [] } = useIdentityUsers(true);
  const userNames = useMemo(
    () => new Map(users.map((user) => [user.id, user.displayName || user.email])),
    [users]
  );

  useEffect(() => {
    setPage(1);
  }, [search, action, resourceType, actorUserId, from, to]);

  const clearFilters = () => {
    setSearch('');
    setAction('');
    setResourceType('');
    setActorUserId('');
    setFrom('');
    setTo('');
  };

  return (
    <div className="space-y-6 max-w-[1500px]">
      {!embedded && (
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Activity size={21} className="text-slate-600" />
              <h1 className="text-xl font-semibold">Activity logs</h1>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Captures, reviews, stage changes, and administrative activity across the CRM.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-right shadow-sm">
            <div className="text-xs uppercase tracking-wide text-slate-400">Matching events</div>
            <div className="text-lg font-semibold text-slate-800">{data?.total ?? '—'}</div>
          </div>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Filter size={16} /> Filters
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="relative xl:col-span-2">
            <span className="sr-only">Search logs</span>
            <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search action, resource, or ID"
              className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <select
            value={actorUserId}
            onChange={(event) => setActorUserId(event.target.value)}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
            aria-label="Filter by person"
          >
            <option value="">All people</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName || user.email}
              </option>
            ))}
          </select>
          <select
            value={action}
            onChange={(event) => setAction(event.target.value)}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
            aria-label="Filter by activity type"
          >
            <option value="">All activity types</option>
            {(data?.filters.actions ?? []).map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
          <select
            value={resourceType}
            onChange={(event) => setResourceType(event.target.value)}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
            aria-label="Filter by resource type"
          >
            <option value="">All resource types</option>
            {(data?.filters.resourceTypes ?? []).map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <label className="relative min-w-0 flex-1">
              <CalendarDays
                size={15}
                className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400"
              />
              <input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="w-full rounded-md border border-slate-200 py-2 pl-8 pr-2 text-sm"
                aria-label="From date"
              />
            </label>
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-2 text-sm"
              aria-label="To date"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={clearFilters}
          className="mt-3 text-xs font-medium text-blue-700 hover:underline"
        >
          Clear filters
        </button>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {isLoading ? (
          <div className="p-12 text-center text-sm text-slate-500">Loading activity…</div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-red-600">
            {error instanceof Error ? error.message : 'Could not load activity logs.'}
          </div>
        ) : data?.logs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Person</th>
                  <th className="px-4 py-3">Activity</th>
                  <th className="px-4 py-3">Resource</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.logs.map((log) => (
                  <tr key={log.id} className="align-top hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      <time dateTime={log.createdAt}>{formatDate(log.createdAt)}</time>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">
                        {log.actorUserId
                          ? userNames.get(log.actorUserId) || 'Unknown user'
                          : 'System'}
                      </div>
                      {log.actorUserId && (
                        <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                          {log.actorUserId}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-700">{label(log.action)}</td>
                    <td className="px-4 py-3">
                      <div className="text-slate-700">{label(log.resourceType)}</div>
                      <div
                        className="mt-0.5 max-w-[260px] truncate font-mono text-[11px] text-slate-400"
                        title={log.resourceId}
                      >
                        {log.resourceId}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <details className="max-w-[360px]">
                        <summary className="cursor-pointer text-xs font-medium text-blue-700">
                          View snapshot
                        </summary>
                        <div className="mt-2 space-y-2">
                          {log.before !== null && log.before !== undefined && (
                            <div>
                              <div className="text-[10px] font-semibold uppercase text-slate-400">
                                Before
                              </div>
                              <pre className="max-h-40 overflow-auto rounded bg-slate-950 p-2 text-[10px] text-slate-100">
                                {snapshot(log.before)}
                              </pre>
                            </div>
                          )}
                          {log.after !== null && log.after !== undefined && (
                            <div>
                              <div className="text-[10px] font-semibold uppercase text-slate-400">
                                After
                              </div>
                              <pre className="max-h-40 overflow-auto rounded bg-slate-950 p-2 text-[10px] text-slate-100">
                                {snapshot(log.after)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-sm text-slate-500">
            No activity matches these filters.
          </div>
        )}
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
          <span>
            Page {data?.page ?? page} of {data?.totalPages ?? 1}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || isLoading}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={15} /> Previous
            </button>
            <button
              type="button"
              onClick={() =>
                setPage((current) => Math.min(data?.totalPages ?? current, current + 1))
              }
              disabled={page >= (data?.totalPages ?? 1) || isLoading}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
