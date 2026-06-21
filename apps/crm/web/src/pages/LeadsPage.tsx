import { useState, useEffect } from 'react';
import { useLeads, useDeleteEntity, useBulkLeads } from '../hooks/use-api.js';
import { useNavigate } from 'react-router-dom';
import { Target, Plus, Search, Trash2, ArrowRight, Pencil, Upload, Linkedin, ChevronLeft, ChevronRight, Download, ArrowUpDown, ArrowUp, ArrowDown, Square, SquareCheck, X } from 'lucide-react';
import { cn } from '../lib/utils.js';
import LeadForm from '../components/forms/LeadForm.js';
import ImportModal from '../components/ImportModal.js';
import type { Lead, LeadStatus, OutreachStatus } from '../api.js';
import { CRM_API_URL, getAccessToken } from '../api.js';
import { showToast } from '../stores/toast.js';

const PAGE_SIZES = [25, 50, 100, 250];
const LEAD_STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'disqualified', 'converted'];
const OUTREACH_STATUSES: OutreachStatus[] = ['not_approached', 'approached', 'connected', 'replied', 'booked_call', 'not_interested', 'bad_fit'];

export default function LeadsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | LeadStatus>('all');
  const [outreachFilter, setOutreachFilter] = useState<'all' | OutreachStatus>('all');
  const [sortBy, setSortBy] = useState<string>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionOpen, setBulkActionOpen] = useState<false | 'status' | 'outreach'>(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);

  const { data, isLoading } = useLeads(
    page,
    pageSize,
    statusFilter === 'all' ? undefined : statusFilter,
    debouncedSearch || undefined,
    outreachFilter === 'all' ? undefined : outreachFilter,
    sortBy,
    sortOrder
  );
  const deleteMutation = useDeleteEntity();
  const bulkMutation = useBulkLeads();
  const navigate = useNavigate();

  const leads = data?.leads ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const statusCounts = data?.statusCounts ?? { new: 0, contacted: 0, qualified: 0, disqualified: 0, converted: 0 };
  const outreachStatusCounts = data?.outreachStatusCounts ?? { not_approached: 0, approached: 0, connected: 0, replied: 0, booked_call: 0, not_interested: 0, bad_fit: 0 };

  // Reset selection when page/filter changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, statusFilter, outreachFilter, debouncedSearch, pageSize, sortBy, sortOrder]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset to page 1 when filter, search, or sort changes
  useEffect(() => {
    setPage(1);
  }, [statusFilter, outreachFilter, debouncedSearch, pageSize, sortBy, sortOrder]);

  const toggleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  const openCreate = () => { setEditLead(null); setModalOpen(true); };
  const openEdit = (lead: Lead) => { setEditLead(lead); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setEditLead(null); };

  const handleExport = async () => {
    const qs = new URLSearchParams();
    if (statusFilter !== 'all') qs.append('status', statusFilter);
    if (outreachFilter !== 'all') qs.append('outreachStatus', outreachFilter);
    if (debouncedSearch) qs.append('search', debouncedSearch);
    const url = `${CRM_API_URL}/api/leads/export.csv?${qs.toString()}`;
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
    if (!window.confirm(`Are you sure you want to delete ${selectionCount} leads? This action cannot be undone.`)) return;
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
          showToast(`${res.processed} leads updated to ${outreachStatus.replace(/_/g, ' ')}`, 'success');
          setSelectedIds(new Set());
          setBulkActionOpen(false);
        },
        onError: () => showToast('Bulk update failed', 'error'),
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
          <button onClick={handleExport} className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-md text-sm hover:bg-slate-50 text-slate-600">
            <Download size={16} /> Export CSV
          </button>
          <button onClick={() => setImportOpen(true)} className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-md text-sm hover:bg-slate-50 text-slate-600">
            <Upload size={16} /> CSV Import
          </button>
          <button onClick={openCreate} className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700">
            <Plus size={16} /> Add Lead
          </button>
        </div>
      </div>

      {/* Status filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setStatusFilter('all')}
          className={cn('px-3 py-1.5 rounded-md text-sm border', statusFilter === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 hover:bg-slate-50')}
        >
          All ({total})
        </button>
        {(Object.keys(statusCounts) as LeadStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn('px-3 py-1.5 rounded-md text-sm border capitalize', statusFilter === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 hover:bg-slate-50')}
          >
            {s} ({statusCounts[s] || 0})
          </button>
        ))}
      </div>

      {/* Outreach filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setOutreachFilter('all')}
          className={cn('px-3 py-1.5 rounded-md text-sm border', outreachFilter === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 hover:bg-slate-50')}
        >
          All Outreach
        </button>
        {(Object.keys(outreachStatusCounts) as OutreachStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setOutreachFilter(s)}
            className={cn('px-3 py-1.5 rounded-md text-sm border capitalize', outreachFilter === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 hover:bg-slate-50')}
          >
            {s.replace(/_/g, ' ')} ({outreachStatusCounts[s] || 0})
          </button>
        ))}
      </div>

      {/* Search and page size */}
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
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="px-3 py-2 border border-slate-200 rounded-md text-sm bg-white"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>{size} / page</option>
          ))}
        </select>
      </div>

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
          <button onClick={() => setBulkActionOpen(false)} className="p-1 rounded hover:bg-blue-100 text-blue-600">
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
          <button onClick={() => setBulkActionOpen(false)} className="p-1 rounded hover:bg-purple-100 text-purple-600">
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
                    {allSelected ? <SquareCheck size={18} /> : someSelected ? <SquareCheck size={18} className="text-blue-600" /> : <Square size={18} />}
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 cursor-pointer select-none hover:bg-slate-100" onClick={() => toggleSort('firstName')}>
                  <div className="flex items-center gap-1">Name {sortBy === 'firstName' ? (sortOrder === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} className="text-slate-300" />}</div>
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 cursor-pointer select-none hover:bg-slate-100" onClick={() => toggleSort('companyName')}>
                  <div className="flex items-center gap-1">Company {sortBy === 'companyName' ? (sortOrder === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} className="text-slate-300" />}</div>
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 cursor-pointer select-none hover:bg-slate-100" onClick={() => toggleSort('email')}>
                  <div className="flex items-center gap-1">Email {sortBy === 'email' ? (sortOrder === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} className="text-slate-300" />}</div>
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">LinkedIn</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 cursor-pointer select-none hover:bg-slate-100" onClick={() => toggleSort('outreachStatus')}>
                  <div className="flex items-center gap-1">Outreach {sortBy === 'outreachStatus' ? (sortOrder === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} className="text-slate-300" />}</div>
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 cursor-pointer select-none hover:bg-slate-100" onClick={() => toggleSort('status')}>
                  <div className="flex items-center gap-1">Status {sortBy === 'status' ? (sortOrder === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} className="text-slate-300" />}</div>
                </th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className={cn("border-b border-slate-100 hover:bg-slate-50 cursor-pointer", selectedIds.has(lead.id) && "bg-blue-50")} onClick={() => navigate(`/leads/${lead.id}`)}>
                  <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => toggleSelectRow(lead.id)}
                      className="p-1 rounded hover:bg-slate-200 text-slate-500"
                    >
                      {selectedIds.has(lead.id) ? <SquareCheck size={18} className="text-blue-600" /> : <Square size={18} />}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{lead.firstName} {lead.lastName}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{lead.companyName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{lead.email.includes('@placeholder.skarion') ? '—' : lead.email}</td>
                  <td className="px-4 py-3">
                    {lead.linkedinUrl ? (
                      <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-600 hover:text-blue-800">
                        <Linkedin size={16} />
                      </a>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded text-xs font-medium',
                      lead.outreachStatus === 'not_approached' ? 'bg-slate-100 text-slate-600' :
                      lead.outreachStatus === 'approached' ? 'bg-amber-100 text-amber-700' :
                      lead.outreachStatus === 'connected' ? 'bg-blue-100 text-blue-700' :
                      lead.outreachStatus === 'replied' ? 'bg-green-100 text-green-700' :
                      lead.outreachStatus === 'booked_call' ? 'bg-purple-100 text-purple-700' :
                      'bg-slate-100 text-slate-600'
                    )}>
                      {lead.outreachStatus?.replace(/_/g, ' ') ?? 'not approached'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded text-xs font-medium',
                      lead.status === 'new' ? 'bg-blue-100 text-blue-700' :
                      lead.status === 'contacted' ? 'bg-amber-100 text-amber-700' :
                      lead.status === 'qualified' ? 'bg-green-100 text-green-700' :
                      lead.status === 'converted' ? 'bg-purple-100 text-purple-700' :
                      'bg-slate-100 text-slate-600'
                    )}>
                      {lead.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={(e) => { e.stopPropagation(); openEdit(lead); }} className="p-1.5 rounded hover:bg-slate-200 text-slate-500">
                        <Pencil size={14} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); navigate(`/leads/${lead.id}`); }} className="p-1.5 rounded hover:bg-slate-200 text-slate-500">
                        <ArrowRight size={14} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); if (window.confirm('Are you sure you want to delete this lead? This action cannot be undone.')) { deleteMutation.mutate({ type: 'leads', id: lead.id }, { onSuccess: () => showToast('Lead deleted', 'success') }); } }} className="p-1.5 rounded hover:bg-red-100 text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">No leads found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2">
          <div className="text-sm text-slate-500">
            Page {page} of {totalPages} ({total} total)
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 border border-slate-200 rounded-md text-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 border border-slate-200 rounded-md text-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

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
    </div>
  );
}
