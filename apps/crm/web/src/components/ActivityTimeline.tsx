import { useState, type FormEvent } from 'react';
import { useActivities, useUpdateActivity } from '../hooks/use-api.js';
import { Phone, Mail, Users, FileText, MessageSquare, Pencil, Plus } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { useAuthStore } from '../stores/auth.js';
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
  filters: { leadId?: string; contactId?: string; companyId?: string; opportunityId?: string };
  entityName: string;
  onAddActivity?: (type: Activity['type']) => void;
}

export default function ActivityTimeline({
  filters,
  entityName,
  onAddActivity,
}: ActivityTimelineProps) {
  const { data, isLoading } = useActivities(filters);
  const updateActivity = useUpdateActivity();
  const currentUser = useAuthStore((state) => state.user);
  const [editing, setEditing] = useState<Activity | null>(null);
  const activities = data?.activities ?? [];

  const saveEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    updateActivity.mutate(
      {
        id: editing.id,
        type: editing.type,
        subject: editing.subject,
        content: editing.content,
        happenedAt: editing.happenedAt,
      },
      { onSuccess: () => setEditing(null) }
    );
  };

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
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded text-xs border hover:opacity-80',
                  typeColors[t]
                )}
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
            const canEdit = currentUser?.isSuperadmin || a.actorId === currentUser?.id;
            if (editing?.id === a.id) {
              return (
                <form
                  key={a.id}
                  onSubmit={saveEdit}
                  className="ml-11 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
                    <select
                      value={editing.type}
                      onChange={(e) =>
                        setEditing({ ...editing, type: e.target.value as Activity['type'] })
                      }
                      className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      {Object.entries(typeLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <input
                      required
                      value={editing.subject}
                      onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                      aria-label="Activity subject"
                    />
                  </div>
                  <textarea
                    value={editing.content ?? ''}
                    onChange={(e) => setEditing({ ...editing, content: e.target.value || null })}
                    rows={3}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                    aria-label="Activity content"
                  />
                  <input
                    type="datetime-local"
                    value={new Date(editing.happenedAt).toISOString().slice(0, 16)}
                    onChange={(e) => setEditing({ ...editing, happenedAt: e.target.value })}
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                    aria-label="Activity date and time"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={updateActivity.isPending}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                    >
                      {updateActivity.isPending ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                </form>
              );
            }
            return (
              <div key={a.id} className="flex gap-3">
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center border shrink-0',
                    color
                  )}
                >
                  <Icon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{a.subject}</div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-xs text-slate-400">
                        {new Date(a.happenedAt).toLocaleDateString()}
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setEditing(a)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          aria-label={`Edit ${a.subject}`}
                          title="Edit activity"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  {a.content && <p className="text-sm text-slate-600 mt-0.5">{a.content}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
