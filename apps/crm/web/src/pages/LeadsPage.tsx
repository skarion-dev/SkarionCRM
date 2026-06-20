import { useState } from 'react';
import { useLeads, useDeleteEntity } from '../hooks/use-api.js';
import { useNavigate } from 'react-router-dom';
import { Target, Plus, Search, Trash2, ArrowRight, Pencil, Upload } from 'lucide-react';
import { cn } from '../lib/utils.js';
import LeadForm from '../components/forms/LeadForm.js';
import ImportModal from '../components/ImportModal.js';
import type { Lead } from '../api.js';

export default function LeadsPage() {
  const { data, isLoading } = useLeads();
  const deleteMutation = useDeleteEntity();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | LeadStatus>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);

  const openCreate = () => { setEditLead(null); setModalOpen(true); };
  const openEdit = (lead: Lead) => { setEditLead(lead); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setEditLead(null); };

  const leads = data?.leads.filter((l) => !l.deletedAt) ?? [];
  const filtered = leads.filter((l) => {
    const matchesSearch = !search || l.email.toLowerCase().includes(search.toLowerCase()) ||
      `${l.firstName} ${l.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
      (l.companyName ?? '').toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'all' || l.status === filter;
    return matchesSearch && matchesFilter;
  });

  const statusCounts = {
    new: leads.filter(l => l.status === 'new').length,
    contacted: leads.filter(l => l.status === 'contacted').length,
    qualified: leads.filter(l => l.status === 'qualified').length,
    disqualified: leads.filter(l => l.status === 'disqualified').length,
    converted: leads.filter(l => l.status === 'converted').length,
  };

  if (isLoading) return <div className="text-slate-500">Loading leads...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target size={20} className="text-slate-600" />
          <h1 className="text-xl font-semibold">Leads</h1>
          <span className="text-sm text-slate-500">({filtered.length})</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setImportOpen(true)} className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-md text-sm hover:bg-slate-50 text-slate-600">
            <Upload size={16} /> Import
          </button>
          <button onClick={openCreate} className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700">
            <Plus size={16} /> Add Lead
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter('all')}
          className={cn('px-3 py-1.5 rounded-md text-sm border', filter === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 hover:bg-slate-50')}
        >
          All ({leads.length})
        </button>
        {(Object.keys(statusCounts) as LeadStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn('px-3 py-1.5 rounded-md text-sm border capitalize', filter === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 hover:bg-slate-50')}
          >
            {s} ({statusCounts[s]})
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-md px-3 py-2">
        <Search size={16} className="text-slate-400" />
        <input
          type="text"
          placeholder="Search leads..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 text-sm outline-none"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Company</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Source</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => (
                <tr key={lead.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/leads/${lead.id}`)}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{lead.firstName} {lead.lastName}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{lead.companyName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{lead.email}</td>
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
                  <td className="px-4 py-3 text-slate-600 capitalize">{lead.source.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(lead); }}
                        className="p-1.5 rounded hover:bg-slate-200 text-slate-500"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/leads/${lead.id}`); }}
                        className="p-1.5 rounded hover:bg-slate-200 text-slate-500"
                      >
                        <ArrowRight size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteMutation.mutate({ type: 'leads', id: lead.id }); }}
                        className="p-1.5 rounded hover:bg-red-100 text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No leads found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <LeadForm open={modalOpen} onClose={closeModal} lead={editLead} />
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        type="leads"
        title="Leads"
        sampleCsv={`firstName,lastName,email,phone,companyName,companyDomain,source
John,Doe,john@acme.com,+1-555-1234,Acme Inc,acme.com,website
Jane,Smith,jane@globex.org,+1-555-5678,Globex Corp,globex.org,referral`}
      />
    </div>
  );
}

type LeadStatus = 'new' | 'contacted' | 'qualified' | 'disqualified' | 'converted';
