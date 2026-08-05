import { useState } from 'react';
import { BriefcaseBusiness, Building2, ExternalLink, Search, UsersRound } from 'lucide-react';
import { useCompanyPeople, useUpdateCompanyPerson } from '../hooks/use-api.js';
import type { CompanyPersonCategory } from '../api.js';

const PAGE_CONFIG: Record<CompanyPersonCategory, { title: string; description: string }> = {
  recruiter: {
    title: 'Recruiters',
    description: 'Recruiting professionals captured from LinkedIn and linked to their companies.',
  },
  hiring_manager: {
    title: 'Hiring Managers',
    description: 'Engineering and hiring managers connected to current company relationships.',
  },
  company_leadership: {
    title: 'Company Leadership',
    description: 'Leadership profiles captured for company intelligence and outreach.',
  },
};

export default function CompanyPeoplePage({ category }: { category: CompanyPersonCategory }) {
  const [search, setSearch] = useState('');
  const config = PAGE_CONFIG[category];
  const { data, isLoading } = useCompanyPeople(category, search);
  const updatePerson = useUpdateCompanyPerson();
  const people = data?.people ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-indigo-100 p-2 text-indigo-700"><UsersRound size={20} /></div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{config.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{config.description}</p>
        </div>
        <span className="ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          {people.length} captured
        </span>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
        <Search size={16} className="text-slate-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Search ${config.title.toLowerCase()} or company...`}
          className="flex-1 bg-transparent text-sm outline-none"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Person</th>
                <th className="px-4 py-3">LinkedIn</th>
                <th className="px-4 py-3">Current company</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Captured</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {people.map((person) => (
                <tr key={person.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{person.display_name}</div>
                    {person.email && <div className="mt-1 text-xs text-slate-500">{person.email}</div>}
                    <div className="mt-1 flex gap-1 text-[11px] text-slate-400">
                      {person.categories.map((item) => <span key={item} className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600">{item.replace('_', ' ')}</span>)}
                    </div>
                  </td>
                  <td className="px-4 py-3">{person.linkedin_url ? <a className="inline-flex items-center gap-1 text-indigo-600 hover:underline" href={person.linkedin_url} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open profile</a> : <span className="text-slate-400">Unlinked</span>}</td>
                  <td className="px-4 py-3 text-slate-700"><span className="inline-flex items-center gap-1"><Building2 size={14} />{person.current_company_name ?? 'Unlinked'}</span></td>
                  <td className="px-4 py-3 text-slate-600">{person.current_title ?? person.headline ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{person.location ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{person.last_captured_at ? new Date(person.last_captured_at).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3"><select className="rounded border border-slate-200 bg-white px-2 py-1 text-xs" value={category} onChange={(event) => updatePerson.mutate({ id: person.id, category: event.target.value as CompanyPersonCategory })}><option value="recruiter">Recruiter</option><option value="hiring_manager">Hiring Manager</option><option value="company_leadership">Leadership</option></select></td>
                </tr>
              ))}
              {!isLoading && people.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400"><BriefcaseBusiness className="mx-auto mb-2" size={24} />No {config.title.toLowerCase()} captured yet.</td></tr>}
              {isLoading && <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">Loading...</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
