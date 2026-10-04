import { 
  Users, Send, CheckCircle2, AlertOctagon, 
  Clock, ArrowUpRight, Play, Upload, MessageCircle, Download,
  Pause, Square
} from 'lucide-react';
import { LiveAutomationState, Contact, Task } from '../types';

interface OverviewProps {
  state: LiveAutomationState;
  contacts: Contact[];
  tasks: Task[];
  batchLimit?: number | null;
  onStart: (limit?: number | null) => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  onNavigate: (tab: string) => void;
}

export const Overview: React.FC<OverviewProps> = ({
  state,
  contacts,
  tasks,
  batchLimit,
  onStart,
  onPause,
  onResume,
  onStop,
  onNavigate,
}) => {
  const totalContacts = contacts.length;
  const totalReplied = contacts.filter((c) => c.has_replied).length;
  const replyRate = totalContacts > 0 ? ((totalReplied / totalContacts) * 100).toFixed(1) : '0';

  const completedTasks = tasks.filter((t) => t.status === 'COMPLETED').length;
  const queuedTasks = tasks.filter((t) => t.status === 'QUEUED' || t.status === 'READY').length;
  const runningTasks = tasks.filter((t) => t.status === 'RUNNING').length;
  const failedTasks = tasks.filter((t) => t.status === 'RETRY_WAIT' || t.status === 'MANUAL_REVIEW').length;

  const statCards = [
    {
      label: 'Total Contacts',
      value: totalContacts,
      sub: 'Ingested from sheets',
      icon: Users,
      color: 'from-blue-600/20 to-indigo-600/20 border-indigo-500/30 text-indigo-400',
    },
    {
      label: 'Queued / Ready',
      value: queuedTasks,
      sub: 'Awaiting execution',
      icon: Clock,
      color: 'from-amber-600/20 to-orange-600/20 border-amber-500/30 text-amber-400',
    },
    {
      label: 'Completed / Sent',
      value: completedTasks,
      sub: 'Messages dispatched',
      icon: Send,
      color: 'from-emerald-600/20 to-teal-600/20 border-emerald-500/30 text-emerald-400',
    },
    {
      label: 'Replied / Converted',
      value: `${totalReplied} (${replyRate}%)`,
      sub: 'Inbound responses',
      icon: MessageCircle,
      color: 'from-purple-600/20 to-pink-600/20 border-purple-500/30 text-purple-400',
    },
    {
      label: 'Failed / Review',
      value: failedTasks,
      sub: 'Require inspection',
      icon: AlertOctagon,
      color: 'from-rose-600/20 to-red-600/20 border-rose-500/30 text-rose-400',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome & Quick Action Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gray-900/60 p-6 rounded-2xl border border-gray-800">
        <div>
          <h2 className="text-2xl font-black text-white tracking-tight">Mission Control Dashboard</h2>
          <p className="text-sm text-gray-400 mt-1">
            Local desktop Instagram outreach pipeline with visible browser automation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/api/contacts/export/excel"
            download
            className="flex items-center space-x-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-lg shadow-emerald-500/20 transition hover:scale-105 active:scale-95"
            title="Download full outreach report with 1st message and follow-up tracking in Excel (.xlsx)"
          >
            <Download className="w-4 h-4" />
            <span>Export Excel</span>
          </a>
          <button
            onClick={() => onNavigate('sources')}
            className="flex items-center space-x-2 bg-gray-800 hover:bg-gray-700 text-gray-200 px-4 py-2.5 rounded-xl text-xs font-bold border border-gray-700 transition cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>Import Sheet</span>
          </button>

          {state.status === 'RUNNING' && (
            <>
              {onPause && (
                <button
                  onClick={onPause}
                  className="flex items-center space-x-2 bg-amber-600 hover:bg-amber-500 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow transition hover:scale-105 active:scale-95 cursor-pointer"
                >
                  <Pause className="w-4 h-4 fill-white" />
                  <span>Pause</span>
                </button>
              )}
              {onStop && (
                <button
                  onClick={onStop}
                  className="flex items-center space-x-2 bg-rose-600 hover:bg-rose-500 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow transition hover:scale-105 active:scale-95 cursor-pointer"
                >
                  <Square className="w-4 h-4 fill-white" />
                  <span>Stop</span>
                </button>
              )}
              <button
                onClick={() => onNavigate('automation')}
                className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition hover:scale-105 active:scale-95 cursor-pointer"
              >
                <span>Live Monitor</span>
              </button>
            </>
          )}

          {state.status === 'PAUSED' && (
            <>
              {onResume && (
                <button
                  onClick={onResume}
                  className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow transition hover:scale-105 active:scale-95 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>Resume</span>
                </button>
              )}
              {onStop && (
                <button
                  onClick={onStop}
                  className="flex items-center space-x-2 bg-rose-600 hover:bg-rose-500 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow transition hover:scale-105 active:scale-95 cursor-pointer"
                >
                  <Square className="w-4 h-4 fill-white" />
                  <span>Stop</span>
                </button>
              )}
            </>
          )}

          {state.status !== 'RUNNING' && state.status !== 'PAUSED' && (
            <button
              onClick={() => onStart(batchLimit)}
              className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition hover:scale-105 active:scale-95 cursor-pointer"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Start Processing ({batchLimit === null ? 'All' : batchLimit})</span>
            </button>
          )}
        </div>
      </div>

      {/* High Level Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <div
              key={i}
              className={`p-5 rounded-2xl border bg-gradient-to-br ${card.color} shadow-lg backdrop-blur-sm`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">{card.label}</span>
                <Icon className="w-5 h-5" />
              </div>
              <div className="text-2xl font-black text-white">{card.value}</div>
              <p className="text-[11px] text-gray-400 mt-1">{card.sub}</p>
            </div>
          );
        })}
      </div>

      {/* Pipeline Progress and Quick Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Pipeline Progress */}
        <div className="lg:col-span-2 bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-xl space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white">Queue Distribution</h3>
            <button
              onClick={() => onNavigate('queue')}
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center space-x-1"
            >
              <span>View Full Queue</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-400 font-medium">
              <span>Overall Progress</span>
              <span>{totalContacts > 0 ? `${completedTasks} of ${totalContacts} completed` : 'No contacts'}</span>
            </div>
            <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden flex">
              <div
                style={{ width: `${totalContacts > 0 ? (completedTasks / totalContacts) * 100 : 0}%` }}
                className="bg-emerald-500 h-full transition-all"
              />
              <div
                style={{ width: `${totalContacts > 0 ? (runningTasks / totalContacts) * 100 : 0}%` }}
                className="bg-indigo-500 h-full animate-pulse transition-all"
              />
              <div
                style={{ width: `${totalContacts > 0 ? (failedTasks / totalContacts) * 100 : 0}%` }}
                className="bg-rose-500 h-full transition-all"
              />
            </div>
          </div>

          {/* Detailed Task Status Counts */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-3 bg-gray-950/60 rounded-xl border border-gray-800">
              <span className="text-[10px] text-gray-400 uppercase font-semibold">Ready</span>
              <p className="text-lg font-bold text-gray-200 mt-1">{queuedTasks}</p>
            </div>
            <div className="p-3 bg-gray-950/60 rounded-xl border border-gray-800">
              <span className="text-[10px] text-gray-400 uppercase font-semibold">Running</span>
              <p className="text-lg font-bold text-indigo-400 mt-1">{runningTasks}</p>
            </div>
            <div className="p-3 bg-gray-950/60 rounded-xl border border-gray-800">
              <span className="text-[10px] text-gray-400 uppercase font-semibold">Completed</span>
              <p className="text-lg font-bold text-emerald-400 mt-1">{completedTasks}</p>
            </div>
            <div className="p-3 bg-gray-950/60 rounded-xl border border-gray-800">
              <span className="text-[10px] text-gray-400 uppercase font-semibold">Needs Review</span>
              <p className="text-lg font-bold text-amber-400 mt-1">{failedTasks}</p>
            </div>
          </div>
        </div>

        {/* Right Col: Quick Safety Summary */}
        <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-white mb-2">Safety Architecture</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              MessageV2 operates locally under strict fail-closed constraints.
            </p>

            <ul className="mt-4 space-y-3 text-xs text-gray-300">
              <li className="flex items-start space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Visible Browser:</strong> Chrome always runs non-headless so you can observe all interactions.</span>
              </li>
              <li className="flex items-start space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Zero Credential Storage:</strong> Log in directly in the visible Chrome window. No passwords stored.</span>
              </li>
              <li className="flex items-start space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Deterministic Verification:</strong> 4-point weighted identity check prevents messaging wrong accounts.</span>
              </li>
              <li className="flex items-start space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><strong>Human Emulation:</strong> Humanized keystrokes and Gaussian rate-limit pacing.</span>
              </li>
            </ul>
          </div>

          <div className="mt-6 pt-4 border-t border-gray-800">
            <button
              onClick={() => onNavigate('automation')}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white text-xs font-bold shadow-lg transition"
            >
              Open Live Automation Monitor
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
