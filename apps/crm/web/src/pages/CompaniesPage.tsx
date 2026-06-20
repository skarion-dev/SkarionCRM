import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCompanies, useDeleteEntity } from '../hooks/use-api.js';
import { Building2, Plus, Search, Trash2, Pencil } from 'lucide-react';
import CompanyForm from '../components/forms/CompanyForm.js';
import type { Company } from '../api.js';

export default function CompaniesPage() {
  const { data, isLoading } = useCompanies();
  const deleteMutation = useDeleteEntity();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editCompany, setEditCompany] = useState<Company | null>(null);

  const openCreate = () => { setEditCompany(null); setModalOpen(true); };
  const openEdit = (company: Company) => { setEditCompany(company); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setEditCompany(null); };

  const companies = data?.companies.filter((c) => !c.deletedAt) ?? [];
  const filtered = companies.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.domain ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (c.industry ?? '').toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) return <div className="text-slate-500">Loading companies...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 size={20} className="text-slate-600" />
          <h1 className="text-xl font-semibold">Companies</h1>
          <span className="text-sm text-slate-500">({filtered.length})</span>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700">
          <Plus size={16} /> Add Company
        </button>
      </div>

      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-md px-3 py-2">
        <Search size={16} className="text-slate-400" />
        <input
          type="text"
          placeholder="Search companies..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 text-sm outline-none"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((company) => (
          <div
            key={company.id}
            className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-sm transition-shadow cursor-pointer"
            onClick={() => navigate(`/companies/${company.id}`)}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold">{company.name}</h3>
                <div className="text-sm text-slate-500 mt-1">{company.domain ?? '—'}</div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(company); }}
                  className="p-1.5 rounded hover:bg-slate-200 text-slate-500"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteMutation.mutate({ type: 'companies', id: company.id }); }}
                  className="p-1.5 rounded hover:bg-red-100 text-red-500"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              {company.industry && (
                <span className="px-2 py-0.5 bg-slate-100 rounded text-xs text-slate-600">{company.industry}</span>
              )}
              {company.size && (
                <span className="px-2 py-0.5 bg-slate-100 rounded text-xs text-slate-600">{company.size}</span>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full text-center text-slate-400 py-12">No companies found</div>
        )}
      </div>

      <CompanyForm open={modalOpen} onClose={closeModal} company={editCompany} />
    </div>
  );
}
