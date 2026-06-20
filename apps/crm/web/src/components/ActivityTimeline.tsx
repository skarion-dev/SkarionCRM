import { useActivities } from '../hooks/use-api.js';
import { Phone, Mail, Users, FileText, MessageSquare, Plus } from 'lucide-react';
import { cn } from '../lib/utils.js';
import type { Activity } from '../api.js';

const typeIcons = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: FileText,
};

const typeLabels = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note',
};

const typeColors = {
  call: 'bg-blue-50 text-blue-600 border-blue-200',
  email: 'bg-amber-50 text-amber-600 border-amber-200',
  meeting: 'bg-purple-50 text-purple-600 border-purple-200',
  note: 'bg-slate-50 text-slate-600 border-slate-200',
};

interface ActivityTimelineProps {
  filters: { contactId?: string; companyId?: string; opportunityId?: string };
  entityName: string;
  onAddActivity?: (type: Activity['type']) => void;
}

export default function ActivityTimeline({ filters, entityName, onAddActivity }: ActivityTimelineProps) {
  const { data, isLoading } = useActivities(filters);
  const activities = data?.activities ?? [];

  if (isLoading) return <div className="text-sm text-slate-500">Loading activities...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Activity Timeline</h3>
        {onAddActivity && (
          <div className="flex gap-1">
            {(['note', 'call', 'email', 'meeting'] as Activity['type'][]).map((t) => (
              <button
                key={t}
                onClick={() => onAddActivity(t)}
                className={cn('flex items-center gap-1 px-2 py-1 rounded text-xs border hover:opacity-80', typeColors[t])}
              >
                <Plus size={12} /> {typeLabels[t]}
              </button>
            ))}
          </div>
        )}
      </div>

      {activities.length === 0 ? (
        <div className="text-sm text-slate-400 bg-slate-50 rounded-lg p-4 text-center">
          No activity yet for {entityName}
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map((a) => {
            const Icon = typeIcons[a.type] ?? MessageSquare;
            const color = typeColors[a.type] ?? typeColors.note;
            return (
              <div key={a.id} className="flex gap-3">
                <div className={cn('w-8 h-8 rounded-full flex items-center justify-center border shrink-0', color)}>
                  <Icon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{a.subject}</div>
                    <div className="text-xs text-slate-400">
                      {new Date(a.happenedAt).toLocaleDateString()}
                    </div>
                  </div>
                  {a.content && (
                    <p className="text-sm text-slate-600 mt-0.5">{a.content}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
