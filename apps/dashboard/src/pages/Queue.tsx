import React, { useState } from 'react';
import { RefreshCw, XCircle, AlertCircle, CheckCircle2, Clock, Play } from 'lucide-react';
import { Task, TaskStatus } from '../types';
import { retryTask, cancelTask } from '../services/api';

interface QueueProps {
  tasks: Task[];
  onRefresh: () => void;
}

export const Queue: React.FC<QueueProps> = ({ tasks, onRefresh }) => {
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const handleRetry = async (taskId: string) => {
    try {
      setActionLoadingId(taskId);
      await retryTask(taskId);
      onRefresh();
    } catch (e) {
      console.error('Failed to retry task', e);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancel = async (taskId: string) => {
    try {
      setActionLoadingId(taskId);
      await cancelTask(taskId);
      onRefresh();
    } catch (e) {
      console.error('Failed to cancel task', e);
    } finally {
      setActionLoadingId(null);
    }
  };

  const filteredTasks = tasks.filter((t) => {
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-white tracking-tight">Execution Queue</h2>
          <p className="text-sm text-gray-400 mt-1">
            Dispatch pipeline queue managing retries, priority, and state transitions.
          </p>
        </div>

        {/* Filter status buttons */}
        <div className="flex flex-wrap gap-1.5 bg-gray-900 p-1 rounded-xl border border-gray-800">
          {['ALL', 'READY', 'RUNNING', 'COMPLETED', 'RETRY_WAIT', 'MANUAL_REVIEW'].map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
                filterStatus === st
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {st.replace('_', ' ').toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Queue Table */}
      <div className="bg-gray-900/80 border border-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-950/60 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                <th className="py-3.5 px-6">Task ID</th>
                <th className="py-3.5 px-6">Status</th>
                <th className="py-3.5 px-6">Retries</th>
                <th className="py-3.5 px-6">Error Detail</th>
                <th className="py-3.5 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60 text-xs">
              {filteredTasks.length > 0 ? (
                filteredTasks.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="py-4 px-6 font-mono text-gray-300">
                      #{t.id.slice(0, 8)}
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
                    <td className="py-4 px-6 text-gray-400 font-mono">
                      {t.retry_count} / {t.max_retries}
                    </td>
                    <td className="py-4 px-6 max-w-xs">
                      {t.last_error ? (
                        <div className="text-rose-400 font-mono text-[11px] truncate" title={t.last_error}>
                          {t.last_error}
                        </div>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right space-x-2">
                      {(t.status === 'RETRY_WAIT' || t.status === 'MANUAL_REVIEW' || t.status === 'INTERRUPTED') && (
                        <button
                          onClick={() => handleRetry(t.id)}
                          disabled={actionLoadingId === t.id}
                          className="inline-flex items-center space-x-1 px-2.5 py-1 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 rounded-lg text-xs font-semibold transition"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Retry</span>
                        </button>
                      )}

                      {t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && (
                        <button
                          onClick={() => handleCancel(t.id)}
                          disabled={actionLoadingId === t.id}
                          className="inline-flex items-center space-x-1 px-2.5 py-1 bg-gray-800 hover:bg-rose-950/50 text-gray-400 hover:text-rose-300 border border-gray-700 hover:border-rose-700/50 rounded-lg text-xs font-semibold transition"
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
                  <td colSpan={5} className="py-12 text-center text-gray-500">
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
