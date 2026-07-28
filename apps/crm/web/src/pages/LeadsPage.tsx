import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  useInfiniteLeads,
  useDeleteEntity,
  useBulkLeads,
  useImportBatches,
  useIdentityUsers,
  useSavedSearches,
  useCreateSavedSearch,
  useDeleteSavedSearch,
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
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import LeadForm from '../components/forms/LeadForm.js';
import ImportModal from '../components/ImportModal.js';
import PdfImportModal from '../components/PdfImportModal.js';
import type { Lead, LeadStatus, OutreachStatus } from '../api.js';
import { CRM_API_URL, getAccessToken } from '../api.js';
import { showToast } from '../stores/toast.js';
import { buildLeadsQueryString, type LeadFilters } from '../lib/leadFilters.js';

const LEAD_STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'disqualified', 'converted'];
const OUTREACH_STATUSES: OutreachStatus[] = [
  'not_approached',
  'approached',
  'connection_request_sent',
  'in_conversation',
  'connected',
  'replied',
  'booked_call',
  'not_interested',
  'bad_fit',
];

export default function LeadsPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | LeadStatus>('all');
  const [outreachFilter, setOutreachFilter] = useState<'all' | OutreachStatus>('all');
  const [sortBy, setSortBy] = useState<string>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionOpen, setBulkActionOpen] = useState<
    false | 'status' | 'outreach' | 'tag' | 'assign'
  >(false);
  const [tagInput, setTagInput] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [batchFilter, setBatchFilter] = useState<'all' | string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pdfImportOpen, setPdfImportOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);

  // Additive "More filters" — date range, tag, and (superadmin/manager-only)
  // owner multi-select. Kept separate from the single-select status/outreach
  // pill rows above so those stay the fast, unchanged common path.
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
  const canManage = isSuperadmin || role === 'manager';

  const filters: LeadFilters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      statuses: statusFilter === 'all' ? undefined : [statusFilter],
      outreachStatuses: outreachFilter === 'all' ? undefined : [outreachFilter],
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
      outreachFilter,
      ownerFilters,
      tagFilters,
      batchFilter,
      dateFrom,
      dateTo,
      sortBy,
      sortOrder,
    ]
  );

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteLeads(filters);
  const deleteMutation = useDeleteEntity();
  const bulkMutation = useBulkLeads();
  const { data: batches } = useImportBatches();
  const { data: identityUsers } = useIdentityUsers(canManage);
  const { data: savedSearchesData } = useSavedSearches();
  const createSavedSearch = useCreateSavedSearch();
  const deleteSavedSearch = useDeleteSavedSearch();
  const navigate = useNavigate();
  const crmUsers = (identityUsers ?? []).filter((u) =>
    u.appMemberships?.some((m) => m.app === 'crm')
  );
  const savedSearches = savedSearchesData?.savedSearches ?? [];

  const leads = useMemo(() => data?.pages.flatMap((p) => p.leads) ?? [], [data]);
  const firstPage = data?.pages[0];
  const total = firstPage?.total ?? 0;
  const loadedCount = leads.length;
  const statusCounts = firstPage?.statusCounts ?? {
    new: 0,
    contacted: 0,
    qualified: 0,
    disqualified: 0,
    converted: 0,
  };
  const outreachStatusCounts = firstPage?.outreachStatusCounts ?? {
    not_approached: 0,
    approached: 0,
    connection_request_sent: 0,
    in_conversation: 0,
    connected: 0,
    replied: 0,
    booked_call: 0,
    not_interested: 0,
    bad_fit: 0,
  };

  // Reset selection whenever the filtered/sorted set changes — the old
  // accumulated selection wouldn't make sense against a different result set.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filters]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Auto-load more when the sentinel below the table scrolls into view.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const fetchNextPageRef = useRef(fetchNextPage);
  fetchNextPageRef.current = fetchNextPage;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchNextPageRef.current();
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage]);

  const applySavedSearch = useCallback((saved: LeadFilters) => {
    setSearch(saved.search ?? '');
    setDebouncedSearch(saved.search ?? '');
    setStatusFilter((saved.statuses?.[0] as LeadStatus | undefined) ?? 'all');
    setOutreachFilter((saved.outreachStatuses?.[0] as OutreachStatus | undefined) ?? 'all');
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
      setSortOrder('asc');
    }
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
      { ids: Array.from(selectedIds), action: 'update_status', status },
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

  const handleBulkUpdateOutreach = (outreachStatus: string) => {
    bulkMutation.mutate(
      { ids: Array.from(selectedIds), action: 'update_outreach_status', outreachStatus },
      {
        onSuccess: (res) => {
          showToast(
            `${res.processed} leads updated to ${outreachStatus.replace(/_/g, ' ')}`,
            'success'
          );
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
          All ({total})
        </button>
        {(Object.keys(statusCounts) as LeadStatus[]).map((s) => (
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
            {s} ({statusCounts[s] || 0})
          </button>
        ))}
      </div>

      {/* Outreach filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setOutreachFilter('all')}
          className={cn(
            'px-3 py-1.5 rounded-md text-sm border',
            outreachFilter === 'all'
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white border-slate-200 hover:bg-slate-50'
          )}
        >
          All Outreach
        </button>
        {(Object.keys(outreachStatusCounts) as OutreachStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setOutreachFilter(s)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm border capitalize',
              outreachFilter === s
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white border-slate-200 hover:bg-slate-50'
            )}
          >
            {s.replace(/_/g, ' ')} ({outreachStatusCounts[s] || 0})
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
              Change Status
            </button>
            <button
              onClick={() => setBulkActionOpen('outreach')}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white hover:bg-slate-50 text-slate-700"
            >
              Change Outreach
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
            <button
              onClick={handleBulkDelete}
              className="px-3 py-1.5 text-sm border border-red-200 rounded-md bg-red-50 hover:bg-red-100 text-red-600"
            >
              <Trash2 size={14} className="inline mr-1" /> Delete
            </button>
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
          <span className="text-sm text-blue-700 font-medium">Set status to:</span>
          {LEAD_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => handleBulkUpdateStatus(s)}
              className="px-3 py-1 text-xs border border-slate-300 rounded-md bg-white hover:bg-slate-50 capitalize"
            >
              {s}
            </button>
          ))}
          <button
            onClick={() => setBulkActionOpen(false)}
            className="p-1 rounded hover:bg-blue-100 text-blue-600"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {bulkActionOpen === 'outreach' && (
        <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-lg px-4 py-2">
          <span className="text-sm text-purple-700 font-medium">Set outreach to:</span>
          {OUTREACH_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => handleBulkUpdateOutreach(s)}
              className="px-3 py-1 text-xs border border-slate-300 rounded-md bg-white hover:bg-slate-50 capitalize"
            >
              {s.replace(/_/g, ' ')}
            </button>
          ))}
          <button
            onClick={() => setBulkActionOpen(false)}
            className="p-1 rounded hover:bg-purple-100 text-purple-600"
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
                <th
                  className="text-left px-4 py-3 font-medium text-slate-600 cursor-pointer select-none hover:bg-slate-100"
                  onClick={() => toggleSort('firstName')}
                >
                  <div className="flex items-center gap-1">
                    Name{' '}
                    {sortBy === 'firstName' ? (
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
                <th className="text-left px-4 py-3 font-medium text-slate-600">Lead #</th>
                <th
                  className="text-left px-4 py-3 font-medium text-slate-600 cursor-pointer select-none hover:bg-slate-100"
                  onClick={() => toggleSort('companyName')}
                >
                  <div className="flex items-center gap-1">
                    Company{' '}
                    {sortBy === 'companyName' ? (
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
                <th
                  className="text-left px-4 py-3 font-medium text-slate-600 cursor-pointer select-none hover:bg-slate-100"
                  onClick={() => toggleSort('email')}
                >
                  <div className="flex items-center gap-1">
                    Email{' '}
                    {sortBy === 'email' ? (
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
                <th className="text-left px-4 py-3 font-medium text-slate-600">LinkedIn</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Tags</th>
                <th
                  className="text-left px-4 py-3 font-medium text-slate-600 cursor-pointer select-none hover:bg-slate-100"
                  onClick={() => toggleSort('outreachStatus')}
                >
                  <div className="flex items-center gap-1">
                    Outreach{' '}
                    {sortBy === 'outreachStatus' ? (
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
                <th
                  className="text-left px-4 py-3 font-medium text-slate-600 cursor-pointer select-none hover:bg-slate-100"
                  onClick={() => toggleSort('status')}
                >
                  <div className="flex items-center gap-1">
                    Status{' '}
                    {sortBy === 'status' ? (
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
                <th className="text-left px-4 py-3 font-medium text-slate-600">Owner</th>
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
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {lead.firstName} {lead.lastName}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {lead.leadNumber ? (
                      <span className="font-mono text-xs text-slate-500">{lead.leadNumber}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{lead.companyName ?? '—'}</td>
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
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded text-xs font-medium',
                        lead.outreachStatus === 'not_approached'
                          ? 'bg-slate-100 text-slate-600'
                          : lead.outreachStatus === 'approached'
                            ? 'bg-amber-100 text-amber-700'
                            : lead.outreachStatus === 'connection_request_sent'
                              ? 'bg-amber-100 text-amber-700'
                              : lead.outreachStatus === 'in_conversation'
                                ? 'bg-teal-100 text-teal-700'
                                : lead.outreachStatus === 'connected'
                                  ? 'bg-blue-100 text-blue-700'
                                  : lead.outreachStatus === 'replied'
                                    ? 'bg-green-100 text-green-700'
                                    : lead.outreachStatus === 'booked_call'
                                      ? 'bg-purple-100 text-purple-700'
                                      : 'bg-slate-100 text-slate-600'
                      )}
                    >
                      {lead.outreachStatus?.replace(/_/g, ' ') ?? 'not approached'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded text-xs font-medium',
                        lead.status === 'new'
                          ? 'bg-blue-100 text-blue-700'
                          : lead.status === 'contacted'
                            ? 'bg-amber-100 text-amber-700'
                            : lead.status === 'qualified'
                              ? 'bg-green-100 text-green-700'
                              : lead.status === 'converted'
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-slate-100 text-slate-600'
                      )}
                    >
                      {lead.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {canManage
                      ? crmUsers.find((u) => u.id === lead.ownerId)?.displayName || '—'
                      : 'Me'}
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
                      >
                        <Trash2 size={14} />
                      </button>
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

      {/* Incremental loading — accumulates rows instead of paging through them */}
      <div className="flex flex-col items-center gap-2 py-2">
        <div className="text-sm text-slate-500">
          Showing {loadedCount} of {total}
        </div>
        {hasNextPage && (
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-md text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Loading...
              </>
            ) : (
              'Load more'
            )}
          </button>
        )}
        {/* Scrolling this into view auto-triggers the same fetch as the button above */}
        <div ref={sentinelRef} className="h-1 w-full" />
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
