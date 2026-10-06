import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, CheckCircle2, ShieldCheck, Eye, Clock, 
  Send, AlertCircle, Sparkles, UserCheck, Terminal, Compass,
  ExternalLink, Loader2, RefreshCw, Play, Pause, Square,
  Bot, ShieldAlert, Phone, Mail, Link2, LayoutGrid, Layers,
  Check, User, Lock, Unlock, Repeat
} from 'lucide-react';
import { LiveAutomationState } from '../types';
import { 
  openBrowserWindow, 
  triggerReplyScan, 
  fetchReplyScannerStatus,
  startRepliesWorker,
  pauseRepliesWorker,
  resumeRepliesWorker,
  stopRepliesWorker,
  fetchChromeProfiles,
  startWorker3,
  pauseWorker3,
  resumeWorker3,
  stopWorker3,
  fetchWorker3Status,
  makeFollowupsDueNow,
  fetchCoordinatorStatus,
  setCoordinatorMode,
  setWorkerRandomOrder
} from '../services/api';

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
  onRefresh?: () => void;
}
import { formatLastScan } from '../utils/date';
export { formatLastScan };

const OUTREACH_STAGES = [
  { key: 'CHECKING_LOGIN', label: 'Login Check', aliases: ['INITIALIZING'] },
  { key: 'OPENING_PROFILE', label: 'Open Profile', aliases: ['WAITING_FOR_PROFILE'] },
  { key: 'VERIFYING', label: 'Verify Identity', aliases: ['EXTRACTING_PROFILE', 'CLAIMING_TASK'] },
  { key: 'CHECKING_DM_AVAILABILITY', label: 'Check DM Button', aliases: [] },
  { key: 'OPENING_COMPOSER', label: 'Type Message', aliases: ['PREPARING_MESSAGE'] },
  { key: 'SENDING_MESSAGE', label: 'Send Message', aliases: [] },
  { key: 'DETECTING_RESULT', label: 'Confirm Result', aliases: ['COMPLETED'] },
];

const FOLLOWUP_STAGES = [
  { key: 'CHECKING_LOGIN', label: 'Login Check', aliases: ['INITIALIZING'] },
  { key: 'OPENING_PROFILE', label: 'Open Chat', aliases: ['WAITING_FOR_PROFILE'] },
  { key: 'CHECKING_DM_AVAILABILITY', label: 'Continuity Check', aliases: [] },
  { key: 'OPENING_COMPOSER', label: 'Type Follow-Up', aliases: ['PREPARING_MESSAGE'] },
  { key: 'SENDING_MESSAGE', label: 'Send Touch', aliases: [] },
  { key: 'DETECTING_RESULT', label: 'Confirm & Schedule', aliases: ['COMPLETED'] },
];

