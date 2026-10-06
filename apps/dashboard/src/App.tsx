import React, { useState, useEffect, useCallback } from 'react';
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
  const loadData = useCallback(async () => {
    try {
      const [st, cList, tList, sList, eList, allSt] = await Promise.all([
        fetchAutomationStatus().catch(() => null),
        fetchContacts().catch(() => []),
        fetchTasks().catch(() => []),
        fetchSources().catch(() => []),
        fetchEvents(100).catch(() => []),
        fetchAllWorkersStatus().catch(() => null),
      ]);

      if (st) setAutomationState(st);
      if (cList) setContacts(cList);
      if (tList) setTasks(tList);
      if (sList) setSources(sList);
      if (eList) setEvents(eList);
      if (allSt) setAllWorkersStatus(allSt);
    } catch (e) {
      console.error('Error fetching dashboard data:', e);
    }
  }, []);

  // Real-time event handling via WebSocket
  const handleWsEvent = useCallback((event: EventLog) => {
    setEvents((prev) => [event, ...prev.slice(0, 199)]);
    // Reload state on key status changes
    loadData();
  }, [loadData]);

  const { isConnected: isWsConnected } = useWebSocket(handleWsEvent);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2500);
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
      await startAutomation({ batch_limit: activeLimit, delay_seconds: 15, random_order: isRandomOrder });
      await loadData();
    } catch (e: any) {
      alert(`Could not start automation: ${e.message}`);
    }
  };

  const handlePause = async () => {
    try {
      await pauseAutomation();
      await loadData();
    } catch (e: any) {
      alert(`Could not pause automation: ${e.message}`);
    }
  };

  const handleResume = async () => {
    try {
      await resumeAutomation();
      await loadData();
    } catch (e: any) {
      alert(`Could not resume automation: ${e.message}`);
    }
  };

  const handleStop = async () => {
    try {
      await stopAutomation();
      await loadData();
    } catch (e: any) {
      alert(`Could not stop automation: ${e.message}`);
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
      await startAllWorkers({ batch_limit: activeLimit, delay_seconds: 15, random_order: isRandomOrder });
      await loadData();
    } catch (e: any) {
      alert(`Could not start all workers: ${e.message}`);
    }
  };

  const handlePauseAll = async () => {
    try {
      await pauseAllWorkers();
      await loadData();
    } catch (e: any) {
      alert(`Could not pause all workers: ${e.message}`);
    }
  };

  const handleResumeAll = async () => {
    try {
      await resumeAllWorkers();
      await loadData();
    } catch (e: any) {
      alert(`Could not resume all workers: ${e.message}`);
    }
  };

  const handleStopAll = async () => {
    try {
      await stopAllWorkers();
      await loadData();
    } catch (e: any) {
      alert(`Could not stop all workers: ${e.message}`);
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
