import { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ExternalLink,
  FileUp,
  Loader2,
  Search,
  UsersRound,
} from 'lucide-react';
import {
  useClaimNextProspects,
  useImportBatches,
  useImportProspects,
  useProspectEvents,
  useProspectImportJob,
  useProspects,
  useReviewProspect,
  type ProspectDisposition,
} from '../hooks/use-api.js';
import type { Prospect } from '../api.js';
import { showToast } from '../stores/toast.js';
import { cn } from '../lib/utils.js';

const PHD_ZERO_SCORE_REASON =
  'PhD profile — excluded by the current prospecting policy. Score forced to 0.';
const PHD_PATTERN = /\bph\.?\s*d\b\.?|\bdoctor of philosophy\b/i;

function prospectHasPhd(prospect: Prospect): boolean {
  if (prospect.isPhd) return true;
  return PHD_PATTERN.test(
    [
      prospect.firstName,
      prospect.lastName,
      prospect.headline,
      prospect.about,
      prospect.experience,
      prospect.education,
      prospect.skills,
      prospect.currentRole,
      prospect.currentRoleDates,
      prospect.profileSummary,
      prospect.educationEntries,
      prospect.experienceEntries,
      prospect.notes,
    ]
      .map((value) => (typeof value === 'string' ? value : value ? JSON.stringify(value) : ''))
      .filter(Boolean)
      .join(' ')
  );
}

function prospectAiRemark(prospect: Prospect, isPhd: boolean): string {
  if (isPhd) return PHD_ZERO_SCORE_REASON;
  if (prospect.aiReasoningSummary) return prospect.aiReasoningSummary;
  if (prospect.scoreJobStatus === 'processing') return 'Lead Scoring Agent is working…';
  if (prospect.scoreJobStatus === 'pending') {
    if (prospect.profileNormalizationStatus === 'pending') {
      return 'Profile Cleanup Agent is structuring the profile before scoring.';
    }
    return prospect.scoreJobError || 'Lead scoring is queued.';
  }
  if (prospect.scoreJobStatus === 'failed') {
    return prospect.scoreJobError || 'Scoring will retry automatically.';
  }
  return prospect.profileCaptureStatus === 'not_captured'
    ? 'Waiting for a LinkedIn profile capture.'
    : 'Lead scoring is queued.';
}

const DECISIONS: Array<{
  id: ProspectDisposition;
  label: string;
  className: string;
}> = [
  { id: 'excellent_fit', label: 'Excellent Fit', className: 'bg-emerald-600 text-white' },
  { id: 'worth_trying', label: 'Worth Trying', className: 'bg-blue-600 text-white' },
  { id: 'maybe', label: 'Maybe', className: 'bg-amber-500 text-white' },
  { id: 'future', label: 'Future', className: 'bg-violet-600 text-white' },
  {
    id: 'disqualified',
    label: 'Disqualify',
    className: 'border border-red-300 text-red-700 bg-white',
  },
];

