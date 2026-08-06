import { useNavigate, useParams } from 'react-router-dom';
import { useCompany, useCompanyPeopleByCompany, useDeleteEntity, useResearchCompany } from '../hooks/use-api.js';
import { ArrowLeft, Building2, Globe, Users, FileText, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import ActivityTimeline from '../components/ActivityTimeline.js';
import ActivityForm from '../components/ActivityForm.js';
import CompanyForm from '../components/forms/CompanyForm.js';
import type { ActivityType } from '../api.js';

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useCompany(id ?? '');
  const { data: peopleData } = useCompanyPeopleByCompany(id ?? '');
  const deleteMutation = useDeleteEntity();
  const researchCompany = useResearchCompany();
  const [editOpen, setEditOpen] = useState(false);
  const [activityType, setActivityType] = useState<ActivityType | null>(null);

  if (isLoading) return <div className="text-slate-500">Loading company...</div>;
  if (!data?.company) return <div className="text-slate-500">Company not found</div>;

  const company = data.company;

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate('/companies')}
        className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> Back to companies
      </button>

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-indigo-600 text-white flex items-center justify-center text-lg font-medium">
              <Building2 size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold">{company.name}</h1>
              <div className="text-slate-500 text-sm">{company.domain ?? 'No domain'}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditOpen(true)} className="p-2 rounded hover:bg-slate-100 text-slate-500">
              <Pencil size={16} />
            </button>
            <button
              onClick={() => {
                deleteMutation.mutate({ type: 'companies', id: company.id }, { onSuccess: () => navigate('/companies') });
              }}
              className="p-2 rounded hover:bg-red-100 text-red-500"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="flex items-center gap-2 text-sm">
            <Globe size={16} className="text-slate-400" />
            <span>{company.domain ?? '—'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Users size={16} className="text-slate-400" />
            <span>{company.size ?? '—'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <FileText size={16} className="text-slate-400" />
            <span>{company.industry ?? '—'}</span>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-base font-semibold">Company intelligence</h2><p className="mt-1 text-xs text-slate-500">Evidence-backed research is stored for future AI agents and refreshes.</p></div><button onClick={() => researchCompany.mutate(company.id)} disabled={researchCompany.isPending} className="rounded bg-indigo-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{researchCompany.isPending ? 'Queued…' : 'Research company'}</button></div>
        <div className="mt-4 grid gap-4 md:grid-cols-3 text-sm"><div><div className="text-xs uppercase text-slate-400">Research status</div><div className="mt-1 font-medium">{company.researchStatus ?? 'Not researched'}</div></div><div><div className="text-xs uppercase text-slate-400">Last researched</div><div className="mt-1">{company.researchedAt ? new Date(company.researchedAt).toLocaleString() : '—'}</div></div><div><div className="text-xs uppercase text-slate-400">Summary</div><div className="mt-1 text-slate-600">{company.researchSummary ?? 'No evidence summary yet.'}</div></div></div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Current captured people</h2>
            <p className="mt-1 text-xs text-slate-500">Recruiters, hiring managers, and leadership linked to this company.</p>
          </div>
          <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">{peopleData?.people.length ?? 0}</span>
        </div>
        <div className="divide-y divide-slate-100">
          {(peopleData?.people ?? []).map((person) => (
            <div key={person.id} className="flex items-center justify-between py-3">
              <div>
                <button onClick={() => navigate(`/company-people/${person.id}`)} className="font-medium text-indigo-700 hover:underline">{person.display_name}</button>
                <div className="text-xs text-slate-500">{person.current_title ?? person.headline ?? '—'}</div>
              </div>
              <div className="flex gap-1 text-[11px] text-indigo-600">
                {person.categories.map((category) => <span key={category} className="rounded bg-indigo-50 px-2 py-1">{category.replace('_', ' ')}</span>)}
              </div>
            </div>
          ))}
          {peopleData?.people.length === 0 && <div className="py-8 text-center text-sm text-slate-400">No captured people linked yet.</div>}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <ActivityTimeline
          filters={{ companyId: company.id }}
          entityName={company.name}
          onAddActivity={(type) => setActivityType(type)}
        />
      </div>

      <CompanyForm open={editOpen} onClose={() => setEditOpen(false)} company={company} />
      {activityType && (
        <ActivityForm
          open={!!activityType}
          onClose={() => setActivityType(null)}
          type={activityType}
          filters={{ companyId: company.id }}
          entityName={company.name}
        />
      )}
    </div>
  );
}
