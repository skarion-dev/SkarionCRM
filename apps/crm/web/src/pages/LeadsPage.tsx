import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  usePagedLeads,
  useDeleteEntity,
  useBulkLeads,
  useImportBatches,
  useIdentityUsers,
  useSavedSearches,
  useCreateSavedSearch,
  useDeleteSavedSearch,
  useUpdateEntity,
  useLeadScoringStatus,
  useProspectEvents,
} from '../hooks/use-api.js';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';
import {
  Target,
  Plus,
  Search,
  Trash2,
  ArrowRight,
  Pencil,
  Upload,
  Linkedin,
  Download,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Square,
  SquareCheck,
  X,
  Tag as TagIcon,
  UserCircle,
  SlidersHorizontal,
  Bookmark,
  Loader2,
  Bot,
  CheckCircle2,
  Clock3,
  Gauge,
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import LeadForm from '../components/forms/LeadForm.js';
import ImportModal from '../components/ImportModal.js';
import PdfImportModal from '../components/PdfImportModal.js';
import type { Lead, LeadJourneyStage } from '../api.js';
import { CRM_API_URL, getAccessToken } from '../api.js';
import { showToast } from '../stores/toast.js';
import { buildLeadsQueryString, type LeadFilters } from '../lib/leadFilters.js';
import { LEAD_JOURNEY_STAGES, journeyBadgeClass, journeyLabel } from '../lib/leadJourney.js';
import { formatCandidateCreatedTime } from '../lib/candidateTime.js';
import { visiblePageNumbers } from '../lib/pagination.js';

const LEAD_SORT_OPTIONS = [
  ['createdAt', 'Created'],
  ['updatedAt', 'Updated'],
  ['name', 'Full name'],
  ['firstName', 'First name'],
  ['lastName', 'Last name'],
  ['leadNumber', 'Lead number'],
  ['score', 'AI score'],
  ['classification', 'AI classification'],
  ['journeyStage', 'Journey'],
  ['companyName', 'Company'],
  ['companyDomain', 'Company domain'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['linkedinUrl', 'LinkedIn URL'],
  ['source', 'Source'],
  ['tags', 'Tags'],
  ['ownerId', 'Owner'],
  ['outreachStatus', 'Legacy outreach status'],
  ['notes', 'Notes'],
  ['sourceSheet', 'Import source'],
  ['originalRowNumber', 'Import row'],
] as const;

function SortableHeader({
  column,
  label,
  sortBy,
  sortOrder,
  onSort,
}: {
  column: string;
  label: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSort: (column: string) => void;
}) {
  return (
    <th
      className="text-left px-4 py-3 font-medium text-slate-600 cursor-pointer select-none hover:bg-slate-100"
      onClick={() => onSort(column)}
    >
      <div className="flex items-center gap-1 whitespace-nowrap">
        {label}
        {sortBy === column ? (
          sortOrder === 'asc' ? (
            <ArrowUp size={14} />
          ) : (
            <ArrowDown size={14} />
          )
        ) : (
          <ArrowUpDown size={14} className="text-slate-300" />
        )}
      </div>
    </th>
  );
}

function CandidateCreatedAt({
  createdAt,
  location,
}: {
  createdAt: string;
  location: string | null;
}) {
  const formatted = formatCandidateCreatedTime(createdAt, location);
  return (
    <div
      className="whitespace-nowrap"
      title={
        formatted.inferredFromCandidate
          ? `Candidate local time inferred from ${location} (${formatted.timeZone})`
          : `Candidate timezone unavailable; shown in your local timezone (${formatted.timeZone})`
      }
    >
      <div>{formatted.date}</div>
      <div className="text-xs text-slate-400">{formatted.time}</div>
    </div>
  );
}

export default function LeadsPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | LeadJourneyStage>('all');
  const [sortBy, setSortBy] = useState<string>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionOpen, setBulkActionOpen] = useState<false | 'status' | 'tag' | 'assign'>(false);
  const [tagInput, setTagInput] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [batchFilter, setBatchFilter] = useState<'all' | string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pdfImportOpen, setPdfImportOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [journeyOverrides, setJourneyOverrides] = useState<Record<string, LeadJourneyStage>>({});

  // Additive "More filters" — date range, tag, and (superadmin/manager-only)
  // owner multi-select. Journey remains the fast primary filter above.
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagFilterInput, setTagFilterInput] = useState('');
  const [ownerFilters, setOwnerFilters] = useState<string[]>([]);

  // Saved searches
  const [savedSearchesOpen, setSavedSearchesOpen] = useState(false);
  const [saveSearchName, setSaveSearchName] = useState('');

  const role = useAuthStore((s) => s.user?.role ?? '');
  const isSuperadmin = useAuthStore((s) => s.user?.isSuperadmin ?? false);
  const currentUserId = useAuthStore((s) => s.user?.id ?? '');
  const canManage = isSuperadmin || role === 'manager';

  const filters: LeadFilters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      statuses: statusFilter === 'all' ? undefined : [statusFilter],
      owners: ownerFilters.length > 0 ? ownerFilters : undefined,
      tags: tagFilters.length > 0 ? tagFilters : undefined,
      batchId: batchFilter === 'all' ? undefined : batchFilter,
      createdFrom: dateFrom || undefined,
      createdTo: dateTo || undefined,
      sortBy,
      sortOrder,
    }),
    [
      debouncedSearch,
      statusFilter,
      ownerFilters,
      tagFilters,
      batchFilter,
      dateFrom,
      dateTo,
      sortBy,
      sortOrder,
    ]
  );

  const { data, isLoading, isFetching } = usePagedLeads(filters, page, pageSize);
  const deleteMutation = useDeleteEntity();
  const bulkMutation = useBulkLeads();
  const { data: batches } = useImportBatches();
  const { data: identityUsers } = useIdentityUsers(canManage);
  const { data: savedSearchesData } = useSavedSearches();
  const { data: scoringStatus, isLoading: scoringStatusLoading } = useLeadScoringStatus();
  useProspectEvents(true);
  const createSavedSearch = useCreateSavedSearch();
  const deleteSavedSearch = useDeleteSavedSearch();
  const updateLead = useUpdateEntity('leads');
  const navigate = useNavigate();
  const crmUsers = (identityUsers ?? []).filter((u) =>
    u.appMemberships?.some((m) => m.app === 'crm')
  );
  const savedSearches = savedSearchesData?.savedSearches ?? [];

  const leads = data?.leads ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;
  const pageNumbers = useMemo(() => visiblePageNumbers(page, totalPages), [page, totalPages]);
  const statusCounts = data?.statusCounts ?? {};
  const allStatusTotal = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  const firstVisible = total > 0 ? (page - 1) * pageSize + 1 : 0;
  const lastVisible = total > 0 ? Math.min(page * pageSize, total) : 0;
  const scoring = scoringStatus?.summary;
  const connectionsToday = scoringStatus?.connectionsToday;
  const connectionProgress = connectionsToday
    ? Math.min(100, Math.round((connectionsToday.mine / Math.max(1, connectionsToday.limit)) * 100))
    : 0;
  const scoringState =
    (scoring?.processing ?? 0) > 0
      ? 'Scoring now'
      : (scoring?.retrying ?? 0) > 0
        ? 'Retrying'
        : (scoring?.waiting ?? 0) > 0
          ? 'Waiting for next run'
          : 'Queue clear';

  // Reset selection whenever the filtered/sorted set changes — the old
  // accumulated selection wouldn't make sense against a different result set.
  useEffect(() => {
    setSelectedIds(new Set());
    setPage(1);
  }, [filters]);

  // If a mutation removes the final record on the current page, move back to
  // the last valid page instead of leaving the user on an empty page.
  useEffect(() => {
    if (totalPages > 0 && page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const applySavedSearch = useCallback((saved: LeadFilters) => {
    setSearch(saved.search ?? '');
    setDebouncedSearch(saved.search ?? '');
    setStatusFilter((saved.statuses?.[0] as LeadJourneyStage | undefined) ?? 'all');
    setOwnerFilters(saved.owners ?? []);
    setTagFilters(saved.tags ?? []);
    setBatchFilter(saved.batchId ?? 'all');
    setDateFrom(saved.createdFrom ?? '');
    setDateTo(saved.createdTo ?? '');
    setSortBy(saved.sortBy ?? 'createdAt');
    setSortOrder((saved.sortOrder as 'asc' | 'desc' | undefined) ?? 'desc');
    setSavedSearchesOpen(false);
  }, []);

  const handleSaveSearch = () => {
    if (!saveSearchName.trim()) {
      showToast('Name the search before saving', 'warning');
      return;
    }
    createSavedSearch.mutate(
      {
        name: saveSearchName.trim(),
        filters,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
      },
      {
        onSuccess: () => {
          showToast('Search saved', 'success');
          setSaveSearchName('');
        },
        onError: (err) => showToast(err instanceof Error ? err.message : 'Failed to save', 'error'),
      }
    );
  };

  const toggleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortOrder(column === 'score' || column === 'createdAt' ? 'desc' : 'asc');
    }
  };

  const updateJourneyInline = (lead: Lead, journeyStage: LeadJourneyStage) => {
    if (journeyStage === lead.journeyStage) return;
    setJourneyOverrides((current) => ({ ...current, [lead.id]: journeyStage }));
    updateLead.mutate(
      { id: lead.id, data: { journeyStage } },
      {
        onSuccess: () => {
          setJourneyOverrides((current) => {
            const next = { ...current };
            delete next[lead.id];
            return next;
          });
          showToast(`${lead.firstName} moved to ${journeyLabel(journeyStage)}`, 'success');
        },
        onError: (error) => {
          setJourneyOverrides((current) => {
            const next = { ...current };
            delete next[lead.id];
            return next;
          });
          showToast(
            error instanceof Error ? error.message : 'Could not update the lead journey',
            'error'
          );
        },
      }
    );
  };

  const openCreate = () => {
    setEditLead(null);
    setModalOpen(true);
  };
  const openEdit = (lead: Lead) => {
    setEditLead(lead);
    setModalOpen(true);
  };
  const closeModal = () => {
    setModalOpen(false);
    setEditLead(null);
  };

  const handleExport = async () => {
    const qs = buildLeadsQueryString(filters);
    const url = `${CRM_API_URL}/api/leads/export.csv?${qs}`;
    const token = getAccessToken();
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      showToast('Export failed', 'error');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().split('T')[0];
    a.download = `skarion-leads-${dateStr}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    showToast('Export downloaded', 'success');
  };

  // Selection helpers
  const allSelected = leads.length > 0 && leads.every((l) => selectedIds.has(l.id));
  const someSelected = selectedIds.size > 0 && !allSelected;
  const selectionCount = selectedIds.size;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(leads.map((l) => l.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = () => {
    if (
      !window.confirm(
        `Are you sure you want to delete ${selectionCount} leads? This action cannot be undone.`
      )
    )
      return;
    bulkMutation.mutate(
      { ids: Array.from(selectedIds), action: 'delete' },
      {
        onSuccess: (res) => {
          showToast(`${res.processed} leads deleted`, 'success');
          setSelectedIds(new Set());
        },
        onError: () => showToast('Bulk delete failed', 'error'),
      }
    );
  };

  const handleBulkUpdateStatus = (status: string) => {
    bulkMutation.mutate(
      {
        ids: Array.from(selectedIds),
        action: 'update_journey_stage',
        journeyStage: status,
      },
      {
        onSuccess: (res) => {
          showToast(`${res.processed} leads updated to ${status}`, 'success');
          setSelectedIds(new Set());
          setBulkActionOpen(false);
        },
        onError: () => showToast('Bulk update failed', 'error'),
      }
    );
  };

  const handleBulkTag = () => {
    const tags = tagInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length === 0) {
      showToast('Enter at least one tag', 'warning');
      return;
    }
    bulkMutation.mutate(
      { ids: Array.from(selectedIds), action: 'update_tags', tags, tagMode: 'merge' },
      {
        onSuccess: (res) => {
          showToast(`${res.processed} leads tagged`, 'success');
          setTagInput('');
          setSelectedIds(new Set());
          setBulkActionOpen(false);
        },
        onError: () => showToast('Bulk tag failed', 'error'),
      }
    );
  };

  const handleBulkAssign = () => {
    if (!assigneeId) {
      showToast('Select a user to assign', 'warning');
      return;
    }
    bulkMutation.mutate(
      { ids: Array.from(selectedIds), action: 'assign_owner', assigneeId },
      {
        onSuccess: (res) => {
          showToast(`${res.processed} leads assigned`, 'success');
          setAssigneeId('');
          setSelectedIds(new Set());
          setBulkActionOpen(false);
        },
        onError: () => showToast('Bulk assign failed', 'error'),
      }
    );
  };

  if (isLoading) return <div className="text-slate-500">Loading leads...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target size={20} className="text-slate-600" />
          <h1 className="text-xl font-semibold">Leads</h1>
          <span className="text-sm text-slate-500">({total} total)</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-md text-sm hover:bg-slate-50 text-slate-600"
          >
            <Download size={16} /> Export CSV
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-md text-sm hover:bg-slate-50 text-slate-600"
          >
            <Upload size={16} /> CSV Import
          </button>
          <button
            onClick={() => setPdfImportOpen(true)}
            className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-md text-sm hover:bg-slate-50 text-slate-600"
          >
            <Upload size={16} /> Document Import
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
          >
            <Plus size={16} /> Add Lead
          </button>
        </div>
      </div>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-md bg-blue-50 p-2 text-blue-600">
              <Bot size={18} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-800">Lead Scoring Agent</h2>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    scoringState === 'Scoring now'
                      ? 'bg-blue-100 text-blue-700'
                      : scoringState === 'Retrying'
                        ? 'bg-amber-100 text-amber-700'
                        : scoringState === 'Queue clear'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-violet-100 text-violet-700'
                  )}
                >
                  {scoringState}
                </span>
                <span className="text-xs text-slate-400">updates every 5 seconds</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Scores New and Ready to reach out leads only after profile capture and cleanup.
                Uncaptured leads use zero AI tokens.
              </p>
            </div>
          </div>
          <div className="text-right text-xs text-slate-500">
            {(scoring?.active ?? 0) > 0 ? (
              <>
                Estimated queue time{' '}
                <span className="font-semibold text-slate-700">
                  ~{scoring?.estimatedMinutes ?? 0} min
                </span>
              </>
            ) : (
              'Ready for captured profiles'
            )}
          </div>
        </div>

        <div className="grid gap-4 p-4 xl:grid-cols-[1.45fr_0.7fr_1fr]">
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-slate-700">
                {scoringStatusLoading
                  ? 'Loading scoring queue…'
                  : `${scoring?.unscoredCaptured ?? 0} captured leads awaiting a score`}
              </span>
              <span className="text-slate-400">
                {scoring?.progressPercent ?? 0}% of captured candidates scored
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-500"
                style={{ width: `${scoring?.progressPercent ?? 0}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Captured & eligible', scoring?.capturedReady ?? 0],
                ['Waiting for capture', scoring?.waitingForCapture ?? 0],
                ['Queued / scoring', scoring?.active ?? 0],
                ['Scored', scoring?.scored ?? 0],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md bg-slate-50 px-3 py-2">
                  <div className="text-lg font-semibold text-slate-800">{value}</div>
                  <div className="text-xs text-slate-500">{label}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-400">
                Up to {scoringStatus?.cadence.batchSize ?? 30} leads every minute with{' '}
                {scoringStatus?.cadence.concurrency ?? 10} parallel cheap-model workers.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSortBy('score');
                  setSortOrder('desc');
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
              >
                <Gauge size={14} /> Sort highest scores
              </button>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-slate-500">My LinkedIn connections today</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">
                  {connectionsToday?.mine ?? 0}
                  <span className="text-sm font-normal text-slate-400">
                    {' '}
                    / {connectionsToday?.limit ?? 20}
                  </span>
                </p>
              </div>
              <Clock3
                size={20}
                className={cn(
                  connectionProgress >= 100
                    ? 'text-red-500'
                    : connectionProgress >= 80
                      ? 'text-amber-500'
                      : 'text-blue-500'
                )}
              />
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  connectionProgress >= 100
                    ? 'bg-red-500'
                    : connectionProgress >= 80
                      ? 'bg-amber-500'
                      : 'bg-blue-500'
                )}
                style={{ width: `${connectionProgress}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Team today: {connectionsToday?.team ?? 0}. The 20/day number is a pacing guide, not an
              enforced block.
            </p>
          </div>

          <div className="min-w-0 rounded-md border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Live scoring queue
              </span>
              <span className="text-xs font-medium text-slate-500">
                {scoring?.active ?? 0} total
              </span>
            </div>
            <div className="max-h-36 overflow-y-auto">
              {(scoringStatus?.queue.length ?? 0) === 0 ? (
                <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-slate-400">
                  <CheckCircle2 size={15} className="text-emerald-500" />
                  No captured leads waiting for scoring.
                </div>
              ) : (
                scoringStatus?.queue.map((job, index) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0 truncate text-xs text-slate-700">
                      <span className="mr-2 text-slate-400">{index + 1}</span>
                      {job.leadNumber ? `${job.leadNumber} · ` : ''}
                      {job.firstName} {job.lastName}
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize',
                        job.status === 'processing'
                          ? 'bg-blue-100 text-blue-700'
                          : job.status === 'failed'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-600'
                      )}
                    >
                      {job.status === 'failed' ? 'retrying' : job.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Status filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setStatusFilter('all')}
          className={cn(
            'px-3 py-1.5 rounded-md text-sm border',
            statusFilter === 'all'
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white border-slate-200 hover:bg-slate-50'
          )}
        >
          All ({allStatusTotal})
        </button>
        {LEAD_JOURNEY_STAGES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm border capitalize',
              statusFilter === s
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white border-slate-200 hover:bg-slate-50'
            )}
          >
            {journeyLabel(s)} ({statusCounts[s] || 0})
          </button>
        ))}
      </div>

      {/* Search, batch filter, more-filters toggle, saved searches */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-md px-3 py-2 flex-1">
          <Search size={16} className="text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, email, company, LinkedIn..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-sm outline-none"
          />
        </div>
        <select
          value={batchFilter}
          onChange={(e) => setBatchFilter(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-md text-sm bg-white"
          title="Filter by import set"
        >
          <option value="all">All Sets</option>
          {(batches ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(event) => toggleSort(event.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-md text-sm bg-white"
          title="Sort leads by any field"
          aria-label="Sort leads by field"
        >
          {LEAD_SORT_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              Sort: {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'))}
          className="flex items-center gap-1 px-3 py-2 border border-slate-200 rounded-md text-sm bg-white hover:bg-slate-50"
          title={
            sortOrder === 'asc'
              ? 'Ascending; click for descending'
              : 'Descending; click for ascending'
          }
          aria-label={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
        >
          {sortOrder === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
          {sortOrder === 'asc' ? 'Asc' : 'Desc'}
        </button>
        <button
          onClick={() => setMoreFiltersOpen((o) => !o)}
          className={cn(
            'flex items-center gap-2 px-3 py-2 border rounded-md text-sm',
            moreFiltersOpen ||
              dateFrom ||
              dateTo ||
              tagFilters.length > 0 ||
              ownerFilters.length > 0
              ? 'border-blue-300 bg-blue-50 text-blue-700'
              : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
          )}
        >
          <SlidersHorizontal size={16} /> More Filters
        </button>
        <div className="relative">
          <button
            onClick={() => setSavedSearchesOpen((o) => !o)}
            className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-md text-sm bg-white hover:bg-slate-50 text-slate-600"
          >
            <Bookmark size={16} /> Saved Searches
          </button>
          {savedSearchesOpen && (
            <div className="absolute right-0 mt-1 w-80 bg-white border border-slate-200 rounded-md shadow-lg z-10 p-3">
              {savedSearches.length === 0 && (
                <p className="text-xs text-slate-400 mb-2">No saved searches yet.</p>
              )}
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {savedSearches.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50"
                  >
                    <button
                      onClick={() => applySavedSearch(s.filters)}
                      className="flex-1 text-left text-sm text-slate-700"
                    >
                      {s.name}
                    </button>
                    <button
                      onClick={() =>
                        deleteSavedSearch.mutate(s.id, {
                          onSuccess: () => showToast('Saved search deleted', 'success'),
                        })
                      }
                      className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
                      title="Delete"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-2 pt-2 border-t border-slate-100">
                <input
                  type="text"
                  placeholder="Name this search..."
                  value={saveSearchName}
                  onChange={(e) => setSaveSearchName(e.target.value)}
                  className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-md outline-none"
                />
                <button
                  onClick={handleSaveSearch}
                  disabled={createSavedSearch.isPending}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* More filters panel — date range, tags, (manager+) owner */}
      {moreFiltersOpen && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Created from</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Created to</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-md text-sm"
            />
          </div>
          <div className="min-w-[220px]">
            <label className="block text-xs font-medium text-slate-500 mb-1">Tags</label>
            <div className="flex flex-wrap gap-1 mb-1">
              {tagFilters.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-1 bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5 text-xs"
                >
                  {t}
                  <button onClick={() => setTagFilters((prev) => prev.filter((x) => x !== t))}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <input
              type="text"
              placeholder="Type a tag, press Enter"
              value={tagFilterInput}
              onChange={(e) => setTagFilterInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const tag = tagFilterInput.trim();
                if (tag && !tagFilters.includes(tag)) setTagFilters((prev) => [...prev, tag]);
                setTagFilterInput('');
              }}
              className="w-full px-3 py-1.5 border border-slate-200 rounded-md text-sm outline-none"
            />
          </div>
          {canManage && (
            <div className="min-w-[220px]">
              <label className="block text-xs font-medium text-slate-500 mb-1">Owners</label>
              <div className="flex flex-col gap-1 max-h-28 overflow-y-auto border border-slate-200 rounded-md p-2">
                {crmUsers.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ownerFilters.includes(u.id)}
                      onChange={(e) =>
                        setOwnerFilters((prev) =>
                          e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)
                        )
                      }
                    />
                    {u.displayName || u.email}
                  </label>
                ))}
              </div>
            </div>
          )}
          {(dateFrom || dateTo || tagFilters.length > 0 || ownerFilters.length > 0) && (
            <button
              onClick={() => {
                setDateFrom('');
                setDateTo('');
                setTagFilters([]);
                setOwnerFilters([]);
              }}
              className="self-end px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700"
            >
              Clear these filters
            </button>
          )}
        </div>
      )}

      {/* Bulk action bar */}
      {selectionCount > 0 && (
        <div className="flex items-center gap-3 bg-slate-100 border border-slate-200 rounded-lg px-4 py-2">
          <span className="text-sm font-medium text-slate-700">{selectionCount} selected</span>
          <div className="flex-1" />
          <div className="flex gap-2">
            <button
              onClick={() => setBulkActionOpen('status')}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white hover:bg-slate-50 text-slate-700"
            >
              Change journey
            </button>
            {canManage && (
              <>
                <button
                  onClick={() => setBulkActionOpen('tag')}
                  className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white hover:bg-slate-50 text-slate-700"
                >
                  <TagIcon size={14} className="inline mr-1" /> Tag
                </button>
                <button
                  onClick={() => setBulkActionOpen('assign')}
                  className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white hover:bg-slate-50 text-slate-700"
                >
                  <UserCircle size={14} className="inline mr-1" /> Assign
                </button>
              </>
            )}
            {isSuperadmin && (
              <button
                onClick={handleBulkDelete}
                className="px-3 py-1.5 text-sm border border-red-200 rounded-md bg-red-50 hover:bg-red-100 text-red-600"
              >
                <Trash2 size={14} className="inline mr-1" /> Delete
              </button>
            )}
            <button
              onClick={() => setSelectedIds(new Set())}
              className="p-1.5 rounded-md hover:bg-slate-200 text-slate-500"
              title="Clear selection"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Bulk action dropdowns */}
      {bulkActionOpen === 'status' && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
          <span className="text-sm text-blue-700 font-medium">Set journey to:</span>
          <div className="flex flex-wrap gap-2">
            {LEAD_JOURNEY_STAGES.map((s) => (
              <button
                key={s}
                onClick={() => handleBulkUpdateStatus(s)}
                className="px-3 py-1 text-xs border border-slate-300 rounded-md bg-white hover:bg-slate-50 capitalize"
              >
                {journeyLabel(s)}
              </button>
            ))}
          </div>
          <button
            onClick={() => setBulkActionOpen(false)}
            className="p-1 rounded hover:bg-blue-100 text-blue-600"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {bulkActionOpen === 'tag' && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">
          <span className="text-sm text-emerald-700 font-medium">Add tags (comma-separated):</span>
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleBulkTag();
            }}
            placeholder="e.g. vip, warm-lead"
            className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white outline-none"
          />
          <button
            onClick={handleBulkTag}
            disabled={bulkMutation.isPending}
            className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
          >
            Apply
          </button>
          <button
            onClick={() => setBulkActionOpen(false)}
            className="p-1 rounded hover:bg-emerald-100 text-emerald-600"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {bulkActionOpen === 'assign' && (
        <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2">
          <span className="text-sm text-indigo-700 font-medium">Assign to:</span>
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
          >
            <option value="">Select user...</option>
            {crmUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName || u.email}
              </option>
            ))}
          </select>
          <button
            onClick={handleBulkAssign}
            disabled={bulkMutation.isPending}
            className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            Assign
          </button>
          <button
            onClick={() => setBulkActionOpen(false)}
            className="p-1 rounded hover:bg-indigo-100 text-indigo-600"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-2 py-3 w-10">
                  <button
                    onClick={toggleSelectAll}
                    className="p-1 rounded hover:bg-slate-200 text-slate-500"
                    title={allSelected ? 'Deselect all' : 'Select all'}
                  >
                    {allSelected ? (
                      <SquareCheck size={18} />
                    ) : someSelected ? (
                      <SquareCheck size={18} className="text-blue-600" />
                    ) : (
                      <Square size={18} />
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium text-slate-600">
                  <div className="flex items-center gap-3 whitespace-nowrap">
                    {[
                      { column: 'name', label: 'Name' },
                      { column: 'journeyStage', label: 'Journey' },
                    ].map((heading) => (
                      <button
                        key={heading.column}
                        type="button"
                        onClick={() => toggleSort(heading.column)}
                        className="flex items-center gap-1 hover:text-slate-900"
                      >
                        {heading.label}
                        {sortBy === heading.column ? (
                          sortOrder === 'asc' ? (
                            <ArrowUp size={14} />
                          ) : (
                            <ArrowDown size={14} />
                          )
                        ) : (
                          <ArrowUpDown size={14} className="text-slate-300" />
                        )}
                      </button>
                    ))}
                  </div>
                </th>
                <SortableHeader
                  column="leadNumber"
                  label="Lead #"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={toggleSort}
                />
                <SortableHeader
                  column="score"
                  label="AI score"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={toggleSort}
                />
                <SortableHeader
                  column="tags"
                  label="Tags"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={toggleSort}
                />
                <SortableHeader
                  column="email"
                  label="Email"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={toggleSort}
                />
                <SortableHeader
                  column="linkedinUrl"
                  label="LinkedIn"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={toggleSort}
                />
                <SortableHeader
                  column="source"
                  label="Source"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={toggleSort}
                />
                <SortableHeader
                  column="ownerId"
                  label="Owner"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={toggleSort}
                />
                <SortableHeader
                  column="createdAt"
                  label="Created"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={toggleSort}
                />
                <th className="text-right px-4 py-3 font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr
                  key={lead.id}
                  className={cn(
                    'border-b border-slate-100 hover:bg-slate-50 cursor-pointer',
                    selectedIds.has(lead.id) && 'bg-blue-50'
                  )}
                  onClick={() => navigate(`/leads/${lead.id}`)}
                >
                  <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => toggleSelectRow(lead.id)}
                      className="p-1 rounded hover:bg-slate-200 text-slate-500"
                    >
                      {selectedIds.has(lead.id) ? (
                        <SquareCheck size={18} className="text-blue-600" />
                      ) : (
                        <Square size={18} />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 min-w-64">
                    <div className="flex items-center gap-2">
                      <div className="font-medium whitespace-nowrap">
                        {lead.firstName} {lead.lastName}
                      </div>
                      <select
                        value={journeyOverrides[lead.id] ?? lead.journeyStage}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          event.stopPropagation();
                          updateJourneyInline(lead, event.target.value as LeadJourneyStage);
                        }}
                        className={cn(
                          'max-w-40 rounded-md border-0 px-2 py-1 text-xs font-medium outline-none ring-1 ring-inset ring-slate-200',
                          journeyBadgeClass(journeyOverrides[lead.id] ?? lead.journeyStage)
                        )}
                        aria-label={`Update journey for ${lead.firstName} ${lead.lastName}`}
                      >
                        {LEAD_JOURNEY_STAGES.map((stage) => (
                          <option key={stage} value={stage}>
                            {journeyLabel(stage)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {lead.leadNumber ? (
                      <span className="font-mono text-xs text-slate-500">{lead.leadNumber}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {lead.aiScore != null ? (
                      <div
                        className="inline-flex min-w-12 items-center justify-center rounded-full bg-violet-100 px-2 py-1 text-xs font-bold text-violet-700"
                        title={lead.aiClassification ?? 'AI lead score'}
                      >
                        {lead.aiScore}/100
                      </div>
                    ) : lead.scoreJobStatus === 'processing' ? (
                      <span className="inline-flex items-center gap-1 text-xs text-blue-600">
                        <Loader2 size={13} className="animate-spin" /> Scoring
                      </span>
                    ) : lead.scoreJobStatus === 'failed' ? (
                      <span className="text-xs font-medium text-amber-600">Retry queued</span>
                    ) : lead.profileNormalizationStatus === 'processing' ||
                      lead.profileNormalizationStatus === 'pending' ? (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <Loader2 size={13} className="animate-spin" /> Profile cleanup
                      </span>
                    ) : lead.profileNormalizationStatus !== 'completed' ? (
                      <span className="text-xs text-slate-400">Capture needed</span>
                    ) : (
                      <span className="text-xs text-slate-400">Awaiting score</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {lead.tags && lead.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {lead.tags.slice(0, 2).map((tag, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs font-medium"
                          >
                            {tag}
                          </span>
                        ))}
                        {lead.tags.length > 2 && (
                          <span className="px-1.5 py-0.5 bg-slate-50 text-slate-400 rounded-full text-xs">
                            +{lead.tags.length - 2}
                          </span>
                        )}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {!lead.email || lead.email.includes('@placeholder.skarion') ? '—' : lead.email}
                  </td>
                  <td className="px-4 py-3">
                    {lead.linkedinUrl ? (
                      <a
                        href={lead.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        <Linkedin size={16} />
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 capitalize">
                    {lead.source.replace(/_/g, ' ')}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {canManage
                      ? crmUsers.find((u) => u.id === lead.ownerId)?.displayName || '—'
                      : lead.ownerId === currentUserId
                        ? 'Me'
                        : 'Team member'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                    <CandidateCreatedAt createdAt={lead.createdAt} location={lead.location} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(lead);
                        }}
                        className="p-1.5 rounded hover:bg-slate-200 text-slate-500"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/leads/${lead.id}`);
                        }}
                        className="p-1.5 rounded hover:bg-slate-200 text-slate-500"
                      >
                        <ArrowRight size={14} />
                      </button>
                      {isSuperadmin && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              window.confirm(
                                'Are you sure you want to delete this lead? This action cannot be undone.'
                              )
                            ) {
                              deleteMutation.mutate(
                                { type: 'leads', id: lead.id },
                                { onSuccess: () => showToast('Lead deleted', 'success') }
                              );
                            }
                          }}
                          className="p-1.5 rounded hover:bg-red-100 text-red-500"
                          title="Delete lead (superadmin only)"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-slate-400">
                    No leads found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bounded server-side pagination. Nothing auto-fetches on scroll. */}
      <div className="flex flex-wrap items-center justify-between gap-3 py-2">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span>
            Showing {firstVisible}–{lastVisible} of {total}
          </span>
          {isFetching && !isLoading && (
            <span className="inline-flex items-center gap-1 text-blue-600">
              <Loader2 size={14} className="animate-spin" /> Updating
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-500">
            Rows
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-700"
            >
              {[50, 100, 250, 500].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setPage(1)}
            disabled={page <= 1}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
          >
            First
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
          >
            Previous
          </button>
          <div className="flex items-center gap-1" aria-label="Lead result pages">
            {pageNumbers.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => setPage(pageNumber)}
                aria-current={pageNumber === page ? 'page' : undefined}
                className={cn(
                  'min-w-8 rounded-md border px-2 py-1.5 text-sm',
                  pageNumber === page
                    ? 'border-blue-600 bg-blue-600 font-semibold text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                )}
              >
                {pageNumber}
              </button>
            ))}
          </div>
          <span className="text-sm text-slate-500">of {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={totalPages === 0 || page >= totalPages}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
          >
            Next
          </button>
          <button
            type="button"
            onClick={() => setPage(totalPages)}
            disabled={totalPages === 0 || page >= totalPages}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
          >
            Last
          </button>
        </div>
      </div>

      <LeadForm open={modalOpen} onClose={closeModal} lead={editLead} />
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        type="leads"
        title="Leads"
        sampleCsv={`firstName,lastName,email,phone,companyName,companyDomain,linkedinUrl,title,source,status,notes
John,Doe,john@acme.com,+1-555-1234,Acme Inc,acme.com,https://linkedin.com/in/johndoe,Manager,website,new,Interested in OSP support
Jane,Smith,jane@globex.org,+1-555-5678,Globex Corp,globex.org,https://linkedin.com/in/janesmith,Director,referral,contacted,Referred by Bob`}
      />
      <PdfImportModal open={pdfImportOpen} onClose={() => setPdfImportOpen(false)} />
    </div>
  );
}
