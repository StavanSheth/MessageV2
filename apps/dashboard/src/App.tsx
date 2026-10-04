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

  const [automationState, setAutomationState] = useState<LiveAutomationState>({
    worker_id: 'WORKER-01',
    worker_name: 'Instagram Worker 01',
    status: 'IDLE',
    stage: 'IDLE',
    browser_status: 'NOT_RUNNING',
    instagram_login_status: 'UNKNOWN',
    task_counts: {},
  });

  // Load backend state
  const loadData = useCallback(async () => {
    try {
      const [st, cList, tList, sList, eList] = await Promise.all([
        fetchAutomationStatus().catch(() => null),
        fetchContacts().catch(() => []),
        fetchTasks().catch(() => []),
        fetchSources().catch(() => []),
        fetchEvents(100).catch(() => []),
      ]);

      if (st) setAutomationState(st);
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
    // Reload state on key status changes
    loadData();
  }, [loadData]);

  const { isConnected: isWsConnected } = useWebSocket(handleWsEvent);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2500);
    return () => clearInterval(interval);
  }, [loadData]);

  // Action handlers
  const handleStart = async () => {
    try {
      await startAutomation();
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

  const needsAttention =
    automationState.instagram_login_status === 'LOGIN_REQUIRED' ||
    automationState.stage === 'MANUAL_ATTENTION' ||
    automationState.status === 'ERROR';

  return (
    <div className="min-h-screen bg-[#090d16] text-gray-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Bar with Live Worker Controls */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        workerStatus={automationState.status}
        isWsConnected={isWsConnected}
        onStart={handleStart}
        onPause={handlePause}
        onResume={handleResume}
        onStop={handleStop}
        needsAttention={needsAttention}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8">
        {/* Prominent Attention Alert */}
        <AttentionCenter state={automationState} />

        {/* Tab Routing */}
        {currentTab === 'automation' && <LiveAutomationView state={automationState} />}
        {currentTab === 'overview' && (
          <Overview
            state={automationState}
            contacts={contacts}
            tasks={tasks}
            onStart={handleStart}
            onNavigate={setCurrentTab}
          />
        )}
        {currentTab === 'contacts' && <Contacts contacts={contacts} onRefresh={loadData} />}
        {currentTab === 'queue' && <Queue tasks={tasks} onRefresh={loadData} />}
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
