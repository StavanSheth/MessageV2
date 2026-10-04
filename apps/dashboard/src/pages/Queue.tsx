import React, { useState } from 'react';
import { 
  RefreshCw, XCircle, AlertCircle, CheckCircle2, Clock, 
  ExternalLink, Search, ListOrdered, Calendar, Play
} from 'lucide-react';
import { Task, TaskStatus } from '../types';
import { retryTask, cancelTask } from '../services/api';

interface QueueProps {
  tasks: Task[];
  onRefresh: () => void;
}

export const Queue: React.FC<QueueProps> = ({ tasks, onRefresh }) => {
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

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

  const filteredTasks = tasks.filter((t) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      t.id.toLowerCase().includes(term) ||
      (t.contact_name || '').toLowerCase().includes(term) ||
      (t.username || '').toLowerCase().includes(term) ||
      (t.contact_instagram || '').toLowerCase().includes(term);

    if (!matchesSearch) return false;

    if (filterStatus === 'ALL') return true;
    return t.status === filterStatus;
  });

  const getStatusBadge = (status: TaskStatus) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'RUNNING':
        return 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30 animate-pulse';
      case 'READY':
      case 'QUEUED':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'RETRY_WAIT':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'MANUAL_REVIEW':
        return 'bg-orange-500/20 text-orange-400 border-orange-500/30 font-bold';
      case 'CANCELLED':
      case 'SKIPPED':
        return 'bg-gray-800 text-gray-400 border-gray-700';
      default:
        return 'bg-gray-800 text-gray-300 border-gray-700';
    }
  };

  const getTypeBadge = (type?: string) => {
    switch (type) {
      case 'MESSAGE':
        return 'bg-indigo-950/60 text-indigo-300 border border-indigo-500/30';
      case 'FOLLOW_UP_1':
        return 'bg-purple-950/60 text-purple-300 border border-purple-500/30';
      case 'FOLLOW_UP_2':
        return 'bg-pink-950/60 text-pink-300 border border-pink-500/30';
      default:
        return 'bg-gray-800 text-gray-300 border border-gray-700';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <h2 className="text-2xl font-black text-white tracking-tight">Execution Queue</h2>
            <span className="bg-indigo-500/20 text-indigo-400 font-mono text-xs px-2.5 py-0.5 rounded-full border border-indigo-500/30">
              {tasks.length} Tasks
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Dispatch pipeline queue managing automated task sequencing, retries, priority, and transitions.
          </p>
        </div>

        <button
          onClick={onRefresh}
          className="flex items-center space-x-1.5 bg-gray-900 border border-gray-700 text-gray-300 hover:text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition self-start sm:self-auto cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Queue</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-gray-900/60 p-3 rounded-2xl border border-gray-800">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by contact name, @username, or task ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-950 border border-gray-800 rounded-xl pl-9 pr-4 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* Filter status buttons */}
        <div className="flex flex-wrap gap-1 bg-gray-950 p-1 rounded-xl border border-gray-800 overflow-x-auto">
          {['ALL', 'READY', 'RUNNING', 'COMPLETED', 'RETRY_WAIT', 'MANUAL_REVIEW', 'CANCELLED'].map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
                filterStatus === st
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {st === 'ALL' ? 'All' : st.replace('_', ' ').toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Queue Table */}
      <div className="bg-gray-900/80 border border-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[850px]">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-950/70 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                <th className="py-3.5 px-6">Task ID & Recipient</th>
                <th className="py-3.5 px-6">Outreach Stage</th>
                <th className="py-3.5 px-6">Status</th>
                <th className="py-3.5 px-6">Scheduled / Completed</th>
                <th className="py-3.5 px-6">Attempts</th>
                <th className="py-3.5 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60 text-xs">
              {filteredTasks.length > 0 ? (
                filteredTasks.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="py-4 px-6">
                      <div className="font-bold text-white text-sm">
                        {t.contact_name || 'Recipient'}
                      </div>
                      <div className="text-gray-400 font-mono text-[11px] flex items-center space-x-2 mt-0.5">
                        <span>@{t.username || t.contact_id.slice(0, 8)}</span>
                        <span className="text-gray-600">•</span>
                        <span className="text-gray-500">#{t.id.slice(0, 8)}</span>
                      </div>
                    </td>

                    <td className="py-4 px-6">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${getTypeBadge(t.type)}`}>
                        {t.type ? t.type.replace('_', ' ') : 'MESSAGE'}
                      </span>
                    </td>

                    <td className="py-4 px-6">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border ${getStatusBadge(
                          t.status
                        )}`}
                      >
                        {t.status}
                      </span>
                    </td>

                    <td className="py-4 px-6 text-gray-300 font-mono text-[11px]">
                      {t.status === 'COMPLETED' ? (
                        <div className="text-emerald-400 flex items-center space-x-1">
                          <CheckCircle2 className="w-3 h-3 shrink-0" />
                          <span>{t.completed_at || 'Done'}</span>
                        </div>
                      ) : t.scheduled_at ? (
                        <div className="text-gray-300 flex items-center space-x-1">
                          <Calendar className="w-3 h-3 text-indigo-400 shrink-0" />
                          <span>{t.scheduled_at}</span>
                        </div>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>

                    <td className="py-4 px-6 text-gray-400 font-mono">
                      {t.attempt_count ?? t.retry_count ?? 0} / {t.max_retries ?? 3}
                    </td>

                    <td className="py-4 px-6 text-right space-x-2">
                      {(t.status === 'RETRY_WAIT' || t.status === 'MANUAL_REVIEW' || t.status === 'INTERRUPTED') && (
                        <button
                          onClick={() => handleRetry(t.id)}
                          disabled={actionLoadingId === t.id}
                          className="inline-flex items-center space-x-1 px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 rounded-lg text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Retry</span>
                        </button>
                      )}

                      {t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && (
                        <button
                          onClick={() => handleCancel(t.id)}
                          disabled={actionLoadingId === t.id}
                          className="inline-flex items-center space-x-1 px-3 py-1.5 bg-gray-800 hover:bg-rose-950/50 text-gray-400 hover:text-rose-300 border border-gray-700 hover:border-rose-700/50 rounded-lg text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                        >
                          <XCircle className="w-3 h-3" />
                          <span>Cancel</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-500">
                    No tasks found matching filter.
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
