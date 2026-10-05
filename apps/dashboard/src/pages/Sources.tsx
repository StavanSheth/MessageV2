import React, { useState, useEffect, useRef } from 'react';
import {
  UploadCloud,
  Link2,
  CheckCircle2,
  FileSpreadsheet,
  AlertCircle,
  ArrowRight,
  Download,
  RefreshCw,
  Trash2,
  Database,
  Layers,
  Copy,
  Check,
  Search,
  UserCheck,
  AlertTriangle,
  ShieldCheck,
  Table as TableIcon
} from 'lucide-react';
import { Source } from '../types';
import {
  analyzeSourceXlsx,
  analyzeSourceUrl,
  confirmSourceImport,
  fetchTablesData
} from '../services/api';

interface SourcesProps {
  sources: Source[];
  onImportSuccess: () => void;
  onNavigate: (tab: string) => void;
}

interface StagedAnalysis {
  staging_id: string;
  source_name: string;
  source_type: string;
  total_fetched: number;
  unique_count: number;
  duplicate_count: number;
  invalid_count: number;
  unique_records: any[];
  duplicate_records: any[];
  invalid_records: any[];
  sheets_processed: string[];
  sheets_skipped: string[];
}

export const Sources: React.FC<SourcesProps> = ({ sources, onImportSuccess, onNavigate }) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'url'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Staged Redundancy Review State
  const [stagedData, setStagedData] = useState<StagedAnalysis | null>(null);
  const [reviewTab, setReviewTab] = useState<'unique' | 'duplicates' | 'invalid'>('unique');
  const [selectedUniqueIndices, setSelectedUniqueIndices] = useState<Set<number>>(new Set());
  const [selectedDuplicateIndices, setSelectedDuplicateIndices] = useState<Set<number>>(new Set());
  const [duplicateMode, setDuplicateMode] = useState<'SKIP' | 'ADD_SEPARATELY' | 'MERGE_UPDATE'>('SKIP');
  const [importResult, setImportResult] = useState<any | null>(null);

  // In-App Database Tables Browser State
  const [tablesData, setTablesData] = useState<any | null>(null);
  const [activeTableKey, setActiveTableKey] = useState<string>('contacts');
  const [tableSearch, setTableSearch] = useState('');
  const [loadingTables, setLoadingTables] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load database tables on initial mount
  useEffect(() => {
    loadDatabaseTables();
  }, []);

  const loadDatabaseTables = async () => {
    setLoadingTables(true);
    try {
      const data = await fetchTablesData();
      setTablesData(data);
    } catch (err: any) {
      console.error('Failed to load database tables:', err);
    } finally {
      setLoadingTables(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
      setStagedData(null);
      setImportResult(null);
    }
  };

  const handleAnalyzeXlsx = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setImportResult(null);
    try {
      const res: StagedAnalysis = await analyzeSourceXlsx(file);
      setStagedData(res);
      // Default: select all unique records
      setSelectedUniqueIndices(new Set(res.unique_records.map((r) => r.index)));
      setSelectedDuplicateIndices(new Set());
      setReviewTab(res.unique_records.length > 0 ? 'unique' : 'duplicates');
    } catch (e: any) {
      setError(e.message || 'Failed to analyze spreadsheet');
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzeUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    setLoading(true);
    setError(null);
    setImportResult(null);
    try {
      const res: StagedAnalysis = await analyzeSourceUrl(url, sheetName || 'Web Spreadsheet');
      setStagedData(res);
      setSelectedUniqueIndices(new Set(res.unique_records.map((r) => r.index)));
      setSelectedDuplicateIndices(new Set());
      setReviewTab(res.unique_records.length > 0 ? 'unique' : 'duplicates');
    } catch (e: any) {
      setError(e.message || 'Failed to analyze spreadsheet URL');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!stagedData) return;
    setLoading(true);
    setError(null);
    try {
      const res = await confirmSourceImport({
        staging_id: stagedData.staging_id,
        source_name: stagedData.source_name,
        selected_unique_indices: Array.from(selectedUniqueIndices),
        selected_duplicate_indices: Array.from(selectedDuplicateIndices),
        duplicate_mode: duplicateMode
      });
      setImportResult(res);
      setStagedData(null);
      setFile(null);
      setUrl('');
      onImportSuccess();
      loadDatabaseTables();
    } catch (e: any) {
      setError(e.message || 'Failed to complete import');
    } finally {
      setLoading(false);
    }
  };

  const toggleUniqueIndex = (index: number) => {
    const next = new Set(selectedUniqueIndices);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setSelectedUniqueIndices(next);
  };

  const removeUniqueRecord = (index: number) => {
    const next = new Set(selectedUniqueIndices);
    next.delete(index);
    setSelectedUniqueIndices(next);
  };

  const toggleDuplicateIndex = (index: number) => {
    const next = new Set(selectedDuplicateIndices);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setSelectedDuplicateIndices(next);
  };

  const selectAllUnique = () => {
    if (!stagedData) return;
    setSelectedUniqueIndices(new Set(stagedData.unique_records.map((r) => r.index)));
  };

  const deselectAllUnique = () => {
    setSelectedUniqueIndices(new Set());
  };

  const selectAllDuplicates = () => {
    if (!stagedData) return;
    setSelectedDuplicateIndices(new Set(stagedData.duplicate_records.map((r) => r.index)));
  };

  const deselectAllDuplicates = () => {
    setSelectedDuplicateIndices(new Set());
  };

  // Filter rows in tables browser
  const currentTable = tablesData?.tables?.[activeTableKey];
  const filteredTableRows = (currentTable?.rows || []).filter((row: any) => {
    if (!tableSearch) return true;
    const query = tableSearch.toLowerCase();
    return Object.values(row).some((val) => String(val).toLowerCase().includes(query));
  });

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-white tracking-tight flex items-center space-x-2.5">
            <span>Sources, Deduplication & Database Center</span>
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Analyze spreadsheets for database duplicates, customize duplicate handling, and view or export all database tables.
          </p>
        </div>
      </div>

      {/* Universal Export Highlight Card */}
      <div className="bg-gradient-to-r from-gray-900 via-indigo-950/40 to-gray-900 border border-indigo-500/30 rounded-2xl p-5 shadow-xl flex flex-col lg:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center shrink-0">
            <Database className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-bold text-white">Universal Excel Workbook (.xlsx)</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                5 Sheets Synchronized
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              Includes complete sheets: <span className="text-gray-300 font-semibold">1. Contacts Directory</span> | <span className="text-gray-300 font-semibold">2. Dispatch Queue</span> | <span className="text-gray-300 font-semibold">3. Ingested Sources</span> | <span className="text-gray-300 font-semibold">4. Outreach History</span> | <span className="text-gray-300 font-semibold">5. Audit Events</span>.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3 shrink-0">
          <a
            href={`/api/sources/export/universal?t=${Date.now()}`}
            download
            className="flex items-center space-x-2 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/30 transition hover:scale-105 active:scale-95 cursor-pointer"
            title="Download Universal Excel containing all 5 database tables"
          >
            <Download className="w-4 h-4" />
            <span>Universal Download (All 5 Tables)</span>
          </a>
        </div>
      </div>

      {/* Main Grid: Upload / URL & Redundancy Staging */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-xl space-y-6">
          {/* Method Tabs */}
          <div className="flex border-b border-gray-800 pb-3 space-x-6">
            <button
              onClick={() => {
                setActiveTab('upload');
                setStagedData(null);
                setImportResult(null);
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
                setStagedData(null);
                setImportResult(null);
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
          {activeTab === 'upload' && !stagedData && (
            <div className="space-y-4">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".xlsx, .xls"
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
                  Supports columns: Instagram URL / Username, Name, Message, Expected Followers, Follow-Up Messages
                </p>
              </div>

              {file && (
                <div className="flex items-center space-x-3">
                  <button
                    onClick={handleAnalyzeXlsx}
                    disabled={loading}
                    className="flex-1 py-3 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:bg-gray-800 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/30 transition flex items-center justify-center space-x-2 cursor-pointer"
                  >
                    <Search className="w-4 h-4" />
                    <span>{loading ? 'Inspecting Redundancy & Validating...' : 'Analyze Data & Inspect Redundancy'}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* URL Mode */}
          {activeTab === 'url' && !stagedData && (
            <form onSubmit={handleAnalyzeUrl} className="space-y-4">
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
                Playwright will access the sheet URL and inspect all rows against existing database records for redundancy.
              </p>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/30 transition flex items-center justify-center space-x-2 cursor-pointer"
              >
                <Search className="w-4 h-4" />
                <span>{loading ? 'Inspecting Redundancy & Reading Sheet...' : 'Analyze Data & Inspect Redundancy'}</span>
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

          {/* ─────────────────────────────────────────────────────────────
              STAGED DEDUPLICATION & REDUNDANCY REVIEW PANEL
              ───────────────────────────────────────────────────────────── */}
          {stagedData && (
            <div className="space-y-6 bg-gray-950/70 border border-indigo-500/40 rounded-2xl p-6 shadow-2xl">
              {/* Header Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-800">
                <div>
                  <div className="flex items-center space-x-2">
                    <Layers className="w-5 h-5 text-indigo-400" />
                    <h3 className="text-base font-bold text-white">Redundancy & Deduplication Review</h3>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Source: <span className="text-gray-200 font-mono font-medium">{stagedData.source_name}</span>
                  </p>
                </div>

                <button
                  onClick={() => setStagedData(null)}
                  className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg border border-gray-800 hover:border-gray-700 transition"
                >
                  Cancel / Re-upload
                </button>
              </div>

              {/* Stat Counters */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-gray-900/90 border border-gray-800 p-3 rounded-xl text-center">
                  <span className="text-[10px] text-gray-400 block font-semibold">Total Fetched</span>
                  <span className="text-lg font-black text-white">{stagedData.total_fetched}</span>
                </div>
                <div className="bg-emerald-950/40 border border-emerald-500/40 p-3 rounded-xl text-center">
                  <span className="text-[10px] text-emerald-300 block font-semibold">Unique Leads</span>
                  <span className="text-lg font-black text-emerald-400">{stagedData.unique_count}</span>
                </div>
                <div className="bg-amber-950/40 border border-amber-500/40 p-3 rounded-xl text-center">
                  <span className="text-[10px] text-amber-300 block font-semibold">Duplicates in DB</span>
                  <span className="text-lg font-black text-amber-400">{stagedData.duplicate_count}</span>
                </div>
                <div className="bg-gray-900/90 border border-gray-800 p-3 rounded-xl text-center">
                  <span className="text-[10px] text-gray-400 block font-semibold">Invalid Rows</span>
                  <span className="text-lg font-black text-rose-400">{stagedData.invalid_count}</span>
                </div>
              </div>

              {/* Review Tabs */}
              <div className="flex border-b border-gray-800 space-x-6 text-xs font-bold">
                <button
                  onClick={() => setReviewTab('unique')}
                  className={`pb-2.5 transition flex items-center space-x-1.5 border-b-2 -mb-[1px] ${
                    reviewTab === 'unique'
                      ? 'border-emerald-500 text-emerald-400'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Unique Leads ({selectedUniqueIndices.size}/{stagedData.unique_records.length} selected)</span>
                </button>

                <button
                  onClick={() => setReviewTab('duplicates')}
                  className={`pb-2.5 transition flex items-center space-x-1.5 border-b-2 -mb-[1px] ${
                    reviewTab === 'duplicates'
                      ? 'border-amber-500 text-amber-400'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Duplicates in Database ({stagedData.duplicate_records.length})</span>
                </button>

                {stagedData.invalid_records.length > 0 && (
                  <button
                    onClick={() => setReviewTab('invalid')}
                    className={`pb-2.5 transition flex items-center space-x-1.5 border-b-2 -mb-[1px] ${
                      reviewTab === 'invalid'
                        ? 'border-rose-500 text-rose-400'
                        : 'border-transparent text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Invalid Rows ({stagedData.invalid_records.length})</span>
                  </button>
                )}
              </div>

              {/* TAB 1: Unique Leads Review */}
              {reviewTab === 'unique' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">
                      These leads are completely new and not present in your database. You can review and remove any you do not want to add.
                    </span>
                    <div className="flex items-center space-x-2 shrink-0">
                      <button
                        onClick={selectAllUnique}
                        className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-[11px] font-medium transition"
                      >
                        Select All
                      </button>
                      <button
                        onClick={deselectAllUnique}
                        className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-[11px] font-medium transition"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto max-h-[360px] border border-gray-800 rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-900/90 text-gray-400 text-[11px] uppercase tracking-wider sticky top-0">
                        <tr>
                          <th className="py-2.5 px-3 w-10 text-center">Add</th>
                          <th className="py-2.5 px-3">Name</th>
                          <th className="py-2.5 px-3">Instagram / Username</th>
                          <th className="py-2.5 px-3">1st Message Copy</th>
                          <th className="py-2.5 px-3 w-20 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60 font-sans">
                        {stagedData.unique_records.map((rec) => {
                          const isSelected = selectedUniqueIndices.has(rec.index);
                          return (
                            <tr
                              key={rec.index}
                              className={`transition ${
                                isSelected ? 'bg-gray-900/40 hover:bg-gray-800/40' : 'bg-gray-950/40 opacity-40'
                              }`}
                            >
                              <td className="py-2 px-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleUniqueIndex(rec.index)}
                                  className="rounded border-gray-700 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                />
                              </td>
                              <td className="py-2 px-3 font-semibold text-white truncate max-w-[150px]">
                                {rec.name || '—'}
                              </td>
                              <td className="py-2 px-3 text-gray-300 truncate max-w-[180px]">
                                <span className="font-mono text-indigo-400">@{rec.username || 'unknown'}</span>
                              </td>
                              <td className="py-2 px-3 text-gray-400 truncate max-w-[240px]">
                                {rec.message || 'Hey'}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <button
                                  onClick={() => removeUniqueRecord(rec.index)}
                                  className="text-rose-400 hover:text-rose-300 hover:bg-rose-950/50 p-1 rounded transition cursor-pointer"
                                  title="Remove from import"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 2: Duplicates Review */}
              {reviewTab === 'duplicates' && (
                <div className="space-y-4">
                  {/* Duplicate Handling Strategies (Entire Batch) */}
                  <div className="bg-gray-900/80 border border-gray-800 p-4 rounded-xl space-y-3">
                    <span className="text-xs font-bold text-white block">
                      Duplicate Ingestion Policy (Entire Batch Mode):
                    </span>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                      <label
                        className={`flex items-start space-x-2.5 p-3 rounded-lg border cursor-pointer transition ${
                          duplicateMode === 'SKIP'
                            ? 'bg-amber-950/40 border-amber-500 text-amber-200'
                            : 'bg-gray-950/50 border-gray-800 text-gray-400 hover:border-gray-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="duplicateMode"
                          value="SKIP"
                          checked={duplicateMode === 'SKIP'}
                          onChange={() => setDuplicateMode('SKIP')}
                          className="mt-0.5 text-amber-500 focus:ring-amber-400"
                        />
                        <div>
                          <span className="text-xs font-bold block">Skip All Duplicates</span>
                          <span className="text-[11px] opacity-80 leading-tight">
                            Recommended. Only adds new unique leads and leaves existing leads untouched.
                          </span>
                        </div>
                      </label>

                      <label
                        className={`flex items-start space-x-2.5 p-3 rounded-lg border cursor-pointer transition ${
                          duplicateMode === 'ADD_SEPARATELY'
                            ? 'bg-indigo-950/40 border-indigo-500 text-indigo-200'
                            : 'bg-gray-950/50 border-gray-800 text-gray-400 hover:border-gray-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="duplicateMode"
                          value="ADD_SEPARATELY"
                          checked={duplicateMode === 'ADD_SEPARATELY'}
                          onChange={() => setDuplicateMode('ADD_SEPARATELY')}
                          className="mt-0.5 text-indigo-500 focus:ring-indigo-400"
                        />
                        <div>
                          <span className="text-xs font-bold block">Add All Separately</span>
                          <span className="text-[11px] opacity-80 leading-tight">
                            Creates duplicate contacts separately with a designated duplicate tag.
                          </span>
                        </div>
                      </label>

                      <label
                        className={`flex items-start space-x-2.5 p-3 rounded-lg border cursor-pointer transition ${
                          duplicateMode === 'MERGE_UPDATE'
                            ? 'bg-emerald-950/40 border-emerald-500 text-emerald-200'
                            : 'bg-gray-950/50 border-gray-800 text-gray-400 hover:border-gray-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="duplicateMode"
                          value="MERGE_UPDATE"
                          checked={duplicateMode === 'MERGE_UPDATE'}
                          onChange={() => setDuplicateMode('MERGE_UPDATE')}
                          className="mt-0.5 text-emerald-500 focus:ring-emerald-400"
                        />
                        <div>
                          <span className="text-xs font-bold block">Merge & Enrich Existing</span>
                          <span className="text-[11px] opacity-80 leading-tight">
                            Enriches existing contact notes and message copy without creating duplicate records.
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Individual Duplicates Table */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">
                      You can also cherry-pick specific duplicates to <strong className="text-white">Add Separately</strong> even if the entire batch is set to Skip:
                    </span>
                    <div className="flex items-center space-x-2 shrink-0">
                      <button
                        onClick={selectAllDuplicates}
                        className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-[11px] font-medium transition"
                      >
                        Select All
                      </button>
                      <button
                        onClick={deselectAllDuplicates}
                        className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-[11px] font-medium transition"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto max-h-[360px] border border-gray-800 rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-900/90 text-gray-400 text-[11px] uppercase tracking-wider sticky top-0">
                        <tr>
                          <th className="py-2.5 px-3 w-28 text-center">Add Separately</th>
                          <th className="py-2.5 px-3">Lead in Sheet</th>
                          <th className="py-2.5 px-3">Database Match</th>
                          <th className="py-2.5 px-3">Outreach Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60 font-sans">
                        {stagedData.duplicate_records.map((rec) => {
                          const isIndividuallySelected = selectedDuplicateIndices.has(rec.index);
                          return (
                            <tr key={rec.index} className="bg-gray-900/30 hover:bg-gray-800/40 transition">
                              <td className="py-2 px-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={isIndividuallySelected || duplicateMode === 'ADD_SEPARATELY'}
                                  disabled={duplicateMode === 'ADD_SEPARATELY'}
                                  onChange={() => toggleDuplicateIndex(rec.index)}
                                  className="rounded border-gray-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                />
                              </td>
                              <td className="py-2 px-3">
                                <span className="font-semibold text-white block">{rec.name || '—'}</span>
                                <span className="font-mono text-[11px] text-gray-400">@{rec.username || 'unknown'}</span>
                              </td>
                              <td className="py-2 px-3">
                                <span className="text-amber-300 text-xs block font-medium">{rec.reason}</span>
                                {rec.previously_contacted && (
                                  <span className="text-[10px] text-emerald-400 font-semibold inline-block mt-0.5">
                                    ✓ Previously Contacted In Prior Run
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3">
                                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-gray-800 text-gray-300">
                                  {rec.existing_replied_status || 'UNKNOWN'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 3: Invalid Rows */}
              {reviewTab === 'invalid' && (
                <div className="space-y-4">
                  <p className="text-xs text-rose-300">
                    The following rows could not be parsed due to missing Instagram URLs or corrupt data and will be skipped.
                  </p>
                  <div className="overflow-x-auto max-h-[300px] border border-gray-800 rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-900/90 text-gray-400 text-[11px] uppercase tracking-wider sticky top-0">
                        <tr>
                          <th className="py-2 px-3">Row Index</th>
                          <th className="py-2 px-3">Issue Reason</th>
                          <th className="py-2 px-3">Raw Content</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60 font-sans">
                        {stagedData.invalid_records.map((inv) => (
                          <tr key={inv.index} className="bg-gray-900/30">
                            <td className="py-2 px-3 font-mono text-gray-400">Row #{inv.index + 1}</td>
                            <td className="py-2 px-3 text-rose-400 font-semibold">{inv.error}</td>
                            <td className="py-2 px-3 font-mono text-gray-500 text-[11px] truncate max-w-[250px]">
                              {JSON.stringify(inv.raw)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Bottom Ingest Action Bar */}
              <div className="pt-4 border-t border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="text-xs text-gray-300">
                  Ready to ingest: <strong className="text-emerald-400">{selectedUniqueIndices.size}</strong> unique leads +{' '}
                  <strong className="text-indigo-400">
                    {duplicateMode === 'ADD_SEPARATELY'
                      ? stagedData.duplicate_records.length
                      : selectedDuplicateIndices.size}
                  </strong>{' '}
                  separate duplicates.
                </div>

                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => setStagedData(null)}
                    disabled={loading}
                    className="px-4 py-2.5 rounded-xl border border-gray-700 hover:border-gray-600 text-gray-300 text-xs font-semibold transition cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    onClick={handleConfirmImport}
                    disabled={loading || (selectedUniqueIndices.size === 0 && selectedDuplicateIndices.size === 0 && duplicateMode !== 'ADD_SEPARATELY')}
                    className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:bg-gray-800 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/30 transition flex items-center space-x-2 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {loading
                        ? 'Writing Database Records...'
                        : `Confirm & Ingest (${
                            selectedUniqueIndices.size +
                            (duplicateMode === 'ADD_SEPARATELY'
                              ? stagedData.duplicate_records.length
                              : selectedDuplicateIndices.size)
                          } Leads)`}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Ingestion Result Summary */}
          {importResult && (
            <div className="p-5 bg-emerald-950/40 border border-emerald-500/50 rounded-xl space-y-4">
              <div className="flex items-center space-x-2 text-emerald-400 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5" />
                <span>Spreadsheet Ingestion & Deduplication Successfully Completed!</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="bg-gray-900/80 p-2.5 rounded-lg border border-gray-800 text-center">
                  <span className="text-[10px] text-gray-400 block font-semibold">Total Processed</span>
                  <span className="text-base font-bold text-white">{importResult.total_records}</span>
                </div>
                <div className="bg-gray-900/80 p-2.5 rounded-lg border border-gray-800 text-center">
                  <span className="text-[10px] text-emerald-300 block font-semibold">Unique Added</span>
                  <span className="text-base font-bold text-emerald-400">{importResult.unique_added}</span>
                </div>
                <div className="bg-gray-900/80 p-2.5 rounded-lg border border-gray-800 text-center">
                  <span className="text-[10px] text-indigo-300 block font-semibold">Duplicates Added</span>
                  <span className="text-base font-bold text-indigo-400">{importResult.duplicates_added}</span>
                </div>
                <div className="bg-gray-900/80 p-2.5 rounded-lg border border-gray-800 text-center">
                  <span className="text-[10px] text-amber-300 block font-semibold">Duplicates Skipped</span>
                  <span className="text-base font-bold text-amber-400">{importResult.duplicates_skipped}</span>
                </div>
              </div>

              <div className="pt-2 flex justify-end space-x-3">
                <button
                  onClick={() => onNavigate('contacts')}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-bold transition cursor-pointer"
                >
                  View in Contacts Directory
                </button>
                <button
                  onClick={() => onNavigate('automation')}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold shadow transition cursor-pointer"
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
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white">Import History</h3>
            <span className="text-xs font-mono text-gray-400">{sources.length} sources</span>
          </div>
          <div className="space-y-3 overflow-y-auto max-h-[460px] pr-1">
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

      {/* ─────────────────────────────────────────────────────────────
          IN-APP DATABASE TABLES EXPLORER
          ───────────────────────────────────────────────────────────── */}
      <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-xl space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2.5">
              <TableIcon className="w-5 h-5 text-indigo-400" />
              <h3 className="text-lg font-bold text-white">Live Database Tables Explorer</h3>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Direct live viewer for all 5 database tables. View records, statuses, runs, and event logs in-app.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search table data..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-gray-950 border border-gray-700 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <button
              onClick={loadDatabaseTables}
              disabled={loadingTables}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-medium transition cursor-pointer"
              title="Refresh database tables"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingTables ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* 5 Table Selector Tabs */}
        {tablesData && tablesData.tables && (
          <div className="flex flex-wrap gap-2 border-b border-gray-800 pb-3">
            {Object.entries(tablesData.tables).map(([key, tbl]: [string, any]) => (
              <button
                key={key}
                onClick={() => {
                  setActiveTableKey(key);
                  setTableSearch('');
                }}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                  activeTableKey === key
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                    : 'bg-gray-950/60 hover:bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-800'
                }`}
              >
                <span>{tbl.title}</span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                    activeTableKey === key ? 'bg-indigo-800/80 text-indigo-100' : 'bg-gray-800 text-gray-400'
                  }`}
                >
                  {tbl.count}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Active Table Records Viewer */}
        <div className="overflow-x-auto max-h-[460px] border border-gray-800 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-950 text-gray-400 text-[11px] uppercase tracking-wider sticky top-0 border-b border-gray-800">
              <tr>
                {currentTable?.columns?.map((col: string, idx: number) => (
                  <th key={idx} className="py-3 px-3.5 font-semibold">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60 font-sans">
              {filteredTableRows.length > 0 ? (
                filteredTableRows.map((row: any, rIdx: number) => (
                  <tr key={row.id || rIdx} className="bg-gray-900/30 hover:bg-gray-800/40 transition">
                    {Object.entries(row)
                      .filter(([k]) => k !== 'id')
                      .map(([k, val]: [string, any], cIdx: number) => (
                        <td key={cIdx} className="py-2.5 px-3.5">
                          {k === 'replied_status' || k === 'status' ? (
                            <span
                              className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                                val === 'YES' || val === 'COMPLETED' || val === 'ACTIVE'
                                  ? 'bg-emerald-950 border border-emerald-500/40 text-emerald-400'
                                  : val === 'FAILED' || val === 'ERROR'
                                  ? 'bg-rose-950 border border-rose-500/40 text-rose-400'
                                  : 'bg-indigo-950 border border-indigo-500/40 text-indigo-300'
                              }`}
                            >
                              {String(val)}
                            </span>
                          ) : k === 'username' ? (
                            <span className="font-mono text-indigo-400 text-xs">@{val}</span>
                          ) : (
                            <span className="text-gray-300 text-xs truncate max-w-[260px] block">
                              {String(val ?? '—')}
                            </span>
                          )}
                        </td>
                      ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={currentTable?.columns?.length || 5}
                    className="py-10 text-center text-gray-500 italic text-xs"
                  >
                    {loadingTables ? 'Loading table data...' : 'No records found in this table.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
