import { useState, type FormEvent } from 'react';
import { useCreateEntity } from '../hooks/use-api.js';
import { Upload, AlertCircle, CheckCircle2, X } from 'lucide-react';
import Modal from './ui/Modal.js';

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  type: 'companies' | 'contacts' | 'leads';
  title: string;
  sampleCsv: string;
}

export default function ImportModal({ open, onClose, type, title, sampleCsv }: ImportModalProps) {
  const [csvText, setCsvText] = useState('');
  const [result, setResult] = useState<{ imported: number; errors: string[]; duplicates: string[] } | null>(null);
  const create = useCreateEntity(`import/${type}`);

  const handleFile = async (file: File) => {
    const text = await file.text();
    setCsvText(text);
    setResult(null);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setResult(null);
    create.mutate(
      { csv: csvText },
      {
        onSuccess: (data) => {
          setResult(data as unknown as { imported: number; errors: string[]; duplicates: string[] });
        },
      }
    );
  };

  const isPending = create.isPending;

  return (
    <Modal open={open} onClose={onClose} title={`Import ${title}`}>
      <div className="space-y-4">
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

        <form onSubmit={onSubmit} className="space-y-3">
          <textarea
            value={csvText}
            onChange={(e) => { setCsvText(e.target.value); setResult(null); }}
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
                onClick={() => { setCsvText(''); setResult(null); }}
                className="px-3 py-2 rounded-md text-sm border border-slate-200 hover:bg-slate-50"
              >
                Clear
              </button>
              <button
                type="submit"
                disabled={!csvText.trim() || isPending}
                className="px-3 py-2 rounded-md text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isPending ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </form>

        {result && (
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
                      <X size={12} className="mt-0.5 shrink-0" /> {err}
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
                {result.duplicates.length} duplicate rows skipped
              </div>
            )}
            {result.imported === 0 && result.errors.length === 0 && (
              <div className="text-sm text-slate-500 bg-slate-50 rounded-lg p-3">No rows imported</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
