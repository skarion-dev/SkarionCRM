import { useNavigate, useParams } from 'react-router-dom';
import {
  useLead,
  useDeleteEntity,
  useUpdateEntity,
  useLeadAiAssessment,
  useGenerateLeadAiAssessment,
  useUpdateLeadConnectionNote,
  useLogOutreachAction,
  useDraftCandidateOutreach,
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
  Tag,
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
  Save,
  GraduationCap,
  Briefcase,
  MapPin,
  KeyRound,
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/auth.js';
import ActivityTimeline from '../components/ActivityTimeline.js';
import ActivityForm from '../components/ActivityForm.js';
import LeadForm from '../components/forms/LeadForm.js';
import ChannelPanel from '../components/ChannelPanel.js';
import Attachments from '../components/Attachments.js';
import type { ActivityType, CandidateOutreachDraft, LeadJourneyStage } from '../api.js';
import {
  ACTIVE_LEAD_JOURNEY,
  LEAD_JOURNEY_LABELS,
  LEAD_JOURNEY_STAGES,
  journeyBadgeClass,
  journeyLabel,
} from '../lib/leadJourney.js';

const STATUS_PIPELINE: {
  key: string;
  label: string;
  color: string;
  bg: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}[] = [
  ...ACTIVE_LEAD_JOURNEY.map((key) => ({
    key,
    label: LEAD_JOURNEY_LABELS[key],
    color: key === 'converted' ? 'text-emerald-700' : 'text-blue-700',
    bg: key === 'converted' ? 'bg-emerald-100' : 'bg-blue-100',
    icon:
      key === 'ready_for_email'
        ? Mail
        : key === 'future' ||
            key === 'foreign_national' ||
            key === 'stem' ||
            key === 'new' ||
            key === 'ready_to_reach_out'
          ? Sparkles
          : key === 'qualified'
            ? UserCheck
            : key === 'meeting_booked' || key === 'converted'
              ? CalendarCheck
              : MessageSquare,
  })),
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

function getNextStatus(current: LeadJourneyStage): LeadJourneyStage | null {
  const currentIndex = ACTIVE_LEAD_JOURNEY.indexOf(current);
  return currentIndex >= 0 ? (ACTIVE_LEAD_JOURNEY[currentIndex + 1] ?? null) : null;
}

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isSuperadmin = useAuthStore((state) => state.user?.isSuperadmin ?? false);
  const { data, isLoading } = useLead(id ?? '');
  const { data: aiAssessmentData } = useLeadAiAssessment(id ?? '', Boolean(id));
  const generateAiAssessment = useGenerateLeadAiAssessment(id ?? '');
  const updateConnectionNote = useUpdateLeadConnectionNote(id ?? '');
  const updateOutreachStage = useLogOutreachAction(id ?? '');
  const draftCandidateOutreach = useDraftCandidateOutreach(id ?? '');
  const deleteMutation = useDeleteEntity();
  const updateLead = useUpdateEntity('leads');
  const [editOpen, setEditOpen] = useState(false);
  const [activityType, setActivityType] = useState<ActivityType | null>(null);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [connectionNoteDraft, setConnectionNoteDraft] = useState('');
  const [connectionNoteAction, setConnectionNoteAction] = useState<
    'copied' | 'copied-and-sent' | null
  >(null);
  const [outreachDraft, setOutreachDraft] = useState<CandidateOutreachDraft | null>(null);
  const [draftingChannel, setDraftingChannel] = useState<'inmail' | 'email' | null>(null);
  const [outreachDraftCopied, setOutreachDraftCopied] = useState(false);
  const aiAssessment = aiAssessmentData?.assessment ?? generateAiAssessment.data?.assessment;
  const returnToLeads = () => {
    navigate('/leads');
  };

  useEffect(() => {
    setConnectionNoteDraft(aiAssessment?.connectionNote ?? '');
  }, [aiAssessment?.connectionNote, aiAssessment?.updatedAt]);

  if (isLoading) return <div className="text-slate-500">Loading lead...</div>;
  if (!data?.lead)
    return (
      <div className="space-y-4">
        <button
          onClick={returnToLeads}
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
  const nextStatus = getNextStatus(lead.journeyStage);
  const isPlaceholderEmail = (lead.email ?? '').includes('@placeholder.skarion');
  const connectionNoteCharacterCount = [...connectionNoteDraft].length;
  const connectionNoteDirty = aiAssessment
    ? connectionNoteDraft.trim() !== (aiAssessment.connectionNote ?? '')
    : false;
  const hasConnectionNote = Boolean(aiAssessment?.connectionNote || connectionNoteDraft.trim());
  const connectionNoteBusy = updateConnectionNote.isPending || updateOutreachStage.isPending;

  const handleStatusChange = (newStatus: LeadJourneyStage) => {
    updateLead.mutate(
      { id: lead.id, data: { journeyStage: newStatus } },
      {
        onSuccess: () => {
          showToast(`Journey updated to ${journeyLabel(newStatus)}`, 'success');
          setStatusDropdownOpen(false);
        },
        onError: () => showToast('Failed to update status', 'error'),
      }
    );
  };

  const handleGenerateConnectionNote = () => {
    generateAiAssessment.mutate(undefined, {
      onSuccess: (result) => {
        setConnectionNoteDraft(result.assessment.connectionNote ?? '');
        showToast('Connection note and lead score generated', 'success');
      },
      onError: (error) =>
        showToast(
          error instanceof Error ? error.message : 'Failed to generate the connection note',
          'error'
        ),
    });
  };

  const validatedConnectionNote = () => {
    const note = connectionNoteDraft.trim();
    const characterCount = [...note].length;
    if (!note) {
      showToast('Connection note cannot be empty', 'error');
      return null;
    }
    if (characterCount > 300) {
      showToast('Connection note must be 300 characters or fewer', 'error');
      return null;
    }
    return note;
  };

  const persistConnectionNote = async (note: string) => {
    if (note !== aiAssessment?.connectionNote) {
      await updateConnectionNote.mutateAsync(note);
      setConnectionNoteDraft(note);
    }
  };

  const handleSaveConnectionNote = async () => {
    const note = validatedConnectionNote();
    if (!note) return;
    try {
      await persistConnectionNote(note);
      showToast('Connection note saved', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Could not save the connection note',
        'error'
      );
    }
  };

  const handleCopyConnectionNote = async (markConnectionSent = false) => {
    const note = validatedConnectionNote();
    if (!note) return;
    let copied = false;
    try {
      await navigator.clipboard.writeText(note);
      copied = true;
      await persistConnectionNote(note);
      if (markConnectionSent) {
        await updateOutreachStage.mutateAsync({
          channel: 'linkedin',
          action: 'set_stage',
          stage: 'connection_request_sent',
        });
      }
      setConnectionNoteAction(markConnectionSent ? 'copied-and-sent' : 'copied');
      showToast(
        markConnectionSent
          ? 'Connection note copied and marked as connection request sent'
          : 'Connection note copied',
        'success'
      );
      window.setTimeout(() => setConnectionNoteAction(null), 2500);
    } catch (error) {
      showToast(
        copied
          ? 'Note copied, but the CRM update failed. Please try the status action again.'
          : error instanceof Error
            ? error.message
            : 'Could not copy the connection note',
        'error'
      );
    }
  };

  const handleDraftCandidateOutreach = (channel: 'inmail' | 'email') => {
    setDraftingChannel(channel);
    setOutreachDraftCopied(false);
    draftCandidateOutreach.mutate(channel, {
      onSuccess: ({ draft }) => {
        setOutreachDraft(draft);
        showToast(`${channel === 'inmail' ? 'InMail' : 'Email'} draft ready`, 'success');
      },
      onError: (error) =>
        showToast(
          error instanceof Error ? error.message : 'Could not create the outreach draft',
          'error'
        ),
      onSettled: () => setDraftingChannel(null),
    });
  };

  const handleCopyOutreachDraft = async () => {
    if (!outreachDraft) return;
    const copyText = `Subject: ${outreachDraft.subject}\n\n${outreachDraft.body}`.trim();
    try {
      await navigator.clipboard.writeText(copyText);
      setOutreachDraftCopied(true);
      showToast(
        `${outreachDraft.channel === 'inmail' ? 'InMail' : 'Email'} draft copied`,
        'success'
      );
      window.setTimeout(() => setOutreachDraftCopied(false), 2500);
    } catch {
      showToast('Could not copy the outreach draft', 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Back link */}
      <button
        onClick={returnToLeads}
        className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> Back to leads
      </button>

      {/* Header Card */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {/* Top bar with status pipeline */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <StatusPipeline status={lead.journeyStage} />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditOpen(true)}
              className="p-1.5 rounded hover:bg-slate-200 text-slate-500"
              title="Edit lead"
            >
              <Pencil size={16} />
            </button>
            {isSuperadmin && (
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
                title="Delete lead (superadmin only)"
              >
                <Trash2 size={16} />
              </button>
            )}
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
                </div>
                <div className="text-slate-500 text-sm">
                  {isPlaceholderEmail ? 'No email on file' : lead.email}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'px-3 py-1 rounded-full text-sm font-medium',
                  journeyBadgeClass(lead.journeyStage)
                )}
              >
                {journeyLabel(lead.journeyStage)}
              </span>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 mb-6">
            {/* Primary: Next Status */}
            {nextStatus && (
              <button
                onClick={() => handleStatusChange(nextStatus)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-white transition-colors bg-blue-600 hover:bg-blue-700"
              >
                <ArrowRight size={16} />
                Move to {journeyLabel(nextStatus)}
              </button>
            )}

            {/* Disqualify (available from any non-disqualified status) */}
            {lead.journeyStage !== 'disqualified' && (
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
            {lead.journeyStage === 'disqualified' && (
              <button
                onClick={() => handleStatusChange('new')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                <Sparkles size={16} />
                Re-qualify as New
              </button>
            )}

            {/* Outreach quick actions */}
            {['new', 'ready_to_reach_out'].includes(lead.journeyStage) && lead.linkedinUrl && (
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
              title="Read the saved lead details, score this lead, and draft a LinkedIn connection request note"
            >
              {generateAiAssessment.isPending ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <Sparkles size={16} />
              )}
              {generateAiAssessment.isPending
                ? 'Reading Profile…'
                : aiAssessment?.connectionNote
                  ? 'Regenerate Connection Note'
                  : 'Generate Connection Note'}
            </button>

            <button
              type="button"
              onClick={() => handleDraftCandidateOutreach('inmail')}
              disabled={draftCandidateOutreach.isPending}
              className="flex items-center gap-1.5 rounded-md border border-indigo-200 px-3 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-60"
              title="Run the playbook-grounded agent once and draft a concise LinkedIn InMail"
            >
              {draftingChannel === 'inmail' ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <Linkedin size={16} />
              )}
              {draftingChannel === 'inmail' ? 'Drafting InMail…' : 'Draft InMail'}
            </button>

            <button
              type="button"
              onClick={() => handleDraftCandidateOutreach('email')}
              disabled={draftCandidateOutreach.isPending}
              className="flex items-center gap-1.5 rounded-md border border-indigo-200 px-3 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-60"
              title="Run the playbook-grounded agent once and draft a concise cold email"
            >
              {draftingChannel === 'email' ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <Mail size={16} />
              )}
              {draftingChannel === 'email' ? 'Drafting Email…' : 'Draft Email'}
            </button>

            {lead.journeyStage === 'connected' && (
              <button
                onClick={() => handleStatusChange('engaged')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-green-200 text-green-600 hover:bg-green-50 transition-colors"
              >
                <MessageSquare size={16} />
                Mark as Replied
              </button>
            )}

            {lead.journeyStage === 'engaged' && (
              <button
                onClick={() => handleStatusChange('meeting_booked')}
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
                Set journey...
              </button>
              {statusDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setStatusDropdownOpen(false)}
                  />
                  <div className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1">
                    <div className="px-3 py-1.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                      Lead journey
                    </div>
                    {LEAD_JOURNEY_STAGES.map((s) => (
                      <button
                        key={s}
                        onClick={() => handleStatusChange(s)}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm hover:bg-slate-50 capitalize',
                          lead.journeyStage === s && 'font-medium text-blue-600 bg-blue-50'
                        )}
                      >
                        {journeyLabel(s)}
                        {lead.journeyStage === s && (
                          <span className="ml-2 text-xs text-blue-400">(current)</span>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {outreachDraft && (
            <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Sparkles size={17} className="text-indigo-600" />
                    <h2 className="font-semibold text-indigo-950">
                      Candidate Outreach Drafting Agent
                    </h2>
                    <span className="rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white">
                      {outreachDraft.channel === 'inmail' ? 'InMail' : 'Email'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-indigo-700">
                    Playbook-grounded · Runs only when clicked · Editable · Never auto-sent
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyOutreachDraft}
                  className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
                >
                  {outreachDraftCopied ? <Check size={15} /> : <Copy size={15} />}
                  {outreachDraftCopied ? 'Copied' : 'Copy Draft'}
                </button>
              </div>

              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-indigo-700">
                    Subject
                  </span>
                  <input
                    type="text"
                    value={outreachDraft.subject}
                    maxLength={80}
                    onChange={(event) =>
                      setOutreachDraft((current) =>
                        current ? { ...current, subject: event.target.value } : current
                      )
                    }
                    className="w-full rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wider text-indigo-700">
                    <span>Message</span>
                    <span className="font-medium normal-case text-slate-500">
                      {outreachDraft.body.trim()
                        ? outreachDraft.body.trim().split(/\s+/).length
                        : 0}{' '}
                      words
                    </span>
                  </span>
                  <textarea
                    value={outreachDraft.body}
                    rows={6}
                    onChange={(event) =>
                      setOutreachDraft((current) =>
                        current
                          ? {
                              ...current,
                              body: event.target.value,
                              wordCount: event.target.value.trim()
                                ? event.target.value.trim().split(/\s+/).length
                                : 0,
                            }
                          : current
                      )
                    }
                    className="w-full resize-y rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                </label>
              </div>
            </div>
          )}

          {aiAssessment && (
            <div className="ai-qualification-card mb-6 rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="ai-qualification-title font-semibold">AI Lead Qualification</h2>
                    <span className="rounded-full bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white">
                      {aiAssessment.overallScore}/100
                    </span>
                    <span className="ai-qualification-chip rounded-full border px-2.5 py-1 text-xs font-medium">
                      {aiAssessment.classification}
                    </span>
                  </div>
                  <p className="ai-qualification-accent mt-1 text-xs">
                    {hasConnectionNote
                      ? 'Generated from the lead details saved in CRM. Edit the note before copying if needed.'
                      : 'Scored automatically from the lead details saved in CRM. Generate a connection note when you are ready to reach out.'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="ai-qualification-chip rounded-full border px-2 py-0.5 text-xs">
                      Evidence: {aiAssessment.profileEvidenceQuality.replace(/_/g, ' ')}
                    </span>
                    <span className="ai-qualification-chip rounded-full border px-2 py-0.5 text-xs">
                      Timing: {aiAssessment.marketEntryTiming.replace(/_/g, ' ')}
                    </span>
                    <span className="ai-qualification-chip rounded-full border px-2 py-0.5 text-xs">
                      Need: {aiAssessment.candidateNeedEvidence}
                    </span>
                  </div>
                </div>
                {hasConnectionNote && (
                  <div className="flex flex-wrap items-center gap-2">
                    {connectionNoteDirty && (
                      <button
                        type="button"
                        onClick={handleSaveConnectionNote}
                        disabled={connectionNoteBusy}
                        className="ai-qualification-secondary-button flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-wait disabled:opacity-60 transition-colors"
                      >
                        <Save size={15} />
                        Save Changes
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleCopyConnectionNote(false)}
                      disabled={connectionNoteBusy}
                      className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-wait disabled:bg-violet-300 transition-colors"
                    >
                      {connectionNoteAction === 'copied' ? <Check size={15} /> : <Copy size={15} />}
                      {connectionNoteAction === 'copied' ? 'Copied' : 'Copy Note'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyConnectionNote(true)}
                      disabled={connectionNoteBusy}
                      className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-wait disabled:bg-blue-300 transition-colors"
                      title="Copy the edited note and set the LinkedIn outreach stage to connection request sent"
                    >
                      {connectionNoteAction === 'copied-and-sent' ? (
                        <Check size={15} />
                      ) : (
                        <Send size={15} />
                      )}
                      {connectionNoteAction === 'copied-and-sent'
                        ? 'Copied + Marked Sent'
                        : 'Copy + Connection Sent'}
                    </button>
                  </div>
                )}
              </div>

              {aiAssessment.reasoningSummary && (
                <p className="ai-qualification-muted mb-3 text-sm leading-relaxed">
                  {aiAssessment.reasoningSummary}
                </p>
              )}

              {hasConnectionNote && (
                <div className="ai-qualification-surface rounded-lg border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="ai-qualification-accent text-xs font-semibold uppercase tracking-wider">
                      LinkedIn connection note
                    </span>
                    <span
                      className={cn(
                        'text-xs font-medium',
                        connectionNoteCharacterCount <= 300 ? 'text-slate-500' : 'text-red-600'
                      )}
                    >
                      {connectionNoteCharacterCount}/300 characters
                    </span>
                  </div>
                  <textarea
                    value={connectionNoteDraft}
                    onChange={(event) => setConnectionNoteDraft(event.target.value)}
                    maxLength={300}
                    rows={4}
                    className="ai-qualification-input w-full resize-y rounded-md border px-3 py-2 text-sm leading-relaxed outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    aria-label="Editable LinkedIn connection note"
                  />
                </div>
              )}
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

            {lead.capturedByApiKeyLabel && (
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-md bg-indigo-100 flex items-center justify-center shrink-0">
                  <KeyRound size={14} className="text-indigo-600" />
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Owner
                  </div>
                  <div
                    className="text-sm font-medium text-indigo-700"
                    title="API key used to capture this lead"
                  >
                    {lead.capturedByApiKeyLabel}
                  </div>
                </div>
              </div>
            )}

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
          </div>

          {(lead.profileSummary ||
            lead.mostRecentDegree ||
            lead.mostRecentSchool ||
            (Array.isArray(lead.educationEntries) && lead.educationEntries.length > 0) ||
            (Array.isArray(lead.experienceEntries) && lead.experienceEntries.length > 0) ||
            (Array.isArray(lead.skillNames) && lead.skillNames.length > 0) ||
            ['pending', 'processing', 'failed'].includes(lead.profileNormalizationStatus)) && (
            <section className="mt-6 border-t border-slate-100 pt-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                  <Sparkles size={18} className="text-violet-600" />
                  Clean profile
                </h2>
                {['pending', 'processing'].includes(lead.profileNormalizationStatus) && (
                  <span className="flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
                    <LoaderCircle size={13} className="animate-spin" />
                    Cleaning captured profile
                  </span>
                )}
                {lead.profileNormalizationStatus === 'failed' && (
                  <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                    <AlertTriangle size={13} />
                    Cleanup will retry
                  </span>
                )}
              </div>

              {(lead.mostRecentDegree ||
                lead.mostRecentFieldOfStudy ||
                lead.mostRecentSchool ||
                lead.mostRecentGraduationDate) && (
                <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50/70 p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-white p-2 text-blue-600 shadow-sm">
                      <GraduationCap size={18} />
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                        Most recent education
                      </h3>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {[lead.mostRecentDegree, lead.mostRecentFieldOfStudy]
                          .filter(Boolean)
                          .join(' · ') || 'Degree not stated'}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {[lead.mostRecentSchool, lead.mostRecentGraduationDate]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {lead.profileSummary && (
                <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Summary
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-700">{lead.profileSummary}</p>
                  {(lead.headline || lead.location) && (
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      {lead.headline && <span>{lead.headline}</span>}
                      {lead.location && (
                        <span className="flex items-center gap-1">
                          <MapPin size={12} /> {lead.location}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                {Array.isArray(lead.educationEntries) && lead.educationEntries.length > 0 && (
                  <div>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <GraduationCap size={16} className="text-blue-600" />
                      Education
                    </h3>
                    <div className="space-y-2">
                      {lead.educationEntries.map((entry, index) => (
                        <div
                          key={`${entry.institution}-${index}`}
                          className="rounded-lg border border-slate-200 p-3"
                        >
                          <div className="text-sm font-semibold text-slate-800">
                            {entry.institution}
                          </div>
                          {(entry.degree || entry.fieldOfStudy) && (
                            <div className="mt-0.5 text-sm text-slate-600">
                              {[entry.degree, entry.fieldOfStudy].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          {(entry.startDate || entry.endDate) && (
                            <div className="mt-1 text-xs text-slate-400">
                              {[entry.startDate, entry.endDate].filter(Boolean).join(' – ')}
                            </div>
                          )}
                          {entry.description && (
                            <p className="mt-2 text-xs leading-relaxed text-slate-600">
                              {entry.description}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {Array.isArray(lead.experienceEntries) && lead.experienceEntries.length > 0 && (
                  <div>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <Briefcase size={16} className="text-emerald-600" />
                      Experience
                    </h3>
                    <div className="space-y-2">
                      {lead.experienceEntries.map((entry, index) => (
                        <div
                          key={`${entry.title}-${entry.organization ?? ''}-${index}`}
                          className="rounded-lg border border-slate-200 p-3"
                        >
                          <div className="text-sm font-semibold text-slate-800">{entry.title}</div>
                          {entry.organization && (
                            <div className="mt-0.5 text-sm text-slate-600">
                              {entry.organization}
                            </div>
                          )}
                          {(entry.startDate || entry.endDate || entry.isCurrent) && (
                            <div className="mt-1 text-xs text-slate-400">
                              {[entry.startDate, entry.isCurrent ? 'Present' : entry.endDate]
                                .filter(Boolean)
                                .join(' – ')}
                            </div>
                          )}
                          {entry.description && (
                            <p className="mt-2 text-xs leading-relaxed text-slate-600">
                              {entry.description}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {Array.isArray(lead.skillNames) && lead.skillNames.length > 0 && (
                <div className="mt-5">
                  <h3 className="mb-2 text-sm font-semibold text-slate-800">Skills</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {lead.skillNames.map((skill) => (
                      <span
                        key={skill}
                        className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

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
          filters={{ leadId: lead.id }}
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
          filters={{ leadId: lead.id }}
          entityName={`${lead.firstName} ${lead.lastName}`}
        />
      )}
    </div>
  );
}
