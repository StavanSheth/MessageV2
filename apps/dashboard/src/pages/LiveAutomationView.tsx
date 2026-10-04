import React, { useState, useEffect } from 'react';
import { 
  Activity, CheckCircle2, ShieldCheck, Eye, Clock, 
  Send, AlertCircle, Sparkles, UserCheck, Terminal, Compass,
  ExternalLink, Loader2, RefreshCw, Play, Pause, Square
} from 'lucide-react';
import { LiveAutomationState } from '../types';
import { openBrowserWindow } from '../services/api';
import { ChromeProfileSelector } from '../components/ChromeProfileSelector';

interface LiveAutomationViewProps {
  state: LiveAutomationState;
  batchLimit?: number | null;
  setBatchLimit?: (limit: number | null) => void;
  customBatchInput?: string;
  isCustomBatch?: boolean;
  onSetBatchPreset?: (val: number | null) => void;
  onSelectCustom?: () => void;
  onChangeCustom?: (val: string) => void;
  onStart?: (limit?: number | null) => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
}

const STAGES = [
  { key: 'CHECKING_LOGIN', label: 'Login Check', aliases: ['INITIALIZING'] },
  { key: 'OPENING_PROFILE', label: 'Open Profile', aliases: ['WAITING_FOR_PROFILE'] },
  { key: 'VERIFYING', label: 'Verify Identity', aliases: ['EXTRACTING_PROFILE', 'CLAIMING_TASK'] },
  { key: 'CHECKING_DM_AVAILABILITY', label: 'Check DM Button', aliases: [] },
  { key: 'OPENING_COMPOSER', label: 'Type Message', aliases: ['PREPARING_MESSAGE'] },
  { key: 'SENDING_MESSAGE', label: 'Send Message', aliases: [] },
  { key: 'DETECTING_RESULT', label: 'Confirm Result', aliases: ['COMPLETED'] },
];

