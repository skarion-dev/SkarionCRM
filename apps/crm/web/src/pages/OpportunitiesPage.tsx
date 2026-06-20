import { useState } from 'react';
import { useOpportunities, useDeleteEntity } from '../hooks/use-api.js';
import { Users, Plus, Search, Trash2, Pencil, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils.js';
import OpportunityForm from '../components/forms/OpportunityForm.js';
import type { Opportunity } from '../api.js';

export default function OpportunitiesPage() {
  const { data, isLoading } = useOpportunities();
  const deleteMutation = useDeleteEntity();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editOpp, setEditOpp] = useState<Opportunity | null>(null);

  const openCreate = () => { setEditOpp(null); setModalOpen(true); };
  const openEdit = (opp: Opportunity) => { setEditOpp(opp); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setEditOpp(null); };

  const opportunities = data?.opportunities.filter((o) => !o.deletedAt) ?? [];
  const stages = [...new Set(opportunities.map((o) => o.stage))];

  const filtered = opportunities.filter((o) => {
    const matchesSearch = !search || o.name.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'all' || o.stage === filter;
    return matchesSearch && matchesFilter;
  });

  const totalValue = filtered.reduce((s, o) => s + (parseFloat(o.amount ?? '0') || 0), 0);

  if (isLoading) return <div className="text-slate-500">Loading opportunities...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={20} className="text-slate-600" />
          <h1 className="text-xl font-semibold">Opportunities</h1>
          <span className="text-sm text-slate-500">({filtered.length})</span>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700">
          <Plus size={16} /> Add Opportunity
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter('all')}
          className={cn('px-3 py-1.5 rounded-md text-sm border', filter === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 hover:bg-slate-50')}
        >
          All
        </button>
        {stages.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn('px-3 py-1.5 rounded-md text-sm border capitalize', filter === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 hover:bg-slate-50')}
          >
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-md px-3 py-2">
        <Search size={16} className="text-slate-400" />
        <input
          type="text"
          placeholder="Search opportunities..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 text-sm outline-none"
        />
        <div className="text-sm font-medium text-slate-600">
          Pipeline: ${(totalValue / 1000).toFixed(1)}k
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Stage</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Expected Close</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Probability</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((opp) => (
                <tr
                  key={opp.id}
                  className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => navigate(`/opportunities/${opp.id}`)}
                >
                  <td className="px-4 py-3 font-medium">{opp.name}</td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded text-xs font-medium capitalize',
                      opp.stage === 'prospecting' ? 'bg-slate-100 text-slate-600' :
                      opp.stage === 'qualification' ? 'bg-blue-100 text-blue-700' :
                      opp.stage === 'proposal' ? 'bg-amber-100 text-amber-700' :
                      opp.stage === 'negotiation' ? 'bg-purple-100 text-purple-700' :
                      opp.stage === 'closed_won' ? 'bg-green-100 text-green-700' :
                      'bg-red-100 text-red-700'
                    )}>
                      {opp.stage.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{opp.amount ? `$${parseFloat(opp.amount).toLocaleString()}` : '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{opp.expectedCloseDate ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{opp.probability ? `${opp.probability}%` : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(opp); }}
                        className="p-1.5 rounded hover:bg-slate-200 text-slate-500"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/opportunities/${opp.id}`); }}
                        className="p-1.5 rounded hover:bg-slate-200 text-slate-500"
                      >
                        <ArrowRight size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteMutation.mutate({ type: 'opportunities', id: opp.id }); }}
                        className="p-1.5 rounded hover:bg-red-100 text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No opportunities found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <OpportunityForm open={modalOpen} onClose={closeModal} opportunity={editOpp} />
    </div>
  );
}
