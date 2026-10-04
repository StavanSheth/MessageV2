import React, { useState, useRef } from 'react';
import { UploadCloud, Link2, CheckCircle2, FileSpreadsheet, AlertCircle, ArrowRight } from 'lucide-react';
import { Source } from '../types';
import { uploadXlsx, addUrlSource } from '../services/api';

interface SourcesProps {
  sources: Source[];
  onImportSuccess: () => void;
  onNavigate: (tab: string) => void;
}

export const Sources: React.FC<SourcesProps> = ({ sources, onImportSuccess, onNavigate }) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'url'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const res = await uploadXlsx(file);
      setResult(res);
      onImportSuccess();
    } catch (e: any) {
      setError(e.message || 'Failed to upload spreadsheet');
    } finally {
      setLoading(false);
    }
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      const res = await addUrlSource(url, sheetName || 'Web Spreadsheet');
      setResult(res);
      onImportSuccess();
    } catch (e: any) {
      setError(e.message || 'Failed to process spreadsheet URL');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-black text-white tracking-tight">Data Sources & Ingestion</h2>
        <p className="text-sm text-gray-400 mt-1">
          Import contacts and custom messages via local XLSX file or web spreadsheet URL.
        </p>
      </div>

      {/* Import Methods Switcher */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-xl space-y-6">
          <div className="flex border-b border-gray-800 pb-3 space-x-6">
            <button
              onClick={() => {
                setActiveTab('upload');
                setResult(null);
                setError(null);
              }}
              className={`flex items-center space-x-2 text-sm font-bold pb-2 transition-all border-b-2 -mb-[13px] ${
                activeTab === 'upload'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <UploadCloud className="w-4 h-4" />
              <span>Upload Local XLSX</span>
            </button>
            <button
              onClick={() => {
                setActiveTab('url');
                setResult(null);
                setError(null);
              }}
              className={`flex items-center space-x-2 text-sm font-bold pb-2 transition-all border-b-2 -mb-[13px] ${
                activeTab === 'url'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <Link2 className="w-4 h-4" />
              <span>Spreadsheet URL</span>
            </button>
          </div>

          {/* Upload XLSX Mode */}
          {activeTab === 'upload' && (
            <div className="space-y-4">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".xlsx"
                className="hidden"
              />

              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-700 hover:border-indigo-500 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors bg-gray-950/40 hover:bg-indigo-950/10"
              >
                <FileSpreadsheet className="w-12 h-12 text-indigo-400 mb-3 opacity-80" />
                <p className="text-sm font-bold text-gray-200">
                  {file ? file.name : 'Click to select an Excel (.xlsx) file'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Supports columns: Instagram URL / Username, Name, Message, Expected Followers
                </p>
              </div>

              {file && (
                <button
                  onClick={handleUpload}
                  disabled={loading}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/30 transition flex items-center justify-center space-x-2"
                >
                  <UploadCloud className="w-4 h-4" />
                  <span>{loading ? 'Processing Spreadsheet...' : 'Ingest & Generate Tasks'}</span>
                </button>
              )}
            </div>
          )}

          {/* URL Mode */}
          {activeTab === 'url' && (
            <form onSubmit={handleUrlSubmit} className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 font-semibold uppercase block mb-1.5">
                  Spreadsheet URL (Google Sheets or web sheet)
                </label>
                <input
                  type="url"
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 font-semibold uppercase block mb-1.5">
                  Source Identifier Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Q4 Outreach Leads"
                  value={sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <p className="text-xs text-gray-500 leading-relaxed">
                If the sheet requires authentication, Playwright will open it in your dedicated visible Chrome window where you can log in directly.
              </p>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/30 transition flex items-center justify-center space-x-2"
              >
                <Link2 className="w-4 h-4" />
                <span>{loading ? 'Validating & Reading Sheet...' : 'Connect & Read Spreadsheet'}</span>
              </button>
            </form>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-4 bg-rose-950/60 border border-rose-800 rounded-xl flex items-center space-x-3 text-rose-300 text-xs">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Ingestion Result Summary */}
          {result && (
            <div className="p-5 bg-emerald-950/40 border border-emerald-500/50 rounded-xl space-y-3">
              <div className="flex items-center space-x-2 text-emerald-400 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5" />
                <span>Spreadsheet Successfully Ingested!</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-gray-900/80 p-2.5 rounded-lg border border-gray-800 text-center">
                  <span className="text-[10px] text-gray-400 block font-semibold">Total Records</span>
                  <span className="text-base font-bold text-white">{result.total_records}</span>
                </div>
                <div className="bg-gray-900/80 p-2.5 rounded-lg border border-gray-800 text-center">
                  <span className="text-[10px] text-gray-400 block font-semibold">Valid Contacts</span>
                  <span className="text-base font-bold text-emerald-400">{result.valid_records}</span>
                </div>
                <div className="bg-gray-900/80 p-2.5 rounded-lg border border-gray-800 text-center">
                  <span className="text-[10px] text-gray-400 block font-semibold">Tasks Created</span>
                  <span className="text-base font-bold text-indigo-400">{result.tasks_created}</span>
                </div>
              </div>

              <div className="pt-2 flex justify-end space-x-3">
                <button
                  onClick={() => onNavigate('automation')}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold shadow transition"
                >
                  <span>Launch Live Automation</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Col: Ingested Sources History */}
        <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
          <h3 className="text-base font-bold text-white">Import History</h3>
          <div className="space-y-3 overflow-y-auto max-h-[420px] pr-1">
            {sources.length > 0 ? (
              sources.map((s) => (
                <div
                  key={s.id}
                  className="p-3.5 bg-gray-950/60 border border-gray-800 rounded-xl space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-200 truncate max-w-[160px]">{s.name}</span>
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-gray-800 text-gray-400">
                      {s.type}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-gray-400">
                    <span>{s.valid_count} valid / {s.record_count} total</span>
                    <span className="text-gray-500">{new Date(s.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-gray-500 italic py-6 text-center">
                No spreadsheets imported yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
