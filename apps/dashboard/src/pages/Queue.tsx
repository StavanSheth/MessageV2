import React, { useState, useMemo } from 'react';
import { 
  RefreshCw, XCircle, AlertCircle, CheckCircle2, Clock, 
  Search, ListOrdered, Calendar, Play, ChevronLeft, ChevronRight,
  ArrowUpRight, Users, MessageSquare, AlertTriangle, Send, Sparkles, X, Trash2,
  CheckCheck, ShieldAlert
} from 'lucide-react';
import { Task, TaskStatus } from '../types';
import { retryTask, cancelTask, retryAllTasks, deleteTask } from '../services/api';

interface QueueProps {
  tasks: Task[];
  onRefresh: () => void;
}

type QueueViewMode = 'UPCOMING' | 'DONE' | 'ISSUES' | 'ALL';

function formatDisplayDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    }
    return dateStr.replace(/:\d\d\s+UTC$/, ' UTC');
  } catch {
    return dateStr;
  }
}

export const Queue: React.FC<QueueProps> = ({ tasks, onRefresh }) => {
  const [viewMode, setViewMode] = useState<QueueViewMode>('UPCOMING');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterStage, setFilterStage] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [isRetryingAll, setIsRetryingAll] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Pagination state
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  const handleRetry = async (taskId: string) => {
    try {
      setActionLoadingId(taskId);
      await retryTask(taskId);
      onRefresh();
    } catch (e: any) {
      alert(`Failed to retry task: ${e.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancel = async (taskId: string) => {
    try {
      setActionLoadingId(taskId);
      await cancelTask(taskId);
      onRefresh();
    } catch (e: any) {
      alert(`Failed to cancel task: ${e.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!window.confirm('Are you sure you want to permanently delete this task from the queue?')) return;
    try {
      setActionLoadingId(taskId);
      await deleteTask(taskId);
      onRefresh();
    } catch (e: any) {
      alert(`Failed to delete task: ${e.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRetryAll = async () => {
    try {
      setIsRetryingAll(true);
      const res = await retryAllTasks();
      onRefresh();
      alert(`Successfully requeued ${res.retried_count} task(s) for dispatch.`);
    } catch (e: any) {
      alert(`Failed to retry all tasks: ${e.message}`);
    } finally {
      setIsRetryingAll(false);
    }
  };

  // Status and view metrics
  const issueStatuses = ['RETRY_WAIT', 'MANUAL_REVIEW', 'FAILED', 'INTERRUPTED', 'SKIPPED'];
  const upcomingStatuses = ['READY', 'QUEUED', 'RUNNING'];

  const upcomingCount = useMemo(() => tasks.filter((t) => upcomingStatuses.includes(t.status)).length, [tasks]);
  const runningCount = useMemo(() => tasks.filter((t) => t.status === 'RUNNING').length, [tasks]);
  const readyCount = useMemo(() => tasks.filter((t) => t.status === 'READY' || t.status === 'QUEUED').length, [tasks]);
  const completedCount = useMemo(() => tasks.filter((t) => t.status === 'COMPLETED').length, [tasks]);
  const issueCount = useMemo(() => tasks.filter((t) => issueStatuses.includes(t.status)).length, [tasks]);

  // Filtered and Sorted Tasks
  const filteredAndSortedTasks = useMemo(() => {
    let result = tasks.filter((t) => {
      // 1. Search filter
      const term = searchTerm.toLowerCase();
      if (term) {
        const matchesSearch =
          t.id.toLowerCase().includes(term) ||
          (t.contact_name || '').toLowerCase().includes(term) ||
          (t.username || '').toLowerCase().includes(term) ||
          (t.contact_instagram || '').toLowerCase().includes(term) ||
          (t.message || '').toLowerCase().includes(term);
        if (!matchesSearch) return false;
      }

      // 2. Stage filter
      if (filterStage === 'MESSAGE' && t.type !== 'MESSAGE') return false;
      if (filterStage === 'FOLLOW_UP_1' && t.type !== 'FOLLOW_UP_1') return false;
      if (filterStage === 'FOLLOW_UP_2' && t.type !== 'FOLLOW_UP_2') return false;

      // 3. View Mode filter
      if (viewMode === 'UPCOMING') {
        return upcomingStatuses.includes(t.status);
      } else if (viewMode === 'DONE') {
        return t.status === 'COMPLETED';
      } else if (viewMode === 'ISSUES') {
        return issueStatuses.includes(t.status);
      } else {
        // 'ALL' Mode - allow sub-status filter
        if (filterStatus === 'ISSUES') {
          return issueStatuses.includes(t.status);
        } else if (filterStatus !== 'ALL') {
          return t.status === filterStatus;
        }
        return true;
      }
    });

    // 4. Mode-specific intelligent sorting
    result = [...result].sort((a, b) => {
      if (viewMode === 'UPCOMING') {
        // Running tasks always on top
        if (a.status === 'RUNNING' && b.status !== 'RUNNING') return -1;
        if (b.status === 'RUNNING' && a.status !== 'RUNNING') return 1;

        // Higher priority first
        const pA = a.priority ?? 1;
        const pB = b.priority ?? 1;
        if (pA !== pB) return pB - pA;

        // Earliest scheduled_at first
        const timeA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
        const timeB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
        if (timeA && timeB && timeA !== timeB) return timeA - timeB;

        // Fallback: created_at asc
        const crA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const crB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return crA - crB;
      } else if (viewMode === 'DONE') {
        // Most recently completed first
        const compA = a.completed_at ? new Date(a.completed_at).getTime() : (a.updated_at ? new Date(a.updated_at).getTime() : 0);
        const compB = b.completed_at ? new Date(b.completed_at).getTime() : (b.updated_at ? new Date(b.updated_at).getTime() : 0);
        return compB - compA;
      } else if (viewMode === 'ISSUES') {
        // Most recently updated issues first
        const upA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const upB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return upB - upA;
      } else {
        // ALL: Active/Running first, then Ready, then Issues, then Completed, then Cancelled
        const getRank = (st: string) => {
          if (st === 'RUNNING') return 0;
          if (st === 'READY' || st === 'QUEUED') return 1;
          if (st === 'RETRY_WAIT') return 2;
          if (issueStatuses.includes(st)) return 3;
          if (st === 'COMPLETED') return 4;
          return 5;
        };
        const rankDiff = getRank(a.status) - getRank(b.status);
        if (rankDiff !== 0) return rankDiff;
        const timeA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
        const timeB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
        return timeA - timeB;
      }
    });

    return result;
  }, [tasks, viewMode, searchTerm, filterStage, filterStatus]);

  // Reset pagination when mode or filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [viewMode, filterStage, filterStatus, searchTerm, pageSize]);

  // Pagination calculation
  const totalFiltered = filteredAndSortedTasks.length;
  const totalPages = Math.ceil(totalFiltered / pageSize) || 1;
  const paginatedTasks = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAndSortedTasks.slice(start, start + pageSize);
  }, [filteredAndSortedTasks, currentPage, pageSize]);

  const getStatusBadge = (status: TaskStatus) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-sm shadow-emerald-500/10';
      case 'RUNNING':
        return 'bg-indigo-500/20 text-indigo-400 border-indigo-500/40 animate-pulse';
      case 'READY':
      case 'QUEUED':
        return 'bg-sky-500/20 text-sky-400 border-sky-500/30';
      case 'RETRY_WAIT':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
      case 'MANUAL_REVIEW':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/40 font-bold';
      case 'CANCELLED':
      case 'SKIPPED':
        return 'bg-gray-800 text-gray-400 border-gray-700';
      default:
        return 'bg-gray-800 text-gray-300 border-gray-700';
    }
  };

  const getStageBadge = (type?: string) => {
    switch (type) {
      case 'MESSAGE':
        return {
          label: '1. Initial Outreach',
          icon: Send,
          className: 'bg-emerald-950/40 text-emerald-300 border border-emerald-500/30',
        };
      case 'FOLLOW_UP_1':
        return {
          label: '2. Follow-Up 1 (+3d)',
          icon: Clock,
          className: 'bg-indigo-950/40 text-indigo-300 border border-indigo-500/30',
        };
      case 'FOLLOW_UP_2':
        return {
          label: '3. Follow-Up 2 (+5d)',
          icon: Calendar,
          className: 'bg-purple-950/40 text-purple-300 border border-purple-500/30',
        };
      default:
        return {
          label: 'Initial DM',
          icon: Send,
          className: 'bg-gray-800 text-gray-300 border border-gray-700',
        };
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Global Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-gradient-to-r from-gray-900/90 via-[#08231a]/90 to-gray-900/90 border border-gray-800/80 p-5 rounded-2xl shadow-xl backdrop-blur-md">
        <div>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#d49237] to-[#99631b] flex items-center justify-center shadow-lg shadow-[#d49237]/25">
              <ListOrdered className="w-5 h-5 text-gray-950 font-black" />
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h2 className="text-xl font-black text-white tracking-tight">Execution Queue & Dispatch Scheduler</h2>
                <span className="bg-emerald-500/20 text-emerald-400 font-mono text-xs px-2.5 py-0.5 rounded-full border border-emerald-500/30 font-semibold flex items-center space-x-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                  <span>{tasks.length} Synced</span>
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Real-time automated dispatch pipeline tracking upcoming targets, live browser execution, and delivered outreach history.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {issueCount > 0 && (
            <button
              onClick={handleRetryAll}
              disabled={isRetryingAll}
              className="flex items-center space-x-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-lg shadow-amber-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50"
              title="Re-queue all tasks with issues or waiting on retry"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRetryingAll ? 'animate-spin' : ''}`} />
              <span>Retry Issues ({issueCount})</span>
            </button>
          )}

          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="flex items-center space-x-1.5 bg-gray-900 border border-gray-700/80 text-gray-300 hover:text-white px-3.5 py-2 rounded-xl text-xs font-medium transition hover:border-gray-600 cursor-pointer shadow-sm active:scale-95"
            title="Force refresh queue from backend"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-gray-400 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
            <span>{isRefreshing ? 'Syncing...' : 'Sync Queue'}</span>
          </button>
        </div>
      </div>

      {/* Queue Health & Metric KPI Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        {/* 1. Upcoming in Queue */}
        <div 
          onClick={() => { setViewMode('UPCOMING'); }}
          className={`border rounded-xl p-3.5 flex items-center justify-between shadow-sm transition cursor-pointer ${
            viewMode === 'UPCOMING' 
              ? 'bg-sky-950/50 border-sky-400 ring-2 ring-sky-400/40 shadow-lg shadow-sky-950/50' 
              : 'bg-[#08231a]/70 border-sky-500/30 hover:border-sky-500/60'
          }`}
        >
          <div>
            <span className="text-[10px] text-sky-400 font-bold uppercase tracking-wider block">Upcoming Queue</span>
            <span className="text-2xl font-black text-sky-200 mt-1 block">{upcomingCount}</span>
            <span className="text-[10px] text-sky-400/80 mt-0.5 block">
              {runningCount > 0 ? `${runningCount} Running • ${readyCount} Ready` : `${readyCount} Primed for Dispatch`}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center">
            {runningCount > 0 ? (
              <Play className="w-5 h-5 text-sky-400 animate-pulse fill-sky-400" />
            ) : (
              <Clock className="w-5 h-5 text-sky-400" />
            )}
          </div>
        </div>

        {/* 2. Done / Sent Already */}
        <div 
          onClick={() => { setViewMode('DONE'); }}
          className={`border rounded-xl p-3.5 flex items-center justify-between shadow-sm transition cursor-pointer ${
            viewMode === 'DONE' 
              ? 'bg-emerald-950/50 border-emerald-400 ring-2 ring-emerald-400/40 shadow-lg shadow-emerald-950/50' 
              : 'bg-[#08231a]/70 border-emerald-500/30 hover:border-emerald-500/60'
          }`}
        >
          <div>
            <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block">Done Already</span>
            <span className="text-2xl font-black text-emerald-200 mt-1 block">{completedCount}</span>
            <span className="text-[10px] text-emerald-400/80 mt-0.5 block">Sent & Delivered DMs</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
            <CheckCheck className="w-5 h-5 text-emerald-400" />
          </div>
        </div>

        {/* 3. Needs Attention / Issues */}
        <div 
          onClick={() => { setViewMode('ISSUES'); }}
          className={`border rounded-xl p-3.5 flex items-center justify-between shadow-sm transition cursor-pointer ${
            viewMode === 'ISSUES' 
              ? 'bg-amber-950/50 border-amber-400 ring-2 ring-amber-400/40 shadow-lg shadow-amber-950/50' 
              : issueCount > 0 
              ? 'bg-amber-950/20 border-amber-500/40 hover:border-amber-500/70' 
              : 'bg-gray-900/60 border-gray-800'
          }`}
        >
          <div>
            <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider block">Attention Needed</span>
            <span className="text-2xl font-black text-amber-200 mt-1 block">{issueCount}</span>
            <span className="text-[10px] text-amber-400/80 mt-0.5 block">Retries & Review</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
            <ShieldAlert className={`w-5 h-5 ${issueCount > 0 ? 'text-amber-400 animate-bounce' : 'text-gray-500'}`} />
          </div>
        </div>

        {/* 4. Total Pipeline */}
        <div 
          onClick={() => { setViewMode('ALL'); setFilterStatus('ALL'); setFilterStage('ALL'); }}
          className={`border rounded-xl p-3.5 flex items-center justify-between shadow-sm transition cursor-pointer ${
            viewMode === 'ALL' 
              ? 'bg-indigo-950/50 border-indigo-400 ring-2 ring-indigo-400/40 shadow-lg shadow-indigo-950/50' 
              : 'bg-[#08231a]/70 border-gray-800 hover:border-gray-700'
          }`}
        >
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Total Pipeline</span>
            <span className="text-2xl font-black text-white mt-1 block">{tasks.length}</span>
            <span className="text-[10px] text-gray-400 mt-0.5 block">Entire Contact Queue</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-gray-800/80 border border-gray-700 flex items-center justify-center">
            <ListOrdered className="w-5 h-5 text-gray-300" />
          </div>
        </div>
      </div>

      {/* Primary Category Segmented Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-950/80 p-2 rounded-2xl border border-gray-800/90 shadow-lg backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Upcoming Tab */}
          <button
            onClick={() => setViewMode('UPCOMING')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              viewMode === 'UPCOMING'
                ? 'bg-gradient-to-r from-sky-600 to-indigo-600 text-white shadow-md shadow-sky-500/25 scale-[1.02]'
                : 'text-gray-400 hover:text-white hover:bg-gray-900'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Upcoming Queue</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
              viewMode === 'UPCOMING' ? 'bg-white/20 text-white' : 'bg-gray-800 text-gray-400'
            }`}>
              {upcomingCount}
            </span>
          </button>

          {/* Done Tab */}
          <button
            onClick={() => setViewMode('DONE')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              viewMode === 'DONE'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-500/25 scale-[1.02]'
                : 'text-gray-400 hover:text-white hover:bg-gray-900'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Done Already</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
              viewMode === 'DONE' ? 'bg-white/20 text-white' : 'bg-gray-800 text-gray-400'
            }`}>
              {completedCount}
            </span>
          </button>

          {/* Issues Tab */}
          <button
            onClick={() => setViewMode('ISSUES')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              viewMode === 'ISSUES'
                ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-md shadow-amber-500/25 scale-[1.02]'
                : 'text-gray-400 hover:text-white hover:bg-gray-900'
            }`}
          >
            <AlertTriangle className="w-4 h-4" />
            <span>Needs Attention</span>
            {issueCount > 0 && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
                viewMode === 'ISSUES' ? 'bg-white/20 text-white' : 'bg-amber-500/20 text-amber-300'
              }`}>
                {issueCount}
              </span>
            )}
          </button>

          {/* All Tab */}
          <button
            onClick={() => setViewMode('ALL')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              viewMode === 'ALL'
                ? 'bg-gray-800 text-white shadow-md scale-[1.02]'
                : 'text-gray-400 hover:text-white hover:bg-gray-900'
            }`}
          >
            <ListOrdered className="w-4 h-4" />
            <span>All Tasks</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
              viewMode === 'ALL' ? 'bg-white/20 text-white' : 'bg-gray-800 text-gray-400'
            }`}>
              {tasks.length}
            </span>
          </button>
        </div>

        {/* View Mode Description Banner */}
        <div className="text-[11px] text-gray-400 px-3 hidden lg:flex items-center space-x-2">
          {viewMode === 'UPCOMING' && (
            <span className="text-sky-300 flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse"></span>
              <span>Showing tasks sorted in true dispatch order (Priority P3 $\to$ P1, earliest scheduled first).</span>
            </span>
          )}
          {viewMode === 'DONE' && (
            <span className="text-emerald-300 flex items-center space-x-1.5">
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Showing successfully sent direct messages, sorted most recent first.</span>
            </span>
          )}
          {viewMode === 'ISSUES' && (
            <span className="text-amber-300 flex items-center space-x-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Tasks requiring retry, manual review, or interrupted by browser gates.</span>
            </span>
          )}
          {viewMode === 'ALL' && (
            <span className="text-gray-400">Complete unfiltered view across all statuses.</span>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-[#08231a]/80 p-3 rounded-2xl border border-gray-800 backdrop-blur-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search contact, @handle, task ID, or message..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-950/90 border border-gray-800 rounded-xl pl-9 pr-8 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Stage Filter */}
          <div className="flex items-center rounded-xl bg-gray-950/90 border border-gray-800 p-1">
            <span className="text-[10px] text-gray-500 uppercase font-bold px-2 hidden sm:inline">Stage:</span>
            {[
              { id: 'ALL', label: 'All' },
              { id: 'MESSAGE', label: '1st DM' },
              { id: 'FOLLOW_UP_1', label: 'FU 1' },
              { id: 'FOLLOW_UP_2', label: 'FU 2' },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setFilterStage(opt.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  filterStage === opt.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Sub Status Filter for ALL mode */}
          {viewMode === 'ALL' && (
            <div className="flex items-center rounded-xl bg-gray-950/90 border border-gray-800 p-1">
              <span className="text-[10px] text-gray-500 uppercase font-bold px-2 hidden sm:inline">Status:</span>
              {[
                { id: 'ALL', label: 'All' },
                { id: 'READY', label: 'Ready' },
                { id: 'RUNNING', label: 'Running' },
                { id: 'COMPLETED', label: 'Done' },
                { id: 'ISSUES', label: 'Issues' },
                { id: 'CANCELLED', label: 'Cancelled' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setFilterStatus(opt.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition cursor-pointer ${
                    filterStatus === opt.id
                      ? opt.id === 'ISSUES' ? 'bg-amber-600 text-white shadow-sm' : 'bg-indigo-600 text-white shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* Page Size Selector */}
          <div className="flex items-center rounded-xl bg-gray-950/90 border border-gray-800 px-2.5 py-1 space-x-1.5">
            <span className="text-[10px] text-gray-500 font-bold uppercase">Rows:</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="bg-transparent text-xs text-gray-300 font-semibold focus:outline-none cursor-pointer"
            >
              <option value={10} className="bg-gray-900 text-white">10</option>
              <option value={25} className="bg-gray-900 text-white">25</option>
              <option value={50} className="bg-gray-900 text-white">50</option>
              <option value={100} className="bg-gray-900 text-white">100</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Queue Table */}
      <div className="bg-[#08231a]/70 border border-gray-800/90 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[960px]">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-950/90 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                <th className="py-3.5 px-4 w-[6%] text-center">
                  {viewMode === 'UPCOMING' ? 'Queue #' : '#'}
                </th>
                <th className="py-3.5 px-4 w-[22%]">
                  <span className="flex items-center space-x-1.5">
                    <Users className="w-3.5 h-3.5 text-gray-400" />
                    <span>Recipient & Task ID</span>
                  </span>
                </th>
                <th className="py-3.5 px-4 w-[16%]">
                  <span className="flex items-center space-x-1.5">
                    <ListOrdered className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Outreach Stage</span>
                  </span>
                </th>
                <th className="py-3.5 px-4 w-[24%]">
                  <span className="flex items-center space-x-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
                    <span>{viewMode === 'DONE' ? 'Sent Message Copy' : 'Queued Message Body'}</span>
                  </span>
                </th>
                <th className="py-3.5 px-4 w-[14%]">
                  {viewMode === 'UPCOMING' ? 'Priority & Status' : 'Status & Retries'}
                </th>
                <th className="py-3.5 px-4 w-[12%]">
                  {viewMode === 'DONE' ? 'Delivered At' : 'Scheduled / ETA'}
                </th>
                <th className="py-3.5 px-4 text-right w-[6%]">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/70 text-xs">
              {paginatedTasks.length > 0 ? (
                paginatedTasks.map((t, idx) => {
                  const stage = getStageBadge(t.type);
                  const StageIcon = stage.icon;
                  const initials = (t.contact_name || t.username || 'U')
                    .substring(0, 2)
                    .toUpperCase();

                  const canRetry = issueStatuses.includes(t.status) || t.status === 'CANCELLED';
                  const canCancel = t.status !== 'COMPLETED' && t.status !== 'CANCELLED';
                  const overallRank = (currentPage - 1) * pageSize + idx + 1;

                  return (
                    <tr key={t.id} className="hover:bg-gray-800/35 transition-colors group">
                      {/* Queue Position */}
                      <td className="py-4 px-4 align-top text-center">
                        {t.status === 'RUNNING' ? (
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-500/20 text-indigo-300 font-mono text-xs font-black border border-indigo-400 animate-pulse">
                            <Play className="w-3 h-3 fill-indigo-400" />
                          </span>
                        ) : viewMode === 'UPCOMING' ? (
                          <span className={`inline-flex items-center justify-center px-2 py-1 rounded-lg font-mono text-[10px] font-bold ${
                            overallRank === 1 
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-400/50' 
                              : overallRank <= 5 
                              ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40' 
                              : 'bg-gray-900 text-gray-400 border border-gray-800'
                          }`}>
                            #{overallRank}
                          </span>
                        ) : (
                          <span className="text-gray-500 font-mono text-[11px]">
                            #{overallRank}
                          </span>
                        )}
                      </td>

                      {/* Contact & Task ID */}
                      <td className="py-4 px-4 align-top">
                        <div className="flex items-start space-x-3">
                          {/* Instagram Gradient Avatar Circle */}
                          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 p-[1.5px] shrink-0 shadow-sm">
                            <div className="w-full h-full rounded-full bg-gray-950 flex items-center justify-center text-[11px] font-black text-white">
                              {initials}
                            </div>
                          </div>

                          <div className="min-w-0">
                            <div className="font-bold text-white text-sm truncate max-w-[170px]">
                              {t.contact_name || 'Recipient'}
                            </div>
                            <div className="text-gray-400 font-mono text-[11px] flex items-center space-x-1.5 mt-0.5">
                              <span>@{t.username || t.contact_id.slice(0, 8)}</span>
                              <span className="text-gray-600">•</span>
                              <span className="text-indigo-400 font-semibold">#{t.id.slice(0, 8)}</span>
                            </div>

                            {t.contact_instagram && (
                              <a
                                href={t.contact_instagram}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center space-x-1 text-indigo-400 hover:text-indigo-300 font-medium text-[11px] mt-1 transition group-hover:underline"
                              >
                                <span>View Profile</span>
                                <ArrowUpRight className="w-3 h-3 shrink-0" />
                              </a>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Outreach Stage */}
                      <td className="py-4 px-4 align-top space-y-1.5">
                        <span className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${stage.className}`}>
                          <StageIcon className="w-3 h-3" />
                          <span>{stage.label}</span>
                        </span>
                        <div className="text-[10px] text-gray-500 font-mono flex items-center space-x-1 pl-1">
                          <span>Seq #{t.sequence ?? 1}</span>
                          <span>•</span>
                          <span className="text-gray-400 font-semibold">Priority P{t.priority ?? 1}</span>
                        </div>
                      </td>

                      {/* Queued Message Preview */}
                      <td className="py-4 px-4 align-top">
                        <div 
                          className="text-[11px] text-gray-300 font-sans line-clamp-2 bg-gray-950/70 p-2.5 rounded-xl border border-gray-800/90 shadow-inner group-hover:border-gray-700/80 transition"
                          title={t.message || 'Hey'}
                        >
                          "{t.message || 'Hey! Saw your profile and loved your work.'}"
                        </div>
                      </td>

                      {/* Status & Retries */}
                      <td className="py-4 px-4 align-top space-y-1.5">
                        <span
                          className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${getStatusBadge(
                            t.status
                          )}`}
                        >
                          {t.status === 'COMPLETED' ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          ) : t.status === 'RUNNING' ? (
                            <Play className="w-3 h-3 text-indigo-400 fill-indigo-400" />
                          ) : t.status === 'RETRY_WAIT' || t.status === 'MANUAL_REVIEW' ? (
                            <AlertCircle className="w-3 h-3 text-amber-400" />
                          ) : (
                            <Clock className="w-3 h-3 text-sky-400" />
                          )}
                          <span>{t.status.replace('_', ' ')}</span>
                        </span>

                        <div className="text-[10px] text-gray-400 font-mono pl-1">
                          {t.status === 'COMPLETED' ? (
                            <span className="text-emerald-400 font-semibold">Delivered</span>
                          ) : (
                            <>
                              Attempt: <span className="text-gray-200 font-semibold">{t.attempt_count ?? t.retry_count ?? 0}</span> / {t.max_retries ?? 3}
                            </>
                          )}
                        </div>
                      </td>

                      {/* Scheduled / Completed */}
                      <td className="py-4 px-4 align-top text-gray-300 font-mono text-[11px] space-y-1">
                        {t.status === 'COMPLETED' ? (
                          <div className="text-emerald-300 font-medium flex items-center space-x-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span>{formatDisplayDate(t.completed_at) || 'Completed'}</span>
                          </div>
                        ) : t.scheduled_at ? (
                          <div className="text-gray-300 flex items-center space-x-1">
                            <Calendar className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                            <span>{formatDisplayDate(t.scheduled_at)}</span>
                          </div>
                        ) : (
                          <span className="text-gray-500 italic">Immediate</span>
                        )}
                        {t.worker_id && (
                          <div className="text-[10px] text-gray-500 font-mono truncate max-w-[120px]">
                            Worker: {t.worker_id}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-4 align-top text-right">
                        <div className="flex items-center justify-end space-x-1">
                          {canRetry && (
                            <button
                              onClick={() => handleRetry(t.id)}
                              disabled={actionLoadingId === t.id}
                              className="inline-flex items-center space-x-1 px-2 py-1 bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-300 border border-indigo-500/40 rounded-lg text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                              title="Retry this task"
                            >
                              <RefreshCw className={`w-3 h-3 ${actionLoadingId === t.id ? 'animate-spin' : ''}`} />
                              <span>Retry</span>
                            </button>
                          )}

                          {canCancel && (
                            <button
                              onClick={() => handleCancel(t.id)}
                              disabled={actionLoadingId === t.id}
                              className="inline-flex items-center space-x-1 px-2 py-1 bg-gray-900 hover:bg-rose-950/50 text-gray-400 hover:text-rose-300 border border-gray-800 hover:border-rose-700/50 rounded-lg text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                              title="Cancel this task"
                            >
                              <XCircle className="w-3 h-3" />
                              <span>Cancel</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleDeleteTask(t.id)}
                            disabled={actionLoadingId === t.id}
                            className="inline-flex items-center p-1 bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                            title="Delete this task permanently"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-gray-400">
                    <div className="max-w-sm mx-auto space-y-2">
                      <ListOrdered className="w-8 h-8 text-gray-600 mx-auto" />
                      <div className="font-bold text-white text-sm">
                        {viewMode === 'UPCOMING' ? 'No Upcoming Tasks in Queue' : viewMode === 'DONE' ? 'No Completed Tasks Yet' : 'No Tasks Found'}
                      </div>
                      <p className="text-xs text-gray-500">
                        {viewMode === 'UPCOMING'
                          ? 'All queued outreach has been dispatched or there are no tasks in READY status.'
                          : viewMode === 'DONE'
                          ? 'Dispatched messages will show here with their timestamps and delivery status.'
                          : 'No tasks match the active filters. Adjust your search or tab selection.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalFiltered > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3.5 bg-gray-950/80 border-t border-gray-800 text-xs text-gray-400">
            <div>
              Showing <span className="text-white font-semibold">{Math.min((currentPage - 1) * pageSize + 1, totalFiltered)}</span> to{' '}
              <span className="text-white font-semibold">{Math.min(currentPage * pageSize, totalFiltered)}</span> of{' '}
              <span className="text-white font-semibold">{totalFiltered}</span> tasks
              {totalFiltered !== tasks.length && (
                <span className="text-gray-500 ml-1"> (filtered from {tasks.length} total)</span>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <button
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-gray-800 bg-gray-900 text-gray-300 hover:text-white hover:bg-gray-800 disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Prev</span>
              </button>

              <span className="px-3 py-1 text-xs text-gray-300 font-mono">
                Page {currentPage} of {totalPages}
              </span>

              <button
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-gray-800 bg-gray-900 text-gray-300 hover:text-white hover:bg-gray-800 disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
