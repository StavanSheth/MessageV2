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
  batchSentCount?: number;
  onStart: (limit?: number | null) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  needsAttention: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  workerStatus,
  isWsConnected,
  batchLimit,
  setBatchLimit,
  batchSentCount = 0,
  onStart,
  onPause,
  onResume,
  onStop,
  needsAttention,
}) => {
  const isRunning = workerStatus === 'RUNNING';
  const isPaused = workerStatus === 'PAUSED';

  const isPreset = batchLimit === null || [1, 3, 5, 10, 25, 50, 100].includes(batchLimit);
  const [isCustomMode, setIsCustomMode] = React.useState(!isPreset && batchLimit !== null);
  const [customInput, setCustomInput] = React.useState(batchLimit ? String(batchLimit) : '7');

  React.useEffect(() => {
    if (batchLimit !== null && ![1, 3, 5, 10, 25, 50, 100].includes(batchLimit)) {
      setIsCustomMode(true);
      setCustomInput(String(batchLimit));
    }
  }, [batchLimit]);

  return (
    <header className="border-b border-gray-800 bg-[#0f172a]/80 backdrop-blur-md sticky top-0 z-50 px-6 py-3">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        {/* Brand / Title */}
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg text-white tracking-tight">MessageV2</span>
                <span className="text-[10px] uppercase font-semibold bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full border border-indigo-500/30">
                  MVP
                </span>
              </div>
              <p className="text-xs text-gray-400">Instagram DM Automation</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center space-x-1 pl-4 border-l border-gray-800">
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
                  className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 shadow-sm'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Status Badges & Automation Controls */}
        <div className="flex items-center space-x-4">
          {/* WebSocket Status */}
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-gray-800/60 border border-gray-700/50 text-[11px]">
            <span className={`w-2 h-2 rounded-full ${isWsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            <span className="text-gray-300 font-mono">{isWsConnected ? 'WS LIVE' : 'WS OFFLINE'}</span>
          </div>

          {/* Worker Status Badge */}
          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-gray-900 border border-gray-700">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isRunning
                  ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse'
                  : isPaused
                  ? 'bg-amber-400'
                  : 'bg-gray-500'
              }`}
            />
            <span className={isRunning ? 'text-emerald-400' : isPaused ? 'text-amber-400' : 'text-gray-400'}>
              {workerStatus}
            </span>
          </div>

          {needsAttention && (
            <div className="flex items-center space-x-1 px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40 text-xs font-bold animate-bounce">
              <ShieldAlert className="w-4 h-4" />
              <span>ATTENTION NEEDED</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center space-x-2 pl-2">
            {!isRunning && !isPaused && (
              <div className="flex items-center space-x-1.5 bg-gray-800/80 border border-gray-700/80 rounded-lg px-2.5 py-1.5">
                <span className="text-[11px] text-gray-400 font-medium">Batch:</span>
                <select
                  value={isCustomMode ? 'custom' : batchLimit === null ? 'all' : String(batchLimit)}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'custom') {
                      setIsCustomMode(true);
                      const parsed = parseInt(customInput, 10) || 5;
                      setBatchLimit(parsed);
                    } else if (val === 'all') {
                      setIsCustomMode(false);
                      setBatchLimit(null);
                    } else {
                      setIsCustomMode(false);
                      setBatchLimit(Number(val));
                    }
                  }}
                  className="bg-gray-900 border border-gray-700 text-gray-200 text-xs rounded px-1.5 py-0.5 focus:outline-none focus:border-indigo-500 font-semibold cursor-pointer"
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

                {isCustomMode && (
                  <div className="flex items-center space-x-1 pl-1 border-l border-gray-700">
                    <input
                      type="number"
                      min="1"
                      max="5000"
                      value={customInput}
                      onChange={(e) => {
                        setCustomInput(e.target.value);
                        const val = parseInt(e.target.value, 10);
                        if (val > 0) {
                          setBatchLimit(val);
                        }
                      }}
                      className="w-14 bg-gray-950 border border-indigo-500 text-indigo-200 text-xs font-bold rounded px-1.5 py-0.5 focus:outline-none text-center"
                      title="Enter custom number of contacts to send in this batch"
                    />
                    <span className="text-[10px] text-gray-400">qty</span>
                  </div>
                )}
              </div>
            )}

            {(isRunning || isPaused) && (
              <div className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-indigo-950/60 border border-indigo-500/40 text-xs font-mono">
                <span className="text-gray-400">Batch:</span>
                <span className="text-emerald-400 font-bold">{batchSentCount}</span>
                <span className="text-gray-500">/</span>
                <span className="text-gray-200 font-semibold">{batchLimit === null ? 'All' : batchLimit}</span>
              </div>
            )}

            {!isRunning && !isPaused && (
              <button
                onClick={() => onStart(batchLimit)}
                className="flex items-center space-x-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-lg shadow-emerald-600/30 transition-all hover:scale-105 active:scale-95 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>START RUN</span>
              </button>
            )}

            {isRunning && (
              <button
                onClick={onPause}
                className="flex items-center space-x-2 bg-amber-600 hover:bg-amber-500 text-white px-3.5 py-2 rounded-lg text-xs font-bold shadow transition-all hover:scale-105 active:scale-95"
              >
                <Pause className="w-4 h-4 fill-white" />
                <span>PAUSE</span>
              </button>
            )}

            {isPaused && (
              <button
                onClick={onResume}
                className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 py-2 rounded-lg text-xs font-bold shadow transition-all hover:scale-105 active:scale-95"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>RESUME</span>
              </button>
            )}

            {(isRunning || isPaused) && (
              <button
                onClick={onStop}
                className="flex items-center space-x-2 bg-rose-600 hover:bg-rose-500 text-white px-3.5 py-2 rounded-lg text-xs font-bold shadow transition-all hover:scale-105 active:scale-95"
              >
                <Square className="w-4 h-4 fill-white" />
                <span>STOP</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
