import { useState, type FormEvent } from 'react';
import {
  useCreateEntity,
  useUpdateEntity,
  useImportBatches,
  useIdentityUsers,
} from '../../hooks/use-api.js';
import { useAuthStore } from '../../stores/auth.js';
import type { Lead, LeadStatus, LeadSource, OutreachStatus } from '../../api.js';
import { X as XIcon } from 'lucide-react';
import Modal from '../ui/Modal.js';

interface LeadFormProps {
  open: boolean;
  onClose: () => void;
  lead?: Lead | null;
}

const statuses: LeadStatus[] = ['new', 'contacted', 'qualified', 'disqualified', 'converted'];
const sources: LeadSource[] = [
  'website',
  'referral',
  'social_media',
  'cold_call',
  'email_campaign',
  'event',
  'other',
];
const outreachStatuses: OutreachStatus[] = [
  'not_approached',
  'approached',
  'connection_request_sent',
  'in_conversation',
  'connected',
  'replied',
  'booked_call',
  'not_interested',
  'bad_fit',
];

export default function LeadForm({ open, onClose, lead }: LeadFormProps) {
  const create = useCreateEntity('leads');
  const update = useUpdateEntity('leads');
  const isEdit = !!lead;

  const role = useAuthStore((s) => s.user?.role ?? '');
  const isSuperadmin = useAuthStore((s) => s.user?.isSuperadmin ?? false);
  const canManage = isSuperadmin || role === 'manager';
  const { data: batches } = useImportBatches();
  const { data: identityUsers } = useIdentityUsers(canManage);
  const crmUsers = (identityUsers ?? []).filter((u) =>
    u.appMemberships?.some((m) => m.app === 'crm')
  );

  const [form, setForm] = useState({
    firstName: lead?.firstName ?? '',
    lastName: lead?.lastName ?? '',
    email: lead?.email ?? '',
    phone: lead?.phone ?? '',
    companyName: lead?.companyName ?? '',
    companyDomain: lead?.companyDomain ?? '',
    linkedinUrl: lead?.linkedinUrl ?? '',
    outreachStatus: lead?.outreachStatus ?? 'not_approached',
    connectionStatus: lead?.connectionStatus ?? '',
    sourceSheet: lead?.sourceSheet ?? '',
    originalRowNumber: lead?.originalRowNumber != null ? String(lead.originalRowNumber) : '',
    source: lead?.source ?? 'website',
    status: lead?.status ?? 'new',
    notes: lead?.notes ?? '',
    batchId: lead?.batchId ?? '',
    ownerId: lead?.ownerId ?? '',
  });
  const [tags, setTags] = useState<string[]>(lead?.tags ?? []);
  const [tagInput, setTagInput] = useState('');

  const handleChange = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag) return;
    if (!tags.includes(tag)) setTags((t) => [...t, tag]);
    setTagInput('');
  };
  const removeTag = (tag: string) => setTags((t) => t.filter((x) => x !== tag));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = { ...form, tags };
    if (form.originalRowNumber)
      payload.originalRowNumber = parseInt(form.originalRowNumber, 10) || null;
    else payload.originalRowNumber = null;
    if (!form.batchId) payload.batchId = null;
    if (isEdit && lead) {
      update.mutate({ id: lead.id, data: payload }, { onSuccess: onClose });
    } else {
      create.mutate(payload, { onSuccess: onClose });
    }
  };

  const isPending = create.isPending || update.isPending;

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Lead' : 'Add Lead'}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">First Name</label>
            <input
              required
              value={form.firstName}
              onChange={(e) => handleChange('firstName', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Last Name</label>
            <input
              required
              value={form.lastName}
              onChange={(e) => handleChange('lastName', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Email</label>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => handleChange('email', e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Phone</label>
          <input
            value={form.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Company Name</label>
          <input
            value={form.companyName}
            onChange={(e) => handleChange('companyName', e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Company Domain</label>
          <input
            value={form.companyDomain}
            onChange={(e) => handleChange('companyDomain', e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm"
            placeholder="example.com"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">LinkedIn URL</label>
          <input
            value={form.linkedinUrl}
            onChange={(e) => handleChange('linkedinUrl', e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm"
            placeholder="https://linkedin.com/in/..."
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Outreach Status</label>
            <select
              value={form.outreachStatus}
              onChange={(e) => handleChange('outreachStatus', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm bg-white"
            >
              {outreachStatuses.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Connection Status
            </label>
            <input
              value={form.connectionStatus}
              onChange={(e) => handleChange('connectionStatus', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm"
              placeholder="1st, 2nd, 3rd"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Source Sheet</label>
            <input
              value={form.sourceSheet}
              onChange={(e) => handleChange('sourceSheet', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Original Row #</label>
            <input
              type="number"
              value={form.originalRowNumber}
              onChange={(e) => handleChange('originalRowNumber', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Status</label>
            <select
              value={form.status}
              onChange={(e) => handleChange('status', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm bg-white"
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Source</label>
            <select
              value={form.source}
              onChange={(e) => handleChange('source', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm bg-white"
            >
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Tags</label>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs font-medium"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <XIcon size={12} />
                </button>
              </span>
            ))}
          </div>
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
            className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm"
            placeholder="Type a tag and press Enter"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Set / Batch (optional)
            </label>
            <select
              value={form.batchId}
              onChange={(e) => handleChange('batchId', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm bg-white"
            >
              <option value="">—</option>
              {(batches ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          {canManage && (
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">
                Owner / Assign to
              </label>
              <select
                value={form.ownerId}
                onChange={(e) => handleChange('ownerId', e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm bg-white"
              >
                <option value="">—</option>
                {crmUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName || u.email}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-md text-sm border border-slate-200 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="px-3 py-2 rounded-md text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
