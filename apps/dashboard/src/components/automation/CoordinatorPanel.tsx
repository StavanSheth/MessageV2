import React from 'react';
import { Lock, Unlock } from 'lucide-react';

interface CoordinatorStatus {
  active_sender?: string | null;
  cold_due_count?: number;
  followup_due_count?: number;
  mode?: 'BALANCED' | 'COLD_ONLY' | 'FOLLOWUP_ONLY' | string;
}

interface CoordinatorPanelProps {
  coordinatorStatus: CoordinatorStatus | null;
  onSetMode: (mode: 'BALANCED' | 'COLD_ONLY' | 'FOLLOWUP_ONLY') => void;
}

export const CoordinatorPanel: React.FC<CoordinatorPanelProps> = ({
  coordinatorStatus,
  onSetMode,
}) => {
  return (
    <div className="mt-4 pt-3 border-t border-gray-800/80 flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center space-x-3">
        {/* Lock Status Badge */}
        <div
          className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl border text-xs font-bold shadow-sm ${
            coordinatorStatus?.active_sender === 'WORKER-01'
              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
              : coordinatorStatus?.active_sender === 'WORKER-03'
              ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
              : 'bg-gray-800 border-gray-700 text-gray-300'
          }`}
        >
          {coordinatorStatus?.active_sender ? (
            <>
              <Lock className="w-3.5 h-3.5 animate-pulse text-amber-400" />
              <span>
                DM Lock:{' '}
                {coordinatorStatus.active_sender === 'WORKER-01'
                  ? 'Worker 1 (Cold DMs Active)'
                  : 'Worker 3 (Follow-Up Active)'}
              </span>
            </>
          ) : (
            <>
              <Unlock className="w-3.5 h-3.5 text-gray-400" />
              <span>DM Lock: Standby / Free</span>
            </>
          )}
        </div>

        {/* Due Tasks Count */}
        <div className="text-xs text-gray-400 flex items-center space-x-2">
          <span className="bg-gray-800 px-2 py-0.5 rounded text-gray-300 font-mono">
            {coordinatorStatus?.cold_due_count || 0} Cold Ready
          </span>
          <span>•</span>
          <span className="bg-gray-800 px-2 py-0.5 rounded text-amber-300 font-mono">
            {coordinatorStatus?.followup_due_count || 0} Follow-Ups Due
          </span>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="flex items-center space-x-2 text-xs">
        <span className="text-gray-400 font-semibold uppercase text-[10px]">Strategy:</span>
        <div className="inline-flex p-0.5 rounded-lg bg-gray-950 border border-gray-800">
          <button
            onClick={() => onSetMode('BALANCED')}
            className={`px-2.5 py-1 rounded text-xs font-bold transition cursor-pointer ${
              coordinatorStatus?.mode === 'BALANCED'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            ⚖️ Balanced
          </button>
          <button
            onClick={() => onSetMode('COLD_ONLY')}
            className={`px-2.5 py-1 rounded text-xs font-bold transition cursor-pointer ${
              coordinatorStatus?.mode === 'COLD_ONLY'
                ? 'bg-emerald-600 text-white shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            ⚡ Cold Only
          </button>
          <button
            onClick={() => onSetMode('FOLLOWUP_ONLY')}
            className={`px-2.5 py-1 rounded text-xs font-bold transition cursor-pointer ${
              coordinatorStatus?.mode === 'FOLLOWUP_ONLY'
                ? 'bg-amber-600 text-white shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            🔁 Follow-Ups Only
          </button>
        </div>
      </div>
    </div>
  );
};
