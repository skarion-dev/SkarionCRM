import { useNavigate, useParams } from 'react-router-dom';
import { useLead, useDeleteEntity } from '../hooks/use-api.js';
import { showToast } from '../stores/toast.js';
import { ArrowLeft, Mail, Phone, Building2, Calendar, FileText, Pencil, Trash2, Linkedin, Target, BarChart3, Hash, Tag, Layers, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { useState } from 'react';
import ActivityTimeline from '../components/ActivityTimeline.js';
import ActivityForm from '../components/ActivityForm.js';
import LeadForm from '../components/forms/LeadForm.js';
import type { ActivityType } from '../api.js';

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useLead(id ?? '');
  const deleteMutation = useDeleteEntity();
  const [editOpen, setEditOpen] = useState(false);
  const [activityType, setActivityType] = useState<ActivityType | null>(null);

  if (isLoading) return <div className="text-slate-500">Loading lead...</div>;
  if (!data?.lead) return (
    <div className="space-y-4">
      <button
        onClick={() => navigate('/leads')}
        className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> Back to leads
      </button>
      <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
        <AlertTriangle size={48} className="mx-auto text-slate-300 mb-4" />
        <h2 className="text-lg font-medium text-slate-700 mb-1">Lead not found</h2>
        <p className="text-sm text-slate-400 mb-4">This lead may have been deleted or the ID is invalid.</p>
        <button
          onClick={() => navigate('/leads')}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
        >
          Go to Leads
        </button>
      </div>
    </div>
  );

  const lead = data.lead;

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate('/leads')}
        className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> Back to leads
      </button>

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center text-lg font-medium">
              {lead.firstName.charAt(0)}{lead.lastName.charAt(0)}
            </div>
            <div>
              <h1 className="text-xl font-semibold">{lead.firstName} {lead.lastName}</h1>
              <div className="text-slate-500 text-sm">{lead.email.includes('@placeholder.skarion') ? 'No email' : lead.email}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('px-3 py-1 rounded-full text-sm font-medium capitalize',
              lead.status === 'new' ? 'bg-blue-100 text-blue-700' :
              lead.status === 'contacted' ? 'bg-amber-100 text-amber-700' :
              lead.status === 'qualified' ? 'bg-green-100 text-green-700' :
              lead.status === 'converted' ? 'bg-purple-100 text-purple-700' :
              'bg-slate-100 text-slate-600'
            )}>
              {lead.status}
            </span>
            <span className={cn('px-3 py-1 rounded-full text-sm font-medium capitalize',
              lead.outreachStatus === 'not_approached' ? 'bg-slate-100 text-slate-600' :
              lead.outreachStatus === 'approached' ? 'bg-amber-100 text-amber-700' :
              lead.outreachStatus === 'connected' ? 'bg-blue-100 text-blue-700' :
              lead.outreachStatus === 'replied' ? 'bg-green-100 text-green-700' :
              lead.outreachStatus === 'booked_call' ? 'bg-purple-100 text-purple-700' :
              'bg-slate-100 text-slate-600'
            )}>
              {lead.outreachStatus?.replace(/_/g, ' ') ?? 'not approached'}
            </span>
            <button onClick={() => setEditOpen(true)} className="p-2 rounded hover:bg-slate-100 text-slate-500">
              <Pencil size={16} />
            </button>
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to delete this lead? This action cannot be undone.')) {
                  deleteMutation.mutate({ type: 'leads', id: lead.id }, { onSuccess: () => { showToast('Lead deleted', 'success'); navigate('/leads'); } });
                }
              }}
              className="p-2 rounded hover:bg-red-100 text-red-500"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="flex items-center gap-2 text-sm">
            <Mail size={16} className="text-slate-400" />
            <span>{lead.email.includes('@placeholder.skarion') ? 'No email' : lead.email}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Phone size={16} className="text-slate-400" />
            <span>{lead.phone ?? 'No phone'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Building2 size={16} className="text-slate-400" />
            <span>{lead.companyName ?? 'No company'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Calendar size={16} className="text-slate-400" />
            <span>Created {new Date(lead.createdAt).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Target size={16} className="text-slate-400" />
            <span className="capitalize">{lead.source.replace(/_/g, ' ')}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <BarChart3 size={16} className="text-slate-400" />
            <span>Connection: {lead.connectionStatus ?? 'Unknown'}</span>
          </div>
          {lead.linkedinUrl && (
            <div className="flex items-center gap-2 text-sm">
              <Linkedin size={16} className="text-blue-500" />
              <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                LinkedIn Profile
              </a>
            </div>
          )}
          {lead.sourceSheet && (
            <div className="flex items-center gap-2 text-sm">
              <Layers size={16} className="text-slate-400" />
              <span>Sheet: {lead.sourceSheet}</span>
            </div>
          )}
          {lead.originalRowNumber !== null && (
            <div className="flex items-center gap-2 text-sm">
              <Hash size={16} className="text-slate-400" />
              <span>Row #{lead.originalRowNumber}</span>
            </div>
          )}
          {lead.tags && lead.tags.length > 0 && (
            <div className="flex items-center gap-2 text-sm md:col-span-2">
              <Tag size={16} className="text-slate-400" />
              <div className="flex flex-wrap gap-1">
                {lead.tags.map((tag, i) => (
                  <span key={i} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">{tag}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {lead.notes && (
          <div className="mt-6">
            <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
              <FileText size={16} /> Notes
            </h3>
            <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">{lead.notes}</p>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <ActivityTimeline
          filters={{ contactId: lead.id }}
          entityName={`${lead.firstName} ${lead.lastName}`}
          onAddActivity={(type) => setActivityType(type)}
        />
      </div>

      <LeadForm open={editOpen} onClose={() => setEditOpen(false)} lead={lead} />
      {activityType && (
        <ActivityForm
          open={!!activityType}
          onClose={() => setActivityType(null)}
          type={activityType}
          filters={{ contactId: lead.id }}
          entityName={`${lead.firstName} ${lead.lastName}`}
        />
      )}
    </div>
  );
}
