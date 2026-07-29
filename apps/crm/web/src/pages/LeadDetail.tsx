import { useNavigate, useParams } from 'react-router-dom';
import {
  useLead,
  useDeleteEntity,
  useUpdateEntity,
  useImportBatches,
  useLeadAiAssessment,
  useGenerateLeadAiAssessment,
} from '../hooks/use-api.js';
import { showToast } from '../stores/toast.js';
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  Calendar,
  FileText,
  Pencil,
  Trash2,
  Linkedin,
  Target,
  BarChart3,
  Hash,
  Tag,
  Layers,
  AlertTriangle,
  ChevronRight,
  UserCheck,
  XCircle,
  MessageSquare,
  CalendarCheck,
  Sparkles,
  ArrowRight,
  Send,
  Video,
  Copy,
  Check,
  LoaderCircle,
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import { useState } from 'react';
import ActivityTimeline from '../components/ActivityTimeline.js';
import ActivityForm from '../components/ActivityForm.js';
import LeadForm from '../components/forms/LeadForm.js';
import ChannelPanel from '../components/ChannelPanel.js';
import Attachments from '../components/Attachments.js';
import type { ActivityType } from '../api.js';

const STATUS_PIPELINE: {
  key: string;
  label: string;
  color: string;
  bg: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}[] = [
  { key: 'new', label: 'New', color: 'text-blue-700', bg: 'bg-blue-100', icon: Sparkles },
  {
    key: 'contacted',
    label: 'Contacted',
    color: 'text-amber-700',
    bg: 'bg-amber-100',
    icon: MessageSquare,
  },
  {
    key: 'qualified',
    label: 'Qualified',
    color: 'text-green-700',
    bg: 'bg-green-100',
    icon: UserCheck,
  },
  {
    key: 'converted',
    label: 'Converted',
    color: 'text-purple-700',
    bg: 'bg-purple-100',
    icon: CalendarCheck,
  },
];

const OUTREACH_PIPELINE: { key: string; label: string }[] = [
  { key: 'not_approached', label: 'Not Approached' },
  { key: 'approached', label: 'Approached' },
  { key: 'connected', label: 'Connected' },
  { key: 'replied', label: 'Replied' },
  { key: 'booked_call', label: 'Call Booked' },
];

