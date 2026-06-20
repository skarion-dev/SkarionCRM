import { useNavigate, useParams } from 'react-router-dom';
import { useOpportunity, useDeleteEntity } from '../hooks/use-api.js';
import { ArrowLeft, Users, DollarSign, Calendar, TrendingUp, Pencil, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { useState } from 'react';
import ActivityTimeline from '../components/ActivityTimeline.js';
import ActivityForm from '../components/ActivityForm.js';
import OpportunityForm from '../components/forms/OpportunityForm.js';
import type { ActivityType } from '../api.js';

export default function OpportunityDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useOpportunity(id ?? '');
  const deleteMutation = useDeleteEntity();
  const [editOpen, setEditOpen] = useState(false);
  const [activityType, setActivityType] = useState<ActivityType | null>(null);

  if (isLoading) return <div className="text-slate-500">Loading opportunity...</div>;
  if (!data?.opportunity) return <div className="text-slate-500">Opportunity not found</div>;

  const opp = data.opportunity;

  const stageLabel = opp.stage.replace('_', ' ');
  const stageBadge = cn('px-3 py-1 rounded-full text-sm font-medium capitalize',
    opp.stage === 'prospecting' ? 'bg-slate-100 text-slate-600' :
    opp.stage === 'qualification' ? 'bg-blue-100 text-blue-700' :
    opp.stage === 'proposal' ? 'bg-amber-100 text-amber-700' :
    opp.stage === 'negotiation' ? 'bg-purple-100 text-purple-700' :
    opp.stage === 'closed_won' ? 'bg-green-100 text-green-700' :
    'bg-red-100 text-red-700'
  );

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate('/opportunities')}
        className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> Back to opportunities
      </button>

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-amber-600 text-white flex items-center justify-center text-lg font-medium">
              <DollarSign size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold">{opp.name}</h1>
              <div className="text-slate-500 text-sm">{stageLabel}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={stageBadge}>{stageLabel}</span>
            <button onClick={() => setEditOpen(true)} className="p-2 rounded hover:bg-slate-100 text-slate-500">
              <Pencil size={16} />
            </button>
            <button
              onClick={() => {
                deleteMutation.mutate({ type: 'opportunities', id: opp.id }, { onSuccess: () => navigate('/opportunities') });
              }}
              className="p-2 rounded hover:bg-red-100 text-red-500"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="flex items-center gap-2 text-sm">
            <DollarSign size={16} className="text-slate-400" />
            <span>{opp.amount ? `${opp.currency} ${parseFloat(opp.amount).toLocaleString()}` : '—'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Calendar size={16} className="text-slate-400" />
            <span>{opp.expectedCloseDate ?? 'No expected close date'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <TrendingUp size={16} className="text-slate-400" />
            <span>{opp.probability ? `${opp.probability}% probability` : '—'}</span>
          </div>
        </div>

        {opp.notes && (
          <div className="mt-6">
            <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
              <Users size={16} /> Notes
            </h3>
            <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">{opp.notes}</p>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <ActivityTimeline
          filters={{ opportunityId: opp.id }}
          entityName={opp.name}
          onAddActivity={(type) => setActivityType(type)}
        />
      </div>

      <OpportunityForm open={editOpen} onClose={() => setEditOpen(false)} opportunity={opp} />
      {activityType && (
        <ActivityForm
          open={!!activityType}
          onClose={() => setActivityType(null)}
          type={activityType}
          filters={{ opportunityId: opp.id }}
          entityName={opp.name}
        />
      )}
    </div>
  );
}
