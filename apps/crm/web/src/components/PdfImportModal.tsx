import { useState, useRef } from 'react';
import { useImportDocument, useConfirmDocumentImport, type DocumentImportResult } from '../hooks/use-api.js';
import { Upload, FileText, AlertTriangle, X, Check, Loader2, Building2, User, Mail, Phone, Link, MapPin, Tag, Briefcase, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils.js';

interface PdfImportModalProps {
  open: boolean;
  onClose: () => void;
}

const LEAD_TYPE_OPTIONS = [
  { value: 'candidate', label: 'Candidate / Resume' },
  { value: 'client', label: 'Client / Company' },
  { value: 'vendor', label: 'Vendor / Subcontractor' },
  { value: 'job_rfp', label: 'Job / RFP' },
  { value: 'other', label: 'Other' },
];

export default function PdfImportModal({ open, onClose }: PdfImportModalProps) {
  const [leadType, setLeadType] = useState('candidate');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<DocumentImportResult | null>(null);
  const [step, setStep] = useState<'upload' | 'review' | 'success'>('upload');
  const [editedLead, setEditedLead] = useState<DocumentImportResult['draftLead'] | null>(null);
  const [createCompany, setCreateCompany] = useState(true);
  const [createContact, setCreateContact] = useState(true);
  const [force, setForce] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importMutation = useImportDocument();
  const confirmMutation = useConfirmDocumentImport();

  if (!open) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('leadType', leadType);
    importMutation.mutate(formData, {
      onSuccess: (data) => {
        setResult(data);
        setEditedLead(data.draftLead);
        setStep('review');
      },
    });
  };

  const handleConfirm = async () => {
    if (!editedLead) return;
    confirmMutation.mutate(
      { lead: editedLead as unknown as Record<string, unknown>, force, createCompany, createContact },
      {
        onSuccess: () => {
          setStep('success');
          setTimeout(() => {
            handleReset();
            onClose();
          }, 2000);
        },
      }
    );
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
    setEditedLead(null);
    setStep('upload');
    setForce(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-[640px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Upload size={20} className="text-blue-600" />
            <h2 className="text-lg font-semibold">Add Lead from PDF</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100">
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 'upload' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Document Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {LEAD_TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setLeadType(opt.value)}
                      className={cn(
                        'px-3 py-2 rounded-lg text-sm border text-left transition-colors',
                        leadType === opt.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-slate-200 hover:bg-slate-50'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div
                className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileText size={32} className="mx-auto mb-2 text-slate-400" />
                <p className="text-sm font-medium text-slate-700">
                  {file ? file.name : 'Click to upload a document'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {file ? `${(file.size / 1024).toFixed(1)} KB` : 'PDF, DOCX, PPTX, XLSX, CSV, TXT. Max 10MB.'}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.pptx,.xlsx,.csv,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {file && (
                <button
                  onClick={handleUpload}
                  disabled={importMutation.isPending}
                  className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {importMutation.isPending ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    <>
                      <Upload size={18} />
                      Extract Lead
                    </>
                  )}
                </button>
              )}

              {importMutation.isError && (
                <div className="flex items-start gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <div>
                    {(importMutation.error as Error)?.message ?? 'Extraction failed. Please try again.'}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'review' && editedLead && result && (
            <div className="space-y-4">
              {/* Confidence score */}
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <div className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm',
                  editedLead.confidence >= 0.7 ? 'bg-green-500' :
                  editedLead.confidence >= 0.4 ? 'bg-amber-500' : 'bg-red-500'
                )}>
                  {Math.round(editedLead.confidence * 100)}%
                </div>
                <div>
                  <div className="text-sm font-medium">Confidence</div>
                  <div className="text-xs text-slate-500">
                    {editedLead.confidence >= 0.7 ? 'High' : editedLead.confidence >= 0.4 ? 'Medium' : 'Low'} — review before saving
                  </div>
                </div>
              </div>

              {/* Conversion metadata */}
              <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                <div className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm',
                  result.usedFallback ? 'bg-amber-500' : 'bg-blue-500'
                )}>
                  {result.usedFallback ? '!' : 'MD'}
                </div>
                <div>
                  <div className="text-sm font-medium">
                    {result.usedFallback ? 'Local PDF extraction (fallback)' : 'Document converted to Markdown'}
                  </div>
                  <div className="text-xs text-slate-500">
                    {result.estimatedTokens ? `~${result.estimatedTokens.toLocaleString()} tokens` : ''}
                    {result.charCount ? ` · ${result.charCount.toLocaleString()} chars` : ''}
                    {result.fallbackReason ? ` · ${result.fallbackReason}` : ''}
                  </div>
                </div>
              </div>

              {/* Conversion warnings */}
              {result.conversionWarnings && result.conversionWarnings.length > 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 text-amber-800 rounded-lg text-sm">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium">Conversion warnings:</span>{' '}
                    {result.conversionWarnings.join(', ')}
                  </div>
                </div>
              )}

              {/* Missing fields warning */}
              {editedLead.missingFields.length > 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 text-amber-800 rounded-lg text-sm">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium">Missing or uncertain:</span>{' '}
                    {editedLead.missingFields.join(', ')}
                  </div>
                </div>
              )}

              {/* Duplicates warning */}
              {result.duplicates.length > 0 && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm">
                  <div className="flex items-center gap-2 text-yellow-800 font-medium mb-2">
                    <AlertTriangle size={16} />
                    Possible duplicates found
                  </div>
                  <div className="space-y-1">
                    {result.duplicates.map((d) => (
                      <div key={d.id} className="text-yellow-700 text-xs">
                        {d.firstName} {d.lastName} — {d.email} {d.phone ? `(${d.phone})` : ''}
                      </div>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 mt-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                    Create anyway (ignore duplicates)
                  </label>
                </div>
              )}

              {/* Editable form */}
              <div className="grid grid-cols-2 gap-3">
                <Field icon={<User size={14} />} label="First Name" value={editedLead.firstName} onChange={(v) => setEditedLead({ ...editedLead, firstName: v })} required />
                <Field icon={<User size={14} />} label="Last Name" value={editedLead.lastName} onChange={(v) => setEditedLead({ ...editedLead, lastName: v })} required />
                <Field icon={<Mail size={14} />} label="Email" value={editedLead.email} onChange={(v) => setEditedLead({ ...editedLead, email: v })} required />
                <Field icon={<Phone size={14} />} label="Phone" value={editedLead.phone} onChange={(v) => setEditedLead({ ...editedLead, phone: v })} />
                <Field icon={<Building2 size={14} />} label="Company" value={editedLead.companyName} onChange={(v) => setEditedLead({ ...editedLead, companyName: v })} />
                <Field icon={<Briefcase size={14} />} label="Title" value={editedLead.title} onChange={(v) => setEditedLead({ ...editedLead, title: v })} />
                <Field icon={<Link size={14} />} label="LinkedIn" value={editedLead.linkedinUrl} onChange={(v) => setEditedLead({ ...editedLead, linkedinUrl: v })} />
                <Field icon={<MapPin size={14} />} label="Location" value={editedLead.location} onChange={(v) => setEditedLead({ ...editedLead, location: v })} />
                <Field icon={<Link size={14} />} label="Website" value={editedLead.website} onChange={(v) => setEditedLead({ ...editedLead, website: v })} />
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Lead Type</label>
                  <select
                    value={editedLead.leadType}
                    onChange={(e) => setEditedLead({ ...editedLead, leadType: e.target.value as DocumentImportResult['draftLead']['leadType'] })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {LEAD_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <Field icon={<Tag size={14} />} label="Tags (comma-separated)" value={editedLead.tags.join(', ')} onChange={(v) => setEditedLead({ ...editedLead, tags: v.split(',').map(t => t.trim()).filter(Boolean) })} fullWidth />
              <Field icon={<FileText size={14} />} label="Notes / Summary" value={editedLead.notes} onChange={(v) => setEditedLead({ ...editedLead, notes: v })} fullWidth textarea />

              {/* Options */}
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={createCompany} onChange={(e) => setCreateCompany(e.target.checked)} />
                  Create company if not found
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={createContact} onChange={(e) => setCreateContact(e.target.checked)} />
                  Create contact
                </label>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleReset}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50"
                >
                  Start Over
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={confirmMutation.isPending || !editedLead.email || !editedLead.firstName}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {confirmMutation.isPending ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Check size={18} />
                      Create Lead
                    </>
                  )}
                </button>
              </div>

              {confirmMutation.isError && (
                <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                  {(confirmMutation.error as Error)?.message ?? 'Failed to create lead.'}
                </div>
              )}
            </div>
          )}

          {step === 'success' && (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check size={32} className="text-green-600" />
              </div>
              <h3 className="text-lg font-semibold text-green-700">Lead Created!</h3>
              <p className="text-sm text-slate-500 mt-1">Redirecting to leads...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  icon,
  label,
  value,
  onChange,
  required,
  fullWidth,
  textarea,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  fullWidth?: boolean;
  textarea?: boolean;
}) {
  return (
    <div className={fullWidth ? 'col-span-2' : ''}>
      <label className="flex items-center gap-1 text-xs font-medium text-slate-500 mb-1">
        {icon}
        {label}
        {required && <span className="text-red-500">*</span>}
      </label>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}
    </div>
  );
}
