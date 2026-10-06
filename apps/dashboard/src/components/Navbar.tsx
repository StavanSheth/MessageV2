import React from 'react';
import { 
  Play, Pause, Square, Activity, Users, ListOrdered, 
  FileSpreadsheet, History, ShieldAlert, Sparkles 
} from 'lucide-react';
import { WorkerStatus } from '../types';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  workerStatus: WorkerStatus;
  isWsConnected: boolean;
  batchLimit: number | null;
  setBatchLimit: (limit: number | null) => void;
  customBatchInput?: string;
  isCustomBatch?: boolean;
  onSetBatchPreset?: (val: number | null) => void;
  onSelectCustom?: () => void;
  onChangeCustom?: (val: string) => void;
  batchSentCount?: number;
  onStart: (limit?: number | null) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  // All Workers Master Controls
  onStartAll?: (limit?: number | null) => void;
  onPauseAll?: () => void;
  onResumeAll?: () => void;
  onStopAll?: () => void;
  anyRunning?: boolean;
  anyPaused?: boolean;
  activeWorkersCount?: number;
  needsAttention: boolean;
  isRandomOrder?: boolean;
  onToggleRandomOrder?: (val: boolean) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  workerStatus,
  isWsConnected,
  batchLimit,
  setBatchLimit,
  customBatchInput = '8',
  isCustomBatch,
  onSetBatchPreset,
  onSelectCustom,
  onChangeCustom,
  batchSentCount = 0,
  onStart,
  onPause,
  onResume,
  onStop,
  onStartAll,
  onPauseAll,
  onResumeAll,
  onStopAll,
  anyRunning,
  anyPaused,
  activeWorkersCount,
  needsAttention,
  isRandomOrder = false,
  onToggleRandomOrder,
}) => {
  const isMasterPaused = Boolean((anyPaused ?? false) || workerStatus === 'PAUSED');
  const isMasterRunning = Boolean(!isMasterPaused && ((anyRunning ?? false) || workerStatus === 'RUNNING'));

  const PRESET_BATCHES = [1, 3, 5, 10, 25, 50, 100];
  const effectiveIsCustom = isCustomBatch !== undefined
    ? isCustomBatch
    : (batchLimit !== null && !PRESET_BATCHES.includes(batchLimit));

  const activeBatchLimit = effectiveIsCustom ? (parseInt(customBatchInput, 10) || 5) : batchLimit;

  return (
    <header className="border-b border-[#123529] bg-[#061d15]/90 backdrop-blur-md sticky top-0 z-50 px-6 py-3.5 shadow-xl">
      <div className="flex items-center justify-between max-w-7xl mx-auto flex-wrap gap-y-3">
        {/* Brand / Title */}
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#d49237] via-[#e5a84b] to-[#08231a] flex items-center justify-center shadow-lg shadow-[#d49237]/25 border border-[#d49237]/50">
              <span className="font-serif font-black text-xl text-[#041610] leading-none">M</span>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-serif font-bold text-xl text-[#fcfbf7] tracking-tight">MAVON</span>
                <span className="text-[10px] uppercase font-bold tracking-wider bg-[#d49237]/15 text-[#e5a84b] px-2 py-0.5 rounded-full border border-[#d49237]/35">
                  LUXE
                </span>
              </div>
              <p className="text-[11px] text-[#8fa59c] font-medium tracking-wide">Instagram DM Automation</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center space-x-1 pl-4 border-l border-[#123529]">
            {[
              { id: 'automation', label: 'Live Automation', icon: Activity },
              { id: 'overview', label: 'Overview', icon: Sparkles },
              { id: 'contacts', label: 'Contacts', icon: Users },
              { id: 'queue', label: 'Queue', icon: ListOrdered },
              { id: 'sources', label: 'Sources', icon: FileSpreadsheet },
              { id: 'events', label: 'Audit Log', icon: History },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = currentTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setCurrentTab(tab.id)}
                  className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#d49237]/15 text-[#e5a84b] border border-[#d49237]/40 shadow-sm shadow-[#d49237]/15'
                      : 'text-gray-400 hover:text-[#fcfbf7] hover:bg-gray-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Status Badges & Master Controls */}
        <div className="flex items-center space-x-3 flex-wrap">
          {/* WebSocket Status */}
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-gray-800/60 border border-gray-700/50 text-[11px]">
            <span className={`w-2 h-2 rounded-full ${isWsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            <span className="text-gray-300 font-mono">{isWsConnected ? 'WS LIVE' : 'WS OFFLINE'}</span>
          </div>

          {/* Master Agents Status Badge */}
          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-gray-900 border border-gray-700">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isMasterRunning
                  ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse'
                  : isMasterPaused
                  ? 'bg-amber-400'
                  : 'bg-gray-500'
              }`}
            />
            <span className={isMasterRunning ? 'text-emerald-400' : isMasterPaused ? 'text-amber-400' : 'text-gray-400'}>
              {isMasterRunning
                ? (activeWorkersCount ? `${activeWorkersCount} ACTIVE` : 'RUNNING')
                : isMasterPaused
                ? 'PAUSED'
                : 'IDLE'}
            </span>
          </div>

          {needsAttention && (
            <div className="flex items-center space-x-1 px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40 text-xs font-bold animate-bounce">
              <ShieldAlert className="w-4 h-4" />
              <span>ATTENTION NEEDED</span>
            </div>
          )}

          {/* Random Order Master Toggle (All Workers) */}
          <label
            className={`flex items-center space-x-1.5 border rounded-xl px-2.5 py-1.5 shadow-inner cursor-pointer select-none transition-all ${
              isRandomOrder
                ? 'bg-[#d49237]/20 border-[#d49237]/60 text-[#fcfbf7]'
                : 'bg-gray-900/90 border-gray-700/80 text-gray-300 hover:border-gray-600'
            }`}
            title="Randomize person/task dispatch order for all workers. Toggle anytime before start or while running/paused."
          >
            <input
              type="checkbox"
              checked={!!isRandomOrder}
              onChange={(e) => onToggleRandomOrder?.(e.target.checked)}
              className="w-3.5 h-3.5 accent-[#d49237] rounded cursor-pointer"
            />
            <span className="text-[11px] font-semibold flex items-center gap-1">
              <span>🎲</span>
              <span>Random Order</span>
            </span>
          </label>

          {/* Batch Selector */}
          <div className="flex items-center space-x-1.5 bg-gray-900/90 border border-gray-700/80 rounded-xl px-2.5 py-1.5 shadow-inner">
            <span className="text-[11px] text-gray-400 font-medium">Batch:</span>
            <select
              value={effectiveIsCustom ? 'custom' : batchLimit === null ? 'all' : String(batchLimit)}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'custom') {
                  if (onSelectCustom) {
                    onSelectCustom();
                  } else {
                    const parsed = parseInt(customBatchInput, 10) || 5;
                    setBatchLimit(parsed);
                  }
                } else if (val === 'all') {
                  if (onSetBatchPreset) {
                    onSetBatchPreset(null);
                  } else {
                    setBatchLimit(null);
                  }
                } else {
                  const num = Number(val);
                  if (onSetBatchPreset) {
                    onSetBatchPreset(num);
                  } else {
                    setBatchLimit(num);
                  }
                }
              }}
              className="bg-gray-950 border border-gray-700 text-gray-200 text-xs rounded px-1.5 py-0.5 focus:outline-none focus:border-indigo-500 font-semibold cursor-pointer"
            >
              <option value="1">1 contact</option>
              <option value="3">3 contacts</option>
              <option value="5">5 contacts</option>
              <option value="10">10 contacts</option>
              <option value="25">25 contacts</option>
              <option value="50">50 contacts</option>
              <option value="100">100 contacts</option>
              <option value="all">Entire List (All)</option>
              <option value="custom">Custom No...</option>
            </select>

            {effectiveIsCustom && (
              <div className="flex items-center space-x-1 pl-1 border-l border-gray-700">
                <input
                  type="number"
                  min="1"
                  max="5000"
                  value={customBatchInput}
                  onChange={(e) => {
                    if (onChangeCustom) {
                      onChangeCustom(e.target.value);
                    } else {
                      const val = parseInt(e.target.value, 10);
                      if (val > 0) setBatchLimit(val);
                    }
                  }}
                  className="w-14 bg-gray-950 border border-indigo-500 text-indigo-200 text-xs font-bold rounded px-1.5 py-0.5 focus:outline-none text-center"
                  title="Enter custom number of contacts to send in this batch"
                />
                <span className="text-[10px] text-gray-400">qty</span>
              </div>
            )}
          </div>

          {/* Master Control Buttons: Stop All, Resume All, Pause All */}
          <div className="flex items-center space-x-1.5 pl-1 bg-gray-950/70 p-1 rounded-2xl border border-gray-800">
            {/* Resume / Start All Button */}
            <button
              type="button"
              onClick={() => {
                if (isMasterPaused) {
                  if (onResumeAll) onResumeAll();
                  else onResume();
                } else {
                  if (onStartAll) onStartAll(activeBatchLimit);
                  else onStart(activeBatchLimit);
                }
              }}
              className="flex items-center space-x-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow-md shadow-emerald-900/30 transition-all hover:scale-105 active:scale-95 cursor-pointer"
              title={isMasterPaused ? "Resume all paused automation agents" : "Start all automation agents"}
            >
              <Play className="w-3.5 h-3.5 fill-current text-white" />
              <span>{isMasterPaused ? 'Resume All' : 'Start All'}</span>
            </button>

            {/* Pause All Button */}
            <button
              type="button"
              onClick={() => {
                if (onPauseAll) onPauseAll();
                else onPause();
              }}
              disabled={!isMasterRunning}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer ${
                isMasterRunning
                  ? 'bg-amber-500 hover:bg-amber-400 text-gray-950 font-black border border-amber-300 shadow-amber-900/40 hover:scale-105'
                  : 'bg-gray-800/60 text-gray-500 border border-gray-700/50 cursor-not-allowed opacity-50'
              }`}
              title="Pause all active automation agents"
            >
              <Pause className="w-3.5 h-3.5 fill-current" />
              <span>Pause All</span>
            </button>

            {/* Stop All Button */}
            <button
              type="button"
              onClick={() => {
                if (onStopAll) onStopAll();
                else onStop();
              }}
              disabled={!isMasterRunning && !isMasterPaused}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer ${
                isMasterRunning || isMasterPaused
                  ? 'bg-rose-600 hover:bg-rose-500 text-white border border-rose-400 shadow-rose-900/40 hover:scale-105'
                  : 'bg-gray-800/60 text-gray-500 border border-gray-700/50 cursor-not-allowed opacity-50'
              }`}
              title="Stop all agents and return to idle"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Stop All</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