export default function ProspectReviewPage() {
  const [search, setSearch] = useState('');
  const [leadFrom, setLeadFrom] = useState('');
  const [leadTo, setLeadTo] = useState('');
  const [batchId, setBatchId] = useState('');
  const [captureStatus, setCaptureStatus] = useState('');
  const [claimed, setClaimed] = useState<'all' | 'mine' | 'unclaimed'>('unclaimed');
  const [reviewState, setReviewState] = useState<'pending' | 'rejected'>('pending');
  const [sortBy, setSortBy] = useState('leadSequence');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [importName, setImportName] = useState('');
  const [importCsv, setImportCsv] = useState('');
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const filters = useMemo(
    () => ({
      search: search || undefined,
      leadFrom: leadFrom || undefined,
      leadTo: leadTo || undefined,
      batchId: batchId || undefined,
      captureStatus: captureStatus || undefined,
      claimed,
      reviewState,
      sortBy,
      sortOrder,
      page,
      pageSize: 100,
    }),
    [
      search,
      leadFrom,
      leadTo,
      batchId,
      captureStatus,
      claimed,
      reviewState,
      sortBy,
      sortOrder,
      page,
    ]
  );
  const { data, isLoading, error } = useProspects(filters);
  const { data: batches } = useImportBatches();
  const importProspects = useImportProspects();
  const { data: importJob } = useProspectImportJob(importJobId);
  const claimNext = useClaimNextProspects();
  const review = useReviewProspect();
  useProspectEvents(true);

  const prospects = data?.prospects ?? [];

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      showToast('Prospect Review currently accepts CSV files.', 'warning');
      return;
    }
    setImportCsv(await file.text());
    setImportName(file.name.replace(/\.csv$/i, ''));
  };

  const startImport = () => {
    if (!importCsv) {
      showToast('Choose a CSV first.', 'warning');
      return;
    }
    importProspects.mutate(
      { csv: importCsv, name: importName.trim() || 'Prospect import' },
      {
        onSuccess: ({ job, validRows, invalidRows }) => {
          setImportJobId(job.id);
          showToast(
            `Queued ${validRows} valid prospects${invalidRows.length ? `; ${invalidRows.length} rows need review` : ''}.`,
            'success'
          );
        },
        onError: (importError) =>
          showToast(importError instanceof Error ? importError.message : 'Import failed.', 'error'),
      }
    );
  };

  const claimAndOpen = () => {
    const placeholderTabs = Array.from({ length: 10 }, () => window.open('about:blank', '_blank'));
    claimNext.mutate(
      {
        limit: 10,
        leadFrom,
        leadTo,
        search,
        batchId,
        captureStatus,
        sortBy,
        sortOrder,
      },
      {
        onSuccess: ({ prospects: claimedProspects }) => {
          placeholderTabs.forEach((tab, index) => {
            const prospect = claimedProspects[index];
            if (tab && prospect?.linkedinUrl) tab.location.href = prospect.linkedinUrl;
            else tab?.close();
          });
          setClaimed('mine');
          showToast(
            claimedProspects.length
              ? `Claimed and opened ${claimedProspects.length} prospects for 15 minutes.`
              : 'No available prospects matched these filters.',
            claimedProspects.length ? 'success' : 'warning'
          );
        },
        onError: (claimError) => {
          placeholderTabs.forEach((tab) => tab?.close());
          showToast(
            claimError instanceof Error ? claimError.message : 'Could not claim prospects.',
            'error'
          );
        },
      }
    );
  };

  const decide = (id: string, rowVersion: number, disposition: ProspectDisposition) => {
    review.mutate(
      { id, rowVersion, disposition },
      {
        onSuccess: () => showToast('Prospect reviewed.', 'success'),
        onError: (reviewError) =>
          showToast(
            reviewError instanceof Error ? reviewError.message : 'Could not review prospect.',
            'error'
          ),
      }
    );
  };

  const toggleSort = (field: string) => {
    if (field === sortBy) setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setPage(1);
  };

  const sortIcon = (field: string) =>
    field === sortBy ? (
      sortOrder === 'asc' ? (
        <ArrowUp size={13} />
      ) : (
        <ArrowDown size={13} />
      )
    ) : (
      <ArrowUpDown size={13} className="opacity-35" />
    );

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <UsersRound className="text-blue-600" size={24} />
            <h1 className="text-2xl font-semibold">Prospect Review</h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Review raw candidates. Accepted prospects keep this lead number when they enter Leads.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <button
            onClick={() => fileInput.current?.click()}
            className="px-3 py-2 border rounded-md bg-white flex items-center gap-2 text-sm"
          >
            <FileUp size={16} /> Choose CSV
          </button>
          {importCsv && (
            <>
              <input
                value={importName}
                onChange={(event) => setImportName(event.target.value)}
                className="px-3 py-2 border rounded-md text-sm"
                placeholder="Import/batch name"
              />
              <button
                onClick={startImport}
                disabled={importProspects.isPending}
                className="px-3 py-2 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50"
              >
                {importProspects.isPending ? 'Uploading…' : 'Upload to Review'}
              </button>
            </>
          )}
          <button
            onClick={claimAndOpen}
            disabled={claimNext.isPending}
            className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
          >
            {claimNext.isPending ? 'Claiming…' : 'Claim & Open Next 10'}
          </button>
        </div>
      </div>

      {importJob?.job && (
        <div className="border rounded-lg bg-white p-4">
          <div className="flex justify-between text-sm">
            <span className="font-medium">{importJob.job.name}</span>
            <span className="capitalize">{importJob.job.status}</span>
          </div>
          <div className="h-2 rounded bg-slate-100 mt-2 overflow-hidden">
            <div
              className={cn(
                'h-full transition-all',
                importJob.job.status === 'failed' ? 'bg-red-500' : 'bg-blue-600'
              )}
              style={{
                width: `${Math.min(
                  100,
                  importJob.job.totalRows
                    ? (importJob.job.processedRows / importJob.job.totalRows) * 100
                    : 5
                )}%`,
              }}
            />
          </div>
          <div className="text-xs text-slate-500 mt-2">
            {importJob.job.createdCount} created · {importJob.job.duplicateCount} existing ·{' '}
            {importJob.job.invalidCount} invalid
          </div>
        </div>
      )}

      <div className="border rounded-lg bg-white p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-8 gap-2">
        <label className="xl:col-span-2 relative">
          <Search size={15} className="absolute left-3 top-3 text-slate-400" />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-3 py-2 border rounded-md text-sm"
            placeholder="Name, company, URL or lead number"
          />
        </label>
        <input
          value={leadFrom}
          onChange={(event) => setLeadFrom(event.target.value.replace(/\D/g, ''))}
          className="px-3 py-2 border rounded-md text-sm"
          placeholder="Lead # from"
        />
        <input
          value={leadTo}
          onChange={(event) => setLeadTo(event.target.value.replace(/\D/g, ''))}
          className="px-3 py-2 border rounded-md text-sm"
          placeholder="Lead # to"
        />
        <select
          value={reviewState}
          onChange={(event) => {
            setReviewState(event.target.value as typeof reviewState);
            setClaimed(event.target.value === 'pending' ? 'unclaimed' : 'all');
          }}
          className="px-3 py-2 border rounded-md text-sm"
        >
          <option value="pending">Awaiting review</option>
          <option value="rejected">Disqualified</option>
        </select>
        <select
          value={batchId}
          onChange={(event) => setBatchId(event.target.value)}
          className="px-3 py-2 border rounded-md text-sm"
        >
          <option value="">All batches</option>
          {(batches ?? []).map((batch) => (
            <option key={batch.id} value={batch.id}>
              {batch.name}
            </option>
          ))}
        </select>
        <select
          value={captureStatus}
          onChange={(event) => setCaptureStatus(event.target.value)}
          className="px-3 py-2 border rounded-md text-sm"
        >
          <option value="">All capture states</option>
          <option value="not_captured">Needs capture</option>
          <option value="captured">Captured</option>
          <option value="processing">Processing</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={claimed}
          onChange={(event) => setClaimed(event.target.value as typeof claimed)}
          className="px-3 py-2 border rounded-md text-sm"
        >
          <option value="unclaimed">Available</option>
          <option value="mine">Claimed by me</option>
          <option value="all">All prospects</option>
        </select>
      </div>

      <div className="border rounded-lg bg-white overflow-x-auto">
        {isLoading ? (
          <div className="p-12 flex justify-center text-slate-500">
            <Loader2 className="animate-spin" />
          </div>
        ) : error ? (
          <div className="p-8 text-red-600">
            {error instanceof Error ? error.message : 'Could not load prospects.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                {(
                  [
                    ['leadSequence', 'Lead #'],
                    ['aiScore', 'Score'],
                    ['name', 'Prospect'],
                    ['aiRemark', 'AI remark'],
                    ['companyName', 'Company'],
                    ['profileCaptureStatus', 'Capture'],
                    ['dataCompleteness', 'Complete'],
                  ] as const
                ).map(([field, label]) => (
                  <th
                    key={field}
                    onClick={() => toggleSort(field)}
                    className="text-left px-3 py-3 font-medium text-slate-600 cursor-pointer"
                  >
                    <span className="flex gap-1 items-center">
                      {label} {sortIcon(field)}
                    </span>
                  </th>
                ))}
                <th className="text-left px-3 py-3 font-medium text-slate-600">Review</th>
              </tr>
            </thead>
            <tbody>
              {prospects.map((prospect) => {
                const isPhd = prospectHasPhd(prospect);
                const remark = prospectAiRemark(prospect, isPhd);
                return (
                  <tr
                    key={prospect.id}
                    className={cn(
                      'border-b last:border-0 align-top',
                      isPhd && 'bg-red-50 border-l-4 border-l-red-600'
                    )}
                  >
                    <td className="px-3 py-3 font-mono text-xs">{prospect.leadNumber}</td>
                    <td className="px-3 py-3">
                      {isPhd ? (
                        <span className="inline-flex min-w-8 justify-center rounded bg-red-600 px-2 py-1 font-bold text-white">
                          0
                        </span>
                      ) : prospect.aiScore != null ? (
                        <span className="font-semibold tabular-nums">{prospect.aiScore}</span>
                      ) : (
                        <span
                          className="text-xs text-slate-400"
                          title={prospect.scoreJobStatus || 'queued'}
                        >
                          …
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 min-w-56">
                      {prospect.linkedinUrl ? (
                        <a
                          href={prospect.linkedinUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            'inline-flex items-center gap-1 font-medium hover:underline',
                            isPhd ? 'text-red-800' : 'text-blue-700'
                          )}
                        >
                          {prospect.firstName} {prospect.lastName}
                          <ExternalLink size={13} />
                        </a>
                      ) : (
                        <div className="font-medium">
                          {prospect.firstName} {prospect.lastName}
                        </div>
                      )}
                      <div
                        className={cn(
                          'text-xs mt-1 line-clamp-2',
                          isPhd ? 'text-red-700' : 'text-slate-500'
                        )}
                      >
                        {prospect.headline ||
                          prospect.location ||
                          'Profile details not captured yet'}
                      </div>
                      {isPhd && (
                        <span className="inline-block mt-1 rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                          PhD — score 0
                        </span>
                      )}
                      {prospect.claimedBy && (
                        <span className="inline-block mt-1 ml-1 text-[11px] rounded bg-amber-50 text-amber-700 px-1.5 py-0.5">
                          Claimed
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 min-w-80">
                      <div
                        className={cn(
                          'text-xs leading-5 line-clamp-3',
                          isPhd ? 'font-medium text-red-800' : 'text-slate-600'
                        )}
                        title={remark}
                      >
                        {remark}
                      </div>
                    </td>
                    <td className="px-3 py-3">{prospect.companyName || '—'}</td>
                    <td className="px-3 py-3 capitalize">
                      {prospect.profileCaptureStatus.replace('_', ' ')}
                    </td>
                    <td className="px-3 py-3">{prospect.dataCompleteness}%</td>
                    <td className="px-3 py-3 min-w-[430px]">
                      <div className="flex flex-wrap gap-1.5">
                        {DECISIONS.map((decision) => (
                          <button
                            key={decision.id}
                            onClick={() => decide(prospect.id, prospect.rowVersion, decision.id)}
                            disabled={review.isPending}
                            className={cn(
                              'px-2.5 py-1.5 rounded text-xs font-medium disabled:opacity-40',
                              decision.className
                            )}
                          >
                            {decision.label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {prospects.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-slate-500">
                    No pending prospects match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">
          {data?.total ?? 0} {reviewState === 'pending' ? 'pending' : 'disqualified'} prospects
        </span>
        <div className="flex gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="px-3 py-1.5 border rounded disabled:opacity-40"
          >
            Previous
          </button>
          <span className="px-2 py-1.5">
            Page {page} of {Math.max(1, data?.totalPages ?? 1)}
          </span>
          <button
            disabled={page >= (data?.totalPages ?? 1)}
            onClick={() => setPage((current) => current + 1)}
            className="px-3 py-1.5 border rounded disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
