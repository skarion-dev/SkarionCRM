import { useState, type FormEvent } from 'react';
import { useCreateActivity } from '../hooks/use-api.js';
import type { ActivityType } from '../api.js';
import Modal from './ui/Modal.js';

interface ActivityFormProps {
  open: boolean;
  onClose: () => void;
  type: ActivityType;
  filters: { contactId?: string; companyId?: string; opportunityId?: string };
  entityName: string;
}

export default function ActivityForm({ open, onClose, type, filters, entityName }: ActivityFormProps) {
  const create = useCreateActivity();
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [happenedAt, setHappenedAt] = useState(new Date().toISOString().slice(0, 16));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        type,
        subject,
        content: content || null,
        ...filters,
        happenedAt,
      },
      { onSuccess: onClose }
    );
  };

  const isPending = create.isPending;

  return (
    <Modal open={open} onClose={onClose} title={`Log ${type} on ${entityName}`}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Subject *</label>
          <input
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm"
            placeholder={`e.g. ${type === 'call' ? 'Follow-up call' : type === 'email' ? 'Proposal email' : type === 'meeting' ? 'Discovery meeting' : 'Internal note'}`}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Content</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm"
            placeholder="Details..."
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Date & Time</label>
          <input
            type="datetime-local"
            value={happenedAt}
            onChange={(e) => setHappenedAt(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-md text-sm border border-slate-200 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={isPending} className="px-3 py-2 rounded-md text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {isPending ? 'Saving...' : 'Log'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