const SCANNER_STAGES = [
  { key: 'OPENING_INBOX', label: 'Open Inbox', aliases: [] },
  { key: 'SCANNING_THREADS', label: 'Scan Threads', aliases: [] },
  { key: 'INSPECTING_THREAD', label: 'Inspect Thread', aliases: [] },
  { key: 'CLASSIFYING_REPLY', label: 'Classify Reply', aliases: [] },
  { key: 'EXTRACTING_ENTITIES', label: 'Extract Entities', aliases: [] },
  { key: 'UPDATING_RECORDS', label: 'Update Records', aliases: ['COMPLETED'] },
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
  onStop,
  onRefresh,
}) => {
  const PRESET_BATCHES = [1, 3, 5, 10, 25, 50, 100];
  const effectiveIsCustom = isCustomBatch !== undefined
    ? isCustomBatch
    : (batchLimit !== null && !PRESET_BATCHES.includes(batchLimit));
  const effectiveCustomInput = customBatchInput !== undefined
    ? customBatchInput
    : (batchLimit ? String(batchLimit) : '8');

  // View Mode: 'triad' (All 3 Workers), 'outreach' (Worker 1 only), 'scanner' (Worker 2 only), 'followup' (Worker 3 only)
  const [viewMode, setViewMode] = useState<'triad' | 'outreach' | 'scanner' | 'followup'>('triad');

  // Active Chrome profile
  const [activeProfileName, setActiveProfileName] = useState<string>('Default');

  // Stream state for Worker 1 (Outreach)
  const [outreachTick, setOutreachTick] = useState(Date.now());
  const [outreachStreamError, setOutreachStreamError] = useState(false);
  const [outreachFeedError, setOutreachFeedError] = useState(false);
  const [captureModeTabA, setCaptureModeTabA] = useState<'feed' | 'stream'>('feed');
  const [loadedTabASrc, setLoadedTabASrc] = useState<string>('/api/browser/live_feed?worker=outreach');
  const [isFeedPausedTabA, setIsFeedPausedTabA] = useState<boolean>(false);
  const [selectedTargetTaskId, setSelectedTargetTaskId] = useState<string | null>(null);
  const [isRefreshingTabA, setIsRefreshingTabA] = useState(false);

  // Stream state for Worker 2 (Scanner)
  const [scannerTick, setScannerTick] = useState(Date.now());
  const [scannerStreamError, setScannerStreamError] = useState(false);
  const [scannerFeedError, setScannerFeedError] = useState(false);
  const [loadedTabBSrc, setLoadedTabBSrc] = useState<string>('/api/browser/live_feed?worker=scanner');
  const [isFeedPausedTabB, setIsFeedPausedTabB] = useState<boolean>(false);
  const [isRefreshingTabB, setIsRefreshingTabB] = useState<boolean>(false);

  const [isOpeningBrowser, setIsOpeningBrowser] = useState(false);
  const [extensionNeedsReload, setExtensionNeedsReload] = useState(false);

  // Worker 2 (Reply Scanner) State
  const [scannerStatus, setScannerStatus] = useState<{
    status: string;
    current_stage?: string;
    current_target?: {
      name?: string;
      username?: string;
      thread_href?: string;
      snippet?: string;
      has_reply?: boolean;
      full_text?: string;
      entities?: {
        phone?: string | null;
        email?: string | null;
        link?: string | null;
        is_automated?: boolean;
        confidence?: number;
        indicators?: string[];
      };
    } | null;
    last_scanned_at: string | null;
    last_scan_at?: string | null;
    stats: {
      total_scanned: number;
      automated_found: number;
      human_replies_found: number;
      no_reply_count: number;
    };
    is_connected: boolean;
    is_paused?: boolean;
    is_running?: boolean;
  } | null>(null);

  // Worker 3 (Follow-Up Dispatcher) State
  const [worker3Status, setWorker3Status] = useState<{
    worker_id: string;
    status: string;
    stage: string;
    current_task_id?: string | null;
    current_contact_name?: string | null;
    current_instagram?: string | null;
    current_touch?: string;
    batch_sent_count: number;
    batch_limit: number | null;
    is_running: boolean;
    is_paused: boolean;
    lock_held: boolean;
    due_count?: number;
    future_count?: number;
    next_due_at?: string | null;
    last_scan_at?: string | null;
    last_scanned_at?: string | null;
  } | null>(null);

  const [worker3BatchLimit, setWorker3BatchLimit] = useState<number | null>(5);
  const [worker3ActionLoading, setWorker3ActionLoading] = useState(false);
  const [fastForwardLoading, setFastForwardLoading] = useState(false);
  const [fastForwardMsg, setFastForwardMsg] = useState<string | null>(null);

  // Coordinator Mutex State
  const [coordinatorStatus, setCoordinatorStatus] = useState<{
    active_sender: string | null;
    mode: string;
    lock_held: boolean;
    lock_acquired_at: string | null;
    cold_due_count: number;
    followup_due_count: number;
  } | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);

  // Per-worker Random Order states
  const [worker1RandomOrder, setWorker1RandomOrder] = useState<boolean>(state.random_order ?? false);
  const [worker3RandomOrder, setWorker3RandomOrder] = useState<boolean>(false);

  useEffect(() => {
    if (state.random_order !== undefined) {
      setWorker1RandomOrder(state.random_order);
    }
  }, [state.random_order]);

  const handleToggleWorker1RandomOrder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setWorker1RandomOrder(checked);
    try {
      await setWorkerRandomOrder('worker1', checked);
    } catch (err) {
      console.warn('Could not update Worker 1 random order:', err);
    }
  };

  const handleToggleWorker3RandomOrder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setWorker3RandomOrder(checked);
    try {
      await setWorkerRandomOrder('worker3', checked);
    } catch (err) {
      console.warn('Could not update Worker 3 random order:', err);
    }
  };

  // Fetch active Chrome profile
  useEffect(() => {
    fetchChromeProfiles().then((res) => {
      if (res?.active_profile?.name) {
        setActiveProfileName(res.active_profile.name);
      }
    }).catch(() => {});
  }, []);

  // Mutation lock to prevent background intervals / in-flight polling from overwriting optimistic actions
  const isMutatingWorkerRef = useRef<boolean>(false);
  const lastWorkerMutationRef = useRef<number>(0);

  const markWorkerMutating = () => {
    isMutatingWorkerRef.current = true;
    lastWorkerMutationRef.current = Date.now();
  };

  const finishWorkerMutating = (fetchFn: () => Promise<void>) => {
    setTimeout(async () => {
      isMutatingWorkerRef.current = false;
      await fetchFn();
      onRefresh?.();
    }, 450);
  };

  // Poll Worker 2, Worker 3, and Coordinator status
  useEffect(() => {
    const fetchAllStatus = async (force = false) => {
      if (!force && (isMutatingWorkerRef.current || Date.now() - lastWorkerMutationRef.current < 1400)) {
        return;
      }
      try {
        const [w2, w3, coord] = await Promise.all([
          fetchReplyScannerStatus().catch(() => null),
          fetchWorker3Status().catch(() => null),
          fetchCoordinatorStatus().catch(() => null),
        ]);
        if (w2) {
          setScannerStatus(w2);
          if (w2.status !== 'SCANNING' && isScanning) {
            setIsScanning(false);
          }
        }
        if (w3) {
          setWorker3Status(w3);
          if (w3.random_order !== undefined) {
            setWorker3RandomOrder(w3.random_order);
          }
        }
        if (coord) setCoordinatorStatus(coord);
      } catch (e) {}
    };
    fetchAllStatus();
    const timer = setInterval(() => {
      if (!isMutatingWorkerRef.current && Date.now() - lastWorkerMutationRef.current >= 1400) {
        fetchAllStatus();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [isScanning]);

  const handleStartWorker3 = async () => {
    try {
      setWorker3ActionLoading(true);
      if ((!worker3Status?.due_count || worker3Status.due_count === 0) && (worker3Status?.future_count || 0) > 0) {
        const confirmMakeDue = window.confirm(
          `No follow-ups are due right now (all ${worker3Status?.future_count} are scheduled for future dates).\n\nWould you like to make 1 follow-up due now so Worker 3 can dispatch immediately?`
        );
        if (confirmMakeDue) {
          await makeFollowupsDueNow(1);
        }
      }
      markWorkerMutating();
      setWorker3Status(prev => prev ? ({ ...prev, status: 'RUNNING', is_paused: false, is_running: true }) : prev);
      await startWorker3(worker3BatchLimit, 15, worker3RandomOrder);
      finishWorkerMutating(async () => {
        const updated = await fetchWorker3Status();
        setWorker3Status(updated);
        const coord = await fetchCoordinatorStatus();
        setCoordinatorStatus(coord);
      });
    } catch (e: any) {
      isMutatingWorkerRef.current = false;
      alert(`Worker 3 Error: ${e.message}`);
    } finally {
      setWorker3ActionLoading(false);
    }
  };

  const handlePauseWorker3 = async () => {
    markWorkerMutating();
    setWorker3Status(prev => prev ? ({ ...prev, status: 'PAUSED', is_paused: true, is_running: false }) : prev);
    try {
      await pauseWorker3();
      finishWorkerMutating(async () => {
        const updated = await fetchWorker3Status();
        setWorker3Status(updated);
        const coord = await fetchCoordinatorStatus().catch(() => null);
        if (coord) setCoordinatorStatus(coord);
      });
    } catch (e: any) {
      isMutatingWorkerRef.current = false;
      alert(`Worker 3 Pause Error: ${e.message}`);
    }
  };

  const handleResumeWorker3 = async () => {
    markWorkerMutating();
    setWorker3Status(prev => prev ? ({ ...prev, status: 'RUNNING', is_paused: false, is_running: true }) : prev);
    try {
      await resumeWorker3();
      finishWorkerMutating(async () => {
        const updated = await fetchWorker3Status();
        setWorker3Status(updated);
        const coord = await fetchCoordinatorStatus().catch(() => null);
        if (coord) setCoordinatorStatus(coord);
      });
    } catch (e: any) {
      isMutatingWorkerRef.current = false;
      alert(`Worker 3 Resume Error: ${e.message}`);
    }
  };

  const handleStartWorker2 = async () => {
    markWorkerMutating();
    setScannerStatus(prev => prev ? ({ ...prev, status: 'RUNNING', is_paused: false, is_running: true }) : prev);
    try {
      await startRepliesWorker();
      finishWorkerMutating(async () => {
        const updated = await fetchReplyScannerStatus();
        setScannerStatus(updated);
      });
    } catch (e: any) {
      isMutatingWorkerRef.current = false;
      alert(`Worker 2 Error: ${e.message}`);
    }
  };

  const handlePauseWorker2 = async () => {
    markWorkerMutating();
    setScannerStatus(prev => prev ? ({ ...prev, status: 'PAUSED', is_paused: true, is_running: false }) : prev);
    try {
      await pauseRepliesWorker();
      finishWorkerMutating(async () => {
        const updated = await fetchReplyScannerStatus();
        setScannerStatus(updated);
      });
    } catch (e: any) {
      isMutatingWorkerRef.current = false;
      alert(`Worker 2 Pause Error: ${e.message}`);
    }
  };

  const handleResumeWorker2 = async () => {
    markWorkerMutating();
    setScannerStatus(prev => prev ? ({ ...prev, status: 'RUNNING', is_paused: false, is_running: true }) : prev);
    try {
      await resumeRepliesWorker();
      finishWorkerMutating(async () => {
        const updated = await fetchReplyScannerStatus();
        setScannerStatus(updated);
      });
    } catch (e: any) {
      isMutatingWorkerRef.current = false;
      alert(`Worker 2 Resume Error: ${e.message}`);
    }
  };

  const handleStopWorker2 = async () => {
    markWorkerMutating();
    setScannerStatus(prev => prev ? ({ ...prev, status: 'IDLE', is_paused: false, is_running: false }) : prev);
    try {
      await stopRepliesWorker();
      finishWorkerMutating(async () => {
        const updated = await fetchReplyScannerStatus();
        setScannerStatus(updated);
      });
    } catch (e: any) {
      isMutatingWorkerRef.current = false;
      alert(`Worker 2 Stop Error: ${e.message}`);
    }
  };

  const handleStopWorker3 = async () => {
    markWorkerMutating();
    setWorker3Status(prev => prev ? ({ ...prev, status: 'STOPPED', is_paused: false, is_running: false }) : prev);
    try {
      await stopWorker3();
      finishWorkerMutating(async () => {
        const updated = await fetchWorker3Status();
        setWorker3Status(updated);
        const coord = await fetchCoordinatorStatus().catch(() => null);
        if (coord) setCoordinatorStatus(coord);
      });
    } catch (e: any) {
      isMutatingWorkerRef.current = false;
      alert(`Worker 3 Stop Error: ${e.message}`);
    }
  };

  const handleMakeDueNow = async (count: number | null = null) => {
    try {
      setFastForwardLoading(true);
      const res = await makeFollowupsDueNow(count);
      setFastForwardMsg(res.message || 'Follow-ups are now due!');
      const updated = await fetchWorker3Status();
      setWorker3Status(updated);
      const coord = await fetchCoordinatorStatus();
      setCoordinatorStatus(coord);
    } catch (e: any) {
      alert(`Error fast-forwarding follow-ups: ${e.message}`);
    } finally {
      setFastForwardLoading(false);
      setTimeout(() => setFastForwardMsg(null), 5000);
    }
  };

  const handleSetMode = async (mode: string) => {
    try {
      await setCoordinatorMode(mode);
      const coord = await fetchCoordinatorStatus();
      setCoordinatorStatus(coord);
    } catch (e) {}
  };

  const handleTriggerScan = async () => {
    setIsScanning(true);
    setScanFeedback('Worker 2 is scanning Instagram Direct Inbox (Tab B)...');
    try {
      const res = await triggerReplyScan();
      setScanFeedback(
        res.success 
          ? `Scanned ${res.scanned_count} conversations. Found ${res.automated_found} auto-replies, ${res.human_replies_found} human leads.` 
          : (res.error || 'Scan finished.')
      );
      const updated = await fetchReplyScannerStatus();
      setScannerStatus(updated);
    } catch (err: any) {
      setScanFeedback(`Scan error: ${err.message}`);
    } finally {
      setIsScanning(false);
      setTimeout(() => setScanFeedback(null), 7000);
    }
  };

  useEffect(() => {
    const checkCapture = async () => {
      try {
        const res = await fetch('/api/browser/capture_test');
        if (res.ok) {
          const data = await res.json();
          if (data.error && data.error.includes('Unknown action CAPTURE_SCREENSHOT')) {
            setExtensionNeedsReload(true);
          } else if (data.success || data.has_data) {
            setExtensionNeedsReload(false);
          }
        }
      } catch (e) {}
    };
    checkCapture();
    const testTimer = setInterval(checkCapture, 5000);
    return () => clearInterval(testTimer);
  }, []);

  // Periodic tick for live snapshot refresh (refreshes Tab A & B continuously)
  useEffect(() => {
    const timer = setInterval(() => {
      setOutreachTick(Date.now());
      setScannerTick(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Seamless double-buffered offscreen preload for Tab A to completely prevent blanking/blinking
  useEffect(() => {
    if (captureModeTabA !== 'feed' || isFeedPausedTabA) return;
    const nextUrl = `/api/browser/live_feed?worker=outreach&t=${outreachTick}`;
    const img = new Image();
    img.onload = () => {
      setLoadedTabASrc(nextUrl);
      setOutreachFeedError(false);
    };
    img.onerror = () => {
      setOutreachFeedError(true);
    };
    img.src = nextUrl;
  }, [outreachTick, captureModeTabA, isFeedPausedTabA]);

  const handleRefreshTabA = () => {
    setIsRefreshingTabA(true);
    setOutreachStreamError(false);
    setOutreachFeedError(false);
    const forceUrl = `/api/browser/live_feed?worker=outreach&t=${Date.now()}`;
    const img = new Image();
    img.onload = () => {
      setLoadedTabASrc(forceUrl);
      setOutreachFeedError(false);
      setIsRefreshingTabA(false);
    };
    img.onerror = () => {
      setIsRefreshingTabA(false);
    };
    img.src = forceUrl;
  };

  // Seamless double-buffered offscreen preload for Tab B to prevent blanking
  useEffect(() => {
    if (isFeedPausedTabB) return;
    const nextUrl = `/api/browser/live_feed?worker=scanner&t=${scannerTick}`;
    const img = new Image();
    img.onload = () => {
      setLoadedTabBSrc(nextUrl);
      setScannerFeedError(false);
    };
    img.onerror = () => {
      setScannerFeedError(true);
    };
    img.src = nextUrl;
  }, [scannerTick, isFeedPausedTabB]);

  const handleRefreshTabB = () => {
    setIsRefreshingTabB(true);
    setScannerStreamError(false);
    setScannerFeedError(false);
    const forceUrl = `/api/browser/live_feed?worker=scanner&t=${Date.now()}`;
    const img = new Image();
    img.onload = () => {
      setLoadedTabBSrc(forceUrl);
      setScannerFeedError(false);
      setIsRefreshingTabB(false);
    };
    img.onerror = () => {
      setIsRefreshingTabB(false);
    };
    img.src = forceUrl;
  };

  const handleOpenChrome = async () => {
    setIsOpeningBrowser(true);
    try {
      window.open('https://www.instagram.com', '_blank');
      await openBrowserWindow();
    } catch (e) {
      console.error(e);
    } finally {
      setTimeout(() => setIsOpeningBrowser(false), 2000);
    }
  };

  // Outreach current stage index
  const outreachStageIndex = OUTREACH_STAGES.findIndex(
    (s) => s.key === state.stage || s.aliases.includes(state.stage)
  );

  // Scanner current stage index
  const scannerCurrentStage = scannerStatus?.current_stage || (scannerStatus?.status === 'SCANNING' ? 'SCANNING_THREADS' : 'IDLE');
  const scannerStageIndex = SCANNER_STAGES.findIndex(
    (s) => s.key === scannerCurrentStage || s.aliases.includes(scannerCurrentStage)
  );

  const screenshotUrl = state.latest_screenshot
    ? `/screenshots/${state.latest_screenshot}`
    : null;

  return (
    <div className="space-y-6">
      {/* Top Banner: Status + Profile Info + View Switcher */}
      <div className="bg-gradient-to-r from-gray-900 via-indigo-950/40 to-gray-900 border border-indigo-500/20 rounded-2xl p-5 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 relative z-10">
          <div>
            <div className="flex items-center space-x-3 mb-1.5">
              <span className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                <Activity className="w-5 h-5 animate-pulse" />
              </span>
              <h2 className="text-2xl font-black text-white tracking-tight">3-Worker Triad Automation Deck</h2>
            </div>
            <p className="text-xs text-gray-400 max-w-xl">
              Coordinated 3-Worker Instagram automation. Worker 1 handles initial cold outreach on Tab A, Worker 2 audits inbox replies in parallel on Tab B, and Worker 3 dispatches targeted follow-ups under strict mutual exclusion lock.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Active Chrome Profile Indicator */}
            <div className="bg-gray-800/80 border border-gray-700/60 rounded-xl px-3.5 py-2 flex items-center space-x-2">
              <User className="w-4 h-4 text-indigo-400" />
              <div>
                <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-semibold">Chrome Profile</span>
                <span className="text-xs font-bold text-white">{activeProfileName}</span>
              </div>
            </div>

            {/* Browser Status */}
            <div className="bg-gray-800/80 border border-gray-700/60 rounded-xl px-3.5 py-2">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-semibold">Browser Engine</span>
              <span className={`text-xs font-bold flex items-center space-x-1.5 ${
                state.browser_status === 'CONNECTED' ? 'text-emerald-400' : 'text-gray-400'
              }`}>
                <span className={`w-2 h-2 rounded-full ${state.browser_status === 'CONNECTED' ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
                <span>{state.browser_status || 'DISCONNECTED'}</span>
              </span>
            </div>

            {/* Instagram Session */}
            <div className="bg-gray-800/80 border border-gray-700/60 rounded-xl px-3.5 py-2">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-semibold">Instagram Session</span>
              <span className={`text-xs font-bold flex items-center space-x-1.5 ${
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

            {/* Open Chrome Button */}
            <button
              type="button"
              onClick={handleOpenChrome}
              disabled={isOpeningBrowser}
              title="Open or focus visible Chrome window"
              className="inline-flex items-center space-x-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition active:scale-95 cursor-pointer disabled:opacity-50 shadow"
            >
              {isOpeningBrowser ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
              <span>Open Chrome</span>
            </button>
          </div>
        </div>

        {/* DM Mutual Exclusion Status & Strategy Bar */}
        <div className="mt-4 pt-3 border-t border-gray-800/80 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center space-x-3">
            {/* Lock Status Badge */}
            <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl border text-xs font-bold shadow-sm ${
              coordinatorStatus?.active_sender === 'WORKER-01'
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : coordinatorStatus?.active_sender === 'WORKER-03'
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-gray-800 border-gray-700 text-gray-300'
            }`}>
              {coordinatorStatus?.active_sender ? (
                <>
                  <Lock className="w-3.5 h-3.5 animate-pulse text-amber-400" />
                  <span>
                    DM Lock: {coordinatorStatus.active_sender === 'WORKER-01' ? 'Worker 1 (Cold DMs Active)' : 'Worker 3 (Follow-Up Active)'}
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
                onClick={() => handleSetMode('BALANCED')}
                className={`px-2.5 py-1 rounded text-xs font-bold transition cursor-pointer ${
                  coordinatorStatus?.mode === 'BALANCED'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                ⚖️ Balanced
              </button>
              <button
                onClick={() => handleSetMode('COLD_ONLY')}
                className={`px-2.5 py-1 rounded text-xs font-bold transition cursor-pointer ${
                  coordinatorStatus?.mode === 'COLD_ONLY'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                ⚡ Cold Only
              </button>
              <button
                onClick={() => handleSetMode('FOLLOWUP_ONLY')}
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

        {/* View Switcher Tabs */}
        <div className="mt-3 pt-3 border-t border-gray-800/80 flex items-center justify-between flex-wrap gap-3">
          <div className="inline-flex p-1 rounded-xl bg-gray-950/80 border border-gray-800 flex-wrap">
            <button
              onClick={() => setViewMode('triad')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === 'triad'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Triad View (All 3)</span>
            </button>
            <button
              onClick={() => setViewMode('outreach')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === 'outreach'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Send className="w-3.5 h-3.5 text-emerald-400" />
              <span>Worker 1: Cold DMs</span>
            </button>
            <button
              onClick={() => setViewMode('scanner')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === 'scanner'
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Bot className="w-3.5 h-3.5 text-purple-400" />
              <span>Worker 2: Inbox Scanner</span>
            </button>
            <button
              onClick={() => setViewMode('followup')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === 'followup'
                  ? 'bg-amber-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Repeat className="w-3.5 h-3.5 text-amber-400" />
              <span>Worker 3: Follow-Ups</span>
            </button>
          </div>

          <div className="flex items-center space-x-3 text-xs text-gray-400 flex-wrap gap-y-1">
            <span className="flex items-center space-x-1.5 font-mono text-[11px] bg-gray-900 px-2.5 py-0.5 rounded border border-gray-800" title="Worker 1 last scan">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>W1: {formatLastScan(state.last_scan_at || state.last_scanned_at)}</span>
            </span>
            <span className="flex items-center space-x-1.5 font-mono text-[11px] bg-gray-900 px-2.5 py-0.5 rounded border border-gray-800" title="Worker 2 last scan">
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              <span>W2: {formatLastScan(scannerStatus?.last_scan_at || scannerStatus?.last_scanned_at)}</span>
            </span>
            <span className="flex items-center space-x-1.5 font-mono text-[11px] bg-gray-900 px-2.5 py-0.5 rounded border border-gray-800" title="Worker 3 last scan">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>W3: {formatLastScan(worker3Status?.last_scan_at || worker3Status?.last_scanned_at)}</span>
            </span>
          </div>
        </div>
      </div>

      {extensionNeedsReload && (
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <RefreshCw className="w-4 h-4 text-amber-400 shrink-0 animate-spin" />
            <span>
              Extension update ready: In your Chrome browser, go to <strong className="text-white underline">chrome://extensions</strong> and click <strong>🔄 Reload</strong> on <em>MessageV2 Automation Bridge</em> to stream both live isolated windows.
            </span>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* WORKER 1: OUTREACH DISPATCHER DECK (TAB A)                                 */}
      {/* ========================================================================= */}
      {(viewMode === 'triad' || viewMode === 'outreach') && (
        <div className="bg-gray-900/90 border border-indigo-500/30 rounded-2xl p-6 shadow-2xl space-y-6 relative overflow-hidden">
          {/* Deck Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-gray-800 gap-3">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Send className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
                  <h3 className="text-lg font-bold text-white">Worker 1: Outreach Dispatcher</h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    Tab A: instagram.com/profile
                  </span>
                  <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-emerald-950/60 text-emerald-300 border border-emerald-500/40 shadow-sm" title="Worker 1 last task scan / execution timestamp">
                    <Clock className="w-3 h-3 text-emerald-400" />
                    <span>{formatLastScan(state.last_scan_at || state.last_scanned_at)}</span>
                  </span>
                  <span className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    state.status === 'RUNNING'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : state.status === 'PAUSED'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : 'bg-gray-800 text-gray-400 border border-gray-700'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${state.status === 'RUNNING' ? 'bg-emerald-400 animate-ping' : 'bg-gray-500'}`} />
                    <span>{state.status || 'IDLE'}</span>
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  Automated cold outreach and scheduled follow-ups with instant DM restriction detection.
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3 text-xs text-gray-400 flex-wrap gap-y-2">
              <span>Processed: <strong className="text-white font-mono">{state.batch_sent_count ?? 0}</strong></span>
              {state.current_contact && (
                <span className="px-2 py-1 rounded bg-gray-800 text-indigo-300 font-mono text-xs font-semibold">
                  @{state.current_contact.username}
                </span>
              )}

              {/* Worker 1 Random Order Toggle */}
              <label
                className={`flex items-center space-x-1.5 border rounded-xl px-2.5 py-1 shadow-inner cursor-pointer select-none transition-all ${
                  worker1RandomOrder
                    ? 'bg-indigo-500/20 border-indigo-500/60 text-indigo-200'
                    : 'bg-gray-900/90 border-gray-800 text-gray-400 hover:border-gray-700'
                }`}
                title="Randomize contact/task claiming order for Worker 1 (Outreach). Can toggle before start or while running/paused."
              >
                <input
                  type="checkbox"
                  checked={worker1RandomOrder}
                  onChange={handleToggleWorker1RandomOrder}
                  className="w-3 h-3 accent-indigo-500 rounded cursor-pointer"
                />
                <span className="text-[11px] font-semibold flex items-center gap-1">
                  <span>🎲</span>
                  <span>Random Order</span>
                </span>
              </label>

              {/* Individual Worker 1 Start / Pause Controls */}
              {state.status === 'RUNNING' && !state.is_paused ? (
                <div className="flex items-center space-x-1.5 pl-2 border-l border-gray-800">
                  <button
                    type="button"
                    onClick={onPause}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-gray-950 transition active:scale-95 cursor-pointer shadow"
                    title="Pause Worker 1 (Outreach)"
                  >
                    <Pause className="w-3.5 h-3.5 fill-current" />
                    <span>Pause W1</span>
                  </button>
                  <button
                    type="button"
                    onClick={onStop}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition active:scale-95 cursor-pointer shadow"
                    title="Stop Worker 1 (Outreach)"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Stop W1</span>
                  </button>
                </div>
              ) : state.status === 'PAUSED' || state.is_paused ? (
                <div className="flex items-center space-x-1.5 pl-2 border-l border-gray-800">
                  <button
                    type="button"
                    onClick={onResume}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition active:scale-95 cursor-pointer shadow"
                    title="Resume Worker 1 (Outreach)"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Resume W1</span>
                  </button>
                  <button
                    type="button"
                    onClick={onStop}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition active:scale-95 cursor-pointer shadow"
                    title="Stop Worker 1 (Outreach)"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Stop W1</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5 pl-2 border-l border-gray-800">
                  <button
                    type="button"
                    onClick={() => onStart && onStart(batchLimit)}
                    className="flex items-center space-x-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold shadow hover:scale-105 active:scale-95 cursor-pointer"
                    title="Start Worker 1 (Outreach)"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Start W1 (Outreach)</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Worker 1: 7-Stage Dynamic Stepper */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase font-bold text-gray-400 tracking-wider">Outreach Execution Pipeline (7 Steps)</span>
              <span className="text-xs text-indigo-400 font-mono font-semibold">
                {outreachStageIndex >= 0 ? `Step ${outreachStageIndex + 1} of 7: ${OUTREACH_STAGES[outreachStageIndex].label}` : 'Stage: Idle'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {OUTREACH_STAGES.map((s, idx) => {
                const isPast = outreachStageIndex > idx;
                const isCurrent = state.stage === s.key || s.aliases.includes(state.stage);
                return (
                  <div
                    key={s.key}
                    className={`flex flex-col items-center p-2 rounded-xl border text-center transition-all ${
                      isCurrent
                        ? 'bg-indigo-600/30 border-indigo-400 text-indigo-300 shadow-md shadow-indigo-500/20 scale-105'
                        : isPast
                        ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-400'
                        : 'bg-gray-950/60 border-gray-800 text-gray-500'
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

          {/* Worker 1: Batch Dispatch Toolbar */}
          <div className="p-4 rounded-xl bg-gray-950/80 border border-gray-800 flex flex-col lg:flex-row items-center justify-between gap-4">
            <div className="flex items-center space-x-3 w-full lg:w-auto">
              <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex flex-col items-center justify-center text-indigo-400 shrink-0">
                <span className="font-black text-base leading-none">{state.batch_sent_count ?? 0}</span>
                <span className="text-[8px] uppercase font-bold text-gray-400">Sent</span>
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-white">Batch Target:</span>
                  <span className="text-xs font-mono font-bold text-indigo-400">
                    {state.batch_sent_count ?? 0} / {(state.status === 'RUNNING' || state.status === 'PAUSED' ? state.batch_limit : batchLimit) === null ? 'All' : `${(state.status === 'RUNNING' || state.status === 'PAUSED' ? state.batch_limit : batchLimit)} contacts`}
                  </span>
                  {state.batch_limit && (state.batch_sent_count ?? 0) >= state.batch_limit && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse">
                      BATCH COMPLETE
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Anti-spam pacing: {state.delay_seconds || 15}s delay between sends. When all initial or follow-up tasks are done, Worker 1 cleanly stops.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 justify-end w-full lg:w-auto">
              <span className="text-xs text-gray-400 font-semibold mr-1">Batch:</span>
              {[
                { label: '1', val: 1 },
                { label: '3', val: 3 },
                { label: '5', val: 5 },
                { label: '10', val: 10 },
                { label: '25', val: 25 },
                { label: '50', val: 50 },
                { label: 'All', val: null },
              ].map((opt) => {
                const isSelected = !effectiveIsCustom && batchLimit === opt.val;
                return (
                  <button
                    key={String(opt.label)}
                    type="button"
                    onClick={() => onSetBatchPreset ? onSetBatchPreset(opt.val) : setBatchLimit?.(opt.val)}
                    className={`px-2 py-1 text-xs font-bold rounded-lg border transition cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600 border-indigo-400 text-white shadow'
                        : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}

              <div className="flex items-center space-x-1 bg-gray-900 border border-gray-800 rounded-lg px-2 py-0.5">
                <input
                  type="text"
                  value={effectiveCustomInput}
                  onChange={(e) => {
                    onChangeCustom?.(e.target.value);
                    const parsed = parseInt(e.target.value, 10);
                    if (!isNaN(parsed) && parsed > 0) {
                      setBatchLimit?.(parsed);
                    }
                  }}
                  className="w-12 bg-transparent text-xs font-bold text-center text-white focus:outline-none"
                  placeholder="Custom"
                />
                <span className="text-[10px] text-gray-500">qty</span>
              </div>

              {state.status !== 'RUNNING' && state.status !== 'PAUSED' && (
                <button
                  onClick={() => onStart?.(effectiveIsCustom ? (parseInt(effectiveCustomInput, 10) || 5) : batchLimit)}
                  className="ml-1 flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/30 transition hover:scale-105 active:scale-95 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  <span>Start Batch</span>
                </button>
              )}

              {state.status === 'RUNNING' && onPause && (
                <button
                  onClick={onPause}
                  className="ml-1 flex items-center space-x-1.5 bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer"
                >
                  <Pause className="w-3.5 h-3.5 fill-white" />
                  <span>Pause</span>
                </button>
              )}

              {state.status === 'PAUSED' && onResume && (
                <button
                  onClick={onResume}
                  className="ml-1 flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  <span>Resume</span>
                </button>
              )}

              {(state.status === 'RUNNING' || state.status === 'PAUSED') && onStop && (
                <button
                  onClick={onStop}
                  className="flex items-center space-x-1 bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer"
                >
                  <Square className="w-3 h-3 fill-white" />
                  <span>Stop</span>
                </button>
              )}
            </div>
          </div>

          {/* Worker 1: 3-Column Grid (Target Profile + Verification Radar + Live Capture) */}
          {(() => {
            const runTargets = state.current_run_targets || [];
            const selectedTarget = selectedTargetTaskId
              ? runTargets.find((t) => t.task_id === selectedTargetTaskId)
              : null;

            const effectiveTarget = selectedTarget || (state.current_contact ? {
              task_id: (state.current_contact as any).task_id || state.current_task_id || 'active',
              contact_id: state.current_contact.id,
              name: state.current_contact.name,
              username: state.current_contact.username || '',
              instagram_url: state.current_contact.instagram_url,
              task_type: (state.current_contact as any).task_type || 'MESSAGE',
              status: (state.current_contact as any).task_status || (state.status === 'RUNNING' ? 'RUNNING' : 'COMPLETED'),
              is_done: (state.current_contact as any).is_done ?? (state.status !== 'RUNNING'),
              message: (state.current_contact as any).custom_message || state.current_contact.message || 'Hey',
              replied_status: state.current_contact.replied_status || 'UNKNOWN',
              started_at: (state.current_contact as any).started_at || null,
              completed_at: (state.current_contact as any).completed_at || null,
              verification: state.verification
            } : (runTargets.length > 0 ? runTargets[0] : null));

            const effectiveVerification = selectedTarget
              ? selectedTarget.verification
              : (state.verification || (effectiveTarget?.verification ?? null));

            return (
              <div className="space-y-5">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                  {/* Col 1: Current Target Profile */}
                  <div className="bg-gray-950/70 border border-gray-800 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                      <div className="flex items-center space-x-2">
                        <UserCheck className="w-4 h-4 text-emerald-400" />
                        <h4 className="font-bold text-white text-sm">
                          {selectedTarget ? 'Inspecting Previous Target' : 'Current Target Profile'}
                        </h4>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        {effectiveTarget && (
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                              effectiveTarget.is_done || effectiveTarget.status === 'COMPLETED'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : effectiveTarget.status === 'RUNNING'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                                : effectiveTarget.status === 'SKIPPED'
                                ? 'bg-gray-800 text-gray-400 border border-gray-700'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            }`}
                          >
                            {effectiveTarget.is_done ? 'DONE (SENT)' : effectiveTarget.status}
                          </span>
                        )}
                        {selectedTarget && (
                          <button
                            type="button"
                            onClick={() => setSelectedTargetTaskId(null)}
                            className="text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-0.5 rounded transition cursor-pointer"
                            title="Return to currently active live task"
                          >
                            Live
                          </button>
                        )}
                      </div>
                    </div>

                    {effectiveTarget ? (
                      <div className="space-y-3 text-xs">
                        <div>
                          <span className="text-gray-400 block text-[11px]">Recipient Name</span>
                          <div className="flex items-center justify-between mt-0.5">
                            <p className="text-base font-bold text-white">{effectiveTarget.name || 'N/A'}</p>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">
                              {effectiveTarget.task_type || 'MESSAGE'}
                            </span>
                          </div>
                        </div>

                        <div>
                          <span className="text-gray-400 block text-[11px]">Instagram Profile</span>
                          <a
                            href={effectiveTarget.instagram_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm font-mono font-semibold text-emerald-400 hover:underline inline-flex items-center space-x-1 mt-0.5"
                          >
                            <span>@{effectiveTarget.username || 'unknown'}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>

                        <div>
                          <span className="text-gray-400 block text-[11px]">Outreach Copy</span>
                          <div className="mt-1 p-3 bg-gray-900 border border-gray-800 rounded-xl text-gray-200 font-sans leading-relaxed text-xs">
                            "{effectiveTarget.message || 'Hey'}"
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-gray-800/80">
                          <span className="text-gray-400">Database Status:</span>
                          <span className="font-mono text-emerald-400 font-bold">
                            {effectiveTarget.is_done ? '✓ Message Sent to DB' : 'Queue Task Staged'}
                          </span>
                        </div>

                        {effectiveTarget.started_at && (
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-gray-400">Started At:</span>
                            <span className="font-mono text-gray-300">{new Date(effectiveTarget.started_at).toLocaleTimeString()}</span>
                          </div>
                        )}

                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-gray-400">{effectiveTarget.completed_at ? 'Completed At:' : 'Duration:'}</span>
                          <span className="font-mono text-gray-300">
                            {effectiveTarget.completed_at
                              ? new Date(effectiveTarget.completed_at).toLocaleTimeString()
                              : effectiveTarget.started_at
                                ? (() => {
                                    const diffMs = Date.now() - new Date(effectiveTarget.started_at).getTime();
                                    const secs = Math.floor(diffMs / 1000);
                                    return secs < 60
                                      ? `${secs}s (Ongoing…)`
                                      : `${Math.floor(secs / 60)}m ${secs % 60}s (Ongoing…)`;
                                  })()
                                : 'Queued'}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="py-12 text-center text-gray-500">
                        <Compass className="w-8 h-8 mx-auto text-gray-600 mb-2 opacity-60" />
                        <p className="text-xs">Worker 1 is currently waiting or idle.</p>
                        <p className="text-[11px] text-gray-600 mt-0.5">Start a batch to dispatch messages.</p>
                      </div>
                    )}
                  </div>

                  {/* Col 2: Identity Verification Radar */}
                  <div className="bg-gray-950/70 border border-gray-800 rounded-2xl p-5 space-y-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                        <div className="flex items-center space-x-2">
                          <ShieldCheck className="w-4 h-4 text-indigo-400" />
                          <h4 className="font-bold text-white text-sm">Identity Verification Radar</h4>
                        </div>
                        {effectiveVerification && (
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                              effectiveVerification.decision === 'HIGH_CONFIDENCE'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : effectiveVerification.decision === 'MEDIUM_CONFIDENCE'
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            }`}
                          >
                            {effectiveVerification.decision}
                          </span>
                        )}
                      </div>

                      {effectiveVerification ? (
                        <div className="mt-4 space-y-4">
                          <div className="bg-gray-900 p-4 rounded-xl border border-gray-800 text-center">
                            <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">
                              Match Confidence Score
                            </span>
                            <div className="text-3xl font-black text-white mt-0.5">
                              {(effectiveVerification.confidence * 100).toFixed(0)}%
                            </div>
                            <p className="text-[11px] text-gray-400 mt-1">
                              {effectiveVerification.reason || 'Verified account parameters match target criteria.'}
                            </p>
                          </div>

                          <div className="space-y-2">
                            <span className="text-[10px] text-gray-400 uppercase tracking-wider font-bold block">
                              Verification Signals Evaluated
                            </span>
                            {effectiveVerification.signals && effectiveVerification.signals.length > 0 ? (
                              effectiveVerification.signals.map((sig, i) => (
                                <div
                                  key={i}
                                  className="bg-gray-900/80 border border-gray-800 p-2.5 rounded-lg flex items-center justify-between text-xs"
                                >
                                  <div>
                                    <span className="font-semibold text-gray-200 capitalize">{sig.name}</span>
                                    <span className="text-[10px] text-gray-500 block">{sig.notes || 'Signal evaluated'}</span>
                                  </div>
                                  <span
                                    className={`font-mono font-bold ${
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
                              ))
                            ) : (
                              <div className="bg-gray-900/60 border border-gray-800 p-3 rounded-lg text-xs space-y-1">
                                <div className="flex items-center justify-between text-emerald-400">
                                  <span>Username & URL Match</span>
                                  <span className="font-mono font-bold">100%</span>
                                </div>
                                <div className="flex items-center justify-between text-emerald-400">
                                  <span>Profile Accessibility</span>
                                  <span className="font-mono font-bold">100%</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="py-12 text-center text-gray-500">
                          <ShieldCheck className="w-8 h-8 mx-auto text-gray-600 mb-2 opacity-50" />
                          <p className="text-xs">Awaiting profile inspection.</p>
                          <p className="text-[11px] text-gray-600 mt-0.5">
                            Multi-signal verification populates once profile loads in Chrome.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Col 3: Live Screen (Tab A) */}
                  <div className="bg-gray-950/70 border border-gray-800 rounded-2xl p-5 space-y-3 flex flex-col justify-between">
                    <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                      <div className="flex items-center space-x-2">
                        <Eye className="w-4 h-4 text-emerald-400" />
                        <h4 className="font-bold text-white text-sm">Live Screen (Tab A)</h4>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="flex items-center space-x-1 text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span>Live Feed</span>
                        </span>

                        <button
                          type="button"
                          onClick={() => setIsFeedPausedTabA(!isFeedPausedTabA)}
                          title={isFeedPausedTabA ? "Resume auto-refresh" : "Pause auto-refresh (freeze frame)"}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer border ${
                            isFeedPausedTabA
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : 'bg-gray-900 text-gray-300 border-gray-800 hover:text-white hover:border-gray-700'
                          }`}
                        >
                          {isFeedPausedTabA ? 'Freeze' : 'Live'}
                        </button>

                        <button
                          type="button"
                          onClick={handleRefreshTabA}
                          title="Instant snap / refresh Tab A live capture"
                          className="p-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition cursor-pointer"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingTabA ? 'animate-spin text-emerald-400' : ''}`} />
                        </button>
                      </div>
                    </div>

                    <div className="relative rounded-xl overflow-hidden border border-gray-800 bg-black aspect-video flex items-center justify-center shadow-inner">
                      <img
                        src={
                          captureModeTabA === 'feed'
                            ? loadedTabASrc
                            : (outreachStreamError
                                ? loadedTabASrc
                                : '/api/browser/stream/outreach')
                        }
                        alt="Visible Chrome Tab A Stream"
                        className="w-full h-full object-contain select-none"
                        onError={() => {
                          if (captureModeTabA === 'stream' && !outreachStreamError) {
                            setOutreachStreamError(true);
                          } else {
                            setOutreachFeedError(true);
                          }
                        }}
                        onLoad={() => setOutreachFeedError(false)}
                      />
                      {outreachFeedError && screenshotUrl && (
                        <img
                          src={screenshotUrl}
                          alt="Current Browser Screenshot"
                          className="absolute inset-0 w-full h-full object-contain"
                        />
                      )}
                      {outreachFeedError && !screenshotUrl && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-gray-950">
                          <Eye className="w-6 h-6 text-emerald-400 mb-1 opacity-80 animate-pulse" />
                          <p className="text-xs text-gray-200 font-semibold">Tab A: Instagram Outreach</p>
                          <p className="text-[10px] text-gray-500 mt-0.5">Capturing live Instagram outreach tab.</p>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-gray-400 pt-1">
                      <span className="text-emerald-400 font-mono text-[10px] flex items-center space-x-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                        <span>Tab A Live Capture Active</span>
                      </span>
                      <a
                        href={`/api/browser/live_feed?worker=outreach&t=${Date.now()}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-400 hover:underline inline-flex items-center space-x-1"
                      >
                        <span>Full Size</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>

                {/* ─────────────────────────────────────────────────────────────
                    PREVIOUS TARGET PROFILES (DONE / NOT DONE IN CURRENT RUN)
                    ───────────────────────────────────────────────────────────── */}
                <div className="bg-gray-950/70 border border-gray-800 rounded-2xl p-5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-gray-800">
                    <div className="flex items-center space-x-2">
                      <Activity className="w-4 h-4 text-indigo-400" />
                      <h4 className="font-bold text-white text-sm">
                        Current Run Target Profiles & Execution History ({runTargets.length} Processed)
                      </h4>
                    </div>
                    <div className="flex items-center space-x-2 text-[11px]">
                      <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-500/30 text-emerald-400 font-bold">
                        {runTargets.filter((t) => t.is_done || t.status === 'COMPLETED').length} Done
                      </span>
                      <span className="px-2 py-0.5 rounded bg-amber-950 border border-amber-500/30 text-amber-400 font-bold">
                        {runTargets.filter((t) => t.status === 'RUNNING').length} Active
                      </span>
                      <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-400 font-bold">
                        {runTargets.filter((t) => t.status === 'SKIPPED' || t.status === 'FAILED').length} Other
                      </span>
                    </div>
                  </div>

                  {runTargets.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 max-h-[280px] overflow-y-auto pr-1">
                      {runTargets.map((t) => {
                        const isSelected = selectedTargetTaskId === t.task_id;
                        return (
                          <div
                            key={t.task_id}
                            onClick={() => setSelectedTargetTaskId(isSelected ? null : t.task_id)}
                            className={`p-3 rounded-xl border transition cursor-pointer flex flex-col justify-between space-y-2 ${
                              isSelected
                                ? 'bg-indigo-950/50 border-indigo-500 shadow-md shadow-indigo-600/20'
                                : 'bg-gray-900/60 border-gray-800 hover:border-gray-700'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="font-bold text-white text-xs block truncate max-w-[140px]">
                                  {t.name}
                                </span>
                                <span className="font-mono text-[11px] text-indigo-400 block truncate max-w-[140px]">
                                  @{t.username || 'unknown'}
                                </span>
                              </div>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase shrink-0 ${
                                  t.is_done || t.status === 'COMPLETED'
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : t.status === 'RUNNING'
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                                    : t.status === 'SKIPPED'
                                    ? 'bg-gray-800 text-gray-400 border border-gray-700'
                                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                }`}
                              >
                                {t.is_done ? 'DONE' : t.status}
                              </span>
                            </div>

                            <div className="flex items-center justify-between text-[10px] text-gray-400 pt-1 border-t border-gray-800/60">
                              <span>{t.task_type}</span>
                              <span>
                                {t.started_at ? `Started: ${new Date(t.started_at).toLocaleTimeString()}` : ''}
                                {t.started_at && t.completed_at ? ' • ' : ''}
                                {t.completed_at ? `Ended: ${new Date(t.completed_at).toLocaleTimeString()}` : (t.started_at ? ' (In Progress)' : 'Queued')}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 italic py-4 text-center">
                      No target profiles dispatched in current run yet. Start a batch to dispatch messages.
                    </p>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ========================================================================= */}
      {/* WORKER 2: REPLY SCANNER & ENTITY EXTRACTOR DECK (TAB B)                   */}
      {/* ========================================================================= */}
      {(viewMode === 'triad' || viewMode === 'scanner') && (
        <div className="bg-gray-900/90 border border-purple-500/30 rounded-2xl p-6 shadow-2xl space-y-6 relative overflow-hidden">
          {/* Deck Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-gray-800 gap-3">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
                  <h3 className="text-lg font-bold text-white">Worker 2: Reply Scanner & Lead Extractor</h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    Tab B: instagram.com/direct/inbox
                  </span>
                  <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-purple-950/60 text-purple-300 border border-purple-500/40 shadow-sm" title="Worker 2 last inbox scan timestamp">
                    <Clock className="w-3 h-3 text-purple-400" />
                    <span>{formatLastScan(scannerStatus?.last_scan_at || scannerStatus?.last_scanned_at)}</span>
                  </span>
                  <span className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    scannerStatus?.status === 'SCANNING' || isScanning
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : 'bg-gray-800 text-gray-400 border border-gray-700'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${scannerStatus?.status === 'SCANNING' || isScanning ? 'bg-purple-400 animate-ping' : 'bg-gray-500'}`} />
                    <span>{scannerStatus?.status === 'SCANNING' || isScanning ? 'SCANNING INBOX' : 'STANDBY'}</span>
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  Independent inbox auditor. Classifies bot auto-replies vs high-intent human leads, extracts phones, emails, and links.
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 flex-wrap">
              {/* Individual Worker 2 Start / Pause Controls */}
              {scannerStatus?.status === 'RUNNING' || (scannerStatus?.status === 'SCANNING' && !scannerStatus?.is_paused) ? (
                <div className="flex items-center space-x-1.5">
                  <button
                    type="button"
                    onClick={handlePauseWorker2}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-gray-950 transition active:scale-95 cursor-pointer shadow"
                    title="Pause Worker 2 (Reply Scanner)"
                  >
                    <Pause className="w-3.5 h-3.5 fill-current" />
                    <span>Pause W2</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleStopWorker2}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition active:scale-95 cursor-pointer shadow"
                    title="Stop Worker 2 (Reply Scanner)"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Stop W2</span>
                  </button>
                </div>
              ) : scannerStatus?.status === 'PAUSED' || scannerStatus?.is_paused ? (
                <div className="flex items-center space-x-1.5">
                  <button
                    type="button"
                    onClick={handleResumeWorker2}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white transition active:scale-95 cursor-pointer shadow"
                    title="Resume Worker 2 (Reply Scanner)"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Resume W2</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleStopWorker2}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition active:scale-95 cursor-pointer shadow"
                    title="Stop Worker 2 (Reply Scanner)"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Stop W2</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={handleStartWorker2}
                    className="flex items-center space-x-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold shadow hover:scale-105 active:scale-95 cursor-pointer"
                    title="Start continuous Worker 2 inbox auditing"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Start W2 (Auditor)</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleTriggerScan}
                    disabled={isScanning || scannerStatus?.status === 'SCANNING'}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition active:scale-95 cursor-pointer disabled:opacity-50"
                    title="Run a single instant inbox scan"
                  >
                    {isScanning || scannerStatus?.status === 'SCANNING' ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Scanning...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                        <span>Scan Once</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Worker 2: 6-Stage Dynamic Stepper */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase font-bold text-gray-400 tracking-wider">Reply Audit Pipeline (6 Steps)</span>
              <span className="text-xs text-purple-400 font-mono font-semibold">
                {scannerStageIndex >= 0 ? `Step ${scannerStageIndex + 1} of 6: ${SCANNER_STAGES[scannerStageIndex].label}` : 'Stage: Standby'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {SCANNER_STAGES.map((s, idx) => {
                const isPast = scannerStageIndex > idx;
                const isCurrent = scannerCurrentStage === s.key || s.aliases.includes(scannerCurrentStage);
                return (
                  <div
                    key={s.key}
                    className={`flex flex-col items-center p-2 rounded-xl border text-center transition-all ${
                      isCurrent
                        ? 'bg-purple-600/30 border-purple-400 text-purple-300 shadow-md shadow-purple-500/20 scale-105'
                        : isPast
                        ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-400'
                        : 'bg-gray-950/60 border-gray-800 text-gray-500'
                    }`}
                  >
                    <div className="flex items-center space-x-1 mb-1">
                      {isPast ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : isCurrent ? (
                        <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping" />
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

          {/* Worker 2: Stats Toolbar */}
          <div className="p-3.5 rounded-xl bg-gray-950/80 border border-gray-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-gray-400">
                Audited: <strong className="text-white font-mono">{scannerStatus?.stats.total_scanned ?? 0}</strong>
              </span>
              <span className="text-amber-400">
                Auto-Replies: <strong className="text-white font-mono">{scannerStatus?.stats.automated_found ?? 0}</strong>
              </span>
              <span className="text-emerald-400">
                Human Replies: <strong className="text-white font-mono">{scannerStatus?.stats.human_replies_found ?? 0}</strong>
              </span>
              <span className="text-gray-400">
                No Reply: <strong className="text-white font-mono">{scannerStatus?.stats.no_reply_count ?? 0}</strong>
              </span>
            </div>

            <div className="flex items-center space-x-3 text-gray-400">
              {scannerStatus?.last_scanned_at && (
                <span>Last Scan: <strong className="text-gray-200">{formatLastScan(scannerStatus.last_scanned_at)}</strong></span>
              )}
              {scanFeedback && (
                <span className="text-purple-300 font-semibold animate-pulse">{scanFeedback}</span>
              )}
            </div>
          </div>

          {/* Worker 2: 3-Column Grid (Target Thread + Entity Extraction Radar + Live Capture Tab B) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Col 1: Current Target Thread */}
            <div className="bg-gray-950/70 border border-gray-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                <div className="flex items-center space-x-2">
                  <UserCheck className="w-4 h-4 text-purple-400" />
                  <h4 className="font-bold text-white text-sm">Inspected Inbox Thread</h4>
                </div>
                {scannerStatus?.current_target?.has_reply !== undefined && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    scannerStatus.current_target.has_reply
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-gray-800 text-gray-400'
                  }`}>
                    {scannerStatus.current_target.has_reply ? 'REPLY RECEIVED' : 'OUTBOUND ONLY'}
                  </span>
                )}
              </div>

              {scannerStatus?.current_target ? (
                <div className="space-y-3 text-xs">
                  <div>
                    <span className="text-gray-400 block text-[11px]">Contact / Account</span>
                    <p className="text-base font-bold text-white mt-0.5">{scannerStatus.current_target.name || 'Instagram User'}</p>
                    {scannerStatus.current_target.username && (
                      <span className="text-purple-400 font-mono text-xs">@{scannerStatus.current_target.username}</span>
                    )}
                  </div>

                  <div>
                    <span className="text-gray-400 block text-[11px]">Latest Inbound Message</span>
                    <div className="mt-1 p-3 bg-gray-900 border border-gray-800 rounded-xl text-gray-200 font-sans leading-relaxed">
                      "{scannerStatus.current_target.full_text || scannerStatus.current_target.snippet || 'No message text available'}"
                    </div>
                  </div>

                  {scannerStatus.current_target.thread_href && (
                    <div>
                      <span className="text-gray-400 block text-[11px]">Direct Thread URL</span>
                      <a
                        href={`https://www.instagram.com${scannerStatus.current_target.thread_href}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] font-mono text-purple-400 hover:underline truncate block mt-0.5 bg-gray-900 px-2 py-1 rounded border border-gray-800"
                      >
                        {scannerStatus.current_target.thread_href}
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-12 text-center text-gray-500">
                  <Compass className="w-8 h-8 mx-auto text-gray-600 mb-2 opacity-60" />
                  <p className="text-xs">No active thread under inspection.</p>
                  <p className="text-[11px] text-gray-600 mt-0.5">Click "Scan Inbox Now" to audit Direct Inbox.</p>
                </div>
              )}
            </div>

            {/* Col 2: Entity Extraction Radar */}
            <div className="bg-gray-950/70 border border-gray-800 rounded-2xl p-5 space-y-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                  <div className="flex items-center space-x-2">
                    <ShieldAlert className="w-4 h-4 text-purple-400" />
                    <h4 className="font-bold text-white text-sm">Entity Extraction Radar</h4>
                  </div>
                  {scannerStatus?.current_target?.entities?.is_automated !== undefined && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      scannerStatus.current_target.entities.is_automated
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    }`}>
                      {scannerStatus.current_target.entities.is_automated ? 'AUTO-RESPONDER / BOT' : 'HUMAN LEAD'}
                    </span>
                  )}
                </div>

                {scannerStatus?.current_target?.entities ? (
                  <div className="mt-4 space-y-3 text-xs">
                    {/* Phone */}
                    <div className="p-3 bg-gray-900 rounded-xl border border-gray-800 flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Phone className="w-4 h-4 text-emerald-400" />
                        <div>
                          <span className="text-[10px] text-gray-400 block font-semibold">Extracted Phone</span>
                          <span className="font-mono font-bold text-white">
                            {scannerStatus.current_target.entities.phone || 'None detected'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Email */}
                    <div className="p-3 bg-gray-900 rounded-xl border border-gray-800 flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Mail className="w-4 h-4 text-indigo-400" />
                        <div>
                          <span className="text-[10px] text-gray-400 block font-semibold">Extracted Email</span>
                          <span className="font-mono font-bold text-white">
                            {scannerStatus.current_target.entities.email || 'None detected'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Website / Link */}
                    <div className="p-3 bg-gray-900 rounded-xl border border-gray-800 flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Link2 className="w-4 h-4 text-purple-400" />
                        <div>
                          <span className="text-[10px] text-gray-400 block font-semibold">Extracted Website / Link</span>
                          <span className="font-mono font-bold text-white truncate max-w-[200px] block">
                            {scannerStatus.current_target.entities.link || 'None detected'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Indicators */}
                    {scannerStatus.current_target.entities.indicators && scannerStatus.current_target.entities.indicators.length > 0 && (
                      <div className="pt-2 border-t border-gray-800">
                        <span className="text-[10px] text-gray-400 uppercase font-bold block mb-1">Bot Detection Signals</span>
                        <div className="flex flex-wrap gap-1">
                          {scannerStatus.current_target.entities.indicators.map((ind, idx) => (
                            <span key={idx} className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px]">
                              {ind}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-12 text-center text-gray-500">
                    <Bot className="w-8 h-8 mx-auto text-gray-600 mb-2 opacity-50" />
                    <p className="text-xs">No entities extracted yet.</p>
                    <p className="text-[11px] text-gray-600 mt-0.5">Extracts phone, email, and links when replies are scanned.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Col 3: Live Screen (Tab B) */}
            <div className="bg-gray-950/70 border border-gray-800 rounded-2xl p-5 space-y-3 flex flex-col justify-between">
              <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                <div className="flex items-center space-x-2">
                  <Eye className="w-4 h-4 text-purple-400" />
                  <h4 className="font-bold text-white text-sm">Live Screen (Tab B)</h4>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="flex items-center space-x-1 text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                    <span>Live Feed</span>
                  </span>

                  <button
                    type="button"
                    onClick={() => setIsFeedPausedTabB(!isFeedPausedTabB)}
                    title={isFeedPausedTabB ? "Resume auto-refresh" : "Pause auto-refresh (freeze frame)"}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer border ${
                      isFeedPausedTabB
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-gray-900 text-gray-300 border-gray-800 hover:text-white hover:border-gray-700'
                    }`}
                  >
                    {isFeedPausedTabB ? 'Freeze' : 'Live'}
                  </button>

                  <button
                    type="button"
                    onClick={handleRefreshTabB}
                    title="Instant snap / refresh Tab B live capture"
                    className="p-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingTabB ? 'animate-spin text-purple-400' : ''}`} />
                  </button>
                </div>
              </div>

              <div className="relative rounded-xl overflow-hidden border border-gray-800 bg-black aspect-video flex items-center justify-center shadow-inner">
                <img
                  src={loadedTabBSrc}
                  alt="Live Screen Tab B"
                  className="w-full h-full object-contain"
                  onError={() => setScannerFeedError(true)}
                  onLoad={() => setScannerFeedError(false)}
                />
                {scannerFeedError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-gray-950">
                    <Bot className="w-6 h-6 text-purple-400 mb-1 opacity-80 animate-pulse" />
                    <p className="text-xs text-gray-200 font-semibold">Tab B: Instagram Direct Inbox</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">Streaming live isolated inbox tab.</p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between text-[11px] text-gray-400 pt-1">
                <span className="text-purple-400 font-mono text-[10px] flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping inline-block" />
                  <span>Tab B screencast attached</span>
                </span>
                <a
                  href={scannerStreamError ? `/api/browser/live_feed?worker=scanner&t=${scannerTick}` : "/api/browser/stream/replies"}
                  target="_blank"
                  rel="noreferrer"
                  className="text-purple-400 hover:underline inline-flex items-center space-x-1"
                >
                  <span>Open Full Video</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* WORKER 3: FOLLOW-UP DISPATCHER DECK (TOUCH 2 & 3)                         */}
      {/* ========================================================================= */}
      {(viewMode === 'triad' || viewMode === 'followup') && (
        <div className="bg-gray-900/90 border border-amber-500/30 rounded-2xl p-6 shadow-2xl space-y-6 relative overflow-hidden">
          {/* Deck Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-gray-800 gap-3">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Repeat className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
                  <h3 className="text-lg font-bold text-white">Worker 3: Follow-Up Dispatcher</h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Touch 2 & 3 Nurture
                  </span>
                  <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-amber-950/60 text-amber-300 border border-amber-500/40 shadow-sm" title="Worker 3 last follow-up scan timestamp">
                    <Clock className="w-3 h-3 text-amber-400" />
                    <span>{formatLastScan(worker3Status?.last_scan_at || worker3Status?.last_scanned_at)}</span>
                  </span>
                  <span className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    worker3Status?.status === 'RUNNING'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                      : worker3Status?.status === 'PAUSED'
                      ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                      : 'bg-gray-800 text-gray-400'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      worker3Status?.status === 'RUNNING'
                        ? 'bg-amber-400'
                        : worker3Status?.status === 'PAUSED'
                        ? 'bg-yellow-400'
                        : 'bg-gray-500'
                    }`} />
                    <span>{worker3Status?.status || 'IDLE'}</span>
                  </span>

                  {coordinatorStatus?.active_sender === 'WORKER-03' ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-600/30 text-amber-300 border border-amber-500/50 flex items-center space-x-1">
                      <Lock className="w-3 h-3 text-amber-400" />
                      <span>DM Lock Held</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-800 text-gray-400 border border-gray-700 flex items-center space-x-1">
                      <Unlock className="w-3 h-3 text-gray-500" />
                      <span>Standby</span>
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  Automated sequence follow-ups (+3d / +5d) strictly gated on Worker 2 inbox auditing. Only contacts with confirmed zero replies receive follow-ups.
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3 flex-wrap gap-y-2">
              <span className="text-xs font-mono text-gray-400">
                Due Now: <strong className={worker3Status?.due_count ? "text-emerald-400 font-bold" : "text-gray-400"}>{worker3Status?.due_count || 0}</strong>
                <span className="text-gray-600 px-1">•</span>
                Future: <strong className="text-amber-400 font-bold">{worker3Status?.future_count || 0}</strong>
                <span className="text-gray-600 px-1">•</span>
                Sent: <strong className="text-white font-bold">{worker3Status?.batch_sent_count || 0}</strong>
              </span>

              {/* Worker 3 Random Order Toggle */}
              <label
                className={`flex items-center space-x-1.5 border rounded-xl px-2.5 py-1 shadow-inner cursor-pointer select-none transition-all ${
                  worker3RandomOrder
                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-200'
                    : 'bg-gray-900/90 border-gray-800 text-gray-400 hover:border-gray-700'
                }`}
                title="Randomize follow-up contact/task claiming order for Worker 3. Can toggle before start or while running/paused."
              >
                <input
                  type="checkbox"
                  checked={worker3RandomOrder}
                  onChange={handleToggleWorker3RandomOrder}
                  className="w-3 h-3 accent-amber-500 rounded cursor-pointer"
                />
                <span className="text-[11px] font-semibold flex items-center gap-1">
                  <span>🎲</span>
                  <span>Random Order</span>
                </span>
              </label>

              {/* Individual Worker 3 Start / Pause Controls in Deck Header */}
              {worker3Status?.status === 'RUNNING' && !worker3Status?.is_paused ? (
                <div className="flex items-center space-x-1.5 pl-2 border-l border-gray-800">
                  <button
                    type="button"
                    onClick={handlePauseWorker3}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-gray-950 transition active:scale-95 cursor-pointer shadow"
                    title="Pause Worker 3 (Follow-Ups)"
                  >
                    <Pause className="w-3.5 h-3.5 fill-current" />
                    <span>Pause W3</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleStopWorker3}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition active:scale-95 cursor-pointer shadow"
                    title="Stop Worker 3 (Follow-Ups)"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Stop W3</span>
                  </button>
                </div>
              ) : worker3Status?.status === 'PAUSED' || worker3Status?.is_paused ? (
                <div className="flex items-center space-x-1.5 pl-2 border-l border-gray-800">
                  <button
                    type="button"
                    onClick={handleResumeWorker3}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white transition active:scale-95 cursor-pointer shadow"
                    title="Resume Worker 3 (Follow-Ups)"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Resume W3</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleStopWorker3}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition active:scale-95 cursor-pointer shadow"
                    title="Stop Worker 3 (Follow-Ups)"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Stop W3</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5 pl-2 border-l border-gray-800">
                  <button
                    type="button"
                    onClick={handleStartWorker3}
                    disabled={worker3ActionLoading}
                    className="flex items-center space-x-1.5 bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold shadow hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50"
                    title="Start Worker 3 (Follow-Ups)"
                  >
                    {worker3ActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                    <span>Start W3 (Follow-Ups)</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Stepper Pipeline */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase font-bold text-gray-400 tracking-wider">Follow-Up Pipeline (6 Steps)</span>
              <span className="text-xs text-amber-400 font-mono font-semibold">
                {worker3Status?.stage ? `Stage: ${worker3Status.stage}` : 'Stage: Idle'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {FOLLOWUP_STAGES.map((s, idx) => {
                const isCurrent = worker3Status?.stage === s.key || s.aliases.includes(worker3Status?.stage || '');
                return (
                  <div
                    key={s.key}
                    className={`flex flex-col items-center p-2 rounded-xl border text-center transition-all ${
                      isCurrent
                        ? 'bg-amber-600/30 border-amber-400 text-amber-300 shadow-md shadow-amber-500/20 scale-105'
                        : 'bg-gray-950/60 border-gray-800 text-gray-500'
                    }`}
                  >
                    <div className="flex items-center space-x-1 mb-1">
                      <span className={`w-2 h-2 rounded-full ${isCurrent ? 'bg-amber-400 animate-ping' : 'bg-gray-600'}`} />
                      <span className="text-[10px] font-mono font-bold">Step {idx + 1}</span>
                    </div>
                    <span className="text-xs font-semibold truncate w-full">{s.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Batch Selector & Actions Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-gray-950/80 border border-gray-800/80">
            <div className="flex items-center space-x-3">
              <span className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center font-bold text-amber-400 text-xs">
                {worker3Status?.batch_sent_count || 0}
              </span>
              <div>
                <span className="text-xs font-bold text-white block">
                  Batch Target: {worker3Status?.batch_sent_count || 0} / {worker3BatchLimit !== null ? `${worker3BatchLimit} follow-ups` : 'All Available'}
                </span>
                <span className="text-[11px] text-gray-400">
                  Worker 3 respects 15s pacing delay and auto-pauses when batch target is reached.
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Presets */}
              <div className="flex items-center rounded-xl bg-gray-900 border border-gray-800 p-1">
                <span className="text-[10px] text-gray-500 uppercase font-bold px-2">Batch:</span>
                {[1, 3, 5, 10, 25, null].map((val) => (
                  <button
                    key={val ?? 'all'}
                    type="button"
                    onClick={() => setWorker3BatchLimit(val)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      worker3BatchLimit === val
                        ? 'bg-amber-600 text-white shadow'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {val ?? 'All'}
                  </button>
                ))}
              </div>

              {/* Action Buttons */}
              {worker3Status?.status === 'RUNNING' && !worker3Status?.is_paused ? (
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={handlePauseWorker3}
                    className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-yellow-600 hover:bg-yellow-500 text-white transition active:scale-95 cursor-pointer shadow"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    <span>Pause</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleStopWorker3}
                    className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition active:scale-95 cursor-pointer shadow"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>Stop</span>
                  </button>
                </div>
              ) : worker3Status?.status === 'PAUSED' || worker3Status?.is_paused ? (
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={handleResumeWorker3}
                    className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white transition active:scale-95 cursor-pointer shadow"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Resume</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleStopWorker3}
                    className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition active:scale-95 cursor-pointer shadow"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>Stop</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleStartWorker3}
                  disabled={worker3ActionLoading}
                  className="flex items-center space-x-2 bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {worker3ActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  <span>Start Follow-Up Batch</span>
                </button>
              )}
            </div>
          </div>

          {/* Detail Cards: Target + Radar + Stream Link */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Target Profile */}
            <div className="bg-gray-950/60 border border-gray-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                <span className="text-xs font-bold text-gray-300 flex items-center space-x-1.5">
                  <User className="w-3.5 h-3.5 text-amber-400" />
                  <span>Current Follow-Up Target</span>
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                  {worker3Status?.current_touch || 'Touch 2 / 3'}
                </span>
              </div>
              {worker3Status?.current_contact_name ? (
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-white">{worker3Status.current_contact_name}</h4>
                  <a
                    href={worker3Status.current_instagram || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-amber-400 hover:underline flex items-center space-x-1 font-mono"
                  >
                    <span>{worker3Status.current_instagram}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ) : (
                <div className="py-2 text-center text-xs text-gray-500 space-y-2">
                  <Repeat className="w-5 h-5 mx-auto mb-1 text-gray-600" />
                  <p className="font-semibold text-gray-300">
                    {(worker3Status?.due_count || 0) > 0
                      ? `${worker3Status?.due_count} follow-up(s) ready to send right now!`
                      : '0 follow-ups currently due.'}
                  </p>
                  {(worker3Status?.future_count || 0) > 0 ? (
                    <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-2.5 text-left space-y-1.5 shadow-inner">
                      <div className="flex items-center justify-between text-[11px] text-amber-300 font-bold">
                        <span>{worker3Status?.future_count} scheduled in future</span>
                        <span className="font-mono text-[10px] text-amber-400/90">
                          {worker3Status?.next_due_at ? new Date(worker3Status.next_due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-400 leading-relaxed">
                        Follow-ups wait 48h after initial outreach. Want to test sending immediately?
                      </p>
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <button
                          type="button"
                          onClick={() => handleMakeDueNow(1)}
                          disabled={fastForwardLoading}
                          className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold transition active:scale-95 cursor-pointer disabled:opacity-50 shadow"
                        >
                          {fastForwardLoading ? '...' : '⚡ Make 1 Due Now'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMakeDueNow(null)}
                          disabled={fastForwardLoading}
                          className="px-2.5 py-1 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-[10px] font-bold transition active:scale-95 cursor-pointer disabled:opacity-50 shadow"
                        >
                          {fastForwardLoading ? '...' : '⚡ Make All Due Now'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[10px] text-gray-500">No follow-ups pending in queue.</p>
                  )}
                  {fastForwardMsg && (
                    <p className="text-[10px] text-emerald-400 font-semibold">{fastForwardMsg}</p>
                  )}
                </div>
              )}
            </div>

            {/* Inbox Audit Verification Radar */}
            <div className="bg-gray-950/60 border border-gray-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                <span className="text-xs font-bold text-gray-300 flex items-center space-x-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Worker 2 Audit Radar</span>
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                  Gated Active
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between p-2 rounded-lg bg-gray-900 border border-gray-800">
                  <span className="text-gray-400 text-[11px]">Inbox Pre-Check</span>
                  <span className="text-emerald-400 font-bold font-mono">ENFORCED</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-gray-900 border border-gray-800">
                  <span className="text-gray-400 text-[11px]">Human Reply Guard</span>
                  <span className="text-emerald-400 font-bold font-mono">ACTIVE (Auto-Cancels)</span>
                </div>
                <p className="text-[10px] text-gray-500 italic">
                  Worker 3 will never send to prospects flagged with inbound replies by Worker 2.
                </p>
              </div>
            </div>

            {/* Outbound Channel Stream */}
            <div className="bg-gray-950/60 border border-gray-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                <span className="text-xs font-bold text-gray-300 flex items-center space-x-1.5">
                  <Eye className="w-3.5 h-3.5 text-amber-400" />
                  <span>Live Screen (Tab A)</span>
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-gray-800 text-gray-300">
                  Shared Tab A
                </span>
              </div>
              <div className="relative rounded-xl overflow-hidden border border-gray-800 bg-black aspect-video flex items-center justify-center shadow-inner">
                <img
                  src={loadedTabASrc}
                  alt="Live Screen Tab A"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-gray-400 pt-1">
                <span className="text-amber-400 font-mono text-[10px] flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping inline-block" />
                  <span>Outbound channel linked</span>
                </span>
                <a
                  href="/api/browser/stream/outreach"
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber-400 hover:underline inline-flex items-center space-x-1"
                >
                  <span>Open Full Video</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
