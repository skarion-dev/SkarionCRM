import { useState, type FormEvent } from 'react';
import { useCreateEntity } from '../hooks/use-api.js';
import { crmFetch } from '../api.js';
import { Upload, AlertCircle, CheckCircle2, X, Eye, FileCheck, ArrowLeft, User, Mail, Building2, Linkedin } from 'lucide-react';
import Modal from './ui/Modal.js';

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  type: 'companies' | 'contacts' | 'leads';
  title: string;
  sampleCsv: string;
}

interface PreviewRow {
  firstName: string;
  lastName: string;
  email: string;
  companyName?: string | null;
  linkedinUrl?: string | null;
  conflicts?: string[];
  canImport?: boolean;
}

interface PreviewResult {
  preview: PreviewRow[];
  totalRows: number;
  importableCount: number;
  dbDuplicates: number;
  errors: { row: number; field: string; message: string }[];
  duplicates: { row: number; reason: string }[];
  warnings: { row: number; message: string }[];
  allRows: PreviewRow[];
}

export default function ImportModal({ open, onClose, type, title, sampleCsv }: ImportModalProps) {
  const [csvText, setCsvText] = useState('');
  const [step, setStep] = useState<'input' | 'preview' | 'importing' | 'done'>('input');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<{
    imported: number;
    errors: { row: number; field: string; message: string }[];
    duplicates: { row: number; reason: string }[];
    warnings: { row: number; message: string }[];
  } | null>(null);
  const create = useCreateEntity(`import/${type}`);

  const handleFile = async (file: File) => {
    const text = await file.text();
    setCsvText(text);
    setStep('input');
    setPreview(null);
    setResult(null);
  };

  const handlePreview = async (e: FormEvent) => {
    e.preventDefault();
    if (!csvText.trim()) return;
    setStep('preview');
    try {
      const data = await crmFetch<PreviewResult>(`/api/import/${type}/preview`, {
        method: 'POST',
        body: JSON.stringify({ csv: csvText }),
      });
      setPreview(data);
    } catch (err) {
      setPreview({
        preview: [],
        totalRows: 0,
        importableCount: 0,
        dbDuplicates: 0,
        errors: [{ row: 0, field: 'preview', message: err instanceof Error ? err.message : 'Preview failed' }],
        duplicates: [],
        warnings: [],
        allRows: [],
      });
    }
  };

  const handleImport = () => {
    setStep('importing');
    setResult(null);
    create.mutate(
      { csv: csvText },
      {
        onSuccess: (data) => {
          setResult(data as unknown as {
            imported: number;
            errors: { row: number; field: string; message: string }[];
            duplicates: { row: number; reason: string }[];
            warnings: { row: number; message: string }[];
          });
          setStep('done');
        },
        onError: (err) => {
          setResult({
            imported: 0,
            errors: [{ row: 0, field: 'import', message: err instanceof Error ? err.message : 'Import failed' }],
            duplicates: [],
            warnings: [],
          });
          setStep('done');
        },
      }
    );
  };

  const handleClose = () => {
    setCsvText('');
    setStep('input');
    setPreview(null);
    setResult(null);
    onClose();
  };

  const handleBack = () => {
    setStep('input');
    setPreview(null);
    setResult(null);
  };

  const isPending = create.isPending || step === 'importing';

  return (
    <Modal open={open} onClose={handleClose} title={`Import ${title}`}>
      <div className="space-y-4 max-h-[70vh] overflow-y-auto">
        {/* Step 1: Input */}
        {step === 'input' && (
          <>
            <div
              className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:bg-slate-50 transition-colors cursor-pointer"
              onClick={() => document.getElementById('csv-file')?.click()}
            >
              <Upload size={24} className="mx-auto text-slate-400 mb-2" />
              <div className="text-sm font-medium text-slate-600">Click to upload CSV file</div>
              <div className="text-xs text-slate-400 mt-1">Or paste text below</div>
              <input
                id="csv-file"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = '';
                }}
              />
            </div>

            <form onSubmit={handlePreview} className="space-y-3">
              <textarea
                value={csvText}
                onChange={(e) => { setCsvText(e.target.value); setPreview(null); setResult(null); }}
                rows={8}
                className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm font-mono text-xs"
                placeholder={sampleCsv}
              />

              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-400">
                  Expected CSV format shown in placeholder
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setCsvText(''); setPreview(null); setResult(null); }}
                    className="px-3 py-2 rounded-md text-sm border border-slate-200 hover:bg-slate-50"
                  >
                    Clear
                  </button>
                  <button
                    type="submit"
                    disabled={!csvText.trim()}
                    className="px-3 py-2 rounded-md text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    <Eye size={14} /> Preview
                  </button>
                </div>
              </div>
            </form>
          </>
        )}

        {/* Step 2: Preview */}
        {step === 'preview' && preview && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={handleBack}
                className="text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1"
              >
                <ArrowLeft size={14} /> Back
              </button>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="bg-slate-50 rounded-lg p-2">
                <div className="text-lg font-semibold text-slate-700">{preview.totalRows}</div>
                <div className="text-xs text-slate-500">Total rows</div>
              </div>
              <div className="bg-green-50 rounded-lg p-2">
                <div className="text-lg font-semibold text-green-700">{preview.importableCount}</div>
                <div className="text-xs text-green-600">Ready to import</div>
              </div>
              <div className="bg-amber-50 rounded-lg p-2">
                <div className="text-lg font-semibold text-amber-700">{preview.duplicates.length + preview.dbDuplicates}</div>
                <div className="text-xs text-amber-600">Duplicates</div>
              </div>
              <div className="bg-red-50 rounded-lg p-2">
                <div className="text-lg font-semibold text-red-700">{preview.errors.length}</div>
                <div className="text-xs text-red-600">Errors</div>
              </div>
            </div>

            {/* Warnings */}
            {preview.warnings.length > 0 && (
              <div className="text-xs text-blue-600 bg-blue-50 rounded-lg p-3">
                <div className="flex items-center gap-2 font-medium mb-1">
                  <AlertCircle size={14} />
                  <span>{preview.warnings.length} warnings</span>
                </div>
                <ul className="space-y-0.5 max-h-20 overflow-y-auto">
                  {preview.warnings.slice(0, 5).map((warn, i) => (
                    <li key={i}>Row {warn.row}: {warn.message}</li>
                  ))}
                  {preview.warnings.length > 5 && <li className="text-slate-400">...and {preview.warnings.length - 5} more</li>}
                </ul>
              </div>
            )}

            {/* Preview table */}
            {preview.allRows.length > 0 && (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 flex items-center justify-between">
                  <span>Preview ({preview.allRows.length} rows shown)</span>
                  <span className="text-slate-400">{preview.allRows.filter(r => r.canImport).length} will be imported</span>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-slate-600">Status</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-600">Name</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-600">Email</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-600">Company</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-600">LinkedIn</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.allRows.map((row, i) => (
                        <tr key={i} className={row.canImport ? '' : 'bg-red-50/50'}>
                          <td className="px-3 py-2">
                            {row.canImport ? (
                              <span className="inline-flex items-center gap-1 text-green-600">
                                <CheckCircle2 size={12} /> OK
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-red-600">
                                <X size={12} /> Skip
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <User size={12} className="text-slate-400" />
                              <span className={row.canImport ? '' : 'text-slate-400 line-through'}>
                                {row.firstName} {row.lastName}
                              </span>
                            </div>
                            {row.conflicts && row.conflicts.length > 0 && (
                              <div className="text-red-500 text-[10px] mt-0.5">{row.conflicts.join(', ')}</div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <Mail size={12} className="text-slate-400" />
                              <span className={row.email?.includes('@placeholder.skarion') ? 'text-slate-400 italic' : ''}>
                                {row.email}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {row.companyName && (
                              <div className="flex items-center gap-1">
                                <Building2 size={12} className="text-slate-400" />
                                {row.companyName}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {row.linkedinUrl && (
                              <div className="flex items-center gap-1">
                                <Linkedin size={12} className="text-blue-400" />
                                <span className="truncate max-w-[120px] inline-block">{row.linkedinUrl.replace('https://', '')}</span>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Errors */}
            {preview.errors.length > 0 && (
              <div className="bg-red-50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-sm text-red-700 font-medium mb-1">
                  <AlertCircle size={14} />
                  <span>{preview.errors.length} rows have errors and will be skipped</span>
                </div>
                <ul className="text-xs text-red-600 space-y-0.5 max-h-20 overflow-y-auto">
                  {preview.errors.slice(0, 5).map((err, i) => (
                    <li key={i}>Row {err.row}: {err.field} — {err.message}</li>
                  ))}
                  {preview.errors.length > 5 && <li className="text-slate-400">...and {preview.errors.length - 5} more</li>}
                </ul>
              </div>
            )}

            {/* Duplicates */}
            {preview.duplicates.length > 0 && (
              <div className="bg-amber-50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-sm text-amber-700 font-medium mb-1">
                  <AlertCircle size={14} />
                  <span>{preview.duplicates.length} duplicate rows within CSV will be skipped</span>
                </div>
                <ul className="text-xs text-amber-600 space-y-0.5 max-h-20 overflow-y-auto">
                  {preview.duplicates.slice(0, 5).map((dup, i) => (
                    <li key={i}>Row {dup.row}: {dup.reason}</li>
                  ))}
                  {preview.duplicates.length > 5 && <li className="text-slate-400">...and {preview.duplicates.length - 5} more</li>}
                </ul>
              </div>
            )}

            {/* DB duplicates */}
            {preview.dbDuplicates > 0 && (
              <div className="bg-amber-50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-sm text-amber-700 font-medium">
                  <AlertCircle size={14} />
                  <span>{preview.dbDuplicates} rows already exist in the database and will be skipped</span>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={handleBack}
                className="px-3 py-2 rounded-md text-sm border border-slate-200 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={preview.importableCount === 0 || isPending}
                className="px-3 py-2 rounded-md text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                <FileCheck size={14} />
                {isPending ? 'Importing...' : `Import ${preview.importableCount} rows`}
              </button>
            </div>
          </>
        )}

        {/* Step 3: Importing spinner */}
        {step === 'importing' && (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-slate-500">Importing leads...</p>
          </div>
        )}

        {/* Step 4: Done / Results */}
        {step === 'done' && result && (
          <div className="space-y-2">
            {result.imported > 0 && (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg p-3">
                <CheckCircle2 size={16} />
                <span>Successfully imported {result.imported} rows</span>
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="bg-red-50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-sm text-red-700 font-medium mb-1">
                  <AlertCircle size={16} />
                  <span>{result.errors.length} errors</span>
                </div>
                <ul className="text-xs text-red-600 space-y-0.5 max-h-32 overflow-y-auto">
                  {result.errors.slice(0, 10).map((err, i) => (
                    <li key={i} className="flex items-start gap-1">
                      <X size={12} className="mt-0.5 shrink-0" /> Row {err.row}: {err.field} — {err.message}
                    </li>
                  ))}
                  {result.errors.length > 10 && (
                    <li className="text-slate-400">...and {result.errors.length - 10} more</li>
                  )}
                </ul>
              </div>
            )}
            {result.duplicates.length > 0 && (
              <div className="text-xs text-amber-600 bg-amber-50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-sm text-amber-700 font-medium mb-1">
                  <AlertCircle size={16} />
                  <span>{result.duplicates.length} duplicate rows skipped</span>
                </div>
                <ul className="text-xs text-amber-600 space-y-0.5 max-h-32 overflow-y-auto">
                  {result.duplicates.slice(0, 10).map((dup, i) => (
                    <li key={i} className="flex items-start gap-1">
                      <X size={12} className="mt-0.5 shrink-0" /> Row {dup.row}: {dup.reason}
                    </li>
                  ))}
                  {result.duplicates.length > 10 && (
                    <li className="text-slate-400">...and {result.duplicates.length - 10} more</li>
                  )}
                </ul>
              </div>
            )}
            {result.warnings && result.warnings.length > 0 && (
              <div className="text-xs text-blue-600 bg-blue-50 rounded-lg p-3">
                <div className="flex items-center gap-2 text-sm text-blue-700 font-medium mb-1">
                  <AlertCircle size={16} />
                  <span>{result.warnings.length} warnings</span>
                </div>
                <ul className="text-xs text-blue-600 space-y-0.5 max-h-32 overflow-y-auto">
                  {result.warnings.slice(0, 10).map((warn, i) => (
                    <li key={i} className="flex items-start gap-1">
                      <X size={12} className="mt-0.5 shrink-0" /> Row {warn.row}: {warn.message}
                    </li>
                  ))}
                  {result.warnings.length > 10 && (
                    <li className="text-slate-400">...and {result.warnings.length - 10} more</li>
                  )}
                </ul>
              </div>
            )}
            {result.imported === 0 && result.errors.length === 0 && (
              <div className="text-sm text-slate-500 bg-slate-50 rounded-lg p-3">No rows imported</div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={handleClose}
                className="px-3 py-2 rounded-md text-sm bg-blue-600 text-white hover:bg-blue-700"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