function StatusPipeline({ status }: { status: string }) {
  const currentIndex = STATUS_PIPELINE.findIndex((s) => s.key === status);
  return (
    <div className="flex items-center gap-1">
      {STATUS_PIPELINE.map((s, i) => {
        const Icon = s.icon;
        const isActive = i === currentIndex;
        const isPast = i < currentIndex;
        return (
          <div key={s.key} className="flex items-center">
            <div
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors',
                isActive
                  ? `${s.bg} ${s.color}`
                  : isPast
                    ? 'bg-slate-100 text-slate-500'
                    : 'bg-slate-50 text-slate-300'
              )}
            >
              <Icon size={12} />
              {s.label}
            </div>
            {i < STATUS_PIPELINE.length - 1 && (
              <ChevronRight
                size={12}
                className={cn('mx-0.5', isPast ? 'text-slate-400' : 'text-slate-200')}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function OutreachPipeline({ status }: { status: string }) {
  const currentIndex = OUTREACH_PIPELINE.findIndex((s) => s.key === status);
  if (currentIndex < 0) return null;
  return (
    <div className="flex items-center gap-0.5">
      {OUTREACH_PIPELINE.map((s, i) => (
        <div
          key={s.key}
          className={cn(
            'h-1.5 rounded-full transition-all',
            i <= currentIndex ? 'bg-blue-500 w-6' : 'bg-slate-200 w-4'
          )}
          title={s.label}
        />
      ))}
    </div>
  );
}

function getNextStatus(current: string): { next: string | null; label: string; color: string } {
  switch (current) {
    case 'new':
      return {
        next: 'contacted',
        label: 'Mark as Contacted',
        color: 'bg-amber-600 hover:bg-amber-700',
      };
    case 'contacted':
      return {
        next: 'qualified',
        label: 'Mark as Qualified',
        color: 'bg-green-600 hover:bg-green-700',
      };
    case 'qualified':
      return {
        next: 'converted',
        label: 'Mark as Converted',
        color: 'bg-purple-600 hover:bg-purple-700',
      };
    default:
      return { next: null, label: '', color: '' };
  }
}

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useLead(id ?? '');
  const { data: aiAssessmentData } = useLeadAiAssessment(id ?? '', Boolean(id));
  const generateAiAssessment = useGenerateLeadAiAssessment(id ?? '');
  const deleteMutation = useDeleteEntity();
  const updateLead = useUpdateEntity('leads');
  const { data: batches } = useImportBatches();
  const [editOpen, setEditOpen] = useState(false);
  const [activityType, setActivityType] = useState<ActivityType | null>(null);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [connectionNoteCopied, setConnectionNoteCopied] = useState(false);

  if (isLoading) return <div className="text-slate-500">Loading lead...</div>;
  if (!data?.lead)
    return (
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
          <p className="text-sm text-slate-400 mb-4">
            This lead may have been deleted or the ID is invalid.
          </p>
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
  const aiAssessment = generateAiAssessment.data?.assessment ?? aiAssessmentData?.assessment;
  const nextStatus = getNextStatus(lead.status);
  const isPlaceholderEmail = (lead.email ?? '').includes('@placeholder.skarion');
  const batch = lead.batchId ? batches?.find((b) => b.id === lead.batchId) : undefined;

  const handleStatusChange = (newStatus: string) => {
    updateLead.mutate(
      { id: lead.id, data: { status: newStatus } },
      {
        onSuccess: () => {
          showToast(`Status updated to ${newStatus}`, 'success');
          setStatusDropdownOpen(false);
        },
        onError: () => showToast('Failed to update status', 'error'),
      }
    );
  };

  const handleOutreachChange = (newStatus: string) => {
    updateLead.mutate(
      { id: lead.id, data: { outreachStatus: newStatus } },
      {
        onSuccess: () => {
          showToast(`Outreach updated to ${newStatus.replace(/_/g, ' ')}`, 'success');
        },
        onError: () => showToast('Failed to update outreach', 'error'),
      }
    );
  };

  const handleGenerateConnectionNote = () => {
    generateAiAssessment.mutate(undefined, {
      onSuccess: () => showToast('Connection note and lead score generated', 'success'),
      onError: (error) =>
        showToast(
          error instanceof Error ? error.message : 'Failed to generate the connection note',
          'error'
        ),
    });
  };

  const handleCopyConnectionNote = async () => {
    if (!aiAssessment?.connectionNote) return;
    try {
      await navigator.clipboard.writeText(aiAssessment.connectionNote);
      setConnectionNoteCopied(true);
      showToast('Connection note copied', 'success');
      window.setTimeout(() => setConnectionNoteCopied(false), 2000);
    } catch {
      showToast('Could not copy the connection note', 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Back link */}
      <button
        onClick={() => navigate('/leads')}
        className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> Back to leads
      </button>

      {/* Header Card */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {/* Top bar with status pipeline */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <StatusPipeline status={lead.status} />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditOpen(true)}
              className="p-1.5 rounded hover:bg-slate-200 text-slate-500"
              title="Edit lead"
            >
              <Pencil size={16} />
            </button>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    'Are you sure you want to delete this lead? This action cannot be undone.'
                  )
                ) {
                  deleteMutation.mutate(
                    { type: 'leads', id: lead.id },
                    {
                      onSuccess: () => {
                        showToast('Lead deleted', 'success');
                        navigate('/leads');
                      },
                    }
                  );
                }
              }}
              className="p-1.5 rounded hover:bg-red-100 text-red-500"
              title="Delete lead"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-full bg-blue-600 text-white flex items-center justify-center text-xl font-medium">
                {lead.firstName.charAt(0)}
                {lead.lastName.charAt(0)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold">
                    {lead.firstName} {lead.lastName}
                  </h1>
                  {lead.leadNumber && (
                    <span
                      className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-mono text-sm"
                      title="Lead number"
                    >
                      {lead.leadNumber}
                    </span>
                  )}
                  {batch && (
                    <span
                      className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs font-medium"
                      title="Import set"
                    >
                      Set: {batch.name}
                    </span>
                  )}
                </div>
                <div className="text-slate-500 text-sm">
                  {isPlaceholderEmail ? 'No email on file' : lead.email}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'px-3 py-1 rounded-full text-sm font-medium capitalize',
                  lead.status === 'new'
                    ? 'bg-blue-100 text-blue-700'
                    : lead.status === 'contacted'
                      ? 'bg-amber-100 text-amber-700'
                      : lead.status === 'qualified'
                        ? 'bg-green-100 text-green-700'
                        : lead.status === 'converted'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-slate-100 text-slate-600'
                )}
              >
                {lead.status}
              </span>
              <span
                className={cn(
                  'px-3 py-1 rounded-full text-sm font-medium capitalize',
                  lead.outreachStatus === 'not_approached'
                    ? 'bg-slate-100 text-slate-600'
                    : lead.outreachStatus === 'approached'
                      ? 'bg-amber-100 text-amber-700'
                      : lead.outreachStatus === 'connected'
                        ? 'bg-blue-100 text-blue-700'
                        : lead.outreachStatus === 'replied'
                          ? 'bg-green-100 text-green-700'
                          : lead.outreachStatus === 'booked_call'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-slate-100 text-slate-600'
                )}
              >
                {lead.outreachStatus?.replace(/_/g, ' ') ?? 'not approached'}
              </span>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 mb-6">
            {/* Primary: Next Status */}
            {nextStatus.next && (
              <button
                onClick={() => handleStatusChange(nextStatus.next!)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-white transition-colors',
                  nextStatus.color
                )}
              >
                <ArrowRight size={16} />
                {nextStatus.label}
              </button>
            )}

            {/* Disqualify (available from any non-disqualified status) */}
            {lead.status !== 'disqualified' && (
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      'Mark this lead as disqualified? This will move it to the disqualified pipeline.'
                    )
                  ) {
                    handleStatusChange('disqualified');
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
              >
                <XCircle size={16} />
                Disqualify
              </button>
            )}

            {/* Re-qualify (if disqualified) */}
            {lead.status === 'disqualified' && (
              <button
                onClick={() => handleStatusChange('new')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                <Sparkles size={16} />
                Re-qualify as New
              </button>
            )}

            {/* Outreach quick actions */}
            {lead.outreachStatus === 'not_approached' && lead.linkedinUrl && (
              <a
                href={lead.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors"
              >
                <Send size={16} />
                Reach Out on LinkedIn
              </a>
            )}

            <button
              onClick={handleGenerateConnectionNote}
              disabled={generateAiAssessment.isPending}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:bg-violet-300 disabled:cursor-wait transition-colors"
              title="Read the saved LinkedIn profile details, score this lead, and draft a connection request note"
            >
              {generateAiAssessment.isPending ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <Sparkles size={16} />
              )}
              {generateAiAssessment.isPending
                ? 'Reading Profile…'
                : aiAssessment
                  ? 'Regenerate Connection Note'
                  : 'Generate Connection Note'}
            </button>

            {lead.outreachStatus === 'connected' && (
              <button
                onClick={() => handleOutreachChange('replied')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-green-200 text-green-600 hover:bg-green-50 transition-colors"
              >
                <MessageSquare size={16} />
                Mark as Replied
              </button>
            )}

            {lead.outreachStatus === 'replied' && (
              <button
                onClick={() => handleOutreachChange('booked_call')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-purple-200 text-purple-600 hover:bg-purple-50 transition-colors"
              >
                <Video size={16} />
                Book a Call
              </button>
            )}

            {/* Status dropdown for manual override */}
            <div className="relative">
              <button
                onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Set Status...
              </button>
              {statusDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setStatusDropdownOpen(false)}
                  />
                  <div className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1">
                    <div className="px-3 py-1.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Lead Status
                    </div>
                    {['new', 'contacted', 'qualified', 'converted', 'disqualified'].map((s) => (
                      <button
                        key={s}
                        onClick={() => handleStatusChange(s)}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm hover:bg-slate-50 capitalize',
                          lead.status === s && 'font-medium text-blue-600 bg-blue-50'
                        )}
                      >
                        {s}
                        {lead.status === s && (
                          <span className="ml-2 text-xs text-blue-400">(current)</span>
                        )}
                      </button>
                    ))}
                    <div className="border-t border-slate-100 my-1" />
                    <div className="px-3 py-1.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Outreach
                    </div>
                    {[
                      'not_approached',
                      'approached',
                      'connected',
                      'replied',
                      'booked_call',
                      'not_interested',
                      'bad_fit',
                    ].map((s) => (
                      <button
                        key={s}
                        onClick={() => handleOutreachChange(s)}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm hover:bg-slate-50 capitalize',
                          lead.outreachStatus === s && 'font-medium text-blue-600 bg-blue-50'
                        )}
                      >
                        {s.replace(/_/g, ' ')}
                        {lead.outreachStatus === s && (
                          <span className="ml-2 text-xs text-blue-400">(current)</span>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {aiAssessment && (
            <div className="mb-6 rounded-xl border border-violet-200 bg-violet-50/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-violet-950">AI Lead Qualification</h2>
                    <span className="rounded-full bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white">
                      {aiAssessment.overallScore}/100
                    </span>
                    <span className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-xs font-medium text-violet-800">
                      {aiAssessment.classification}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-violet-700">
                    Generated from the LinkedIn profile details saved on this lead.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyConnectionNote}
                  className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
                >
                  {connectionNoteCopied ? <Check size={15} /> : <Copy size={15} />}
                  {connectionNoteCopied ? 'Copied' : 'Copy Note'}
                </button>
              </div>

              {aiAssessment.reasoningSummary && (
                <p className="mb-3 text-sm leading-relaxed text-slate-700">
                  {aiAssessment.reasoningSummary}
                </p>
              )}

              <div className="rounded-lg border border-violet-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-violet-700">
                    LinkedIn connection note
                  </span>
                  <span
                    className={cn(
                      'text-xs font-medium',
                      aiAssessment.connectionNoteCharacterCount <= 300
                        ? 'text-slate-500'
                        : 'text-red-600'
                    )}
                  >
                    {aiAssessment.connectionNoteCharacterCount}/300 characters
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                  {aiAssessment.connectionNote}
                </p>
              </div>
            </div>
          )}

          {/* Outreach Progress */}
          {lead.outreachStatus &&
            lead.outreachStatus !== 'not_interested' &&
            lead.outreachStatus !== 'bad_fit' && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Outreach Progress
                  </span>
                  <span className="text-xs text-slate-400">
                    {OUTREACH_PIPELINE.find((s) => s.key === lead.outreachStatus)?.label ??
                      lead.outreachStatus.replace(/_/g, ' ')}
                  </span>
                </div>
                <OutreachPipeline status={lead.outreachStatus} />
              </div>
            )}

          {/* Contact Info Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                <Mail size={14} className="text-slate-500" />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Email
                </div>
                <div className="text-sm text-slate-700">
                  {isPlaceholderEmail ? '—' : lead.email}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                <Phone size={14} className="text-slate-500" />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Phone
                </div>
                <div className="text-sm text-slate-700">{lead.phone ?? '—'}</div>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                <Building2 size={14} className="text-slate-500" />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Company
                </div>
                <div className="text-sm text-slate-700">{lead.companyName ?? '—'}</div>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                <Calendar size={14} className="text-slate-500" />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Created
                </div>
                <div className="text-sm text-slate-700">
                  {new Date(lead.createdAt).toLocaleDateString()}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                <Target size={14} className="text-slate-500" />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Source
                </div>
                <div className="text-sm text-slate-700 capitalize">
                  {lead.source.replace(/_/g, ' ')}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                <BarChart3 size={14} className="text-slate-500" />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Connection
                </div>
                <div className="text-sm text-slate-700">{lead.connectionStatus ?? 'Unknown'}</div>
              </div>
            </div>

            {lead.linkedinUrl && (
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-md bg-blue-100 flex items-center justify-center shrink-0">
                  <Linkedin size={14} className="text-blue-600" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                    LinkedIn
                  </div>
                  <a
                    href={lead.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    View Profile
                  </a>
                </div>
              </div>
            )}

            {lead.sourceSheet && (
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                  <Layers size={14} className="text-slate-500" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Source Sheet
                  </div>
                  <div className="text-sm text-slate-700">{lead.sourceSheet}</div>
                </div>
              </div>
            )}

            {lead.originalRowNumber !== null && (
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                  <Hash size={14} className="text-slate-500" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Row
                  </div>
                  <div className="text-sm text-slate-700">#{lead.originalRowNumber}</div>
                </div>
              </div>
            )}
          </div>

          {/* Tags (inline above notes) */}
          {lead.tags && lead.tags.length > 0 && (
            <div className="mt-6 pt-6 border-t border-slate-100">
              <h3 className="font-medium text-sm mb-2 flex items-center gap-2 text-slate-700">
                <Tag size={16} /> Tags
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {lead.tags.map((tag, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-medium"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {lead.notes && (
            <div className="mt-6 pt-6 border-t border-slate-100">
              <h3 className="font-medium text-sm mb-2 flex items-center gap-2 text-slate-700">
                <FileText size={16} /> Notes
              </h3>
              <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-4 whitespace-pre-wrap leading-relaxed">
                {lead.notes}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Outreach Channels */}
      <ChannelPanel leadId={lead.id} />

      {/* Activity Timeline */}
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <ActivityTimeline
          filters={{ contactId: lead.id }}
          entityName={`${lead.firstName} ${lead.lastName}`}
          onAddActivity={(type) => setActivityType(type)}
        />
      </div>

      {/* Attachments */}
      <Attachments leadId={lead.id} />

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