export const LiveAutomationView: React.FC<LiveAutomationViewProps> = ({
  state,
  batchLimit = 5,
  setBatchLimit,
  customBatchInput = '8',
  isCustomBatch,
  onSetBatchPreset,
  onSelectCustom,
  onChangeCustom,
  onStart,
  onPause,
  onResume,
  onStop
}) => {
  const PRESET_BATCHES = [1, 3, 5, 10, 25, 50, 100];
  const effectiveIsCustom = isCustomBatch !== undefined
    ? isCustomBatch
    : (batchLimit !== null && !PRESET_BATCHES.includes(batchLimit));
  const effectiveCustomInput = customBatchInput !== undefined
    ? customBatchInput
    : (batchLimit ? String(batchLimit) : '8');
  const currentStageIndex = STAGES.findIndex(
    (s) => s.key === state.stage || s.aliases.includes(state.stage)
  );
  const [liveTick, setLiveTick] = useState(Date.now());
  const [feedError, setFeedError] = useState(false);
  const [isOpeningBrowser, setIsOpeningBrowser] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setLiveTick(Date.now());
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  const handleOpenChrome = async () => {
    setIsOpeningBrowser(true);
    try {
      await openBrowserWindow();
    } catch (e) {
      console.error(e);
    } finally {
      setTimeout(() => setIsOpeningBrowser(false), 2000);
    }
  };

  const screenshotUrl = state.latest_screenshot
    ? `/screenshots/${state.latest_screenshot}`
    : null;

  return (
    <div className="space-y-6">
      {/* Top Banner: Status + Worker Info */}
      <div className="bg-gradient-to-r from-gray-900 via-indigo-950/40 to-gray-900 border border-indigo-500/20 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center space-x-3 mb-2">
              <span className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                <Activity className="w-5 h-5 animate-pulse" />
              </span>
              <h2 className="text-2xl font-black text-white tracking-tight">Live Automation Control</h2>
            </div>
            <p className="text-sm text-gray-400 max-w-xl">
              Real-time feed of the active visible Playwright Chrome session. Watch identity verification, DOM interactions, and message dispatch.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-gray-800/80 border border-gray-700/60 rounded-xl px-4 py-2.5">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-semibold">Active Worker</span>
              <span className="text-sm font-bold text-gray-100">{state.worker_name || 'Worker-01'}</span>
            </div>

            <div className="bg-gray-800/80 border border-gray-700/60 rounded-xl px-4 py-2.5">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-semibold">Browser Engine</span>
              <span className={`text-sm font-bold flex items-center space-x-1.5 ${
                state.browser_status === 'CONNECTED'
                  ? 'text-emerald-400'
                  : 'text-gray-400'
              }`}>
                <span className={`w-2 h-2 rounded-full ${state.browser_status === 'CONNECTED' ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
                <span>{state.browser_status || 'DISCONNECTED'}</span>
              </span>
            </div>

            <div className="bg-gray-800/80 border border-gray-700/60 rounded-xl px-4 py-2.5">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-semibold">Instagram Session</span>
              <span className={`text-sm font-bold flex items-center space-x-1.5 ${
                state.instagram_login_status === 'LOGGED_IN'
                  ? 'text-emerald-400'
                  : state.instagram_login_status === 'LOGIN_REQUIRED' || state.instagram_login_status === 'CHALLENGE'
                  ? 'text-amber-400 animate-pulse'
                  : 'text-gray-400'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  state.instagram_login_status === 'LOGGED_IN'
                    ? 'bg-emerald-400'
                    : state.instagram_login_status === 'LOGIN_REQUIRED' || state.instagram_login_status === 'CHALLENGE'
                    ? 'bg-amber-400'
                    : 'bg-gray-500'
                }`} />
                <span>{state.instagram_login_status || 'UNKNOWN'}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Dynamic Stepper Bar */}
        <div className="mt-8 pt-6 border-t border-gray-800/80">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
            {STAGES.map((s, idx) => {
              const isPast = currentStageIndex > idx;
              const isCurrent = state.stage === s.key;
              return (
                <div
                  key={s.key}
                  className={`flex flex-col items-center p-2 rounded-lg border text-center transition-all ${
                    isCurrent
                      ? 'bg-indigo-600/30 border-indigo-400 text-indigo-300 shadow-md shadow-indigo-500/20 scale-105'
                      : isPast
                      ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-400'
                      : 'bg-gray-900/40 border-gray-800 text-gray-500'
                  }`}
                >
                  <div className="flex items-center space-x-1 mb-1">
                    {isPast ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : isCurrent ? (
                      <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-gray-600" />
                    )}
                    <span className="text-[10px] font-mono font-bold">Step {idx + 1}</span>
                  </div>
                  <span className="text-xs font-semibold truncate w-full">{s.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Chrome Profile Selection & Live Browser Control */}
      <ChromeProfileSelector />

      {/* Batch Control & Sequential Queue Dispatcher */}
      <div className="bg-gradient-to-r from-gray-900 via-gray-900/90 to-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-5">
          {/* Left: Batch Progress & Queue Status */}
          <div className="flex items-center space-x-4 w-full lg:w-auto">
            <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex flex-col items-center justify-center text-indigo-400">
              <span className="font-black text-lg leading-none">{state.batch_sent_count ?? 0}</span>
              <span className="text-[9px] uppercase font-bold text-gray-400 mt-0.5">Sent</span>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-bold text-white">Batch Target:</span>
                <span className="text-xs font-mono font-bold text-indigo-400">
                  {state.batch_sent_count ?? 0} / {(state.status === 'RUNNING' || state.status === 'PAUSED' ? state.batch_limit : batchLimit) === null ? 'Entire List (All)' : `${(state.status === 'RUNNING' || state.status === 'PAUSED' ? state.batch_limit : batchLimit)} contacts`}
                </span>
                {state.batch_limit && (state.batch_sent_count ?? 0) >= state.batch_limit && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse">
                    BATCH COMPLETE (PAUSED)
                  </span>
                )}
                {state.status === 'RUNNING' && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center space-x-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
                    <span>SEQUENTIAL RUN ACTIVE</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Safe anti-spam pacing: {state.delay_seconds || 15}s delay between sends. Exceptions for invalid profiles, private DMs, or timeouts are automatically handled and skipped without interrupting the queue.
              </p>
            </div>
          </div>

          {/* Right: Quick Batch Selector & Buttons */}
          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-end">
            <span className="text-xs text-gray-400 font-semibold mr-1">Batch Size:</span>
            {[
              { label: '1', val: 1 },
              { label: '3', val: 3 },
              { label: '5', val: 5 },
              { label: '10', val: 10 },
              { label: '25', val: 25 },
              { label: '50', val: 50 },
              { label: '100', val: 100 },
              { label: 'All', val: null },
            ].map((opt) => {
              const isSelected = !effectiveIsCustom && batchLimit === opt.val;
              return (
                <button
                  key={opt.label}
                  disabled={state.status === 'RUNNING'}
                  onClick={() => {
                    if (onSetBatchPreset) {
                      onSetBatchPreset(opt.val);
                    } else {
                      setBatchLimit?.(opt.val);
                    }
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 ring-1 ring-indigo-400'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  } disabled:opacity-50 cursor-pointer`}
                >
                  {opt.label}
                </button>
              );
            })}

            {/* Custom Number Input */}
            <div
              className={`flex items-center space-x-1.5 rounded-lg px-2.5 py-1 transition border ${
                effectiveIsCustom
                  ? 'bg-indigo-950/80 border-indigo-500 ring-2 ring-indigo-400/50 shadow-md shadow-indigo-500/20'
                  : 'bg-gray-950/80 border-gray-700/80 hover:border-gray-600'
              }`}
            >
              <button
                type="button"
                disabled={state.status === 'RUNNING'}
                onClick={() => {
                  if (onSelectCustom) {
                    onSelectCustom();
                  } else {
                    const parsed = parseInt(effectiveCustomInput, 10) || 5;
                    setBatchLimit?.(parsed);
                  }
                }}
                className={`text-[11px] font-semibold transition cursor-pointer ${
                  effectiveIsCustom ? 'text-indigo-300 font-bold' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                Custom:
              </button>
              <input
                type="number"
                min="1"
                max="5000"
                disabled={state.status === 'RUNNING'}
                placeholder="Qty"
                value={effectiveCustomInput}
                onFocus={() => {
                  if (onSelectCustom) {
                    onSelectCustom();
                  } else {
                    const parsed = parseInt(effectiveCustomInput, 10) || 5;
                    setBatchLimit?.(parsed);
                  }
                }}
                onChange={(e) => {
                  if (onChangeCustom) {
                    onChangeCustom(e.target.value);
                  } else {
                    const val = parseInt(e.target.value, 10);
                    if (val > 0) {
                      setBatchLimit?.(val);
                    }
                  }
                }}
                className={`w-14 bg-gray-900 border text-xs font-bold rounded px-1.5 py-0.5 focus:outline-none text-center ${
                  effectiveIsCustom
                    ? 'border-indigo-400 text-indigo-200 bg-gray-950'
                    : 'border-gray-700 text-gray-300'
                }`}
                title="Type any custom number of recipients to send in this batch"
              />
              <span className="text-[10px] text-gray-400">qty</span>
            </div>

            {state.status !== 'RUNNING' && state.status !== 'PAUSED' && (
              <button
                onClick={() => onStart?.(batchLimit)}
                className="ml-2 flex items-center space-x-1.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white px-4 py-1.5 rounded-lg text-xs font-bold shadow-lg shadow-emerald-600/30 transition hover:scale-105 active:scale-95 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>Start Batch ({batchLimit === null ? 'All' : batchLimit})</span>
              </button>
            )}

            {state.status === 'RUNNING' && onPause && (
              <button
                onClick={onPause}
                className="ml-2 flex items-center space-x-1.5 bg-amber-600 hover:bg-amber-500 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold shadow transition active:scale-95 cursor-pointer"
              >
                <Pause className="w-3.5 h-3.5 fill-white" />
                <span>Pause</span>
              </button>
            )}

            {state.status === 'PAUSED' && onResume && (
              <button
                onClick={onResume}
                className="ml-2 flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold shadow transition active:scale-95 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>Resume</span>
              </button>
            )}

            {(state.status === 'RUNNING' || state.status === 'PAUSED') && onStop && (
              <button
                onClick={onStop}
                className="flex items-center space-x-1 bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow transition active:scale-95 cursor-pointer"
              >
                <Square className="w-3 h-3 fill-white" />
                <span>Stop</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid: Target Contact Card + Verification Signals + Screenshot Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Target Contact & Message */}
        <div className="space-y-6">
          <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-gray-800">
              <div className="flex items-center space-x-2">
                <UserCheck className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-white text-base">Current Target</h3>
              </div>
              <span className="text-xs font-mono px-2.5 py-1 rounded bg-gray-800 text-gray-300">
                {state.current_task_id ? `Task #${state.current_task_id.slice(0, 8)}` : 'No Active Task'}
              </span>
            </div>

            {state.current_contact ? (
              <div className="mt-5 space-y-4">
                <div>
                  <span className="text-xs text-gray-400 block font-medium">Recipient Name</span>
                  <p className="text-lg font-bold text-white mt-0.5">{state.current_contact.name || 'N/A'}</p>
                </div>

                <div>
                  <span className="text-xs text-gray-400 block font-medium">Instagram Handle</span>
                  <a
                    href={state.current_contact.instagram_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-base font-mono font-semibold text-indigo-400 hover:text-indigo-300 transition-colors inline-block mt-0.5"
                  >
                    @{state.current_contact.username}
                  </a>
                </div>

                <div>
                  <span className="text-xs text-gray-400 block font-medium">Custom Message Body</span>
                  <div className="mt-1.5 p-3.5 bg-gray-950/80 border border-gray-800 rounded-xl text-sm text-gray-200 font-sans leading-relaxed">
                    "{state.current_contact.custom_message || 'Hey'}"
                  </div>
                </div>

                {state.current_url && (
                  <div>
                    <span className="text-xs text-gray-400 block font-medium">Browser Current URL</span>
                    <p className="text-xs font-mono text-gray-400 truncate mt-0.5 bg-gray-950 px-2 py-1.5 rounded border border-gray-800/80">
                      {state.current_url}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-12 text-center text-gray-500">
                <Compass className="w-10 h-10 mx-auto text-gray-600 mb-2 opacity-60" />
                <p className="text-sm">Worker is currently waiting or idle.</p>
                <p className="text-xs text-gray-600 mt-1">Start a run to process queued contacts.</p>
              </div>
            )}
          </div>

          {/* Last Activity Card */}
          <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center space-x-2 mb-3">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs uppercase tracking-wider font-bold text-gray-300">Last System Event</h4>
            </div>
            <p className="text-sm font-mono text-emerald-300/90 bg-black/40 p-3 rounded-lg border border-gray-800 leading-snug">
              {state.last_event || 'No recent events recorded.'}
            </p>
            {state.last_error && (
              <div className="mt-3 p-3 rounded-lg bg-rose-950/40 border border-rose-800/50 text-xs font-mono text-rose-300">
                Error: {state.last_error}
              </div>
            )}
          </div>
        </div>

        {/* Middle Column: Multi-Signal Verification Radar */}
        <div className="space-y-6">
          <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-xl flex flex-col h-full">
            <div className="flex items-center justify-between pb-4 border-b border-gray-800">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-white text-base">Identity Verification</h3>
              </div>
              {state.verification && (
                <span
                  className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                    state.verification.decision === 'HIGH_CONFIDENCE'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : state.verification.decision === 'MEDIUM_CONFIDENCE'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  }`}
                >
                  {state.verification.decision}
                </span>
              )}
            </div>

            {state.verification ? (
              <div className="mt-5 space-y-6 flex-1 flex flex-col justify-between">
                {/* Score Gauge */}
                <div className="bg-gradient-to-b from-gray-950 to-gray-900 p-5 rounded-xl border border-gray-800 text-center">
                  <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Confidence Score</span>
                  <div className="text-4xl font-black text-white mt-1">
                    {(state.verification.confidence * 100).toFixed(0)}%
                  </div>
                  <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
                    {state.verification.reason}
                  </p>
                </div>

                {/* Signals breakdown */}
                <div className="space-y-3">
                  <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold block">
                    Verification Signals
                  </span>
                  {state.verification.signals && state.verification.signals.length > 0 ? (
                    state.verification.signals.map((sig, i) => (
                      <div
                        key={i}
                        className="bg-gray-950/70 border border-gray-800/80 p-3 rounded-lg flex items-center justify-between"
                      >
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-bold text-gray-200 capitalize">{sig.name}</span>
                            <span className="text-[10px] text-gray-500">weight: {sig.weight}</span>
                          </div>
                          <span className="text-[11px] text-gray-400 mt-0.5 block">{sig.notes || 'Signal evaluated'}</span>
                        </div>
                        <div className="text-right">
                          <span
                            className={`text-xs font-mono font-bold ${
                              sig.score >= 0.8
                                ? 'text-emerald-400'
                                : sig.score >= 0.5
                                ? 'text-amber-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {(sig.score * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-gray-500 italic">No detailed signal records available.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-16 text-center text-gray-500 flex-1 flex flex-col items-center justify-center">
                <ShieldCheck className="w-10 h-10 mx-auto text-gray-600 mb-2 opacity-50" />
                <p className="text-sm font-medium">Awaiting profile navigation</p>
                <p className="text-xs text-gray-600 mt-1">Signals will populate once target profile loads in browser.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Screenshot & Browser View */}
        <div className="space-y-6">
          <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-xl flex flex-col h-full">
            <div className="flex items-center justify-between pb-4 border-b border-gray-800">
              <div className="flex items-center space-x-2">
                <Eye className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-white text-base">Visible Chrome Capture</h3>
              </div>
              <div className="flex items-center space-x-2">
                {!feedError && (
                  <span className="flex items-center space-x-1.5 text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Live Sync</span>
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleOpenChrome}
                  disabled={isOpeningBrowser}
                  title="Open or focus Chrome on your desktop"
                  className="inline-flex items-center space-x-1 text-[11px] font-bold px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white transition active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {isOpeningBrowser ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                  <span>Open Chrome</span>
                </button>
              </div>
            </div>

            <div className="mt-5 flex-1 flex flex-col justify-center">
              {!feedError ? (
                <div className="space-y-3">
                  <div className="relative rounded-xl overflow-hidden border border-gray-700/80 bg-black aspect-video flex items-center justify-center shadow-inner">
                    <img
                      src={`/api/browser/live_feed?t=${liveTick}`}
                      alt="Visible Chrome Live Feed"
                      className="w-full h-full object-contain"
                      onError={() => {
                        if (!screenshotUrl) setFeedError(true);
                      }}
                      onLoad={() => setFeedError(false)}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400 px-1">
                    <span className="flex items-center space-x-1.5 text-emerald-400 font-mono text-[11px]">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block mr-1" />
                      Live session view (auto-syncing)
                    </span>
                    <a
                      href={`/api/browser/live_feed?t=${liveTick}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-400 hover:underline flex items-center space-x-1"
                    >
                      <span>Open Full Size</span>
                    </a>
                  </div>
                </div>
              ) : screenshotUrl ? (
                <div className="space-y-3">
                  <div className="relative rounded-xl overflow-hidden border border-gray-700/80 bg-black aspect-video flex items-center justify-center shadow-inner">
                    <img
                      src={screenshotUrl}
                      alt="Current Browser Screenshot"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400 px-1">
                    <span>Captured on checkpoint</span>
                    <a
                      href={screenshotUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-400 hover:underline flex items-center space-x-1"
                    >
                      <span>Open Full Size</span>
                    </a>
                  </div>
                </div>
              ) : (
                <div className="aspect-video rounded-xl border border-gray-800 bg-black/40 flex flex-col items-center justify-center p-6 text-center">
                  <Eye className="w-10 h-10 text-gray-600 mb-2 opacity-40" />
                  <p className="text-sm text-gray-300 font-medium">Visible Playwright Chrome Active</p>
                  <p className="text-xs text-gray-500 mt-1 max-w-xs">
                    Watch the actual browser window directly on your screen. Click below to bring Chrome to front.
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenChrome}
                    disabled={isOpeningBrowser}
                    className="mt-4 inline-flex items-center space-x-2 text-xs font-bold px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50"
                  >
                    {isOpeningBrowser ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                    <span>Focus / Pop Up Chrome Window</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
