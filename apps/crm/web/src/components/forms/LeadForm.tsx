import { useState, type FormEvent } from 'react';
import {
  useCreateEntity,
  useUpdateEntity,
  useIdentityUsers,
  useTags,
} from '../../hooks/use-api.js';
import { useAuthStore } from '../../stores/auth.js';
import type { Lead, LeadSource } from '../../api.js';
import { LEAD_JOURNEY_STAGES, LEAD_JOURNEY_LABELS } from '../../lib/leadJourney.js';
import { X as XIcon } from 'lucide-react';
import Modal from '../ui/Modal.js';

interface LeadFormProps {
  open: boolean;
  onClose: () => void;
  lead?: Lead | null;
}

const sources: LeadSource[] = [
  'linkedin',
  'website',
  'referral',
  'social_media',
  'cold_call',
  'email_campaign',
  'event',
  'other',
];
export default function LeadForm({ open, onClose, lead }: LeadFormProps) {
  const create = useCreateEntity('leads');
  const update = useUpdateEntity('leads');
  const isEdit = !!lead;

  const role = useAuthStore((s) => s.user?.role ?? '');
  const isSuperadmin = useAuthStore((s) => s.user?.isSuperadmin ?? false);
  const canManage = isSuperadmin || role === 'manager';
  const { data: tagData } = useTags();
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
    source: lead?.source ?? 'website',
    journeyStage: lead?.journeyStage ?? 'new',
    notes: lead?.notes ?? '',
    ownerId: lead?.ownerId ?? '',
  });
  const [tags, setTags] = useState<string[]>(lead?.tags ?? []);
  const [tagInput, setTagInput] = useState('');

  const handleChange = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag) return;
    const knownTag = tagData?.tags.find((item) => item.name.toLowerCase() === tag.toLowerCase());
    if (!knownTag && !canManage) return;
    const resolvedTag = knownTag?.name ?? tag;
    if (!tags.some((item) => item.toLowerCase() === resolvedTag.toLowerCase())) {
      setTags((current) => [...current, resolvedTag]);
    }
    setTagInput('');
  };
  const removeTag = (tag: string) => setTags((t) => t.filter((x) => x !== tag));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = { ...form, tags };
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
            <label className="block text-sm font-medium text-slate-600 mb-1">Lead journey</label>
            <select
              value={form.journeyStage}
              onChange={(e) => handleChange('journeyStage', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm bg-white"
            >
              {LEAD_JOURNEY_STAGES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_JOURNEY_LABELS[s]}
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
            list="lead-tag-options"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
            className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm"
            placeholder={
              canManage
                ? 'Choose or create a tag, then press Enter'
                : 'Choose a team tag, then press Enter'
            }
          />
          <datalist id="lead-tag-options">
            {tagData?.tags
              .filter(
                (tag) => !tags.some((selected) => selected.toLowerCase() === tag.name.toLowerCase())
              )
              .map((tag) => (
                <option key={tag.id} value={tag.name} />
              ))}
          </datalist>
        </div>
        {canManage && (
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Assigned to</label>
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
