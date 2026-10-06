import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { AttentionCenter } from './components/AttentionCenter';
import { LiveAutomationView } from './pages/LiveAutomationView';
import { Overview } from './pages/Overview';
import { Contacts } from './pages/Contacts';
import { Queue } from './pages/Queue';
import { Sources } from './pages/Sources';
import { Events } from './pages/Events';

import { useWebSocket } from './hooks/useWebSocket';
import {
  fetchAutomationStatus,
  startAutomation,
  pauseAutomation,
  resumeAutomation,
  stopAutomation,
  startAllWorkers,
  pauseAllWorkers,
  resumeAllWorkers,
  stopAllWorkers,
  fetchAllWorkersStatus,
  setWorkerRandomOrder,
  fetchContacts,
  fetchTasks,
  fetchSources,
  fetchEvents,
} from './services/api';
import { LiveAutomationState, Contact, Task, Source, EventLog } from './types';

export function App() {
  const [currentTab, setCurrentTab] = useState<string>('automation');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [events, setEvents] = useState<EventLog[]>([]);
  const [allWorkersStatus, setAllWorkersStatus] = useState<any>(null);

  const [automationState, setAutomationState] = useState<LiveAutomationState>({
    worker_id: 'WORKER-01',
    worker_name: 'Instagram Worker 01',
    status: 'IDLE',
    stage: 'IDLE',
    browser_status: 'NOT_RUNNING',
    instagram_login_status: 'UNKNOWN',
    task_counts: {},
  });
  const [batchLimit, setBatchLimit] = useState<number | null>(5);
  const [customBatchInput, setCustomBatchInput] = useState<string>('8');
  const [isCustomBatch, setIsCustomBatch] = useState<boolean>(false);
  const [isRandomOrder, setIsRandomOrder] = useState<boolean>(false);

  // Mutation lock to prevent background intervals / in-flight polling from overwriting optimistic actions
  const isMutatingRef = useRef<boolean>(false);
  const lastMutationTimeRef = useRef<number>(0);

  const markMutating = () => {
    isMutatingRef.current = true;
    lastMutationTimeRef.current = Date.now();
  };

  const finishMutating = () => {
    setTimeout(async () => {
      isMutatingRef.current = false;
      await loadData(true);
    }, 450);
  };

  const handleToggleRandomOrder = async (val: boolean) => {
    setIsRandomOrder(val);
    try {
      await setWorkerRandomOrder('all', val);
    } catch (e) {
      console.warn('Could not update random order on active workers:', e);
    }
  };

  const handleSetBatchPreset = (val: number | null) => {
    setIsCustomBatch(false);
    setBatchLimit(val);
  };

  const handleSelectCustom = () => {
    setIsCustomBatch(true);
    const parsed = parseInt(customBatchInput, 10) || 5;
    setBatchLimit(parsed);
  };

  const handleChangeCustom = (valStr: string) => {
    setIsCustomBatch(true);
    setCustomBatchInput(valStr);
    const parsed = parseInt(valStr, 10);
    if (!isNaN(parsed) && parsed > 0) {
      setBatchLimit(parsed);
    }
  };

  // Load backend state
  const loadData = useCallback(async (force = false) => {
    try {
      const [st, cList, tList, sList, eList, allSt] = await Promise.all([
        fetchAutomationStatus().catch(() => null),
        fetchContacts().catch(() => []),
        fetchTasks().catch(() => []),
        fetchSources().catch(() => []),
        fetchEvents(100).catch(() => []),
        fetchAllWorkersStatus().catch(() => null),
      ]);

      const isRecentMutation = !force && (isMutatingRef.current || (Date.now() - lastMutationTimeRef.current < 1400));

      if (st && !isRecentMutation) setAutomationState(st);
      if (allSt && !isRecentMutation) setAllWorkersStatus(allSt);

      if (cList) setContacts(cList);
      if (tList) setTasks(tList);
      if (sList) setSources(sList);
      if (eList) setEvents(eList);
    } catch (e) {
      console.error('Error fetching dashboard data:', e);
    }
  }, []);

  // Real-time event handling via WebSocket
  const handleWsEvent = useCallback((event: EventLog) => {
    setEvents((prev) => [event, ...prev.slice(0, 199)]);
    // Reload state on key status changes only if no mutation in progress
    if (!isMutatingRef.current && Date.now() - lastMutationTimeRef.current >= 1400) {
      loadData();
    }
  }, [loadData]);

  const { isConnected: isWsConnected } = useWebSocket(handleWsEvent);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      if (!isMutatingRef.current && Date.now() - lastMutationTimeRef.current >= 1400) {
        loadData();
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [loadData]);

  // Action handlers - Worker 1
  const handleStart = async (limitOverride?: number | null) => {
    try {
      let activeLimit: number | null = batchLimit;
      if (isCustomBatch) {
        const parsed = parseInt(customBatchInput, 10);
        activeLimit = (!isNaN(parsed) && parsed > 0) ? parsed : 5;
      } else if (limitOverride !== undefined) {
        activeLimit = limitOverride;
      }
      const readyCount = tasks.filter(t => t.status === 'READY').length;
      if (readyCount === 0) {
        alert("Notice: There are currently 0 contacts in READY status in the queue.\n\nPlease go to the Queue tab to select contacts or re-queue skipped tasks before starting.");
        return;
      }
      markMutating();
      setAutomationState((prev) => ({ ...prev, status: 'RUNNING', is_paused: false, is_running: true }));
      setAllWorkersStatus((prev: any) => prev ? ({ ...prev, any_running: true, any_paused: false, active_count: Math.max((prev.active_count || 0), 1) }) : prev);
      await startAutomation({ batch_limit: activeLimit, delay_seconds: 15, random_order: isRandomOrder });
      finishMutating();
    } catch (e: any) {
      isMutatingRef.current = false;
      alert(`Could not start automation: ${e.message}`);
      await loadData(true);
    }
  };

  const handlePause = async () => {
    markMutating();
    setAutomationState((prev) => ({ ...prev, status: 'PAUSED', is_paused: true, is_running: false }));
    setAllWorkersStatus((prev: any) => prev ? ({ ...prev, any_running: false, any_paused: true }) : prev);
    try {
      await pauseAutomation();
      finishMutating();
    } catch (e: any) {
      isMutatingRef.current = false;
      alert(`Could not pause automation: ${e.message}`);
      await loadData(true);
    }
  };

  const handleResume = async () => {
    markMutating();
    setAutomationState((prev) => ({ ...prev, status: 'RUNNING', is_paused: false, is_running: true }));
    setAllWorkersStatus((prev: any) => prev ? ({ ...prev, any_running: true, any_paused: false }) : prev);
    try {
      await resumeAutomation();
      finishMutating();
    } catch (e: any) {
      isMutatingRef.current = false;
      alert(`Could not resume automation: ${e.message}`);
      await loadData(true);
    }
  };

  const handleStop = async () => {
    markMutating();
    setAutomationState((prev) => ({ ...prev, status: 'STOPPED', is_paused: false, is_running: false }));
    setAllWorkersStatus((prev: any) => prev ? ({ ...prev, any_running: false, any_paused: false, all_idle: true }) : prev);
    try {
      await stopAutomation();
      finishMutating();
    } catch (e: any) {
      isMutatingRef.current = false;
      alert(`Could not stop automation: ${e.message}`);
      await loadData(true);
    }
  };

  // Master Action Handlers - All Workers
  const handleStartAll = async (limitOverride?: number | null) => {
    try {
      let activeLimit: number | null = batchLimit;
      if (isCustomBatch) {
        const parsed = parseInt(customBatchInput, 10);
        activeLimit = (!isNaN(parsed) && parsed > 0) ? parsed : 5;
      } else if (limitOverride !== undefined) {
        activeLimit = limitOverride;
      }
      markMutating();
      setAllWorkersStatus((prev: any) => ({
        ...prev,
        any_running: true,
        any_paused: false,
        active_count: 2
      }));
      setAutomationState((prev) => ({ ...prev, status: 'RUNNING', is_paused: false, is_running: true }));
      await startAllWorkers({ batch_limit: activeLimit, delay_seconds: 15, random_order: isRandomOrder });
      finishMutating();
    } catch (e: any) {
      isMutatingRef.current = false;
      alert(`Could not start all workers: ${e.message}`);
      await loadData(true);
    }
  };

  const handlePauseAll = async () => {
    markMutating();
    setAllWorkersStatus((prev: any) => ({
      ...prev,
      any_running: false,
      any_paused: true,
      active_count: 0,
      paused_count: 3
    }));
    setAutomationState((prev) => ({ ...prev, status: 'PAUSED', is_paused: true }));
    try {
      await pauseAllWorkers();
      finishMutating();
    } catch (e: any) {
      isMutatingRef.current = false;
      alert(`Could not pause all workers: ${e.message}`);
      await loadData(true);
    }
  };

  const handleResumeAll = async () => {
    markMutating();
    setAllWorkersStatus((prev: any) => ({
      ...prev,
      any_running: true,
      any_paused: false,
      active_count: 1
    }));
    setAutomationState((prev) => ({ ...prev, status: 'RUNNING', is_paused: false, is_running: true }));
    try {
      await resumeAllWorkers();
      finishMutating();
    } catch (e: any) {
      isMutatingRef.current = false;
      alert(`Could not resume all workers: ${e.message}`);
      await loadData(true);
    }
  };

  const handleStopAll = async () => {
    markMutating();
    setAllWorkersStatus((prev: any) => ({
      ...prev,
      any_running: false,
      any_paused: false,
      all_idle: true,
      active_count: 0,
      paused_count: 0
    }));
    setAutomationState((prev) => ({ ...prev, status: 'STOPPED', is_paused: false, is_running: false }));
    try {
      await stopAllWorkers();
      finishMutating();
    } catch (e: any) {
      isMutatingRef.current = false;
      alert(`Could not stop all workers: ${e.message}`);
      await loadData(true);
    }
  };

  const needsAttention =
    automationState.instagram_login_status === 'LOGIN_REQUIRED' ||
    automationState.stage === 'MANUAL_ATTENTION' ||
    automationState.status === 'ERROR';

  return (
    <div className="min-h-screen bg-[#041610] text-[#fcfbf7] flex flex-col font-sans selection:bg-[#d49237] selection:text-[#041610]">
      {/* Top Bar with Live Worker Controls */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        workerStatus={automationState.status}
        isWsConnected={isWsConnected}
        batchLimit={batchLimit}
        setBatchLimit={setBatchLimit}
        customBatchInput={customBatchInput}
        isCustomBatch={isCustomBatch}
        onSetBatchPreset={handleSetBatchPreset}
        onSelectCustom={handleSelectCustom}
        onChangeCustom={handleChangeCustom}
        batchSentCount={automationState.batch_sent_count}
        onStart={handleStart}
        onPause={handlePause}
        onResume={handleResume}
        onStop={handleStop}
        onStartAll={handleStartAll}
        onPauseAll={handlePauseAll}
        onResumeAll={handleResumeAll}
        onStopAll={handleStopAll}
        anyRunning={allWorkersStatus?.any_running}
        anyPaused={allWorkersStatus?.any_paused}
        activeWorkersCount={allWorkersStatus?.active_count}
        needsAttention={needsAttention}
        isRandomOrder={isRandomOrder}
        onToggleRandomOrder={handleToggleRandomOrder}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8">
        {/* Prominent Attention Alert */}
        <AttentionCenter state={automationState} />

        {/* Tab Routing */}
        {currentTab === 'automation' && (
          <LiveAutomationView
            state={automationState}
            batchLimit={batchLimit}
            setBatchLimit={setBatchLimit}
            customBatchInput={customBatchInput}
            isCustomBatch={isCustomBatch}
            onSetBatchPreset={handleSetBatchPreset}
            onSelectCustom={handleSelectCustom}
            onChangeCustom={handleChangeCustom}
            onStart={handleStart}
            onPause={handlePause}
            onResume={handleResume}
            onStop={handleStop}
            onRefresh={loadData}
          />
        )}
        {currentTab === 'overview' && (
          <Overview
            state={automationState}
            contacts={contacts}
            tasks={tasks}
            batchLimit={batchLimit}
            onStart={handleStart}
            onPause={handlePause}
            onResume={handleResume}
            onStop={handleStop}
            onNavigate={setCurrentTab}
          />
        )}
        {currentTab === 'contacts' && <Contacts contacts={contacts} tasks={tasks} automationState={automationState} onRefresh={loadData} />}
        {currentTab === 'queue' && <Queue tasks={tasks} automationState={automationState} onRefresh={loadData} />}
        {currentTab === 'sources' && (
          <Sources sources={sources} onImportSuccess={loadData} onNavigate={setCurrentTab} />
        )}
        {currentTab === 'events' && <Events events={events} />}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800/80 py-4 px-6 text-center text-xs text-gray-500 font-mono">
        MessageV2 • Local Playwright Instagram Automation • Fail-Closed Architecture
      </footer>
    </div>
  );
}

export default App;
