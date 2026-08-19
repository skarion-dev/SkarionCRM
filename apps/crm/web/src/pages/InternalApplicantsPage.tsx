import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  Search,
  Star,
  UserRound,
  X,
} from 'lucide-react';
import {
  useInternalApplicant,
  useInternalApplicants,
  useUpdateInternalApplicant,
} from '../hooks/use-api.js';
import type { InternalApplicant, InternalApplicantStatus } from '../api.js';
import { downloadInternalApplicantDocument } from '../api.js';
import { cn } from '../lib/utils.js';
import { showToast } from '../stores/toast.js';

const STATUS_OPTIONS: Array<{ value: InternalApplicantStatus; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'screening', label: 'Screening' },
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'interview', label: 'Interview' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'offer', label: 'Offer' },
  { value: 'hired', label: 'Hired' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

function scoreTone(score: number | null): string {
  if (score === null) return 'text-slate-400';
  if (score >= 75) return 'text-emerald-600';
  if (score >= 55) return 'text-amber-600';
  return 'text-slate-500';
}

function statusTone(status: InternalApplicantStatus): string {
  if (status === 'hired' || status === 'offer') return 'bg-emerald-100 text-emerald-700';
  if (status === 'rejected' || status === 'withdrawn') return 'bg-slate-100 text-slate-500';
  if (status === 'interview' || status === 'assessment') return 'bg-purple-100 text-purple-700';
  if (status === 'shortlisted') return 'bg-blue-100 text-blue-700';
  return 'bg-amber-100 text-amber-700';
}

function recommendationTone(recommendation: string | null): string {
  if (recommendation === 'High priority') return 'text-emerald-600';
  if (recommendation === 'Review') return 'text-amber-600';
  return 'text-slate-400';
}

function isDoNotContact(applicant: InternalApplicant): boolean {
  return (applicant.tags ?? []).some((tag) =>
    ['do not contact', 'do_not_contact', 'screened_no_contact'].includes(tag.toLowerCase())
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ApplicantDetail({
  applicant,
  onClose,
  fullPage = false,
}: {
  applicant: InternalApplicant;
  onClose: () => void;
  fullPage?: boolean;
}) {
  const { data, isLoading } = useInternalApplicant(applicant.id);
  const update = useUpdateInternalApplicant();
  const [notes, setNotes] = useState(applicant.notes ?? '');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const doNotContact = isDoNotContact(applicant);

  useEffect(() => setNotes(applicant.notes ?? ''), [applicant.id, applicant.notes]);

  const save = (dataToSave: Parameters<typeof update.mutate>[0]['data']) => {
    update.mutate(
      { id: applicant.id, data: dataToSave },
      {
        onSuccess: () => showToast('Applicant updated.', 'success'),
        onError: (error) =>
          showToast(error instanceof Error ? error.message : 'Update failed.', 'error'),
      }
    );
  };

  const downloadDocument = async (documentId: string, fileName: string) => {
    setDownloadingId(documentId);
    try {
      const response = await downloadInternalApplicantDocument(applicant.id, documentId);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Resume download failed.', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div
      className={cn(
        fullPage
          ? 'min-h-[calc(100vh-5rem)]'
          : 'fixed inset-0 z-50 flex justify-end bg-slate-950/30'
      )}
      onClick={fullPage ? undefined : onClose}
    >
      <aside
        className={cn(
          fullPage
            ? 'mx-auto min-h-[calc(100vh-5rem)] w-full max-w-6xl overflow-y-auto bg-white'
            : 'h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl'
        )}
        onClick={fullPage ? undefined : (event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-semibold',
                doNotContact ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
              )}
            >
              {initials(applicant.fullName)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-lg font-semibold text-slate-900">
                  {applicant.fullName}
                </h2>
                <span className="font-mono text-xs text-slate-400">
                  {applicant.applicantNumber}
                </span>
              </div>
              <p className="truncate text-sm text-slate-500">{applicant.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close applicant details"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-6 p-6">
          {doNotContact && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle size={17} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">Do not contact</div>
                <div className="text-xs text-red-700">
                  This candidate has already been screened. Contact only with explicit
                  hiring-manager approval.
                </div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-400">Overall</div>
              <div className={cn('mt-1 text-xl font-semibold', scoreTone(applicant.overallScore))}>
                {applicant.overallScore ?? '—'}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-400">Skills</div>
              <div className="mt-1 text-xl font-semibold text-slate-700">
                {applicant.skillsScore ?? '—'}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-400">Education</div>
              <div className="mt-1 text-xl font-semibold text-slate-700">
                {applicant.educationScore ?? '—'}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-400">Culture proxy</div>
              <div className="mt-1 text-xl font-semibold text-slate-700">
                {applicant.cultureScore ?? '—'}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Workflow stage
              <select
                value={applicant.status}
                onChange={(event) =>
                  save({ status: event.target.value as InternalApplicantStatus })
                }
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-sm font-medium text-slate-700">
              Recommendation
              <div
                className={cn(
                  'mt-2 text-base font-semibold',
                  recommendationTone(applicant.recommendation)
                )}
              >
                {applicant.recommendation ?? 'Needs review'}
              </div>
            </div>
          </div>

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <BriefcaseBusiness size={16} /> Applied roles
            </h3>
            <div className="flex flex-wrap gap-2">
              {(applicant.rolesApplied ?? []).map((role) => (
                <span
                  key={role}
                  className="rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700"
                >
                  {role}
                </span>
              ))}
            </div>
          </section>

          <section className="grid gap-3 rounded-lg border border-slate-200 p-4 text-sm sm:grid-cols-2">
            <div>
              <div className="text-xs text-slate-400">University / institute</div>
              <div className="mt-1 text-slate-700">{applicant.university || 'Not provided'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">School</div>
              <div className="mt-1 text-slate-700">{applicant.school || 'Not provided'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">GPA · graduation</div>
              <div className="mt-1 text-slate-700">
                {applicant.gpa ?? '—'} · {applicant.graduationYear ?? '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Education location</div>
              <div className="mt-1 flex items-center gap-1 text-slate-700">
                <MapPin size={14} />
                {applicant.educationLocation || 'Not provided'}
                {applicant.schoolOutsideDhaka && (
                  <span className="ml-1 text-xs text-amber-600">(outside Dhaka proxy)</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Email / phone</div>
              <div className="mt-1 text-slate-700">
                {applicant.email}
                {applicant.phone ? ` · ${applicant.phone}` : ''}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Received</div>
              <div className="mt-1 text-slate-700">
                {formatDate(applicant.firstReceivedAt)} – {formatDate(applicant.lastReceivedAt)}
              </div>
            </div>
          </section>

          <section className="grid gap-3 rounded-lg border border-slate-200 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-xs text-slate-400">Source</div>
              <div className="mt-1 text-slate-700">{applicant.source}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Messages received</div>
              <div className="mt-1 text-slate-700">{applicant.messageCount}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">First received</div>
              <div className="mt-1 text-slate-700">{formatDate(applicant.firstReceivedAt)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Last received</div>
              <div className="mt-1 text-slate-700">{formatDate(applicant.lastReceivedAt)}</div>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Screening evidence</h3>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <div>
                <div className="text-xs text-slate-400">Skills score</div>
                <div className="mt-1 font-semibold text-slate-700">
                  {applicant.skillsScore ?? '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Education score</div>
                <div className="mt-1 font-semibold text-slate-700">
                  {applicant.educationScore ?? '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Culture evidence</div>
                <div className="mt-1 font-semibold text-slate-700">
                  {applicant.cultureEvidenceCount}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Projects</div>
                <div className="mt-1 font-semibold text-slate-700">
                  {applicant.projectEvidenceCount}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Completeness</div>
                <div className="mt-1 font-semibold text-slate-700">
                  {applicant.completenessCount}
                </div>
              </div>
            </div>
            {applicant.schoolOutsideDhaka && (
              <div className="mt-3 text-xs text-amber-700">
                Education location proxy applied: {applicant.locationProxyAdjustment} points.
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Star size={16} /> Skills
            </h3>
            <p className="text-sm leading-6 text-slate-600">
              {(applicant.skills ?? []).join(' · ') ||
                'No normalized skills found in the source material.'}
            </p>
          </section>

          <section>
            <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <ClipboardList size={16} /> Hiring notes
            </label>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              placeholder="Add interview notes, follow-ups, or decision context…"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <button
              onClick={() => save({ notes })}
              disabled={update.isPending}
              className="mt-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {update.isPending ? 'Saving…' : 'Save notes'}
            </button>
          </section>

          {isLoading ? (
            <div className="text-sm text-slate-400">Loading source documents and messages…</div>
          ) : (
            data && (
              <>
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <FileText size={16} /> Source documents ({data.documents.length})
                  </h3>
                  <div className="space-y-2">
                    {data.documents.map((document) => (
                      <div
                        key={document.id}
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-700">
                              {document.fileName}
                            </div>
                            <div className="text-xs text-slate-400">
                              {document.documentType} · {document.mimeType || 'unknown type'}
                              {document.storageKey ? ` · ${document.storageKey}` : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void downloadDocument(document.id, document.fileName)}
                            disabled={downloadingId === document.id}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:border-blue-400 hover:text-blue-700 disabled:opacity-50"
                          >
                            <Download size={13} />
                            {downloadingId === document.id ? 'Downloading…' : 'Download'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <Mail size={16} /> Source messages ({data.messages.length})
                  </h3>
                  <div className="space-y-2">
                    {data.messages.map((message) => (
                      <details
                        key={message.id}
                        className="rounded-md border border-slate-200 px-3 py-2"
                      >
                        <summary className="cursor-pointer text-sm font-medium text-slate-700">
                          {message.subject || 'Untitled message'}{' '}
                          <span className="ml-1 text-xs font-normal text-slate-400">
                            {formatDate(message.receivedAt)}
                          </span>
                        </summary>
                        <div className="mt-3 whitespace-pre-wrap text-xs leading-5 text-slate-600">
                          {message.rawEmailText || 'No raw body captured.'}
                        </div>
                      </details>
                    ))}
                  </div>
                </section>
              </>
            )
          )}

          <details className="rounded-md border border-slate-200 px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">
              Raw email text {applicant.rawTextTruncated ? '(truncated)' : ''}
            </summary>
            <div className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">
              {applicant.rawEmailText || 'No raw email text captured.'}
            </div>
          </details>
          {applicant.resumeText && (
            <details className="rounded-md border border-slate-200 px-3 py-2">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                Extracted resume text
              </summary>
              <div className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">
                {applicant.resumeText}
              </div>
            </details>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function InternalApplicantsPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<InternalApplicantStatus | ''>('');
  const [recommendation, setRecommendation] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<InternalApplicant | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const { data, isLoading, error } = useInternalApplicants({
    page,
    pageSize: 50,
    search: debouncedSearch,
    status,
    recommendation,
  });
  const applicants = data?.applicants ?? [];
  const pageCount = useMemo(
    () => Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 50))),
    [data?.pageSize, data?.total]
  );

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <UserRound className="text-blue-600" size={22} />
            <h1 className="text-2xl font-semibold text-slate-900">Skarion Internal Applicants</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            A private recruiting workspace for applicants sourced from Outlook. Review evidence,
            coordinate workflow stages, and keep decisions separate from the sales CRM.
          </p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <div className="flex items-center gap-1 font-semibold">
            <AlertCircle size={14} /> Review scoring before decisions
          </div>
          <div className="mt-1">
            School location is a separate low-weight proxy, not a culture judgment.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ['Applicants', data?.stats.total ?? 0, 'text-slate-800'],
          ['With resume', data?.stats.withResume ?? 0, 'text-blue-600'],
          ['High priority', data?.stats.highPriority ?? 0, 'text-emerald-600'],
          ['Review', data?.stats.review ?? 0, 'text-amber-600'],
          ['Hold / incomplete', data?.stats.hold ?? 0, 'text-slate-500'],
        ].map(([label, value, tone]) => (
          <div
            key={String(label)}
            className="rounded-lg border border-slate-200 bg-white px-4 py-3"
          >
            <div className="text-xs text-slate-400">{label}</div>
            <div className={cn('mt-1 text-2xl font-semibold', tone)}>{value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="relative min-w-[240px] flex-1">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, applicant ID…"
            className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as InternalApplicantStatus | '');
            setPage(1);
          }}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">All stages</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={recommendation}
          onChange={(event) => {
            setRecommendation(event.target.value);
            setPage(1);
          }}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">All recommendations</option>
          <option value="High priority">High priority</option>
          <option value="Review">Review</option>
          <option value="Hold / incomplete">Hold / incomplete</option>
        </select>
        <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
          <button
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
            className="rounded-md border border-slate-200 p-1.5 hover:bg-slate-50 disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {page} / {pageCount}
          </span>
          <button
            disabled={page >= pageCount}
            onClick={() => setPage((current) => current + 1)}
            className="rounded-md border border-slate-200 p-1.5 hover:bg-slate-50 disabled:opacity-40"
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {isLoading ? (
          <div className="p-12 text-center text-sm text-slate-400">Loading applicants…</div>
        ) : error ? (
          <div className="p-12 text-center text-sm text-red-500">
            Unable to load applicants. Hiring manager access may be required.
          </div>
        ) : applicants.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">
            No applicants match these filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1050px] w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Applicant</th>
                  <th className="px-4 py-3">Applied roles</th>
                  <th className="px-4 py-3">Education</th>
                  <th className="px-4 py-3">Scores</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Recommendation</th>
                  <th className="px-4 py-3">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {applicants.map((applicant) => (
                  <tr
                    key={applicant.id}
                    className={cn(
                      'cursor-pointer',
                      isDoNotContact(applicant)
                        ? 'bg-red-50 hover:bg-red-100/70'
                        : 'hover:bg-blue-50/40'
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                            isDoNotContact(applicant)
                              ? 'bg-red-100 text-red-700'
                              : 'bg-slate-100 text-slate-600'
                          )}
                        >
                          {initials(applicant.fullName)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-medium text-slate-800">
                            <Link
                              to={`/internal-applicants/${applicant.applicantNumber}`}
                              className="hover:text-blue-600 hover:underline"
                            >
                              {applicant.fullName}
                            </Link>
                            <a
                              href={`/internal-applicants/${applicant.applicantNumber}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-slate-400 hover:text-blue-600"
                              aria-label={`Open ${applicant.fullName} in a new tab`}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <ExternalLink size={14} />
                            </a>
                            {isDoNotContact(applicant) && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                                <AlertTriangle size={11} /> Do not contact
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-xs text-slate-400">
                            {applicant.applicantNumber} · {applicant.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[230px] px-4 py-3">
                      <div className="line-clamp-2 text-slate-600">
                        {(applicant.rolesApplied ?? []).join(' · ') || 'Unclear / mixed'}
                      </div>
                    </td>
                    <td className="max-w-[220px] px-4 py-3">
                      <div className="truncate text-slate-700">
                        {applicant.university || 'Not provided'}
                      </div>
                      <div className="text-xs text-slate-400">
                        GPA {applicant.gpa ?? '—'} · {applicant.graduationYear ?? '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className={cn('font-semibold', scoreTone(applicant.overallScore))}>
                        {applicant.overallScore ?? '—'}
                      </div>
                      <div className="text-xs text-slate-400">
                        Skills {applicant.skillsScore ?? '—'} · Edu{' '}
                        {applicant.educationScore ?? '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'rounded-full px-2 py-1 text-xs font-medium',
                          statusTone(applicant.status)
                        )}
                      >
                        {STATUS_OPTIONS.find((option) => option.value === applicant.status)
                          ?.label ?? applicant.status}
                      </span>
                    </td>
                    <td
                      className={cn(
                        'px-4 py-3 font-medium',
                        recommendationTone(applicant.recommendation)
                      )}
                    >
                      {applicant.recommendation ?? 'Needs review'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {formatDate(applicant.firstReceivedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-400">
        Showing {applicants.length} of {data?.total ?? 0} applicants. Blank fields mean the source
        material did not provide usable evidence.
      </p>
      {selected && <ApplicantDetail applicant={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

export function InternalApplicantProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useInternalApplicant(id ?? null);

  if (isLoading)
    return (
      <div className="p-12 text-center text-sm text-slate-400">Loading applicant profile…</div>
    );
  if (error || !data)
    return (
      <div className="p-12 text-center text-sm text-red-500">
        Applicant profile could not be loaded.
      </div>
    );
  return (
    <ApplicantDetail
      applicant={data.applicant}
      onClose={() => navigate('/internal-applicants')}
      fullPage
    />
  );
}
