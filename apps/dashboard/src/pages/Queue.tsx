import React, { useState, useMemo } from 'react';
import { 
  RefreshCw, XCircle, AlertCircle, CheckCircle2, Clock, 
  Search, ListOrdered, Calendar, Play, ChevronLeft, ChevronRight,
  ArrowUpRight, Users, MessageSquare, AlertTriangle, Send, Sparkles, X, Trash2,
  CheckCheck, ShieldAlert, Zap, Filter, ArrowUpDown,
  ThumbsUp, ThumbsDown, CheckSquare, Square, Download,
  Edit3, Pause, Save, ChevronUp, ChevronDown
} from 'lucide-react';
import { Task, TaskStatus, LiveAutomationState } from '../types';
import { retryTask, cancelTask, retryAllTasks, deleteTask, confirmFollowups, cancelFollowups, updateTask, toggleTaskPause, bulkSetTaskSelection, reorderTasks, updateContactMessages, updateFollowupSchedule, startAutomation, startWorker3 } from '../services/api';
import { DateFilterMode, matchesDateFilter, formatDisplayDate, toDatetimeLocalValue } from '../utils/date';
import { getStatusBadgeClass } from '../components/common/StatusBadge';

interface QueueProps {
  tasks: Task[];
  automationState?: LiveAutomationState | null;
  onRefresh: () => void;
}

type QueueViewMode = 'UPCOMING' | 'DONE' | 'ISSUES' | 'ALL';
type RunFilterMode = 'ALL' | 'NEXT_IN_RUN' | 'DONE_IN_RUN';
type TimeSortMode = 'DEFAULT' | 'SCHEDULED_ASC' | 'SCHEDULED_DESC' | 'COMPLETED_DESC' | 'COMPLETED_ASC';

interface ErrorCategoryInfo {
  tag: string;
  label: string;
  badgeClass: string;
  description: string;
}

function parseTaskError(task: Task): ErrorCategoryInfo | null {
  const rawCat = (task.error_category || task.error_code || '').toUpperCase();
  const rawMsg = (task.error_message || task.last_error || task.manual_review_reason || '');
  const statusStr = (task.status || '').toUpperCase();
  const isAttentionStatus = ['MANUAL_REVIEW', 'RETRY_WAIT', 'AWAITING_APPROVAL', 'RECONCILING', 'FAILED', 'INTERRUPTED', 'SKIPPED'].includes(statusStr);
  const hasRepliedStatus = task.contact?.replied_status === 'DM_RESTRICTED' || task.contact?.replied_status === 'YES' || task.contact?.replied_status === 'AUTOMATED_MESSAGE';

  if (!rawCat && !rawMsg && !isAttentionStatus && !hasRepliedStatus) {
    return null;
  }

  // Check prefix [TAG] in message
  const tagMatch = rawMsg.match(/^\[([A-Z0-9_]+)\]\s*(.*)/i);
  const matchedTag = tagMatch ? tagMatch[1].toUpperCase() : rawCat;
  const cleanMsg = tagMatch ? tagMatch[2].trim() : rawMsg.trim();

  // 1. Awaiting Approval
  if (
    statusStr === 'AWAITING_APPROVAL' ||
    matchedTag.includes('AWAITING_APPROVAL') ||
    matchedTag.includes('APPROVAL') ||
    cleanMsg.toLowerCase().includes('awaiting approval') ||
    cleanMsg.toLowerCase().includes('manual approval')
  ) {
    return {
      tag: 'AWAITING_APPROVAL',
      label: 'Needs Manual Approval',
      badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold',
      description: cleanMsg || 'Identity verification confidence was medium. Operator approval required before sending.'
    };
  }

  // 2. Page not found / 404 / Broken link
  const lowerMsg = cleanMsg.toLowerCase();
  if (
    matchedTag.includes('PAGE_NOT_FOUND') ||
    matchedTag.includes('PROFILE_NOT_FOUND') ||
    lowerMsg.includes('page not found') ||
    lowerMsg.includes('profile not found') ||
    lowerMsg.includes("page isn't available") ||
    lowerMsg.includes("page is not available") ||
    lowerMsg.includes("link you followed may be broken") ||
    lowerMsg.includes("page may have been removed") ||
    lowerMsg.includes('404')
  ) {
    return {
      tag: 'PAGE_NOT_FOUND',
      label: 'Account Not Found (404)',
      badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40 font-bold',
      description: cleanMsg || "Sorry, this page isn't available. The link may be broken, or the page may have been removed."
    };
  }

  // 3. DM Restricted
  if (
    matchedTag.includes('DM_RESTRICTED') ||
    cleanMsg.toLowerCase().includes('does not accept') ||
    cleanMsg.toLowerCase().includes('message button not available') ||
    cleanMsg.toLowerCase().includes('no message button') ||
    cleanMsg.toLowerCase().includes('restricted') ||
    task.contact?.replied_status === 'DM_RESTRICTED'
  ) {
    return {
      tag: 'DM_RESTRICTED',
      label: 'DMs Closed / Follow-Only',
      badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold',
      description: cleanMsg || 'Account restricts direct messages from non-followers or disabled message requests.'
    };
  }

  // 4. External message detected
  if (
    matchedTag.includes('EXTERNAL_MESSAGE_DETECTED') ||
    cleanMsg.toLowerCase().includes('external message') ||
    cleanMsg.toLowerCase().includes('message not sent by system')
  ) {
    return {
      tag: 'EXTERNAL_MESSAGE_DETECTED',
      label: 'Manual Message Outside System',
      badgeClass: 'bg-rose-500/25 text-rose-300 border-rose-500/40 font-bold',
      description: cleanMsg || 'A message was sent directly from this Instagram account (e.g. from mobile) outside the automated queue.'
    };
  }

  // 5. Reply received / inbound response
  if (
    matchedTag.includes('REPLY_RECEIVED') ||
    cleanMsg.toLowerCase().includes('reply received') ||
    cleanMsg.toLowerCase().includes('already replied') ||
    cleanMsg.toLowerCase().includes('contact replied') ||
    task.contact?.has_replied ||
    task.contact?.replied_status === 'YES' ||
    task.contact?.replied_status === 'AUTOMATED_MESSAGE'
  ) {
    return {
      tag: 'REPLY_RECEIVED',
      label: 'Lead Replied on Instagram',
      badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold',
      description: cleanMsg || 'Lead answered or sent an automated reply. Held for operator review to prevent automated interruption.'
    };
  }

  // 6. Existing conversation history
  if (
    matchedTag.includes('EXISTING_HISTORY') ||
    matchedTag.includes('ALREADY_MESSAGED') ||
    cleanMsg.toLowerCase().includes('existing') ||
    cleanMsg.toLowerCase().includes('prior conversation')
  ) {
    return {
      tag: 'EXISTING_HISTORY',
      label: 'Prior Chat History with Lead',
      badgeClass: 'bg-sky-500/20 text-sky-300 border-sky-500/40 font-bold',
      description: cleanMsg || 'Prior conversation history detected in this Instagram thread before automation ran.'
    };
  }

  // 7. Rate limit
  if (matchedTag.includes('RATE_LIMITED') || cleanMsg.toLowerCase().includes('rate limit') || cleanMsg.toLowerCase().includes('action blocked')) {
    return {
      tag: 'RATE_LIMITED',
      label: 'Rate Limited (Cooling Down)',
      badgeClass: 'bg-orange-500/20 text-orange-300 border-orange-500/40 font-bold',
      description: cleanMsg || 'Instagram anti-spam limit triggered. System paused with pacing delay before next attempt.'
    };
  }

  // 8. Profile mismatch
  if (matchedTag.includes('PROFILE_MISMATCH') || cleanMsg.toLowerCase().includes('mismatch')) {
    return {
      tag: 'PROFILE_MISMATCH',
      label: 'Profile Doesn\'t Match Lead',
      badgeClass: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40 font-bold',
      description: cleanMsg || 'Extracted profile details do not match the expected contact username or identity.'
    };
  }

  // 9. Composer unavailable
  if (matchedTag.includes('COMPOSER_UNAVAILABLE') || cleanMsg.toLowerCase().includes('composer') || cleanMsg.toLowerCase().includes('typing')) {
    return {
      tag: 'COMPOSER_UNAVAILABLE',
      label: 'Chat Box Unavailable',
      badgeClass: 'bg-red-500/20 text-red-300 border-red-500/40 font-bold',
      description: cleanMsg || 'Instagram message input field could not be focused or typed into.'
    };
  }

  // 10. Security checkpoint
  if (matchedTag.includes('CHALLENGE_REQUIRED') || cleanMsg.toLowerCase().includes('challenge') || cleanMsg.toLowerCase().includes('checkpoint')) {
    return {
      tag: 'CHALLENGE_REQUIRED',
      label: 'Instagram Security Challenge',
      badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40 font-bold',
      description: cleanMsg || 'Instagram presented a security checkpoint, SMS code, or CAPTCHA challenge.'
    };
  }

  // 11. Login / auth required
  if (matchedTag.includes('AUTH') || cleanMsg.toLowerCase().includes('login') || cleanMsg.toLowerCase().includes('not logged in')) {
    return {
      tag: 'AUTHENTICATION_REQUIRED',
      label: 'Instagram Login Required',
      badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40 font-bold',
      description: cleanMsg || 'Instagram session expired or account is not logged in on active Chrome profile.'
    };
  }

  // 12. Fallback based on specific attention task status
  if (statusStr === 'MANUAL_REVIEW') {
    return {
      tag: matchedTag || 'MANUAL_REVIEW',
      label: matchedTag ? matchedTag.replace(/_/g, ' ') : 'Needs Operator Review',
      badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold',
      description: cleanMsg || 'Task flagged for manual operator review before proceeding.'
    };
  }

  if (statusStr === 'RETRY_WAIT') {
    return {
      tag: matchedTag || 'RETRY_WAIT',
      label: matchedTag ? matchedTag.replace(/_/g, ' ') : 'Queued for Auto-Retry',
      badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold',
      description: cleanMsg || 'Task scheduled for retry attempt after transient issue.'
    };
  }

  if (statusStr === 'INTERRUPTED') {
    return {
      tag: 'INTERRUPTED',
      label: 'Interrupted Mid-Run',
      badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40 font-bold',
      description: cleanMsg || 'Automation run was abruptly halted or process terminated while this task was dispatching.'
    };
  }

  if (statusStr === 'RECONCILING') {
    return {
      tag: 'RECONCILING',
      label: 'Verifying Delivery',
      badgeClass: 'bg-blue-500/20 text-blue-300 border-blue-500/40 font-bold',
      description: cleanMsg || 'Message was submitted; system is inspecting chat thread to verify delivery and avoid duplicate sends.'
    };
  }

  if (statusStr === 'FAILED') {
    return {
      tag: matchedTag || 'FAILED',
      label: 'Delivery Failed',
      badgeClass: 'bg-red-500/20 text-red-300 border-red-500/40 font-bold',
      description: cleanMsg || 'Send attempt failed after retries exhausted or non-retryable error.'
    };
  }

  if (statusStr === 'SKIPPED') {
    return {
      tag: matchedTag || 'SKIPPED',
      label: matchedTag ? matchedTag.replace(/_/g, ' ') : 'Skipped by Policy',
      badgeClass: 'bg-gray-500/20 text-gray-300 border-gray-500/40 font-bold',
      description: cleanMsg || 'Task was skipped based on account condition or policy.'
    };
  }

  if (cleanMsg || matchedTag) {
    const finalTag = matchedTag || 'ATTENTION_NEEDED';
    return {
      tag: finalTag,
      label: matchedTag ? matchedTag.replace(/_/g, ' ') : 'Attention Needed',
      badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold',
      description: cleanMsg || 'Task requires attention or operator review.'
    };
  }

  return null;
}

export const Queue: React.FC<QueueProps> = ({ tasks, automationState, onRefresh }) => {
  const [viewMode, setViewMode] = useState<QueueViewMode>('UPCOMING');
  const [runFilter, setRunFilter] = useState<RunFilterMode>('ALL');
  const [dateFilter, setDateFilter] = useState<DateFilterMode>('ALL');
  const [timeSort, setTimeSort] = useState<TimeSortMode>('DEFAULT');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterStage, setFilterStage] = useState<string>('ALL');
  const [issueCategoryFilter, setIssueCategoryFilter] = useState<string>('ALL');
  const [workerFilter, setWorkerFilter] = useState<'ALL' | 'WORKER-01' | 'WORKER-02' | 'WORKER-03'>('ALL');
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [isConfirmingFollowups, setIsConfirmingFollowups] = useState(false);
  const [isStartingSelected, setIsStartingSelected] = useState(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [isRetryingAll, setIsRetryingAll] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isBulkSelecting, setIsBulkSelecting] = useState(false);

  // Pagination state
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Run Tracking Logic
  const currentRunId = automationState?.current_run_id;
  const batchLimit = automationState?.batch_limit;
  const batchSentCount = automationState?.batch_sent_count ?? 0;
  const isWorkerRunning = automationState?.status === 'RUNNING';

  const runCompletedTaskIds = useMemo(() => {
    return new Set(automationState?.run_completed_task_ids || []);
  }, [automationState]);

  // Determine remaining quota in the current/upcoming batch run
  const activeBatchQuota = batchLimit ? batchLimit : 10;
  const remainingInRunQuota = isWorkerRunning 
    ? Math.max(0, activeBatchQuota - batchSentCount) 
    : activeBatchQuota;

  // Upcoming tasks sorted strictly in operational dispatch order
  const upcomingSortedTasks = useMemo(() => {
    return tasks
      .filter((t) => ['READY', 'QUEUED', 'RUNNING'].includes(t.status))
      .sort((a, b) => {
        if (a.status === 'RUNNING' && b.status !== 'RUNNING') return -1;
        if (b.status === 'RUNNING' && a.status !== 'RUNNING') return 1;
        const pDiff = (b.priority ?? 1) - (a.priority ?? 1);
        if (pDiff !== 0) return pDiff;
        const timeA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
        const timeB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
        return timeA - timeB;
      });
  }, [tasks]);

  // Set of task IDs that are "Next in this run"
  const nextInRunTaskIds = useMemo(() => {
    return new Set(upcomingSortedTasks.slice(0, remainingInRunQuota).map((t) => t.id));
  }, [upcomingSortedTasks, remainingInRunQuota]);

  // Map of task ID to run position
  const nextInRunPositionMap = useMemo(() => {
    const map = new Map<string, number>();
    upcomingSortedTasks.slice(0, remainingInRunQuota).forEach((t, i) => {
      map.set(t.id, i + 1);
    });
    return map;
  }, [upcomingSortedTasks, remainingInRunQuota]);

  // Active (non-paused) upcoming tasks ordered by dispatch priority
  const activeUpcomingTasks = useMemo(() => {
    return upcomingSortedTasks.filter((t) => t.status !== 'PAUSED');
  }, [upcomingSortedTasks]);

  // Map of task ID to dispatch order rank (#1, #2, #3...)
  const activeTaskPositionMap = useMemo(() => {
    const map = new Map<string, number>();
    activeUpcomingTasks.forEach((t, i) => {
      map.set(t.id, i + 1);
    });
    return map;
  }, [activeUpcomingTasks]);

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

  // Edit Task & Sequence modal state
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editForm, setEditForm] = useState({
    task_scheduled_at: '',
    task_priority: 1,
    contact_message: '',
    followup_1_message: '',
    followup_1_delay_days: 3,
    followup_1_scheduled_at: '',
    followup_1_status: 'SCHEDULED',
    followup_2_message: '',
    followup_2_delay_days: 5,
    followup_2_scheduled_at: '',
    followup_2_status: 'SCHEDULED',
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editSuccessMsg, setEditSuccessMsg] = useState('');

  const handleOpenEdit = (t: Task) => {
    setEditingTask(t);
    const c = t.contact;
    setEditForm({
      task_scheduled_at: toDatetimeLocalValue(t.scheduled_at_raw || t.scheduled_at),
      task_priority: t.priority ?? 1,
      contact_message: c?.message || c?.custom_message || t.message || '',
      followup_1_message: c?.followup_1_message || 'Hey! Just following up on my previous message.',
      followup_1_delay_days: c?.followup_1_delay_days ?? 3,
      followup_1_scheduled_at: toDatetimeLocalValue(c?.followup_1_scheduled_at_raw || c?.followup_1_scheduled_at),
      followup_1_status: c?.followup_1_status || 'SCHEDULED',
      followup_2_message: c?.followup_2_message || 'Hey! One last quick check-in before I close this thread.',
      followup_2_delay_days: c?.followup_2_delay_days ?? 5,
      followup_2_scheduled_at: toDatetimeLocalValue(c?.followup_2_scheduled_at_raw || c?.followup_2_scheduled_at),
      followup_2_status: c?.followup_2_status || 'SCHEDULED',
    });
    setEditSuccessMsg('');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask) return;
    setIsSavingEdit(true);
    setEditSuccessMsg('');
    try {
      const activeMsg = editingTask.type === 'FOLLOW_UP_1' 
        ? editForm.followup_1_message 
        : editingTask.type === 'FOLLOW_UP_2' 
        ? editForm.followup_2_message 
        : editForm.contact_message;

      await updateTask(editingTask.id, {
        scheduled_at: editForm.task_scheduled_at ? new Date(editForm.task_scheduled_at).toISOString() : null,
        priority: Number(editForm.task_priority) || 1,
        message: activeMsg,
      });

      if (editingTask.contact_id) {
        await updateContactMessages(editingTask.contact_id, {
          message: editForm.contact_message,
          followup_1_message: editForm.followup_1_message,
          followup_2_message: editForm.followup_2_message,
        });

        await updateFollowupSchedule(editingTask.contact_id, {
          followup_1_scheduled_at: editForm.followup_1_scheduled_at ? new Date(editForm.followup_1_scheduled_at).toISOString() : null,
          followup_1_status: editForm.followup_1_status,
          followup_1_delay_days: Number(editForm.followup_1_delay_days) || 3,
          followup_2_scheduled_at: editForm.followup_2_scheduled_at ? new Date(editForm.followup_2_scheduled_at).toISOString() : null,
          followup_2_status: editForm.followup_2_status,
          followup_2_delay_days: Number(editForm.followup_2_delay_days) || 5,
        });
      }

      setEditSuccessMsg('Sequence and schedule updated successfully!');
      onRefresh();
      setTimeout(() => {
        setEditingTask(null);
        setEditSuccessMsg('');
      }, 1000);
    } catch (err: any) {
      alert(`Error updating sequence: ${err.message}`);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleTogglePause = async (taskId: string) => {
    try {
      setActionLoadingId(taskId);
      await toggleTaskPause(taskId);
      onRefresh();
    } catch (e: any) {
      alert(`Failed to toggle pause: ${e.message}`);
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

  const handleToggleSelect = (taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const handleSelectAll = (idsOnPage: string[]) => {
    if (idsOnPage.length === 0) return;
    const allSelected = idsOnPage.every((id) => selectedTaskIds.has(id));
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        idsOnPage.forEach((id) => next.delete(id));
      } else {
        idsOnPage.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleQuickPick = (count: number, pageIds: string[]) => {
    setSelectedTaskIds(new Set(pageIds.slice(0, count)));
  };

  const handleDeselectAll = () => {
    setSelectedTaskIds(new Set());
  };

  const handleStartWorker1WithSelected = async () => {
    if (selectedTaskIds.size === 0) return;
    try {
      setIsStartingSelected(true);
      await startAutomation({ task_ids: Array.from(selectedTaskIds) });
      alert(`Worker 1 started with ${selectedTaskIds.size} selected contact(s)!`);
      await onRefresh();
    } catch (e: any) {
      alert(`Could not start Worker 1: ${e.message}`);
    } finally {
      setIsStartingSelected(false);
    }
  };

  const handleStartWorker3WithSelected = async () => {
    if (selectedTaskIds.size === 0) return;
    try {
      setIsStartingSelected(true);
      await startWorker3(null, 15, false, Array.from(selectedTaskIds));
      alert(`Worker 3 started with ${selectedTaskIds.size} selected follow-up(s)!`);
      await onRefresh();
    } catch (e: any) {
      alert(`Could not start Worker 3: ${e.message}`);
    } finally {
      setIsStartingSelected(false);
    }
  };

  const handleBulkExcludeSelected = async () => {
    if (selectedTaskIds.size === 0) return;
    try {
      setIsBulkSelecting(true);
      await bulkSetTaskSelection(Array.from(selectedTaskIds), false);
      await onRefresh();
    } catch (e: any) {
      alert(`Could not exclude selected tasks: ${e.message}`);
    } finally {
      setIsBulkSelecting(false);
    }
  };

  const handleBulkIncludeSelected = async () => {
    if (selectedTaskIds.size === 0) return;
    try {
      setIsBulkSelecting(true);
      await bulkSetTaskSelection(Array.from(selectedTaskIds), true);
      await onRefresh();
    } catch (e: any) {
      alert(`Could not include selected tasks: ${e.message}`);
    } finally {
      setIsBulkSelecting(false);
    }
  };

  const handleBulkRetrySelected = async () => {
    if (selectedTaskIds.size === 0) return;
    try {
      setIsBulkSelecting(true);
      for (const id of Array.from(selectedTaskIds)) {
        await retryTask(id).catch(() => {});
      }
      await onRefresh();
      alert(`Re-queued ${selectedTaskIds.size} task(s) for dispatch.`);
    } catch (e: any) {
      alert(`Could not retry selected tasks: ${e.message}`);
    } finally {
      setIsBulkSelecting(false);
    }
  };

  const handleConfirmFollowups = async (taskIds?: string[]) => {
    try {
      setIsConfirmingFollowups(true);
      const res = await confirmFollowups(taskIds);
      setSelectedTaskIds(new Set());
      await onRefresh();
      alert(`Successfully confirmed ${res.updated_count} follow-up task(s) for dispatch.`);
    } catch (e: any) {
      alert(`Failed to confirm follow-ups: ${e.message}`);
    } finally {
      setIsConfirmingFollowups(false);
    }
  };

  const handleCancelFollowups = async (taskIds?: string[]) => {
    const countDesc = taskIds ? `${taskIds.length}` : 'all eligible';
    if (!window.confirm(`Are you sure you want to cancel ${countDesc} follow-up task(s)?`)) return;
    try {
      setIsConfirmingFollowups(true);
      const res = await cancelFollowups(taskIds);
      setSelectedTaskIds(new Set());
      await onRefresh();
      alert(`Successfully cancelled ${res.cancelled_count} follow-up task(s).`);
    } catch (e: any) {
      alert(`Failed to cancel follow-ups: ${e.message}`);
    } finally {
      setIsConfirmingFollowups(false);
    }
  };

  const handleMoveTask = async (taskId: string, direction: 'UP' | 'DOWN') => {
    const activeIds = activeUpcomingTasks.map((t) => t.id);
    const idx = activeIds.indexOf(taskId);
    if (idx === -1) return;
    if (direction === 'UP' && idx === 0) return;
    if (direction === 'DOWN' && idx === activeIds.length - 1) return;

    const targetIdx = direction === 'UP' ? idx - 1 : idx + 1;
    const newOrder = [...activeIds];
    const temp = newOrder[idx];
    newOrder[idx] = newOrder[targetIdx];
    newOrder[targetIdx] = temp;

    try {
      setActionLoadingId(taskId);
      await reorderTasks(newOrder);
      await onRefresh();
    } catch (e: any) {
      alert(`Could not reorder tasks: ${e.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleTogglePersonSelection = async (task: Task) => {
    try {
      setActionLoadingId(task.id);
      const willBeSelected = task.status === 'PAUSED';
      await bulkSetTaskSelection([task.id], willBeSelected);

      const activeIds = activeUpcomingTasks.filter((t) => t.id !== task.id).map((t) => t.id);
      let newOrderIds: string[];
      if (willBeSelected) {
        newOrderIds = [...activeIds, task.id];
      } else {
        newOrderIds = activeIds;
      }
      await reorderTasks(newOrderIds);
      await onRefresh();
    } catch (e: any) {
      alert(`Could not update selection: ${e.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleBulkIncludePage = async (pageTasks: Task[]) => {
    const eligibleIds = pageTasks
      .filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED')
      .map((t) => t.id);
    if (eligibleIds.length === 0) return;
    try {
      setIsBulkSelecting(true);
      await bulkSetTaskSelection(eligibleIds, true);
      const existingActiveIds = activeUpcomingTasks.filter((t) => !eligibleIds.includes(t.id)).map((t) => t.id);
      await reorderTasks([...existingActiveIds, ...eligibleIds]);
      await onRefresh();
    } catch (e: any) {
      alert(`Could not include tasks: ${e.message}`);
    } finally {
      setIsBulkSelecting(false);
    }
  };

  const handleBulkExcludePage = async (pageTasks: Task[]) => {
    const eligibleIds = pageTasks
      .filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED')
      .map((t) => t.id);
    if (eligibleIds.length === 0) return;
    try {
      setIsBulkSelecting(true);
      await bulkSetTaskSelection(eligibleIds, false);
      const remainingActiveIds = activeUpcomingTasks.filter((t) => !eligibleIds.includes(t.id)).map((t) => t.id);
      await reorderTasks(remainingActiveIds);
      await onRefresh();
    } catch (e: any) {
      alert(`Could not exclude tasks: ${e.message}`);
    } finally {
      setIsBulkSelecting(false);
    }
  };

  // Status and view metrics
  const issueStatuses = ['RETRY_WAIT', 'MANUAL_REVIEW', 'AWAITING_APPROVAL', 'RECONCILING', 'FAILED', 'INTERRUPTED', 'SKIPPED'];
  const upcomingStatuses = ['READY', 'QUEUED', 'RUNNING', 'PAUSED'];

  const upcomingCount = useMemo(() => tasks.filter((t) => upcomingStatuses.includes(t.status)).length, [tasks]);
  const runningCount = useMemo(() => tasks.filter((t) => t.status === 'RUNNING').length, [tasks]);
  const readyCount = useMemo(() => tasks.filter((t) => t.status === 'READY' || t.status === 'QUEUED').length, [tasks]);
  const pausedCount = useMemo(() => tasks.filter((t) => t.status === 'PAUSED').length, [tasks]);
  const completedCount = useMemo(() => tasks.filter((t) => t.status === 'COMPLETED').length, [tasks]);
  const issueCount = useMemo(() => tasks.filter((t) => issueStatuses.includes(t.status)).length, [tasks]);

  const doneInRunCount = useMemo(() => {
    return tasks.filter((t) => runCompletedTaskIds.has(t.id) || (currentRunId && t.run_id === currentRunId)).length;
  }, [tasks, runCompletedTaskIds, currentRunId]);

  const nextInRunCount = useMemo(() => nextInRunTaskIds.size, [nextInRunTaskIds]);

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

      // 2b. Worker Scope filter
      if (workerFilter === 'WORKER-01' && t.type !== 'MESSAGE') return false;
      if (workerFilter === 'WORKER-03' && !t.type?.startsWith('FOLLOW_UP')) return false;

      // 3. Run Filter
      if (runFilter === 'NEXT_IN_RUN') {
        if (!nextInRunTaskIds.has(t.id)) return false;
      } else if (runFilter === 'DONE_IN_RUN') {
        const isDoneInRun = runCompletedTaskIds.has(t.id) || (currentRunId && t.run_id === currentRunId);
        if (!isDoneInRun) return false;
      }

      // 4. Date filter
      if (dateFilter !== 'ALL') {
        const relevantDate = t.status === 'COMPLETED' ? (t.completed_at || t.updated_at) : (t.scheduled_at || t.created_at);
        if (!matchesDateFilter(relevantDate, dateFilter)) return false;
      }

      // 5. View Mode filter
      if (viewMode === 'UPCOMING') {
        return upcomingStatuses.includes(t.status);
      } else if (viewMode === 'DONE') {
        return t.status === 'COMPLETED';
      } else if (viewMode === 'ISSUES') {
        if (!issueStatuses.includes(t.status)) return false;
        if (issueCategoryFilter !== 'ALL') {
          const err = parseTaskError(t);
          if (!err || err.tag !== issueCategoryFilter) return false;
        }
        return true;
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

    // 6. Mode-specific & custom time sorting
    result = [...result].sort((a, b) => {
      if (timeSort === 'SCHEDULED_ASC') {
        const timeA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
        const timeB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
        return timeA - timeB;
      } else if (timeSort === 'SCHEDULED_DESC') {
        const timeA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
        const timeB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
        return timeB - timeA;
      } else if (timeSort === 'COMPLETED_DESC') {
        const timeA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const timeB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        return timeB - timeA;
      } else if (timeSort === 'COMPLETED_ASC') {
        const timeA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const timeB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        return timeA - timeB;
      }

      // Default sorting per view mode
      if (viewMode === 'UPCOMING') {
        if (a.status === 'RUNNING' && b.status !== 'RUNNING') return -1;
        if (b.status === 'RUNNING' && a.status !== 'RUNNING') return 1;
        if (a.status !== 'PAUSED' && b.status === 'PAUSED') return -1;
        if (a.status === 'PAUSED' && b.status !== 'PAUSED') return 1;
        const pA = a.priority ?? 1;
        const pB = b.priority ?? 1;
        if (pA !== pB) return pB - pA;
        const timeA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
        const timeB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
        if (timeA && timeB && timeA !== timeB) return timeA - timeB;
        return 0;
      } else if (viewMode === 'DONE') {
        const compA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const compB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        return compB - compA;
      } else if (viewMode === 'ISSUES') {
        const upA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const upB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return upB - upA;
      } else {
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
  }, [tasks, viewMode, searchTerm, filterStage, filterStatus, runFilter, dateFilter, timeSort, nextInRunTaskIds, runCompletedTaskIds, currentRunId]);

  // Reset pagination when mode or filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [viewMode, filterStage, filterStatus, runFilter, dateFilter, timeSort, searchTerm, pageSize]);

  // Pagination calculation
  const totalFiltered = filteredAndSortedTasks.length;
  const totalPages = Math.ceil(totalFiltered / pageSize) || 1;
  const paginatedTasks = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAndSortedTasks.slice(start, start + pageSize);
  }, [filteredAndSortedTasks, currentPage, pageSize]);

  const getStatusBadge = (status: TaskStatus) => getStatusBadgeClass(status);

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
                  <span>{totalFiltered} in View ({tasks.length} Total)</span>
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

          <a
            href={`/api/tasks/export/excel?t=${Date.now()}`}
            download
            className="flex items-center space-x-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition shadow-md shadow-emerald-950/40 cursor-pointer active:scale-95 hover:scale-105"
            title="Download categorized queue workbook (.xlsx) with Upcoming, Done, and Action Needed sheets"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Queue (.xlsx)</span>
          </a>

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
          onClick={() => { setViewMode('UPCOMING'); setRunFilter('ALL'); }}
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
              {pausedCount > 0 ? ` • ${pausedCount} Paused` : ''}
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
          onClick={() => { setViewMode('DONE'); setRunFilter('ALL'); }}
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
          onClick={() => { setViewMode('ISSUES'); setRunFilter('ALL'); }}
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
          onClick={() => { setViewMode('ALL'); setFilterStatus('ALL'); setFilterStage('ALL'); setRunFilter('ALL'); }}
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

      {/* Run Tracker Banner & Active Session Telemetry */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-gradient-to-r from-gray-950/90 via-indigo-950/20 to-gray-950/90 p-3.5 rounded-2xl border border-indigo-500/30 shadow-lg backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center shrink-0">
            <Zap className={`w-4 h-4 text-indigo-400 ${isWorkerRunning ? 'animate-bounce' : ''}`} />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-white tracking-wide">
                Automation Session Run:
              </span>
              <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">
                {currentRunId || 'Latest Session'}
              </span>
              {batchLimit && (
                <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-gray-800 text-gray-300 border border-gray-700">
                  Batch: {batchSentCount} / {batchLimit} Sent
                </span>
              )}
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              <span>{nextInRunCount} leads assigned to next dispatch batch</span>
              {doneInRunCount > 0 && <span> • {doneInRunCount} sent during this active run</span>}
            </div>
          </div>
        </div>

        {/* Quick Run Filter Toggles */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setRunFilter(runFilter === 'NEXT_IN_RUN' ? 'ALL' : 'NEXT_IN_RUN')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              runFilter === 'NEXT_IN_RUN'
                ? 'bg-amber-500 text-gray-950 shadow-md shadow-amber-500/30 ring-2 ring-amber-400'
                : 'bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Next in This Run ({nextInRunCount})</span>
          </button>

          <button
            onClick={() => setRunFilter(runFilter === 'DONE_IN_RUN' ? 'ALL' : 'DONE_IN_RUN')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              runFilter === 'DONE_IN_RUN'
                ? 'bg-emerald-500 text-gray-950 shadow-md shadow-emerald-500/30 ring-2 ring-emerald-400'
                : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/20'
            }`}
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>Done in This Run ({doneInRunCount})</span>
          </button>

          {runFilter !== 'ALL' && (
            <button
              onClick={() => setRunFilter('ALL')}
              className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition cursor-pointer"
              title="Clear Run filter"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Primary Category Segmented Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-950/80 p-2 rounded-2xl border border-gray-800/90 shadow-lg backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Upcoming Tab */}
          <button
            onClick={() => { setViewMode('UPCOMING'); setRunFilter('ALL'); }}
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
            onClick={() => { setViewMode('DONE'); setRunFilter('ALL'); }}
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
            onClick={() => { setViewMode('ISSUES'); setRunFilter('ALL'); }}
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
            onClick={() => { setViewMode('ALL'); setRunFilter('ALL'); }}
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
          {/* Date Filter */}
          <div className="flex items-center rounded-xl bg-gray-950/90 border border-gray-800 p-1">
            <span className="text-[10px] text-gray-500 uppercase font-bold px-2 hidden sm:inline">Date:</span>
            {[
              { id: 'ALL', label: 'All Dates' },
              { id: 'TODAY', label: 'Today' },
              { id: 'YESTERDAY', label: 'Yesterday' },
              { id: 'WEEK', label: '7 Days' },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setDateFilter(opt.id as DateFilterMode)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  dateFilter === opt.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

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

          {/* Issue Category Filter for ISSUES mode */}
          {viewMode === 'ISSUES' && (
            <div className="flex items-center rounded-xl bg-gray-950/90 border border-amber-500/30 p-1 flex-wrap gap-1">
              <span className="text-[10px] text-amber-400 uppercase font-bold px-2 hidden sm:inline">Issue Type:</span>
              {[
                { id: 'ALL', label: 'All Issues' },
                { id: 'AWAITING_APPROVAL', label: 'Approval' },
                { id: 'REPLY_RECEIVED', label: 'Replied' },
                { id: 'DM_RESTRICTED', label: 'No DMs' },
                { id: 'PROFILE_MISMATCH', label: 'Mismatch' },
                { id: 'PAGE_NOT_FOUND', label: '404' },
                { id: 'RATE_LIMITED', label: 'Cooldown' },
                { id: 'EXTERNAL_MESSAGE_DETECTED', label: 'External' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setIssueCategoryFilter(opt.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    issueCategoryFilter === opt.id
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

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

          {/* Time Sort Selector */}
          <div className="flex items-center rounded-xl bg-gray-950/90 border border-gray-800 px-2.5 py-1 space-x-1.5">
            <ArrowUpDown className="w-3 h-3 text-gray-500" />
            <select
              value={timeSort}
              onChange={(e) => setTimeSort(e.target.value as TimeSortMode)}
              className="bg-transparent text-xs text-gray-300 font-semibold focus:outline-none cursor-pointer"
            >
              <option value="DEFAULT" className="bg-gray-900 text-white">Default Dispatch Order</option>
              <option value="SCHEDULED_ASC" className="bg-gray-900 text-white">Scheduled (Earliest First)</option>
              <option value="SCHEDULED_DESC" className="bg-gray-900 text-white">Scheduled (Latest First)</option>
              <option value="COMPLETED_DESC" className="bg-gray-900 text-white">Delivered (Recent First)</option>
              <option value="COMPLETED_ASC" className="bg-gray-900 text-white">Delivered (Oldest First)</option>
            </select>
          </div>

          {/* Page Size Selector */}
          <div className="flex items-center rounded-xl bg-gray-950/90 border border-gray-800 px-2.5 py-1 space-x-1.5" title="Page size (how many rows displayed per page)">
            <span className="text-[10px] text-gray-500 font-bold uppercase">Per Page:</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="bg-transparent text-xs text-gray-300 font-semibold focus:outline-none cursor-pointer"
            >
              <option value={10} className="bg-gray-900 text-white">10 / page</option>
              <option value={25} className="bg-gray-900 text-white">25 / page</option>
              <option value={50} className="bg-gray-900 text-white">50 / page</option>
              <option value={100} className="bg-gray-900 text-white">100 / page</option>
            </select>
          </div>
        </div>
      </div>

      {/* Issues & Follow-Up Review Control Panel */}
      {viewMode === 'ISSUES' && (
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-gradient-to-r from-amber-950/40 via-[#08231a] to-amber-950/30 border border-amber-500/40 p-4 rounded-2xl shadow-xl backdrop-blur-md">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="text-sm font-bold text-white flex items-center space-x-2">
                <span>Follow-up & Error Review Control</span>
                <span className="text-xs font-mono font-normal px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {selectedTaskIds.size} of {paginatedTasks.length} selected on page
                </span>
              </div>
              <p className="text-xs text-gray-300 mt-0.5">
                Target leads that replied or had delivery issues (restricted DMs, 404s). Confirm all follow-ups at once or select/deselect individual contacts.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleConfirmFollowups()}
              disabled={isConfirmingFollowups || issueCount === 0}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/20 transition cursor-pointer disabled:opacity-50"
              title="Confirm all follow-ups to proceed"
            >
              <ThumbsUp className="w-3.5 h-3.5" />
              <span>Confirm All Follow-ups ({issueCount})</span>
            </button>

            {selectedTaskIds.size > 0 && (
              <>
                <button
                  onClick={() => handleConfirmFollowups(Array.from(selectedTaskIds))}
                  disabled={isConfirmingFollowups}
                  className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-700/80 hover:bg-emerald-600 text-white border border-emerald-500/40 transition cursor-pointer disabled:opacity-50"
                  title="Confirm only selected follow-ups"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Confirm Selected ({selectedTaskIds.size})</span>
                </button>

                <button
                  onClick={() => handleCancelFollowups(Array.from(selectedTaskIds))}
                  disabled={isConfirmingFollowups}
                  className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-rose-900/60 hover:bg-rose-800 text-rose-200 border border-rose-600/40 transition cursor-pointer disabled:opacity-50"
                  title="Cancel selected follow-ups"
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                  <span>Cancel Selected ({selectedTaskIds.size})</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── 3 WORKERS SCOPE TABS & SELECTION CONTROL BAR ── */}
      <div className="flex flex-col space-y-3 bg-gradient-to-r from-[#061d15] via-[#08231a] to-[#061d15] border border-[#123529] p-4 rounded-2xl shadow-xl backdrop-blur-md">
        {/* Worker Scoping Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800/80 pb-3">
          <div className="flex items-center space-x-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Worker Scope:</span>
            <div className="flex flex-wrap items-center gap-1.5 bg-gray-950/90 p-1 rounded-xl border border-gray-800">
              {[
                { id: 'ALL', label: 'All Workers', count: tasks.length },
                { id: 'WORKER-01', label: 'Worker 1 (Outreach)', count: tasks.filter(t => t.type === 'MESSAGE').length },
                { id: 'WORKER-02', label: 'Worker 2 (Reply Scanner)', count: tasks.filter(t => t.contact?.replied_status === 'PENDING_SCAN' || t.status === 'RECONCILING').length },
                { id: 'WORKER-03', label: 'Worker 3 (Follow-Ups)', count: tasks.filter(t => t.type?.startsWith('FOLLOW_UP')).length },
              ].map((w) => (
                <button
                  key={w.id}
                  onClick={() => { setWorkerFilter(w.id as any); setCurrentPage(1); }}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    workerFilter === w.id
                      ? 'bg-gradient-to-r from-[#d49237] to-[#e5a84b] text-[#041610] shadow-md shadow-[#d49237]/25'
                      : 'text-gray-400 hover:text-white hover:bg-gray-900'
                  }`}
                >
                  <span>{w.label}</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${workerFilter === w.id ? 'bg-[#041610]/30 text-[#041610]' : 'bg-gray-800 text-gray-400'}`}>
                    {w.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Quick Selection Presets */}
          <div className="flex items-center space-x-1.5 bg-gray-950/90 p-1 rounded-xl border border-gray-800">
            <span className="text-[10px] font-bold text-gray-500 uppercase px-2">Quick Pick:</span>
            {[1, 3, 5, 10].map((num) => (
              <button
                key={num}
                onClick={() => handleQuickPick(num, paginatedTasks.map(t => t.id))}
                className="px-2 py-0.5 rounded text-xs font-mono font-bold text-gray-300 hover:text-white hover:bg-gray-800 transition cursor-pointer"
                title={`Pick first ${num} contacts on this page`}
              >
                +{num}
              </button>
            ))}
            <button
              onClick={() => handleSelectAll(paginatedTasks.map(t => t.id))}
              className="px-2.5 py-0.5 rounded text-xs font-bold text-emerald-400 hover:bg-emerald-950/50 transition cursor-pointer"
            >
              All Page
            </button>
            {selectedTaskIds.size > 0 && (
              <button
                onClick={handleDeselectAll}
                className="px-2.5 py-0.5 rounded text-xs font-bold text-rose-400 hover:bg-rose-950/50 transition cursor-pointer"
              >
                Clear ({selectedTaskIds.size})
              </button>
            )}
          </div>
        </div>

        {/* Selected Tasks Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center space-x-2">
            <span className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold border ${
              selectedTaskIds.size > 0
                ? 'bg-[#d49237]/20 text-[#e5a84b] border-[#d49237]/40 shadow-sm'
                : 'bg-gray-900 text-gray-500 border-gray-800'
            }`}>
              {selectedTaskIds.size} Selected
            </span>
            <span className="text-xs text-gray-400">
              {selectedTaskIds.size === 0
                ? 'Click individual checkboxes or quick pick buttons to choose contacts.'
                : 'Choose worker or batch action to execute on this specific selection:'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Start Worker 1 with Selection */}
            <button
              onClick={handleStartWorker1WithSelected}
              disabled={selectedTaskIds.size === 0 || isStartingSelected}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-md shadow-emerald-900/30 transition disabled:opacity-40 cursor-pointer active:scale-95"
              title="Start Worker 1 (Outreach) with only the selected contacts"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Start W1 ({selectedTaskIds.size})</span>
            </button>

            {/* Start Worker 3 with Selection */}
            <button
              onClick={handleStartWorker3WithSelected}
              disabled={selectedTaskIds.size === 0 || isStartingSelected}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-md shadow-indigo-900/30 transition disabled:opacity-40 cursor-pointer active:scale-95"
              title="Start Worker 3 (Follow-Ups) with only the selected follow-ups"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Start W3 ({selectedTaskIds.size})</span>
            </button>

            {/* Include in Active Dispatch Queue */}
            <button
              onClick={handleBulkIncludeSelected}
              disabled={selectedTaskIds.size === 0}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/50 transition disabled:opacity-40 cursor-pointer"
              title="Set selected tasks to READY status"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>Include</span>
            </button>

            {/* Exclude / Pause Selected */}
            <button
              onClick={handleBulkExcludeSelected}
              disabled={selectedTaskIds.size === 0}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 border border-amber-700/50 transition disabled:opacity-40 cursor-pointer"
              title="Pause selected tasks so they are not messaged"
            >
              <Pause className="w-3.5 h-3.5" />
              <span>Exclude</span>
            </button>

            {/* Retry Selected */}
            <button
              onClick={handleBulkRetrySelected}
              disabled={selectedTaskIds.size === 0}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-gray-900 hover:bg-gray-800 text-gray-300 border border-gray-700 transition disabled:opacity-40 cursor-pointer"
              title="Re-queue selected failed/skipped tasks"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Queue Table */}
      <div className="bg-[#08231a]/70 border border-gray-800/90 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[960px]">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-950/90 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                {viewMode !== 'DONE' && (
                  <th className="py-3.5 px-3 w-[4%] text-center">
                    <button
                      type="button"
                      onClick={() => handleSelectAll(paginatedTasks.map((t) => t.id))}
                      className="text-gray-400 hover:text-white transition cursor-pointer"
                      title={
                        paginatedTasks.length > 0 && paginatedTasks.every((t) => selectedTaskIds.has(t.id))
                          ? 'Deselect All on Page'
                          : 'Select All on Page'
                      }
                    >
                      {paginatedTasks.length > 0 && paginatedTasks.every((t) => selectedTaskIds.has(t.id)) ? (
                        <CheckSquare className="w-4 h-4 text-[#e5a84b]" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-500 hover:text-gray-300" />
                      )}
                    </button>
                  </th>
                )}
                <th className="py-3.5 px-4 w-[8%] text-center">
                  <span>Queue #</span>
                </th>
                <th className="py-3.5 px-4 w-[24%]">
                  <span className="flex items-center space-x-1.5">
                    <Users className="w-3.5 h-3.5 text-gray-400" />
                    <span>Contact Profile & Run Tracking</span>
                  </span>
                </th>
                <th className="py-3.5 px-4 w-[16%]">
                  <span className="flex items-center space-x-1.5">
                    <ListOrdered className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Outreach Stage</span>
                  </span>
                </th>
                <th className="py-3.5 px-4 w-[22%]">
                  <span className="flex items-center space-x-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
                    <span>{viewMode === 'DONE' ? 'Sent Message Copy' : 'Queued Message Body'}</span>
                  </span>
                </th>
                <th className="py-3.5 px-4 w-[16%]">
                  {viewMode === 'UPCOMING' ? 'Priority & Status' : viewMode === 'ISSUES' ? 'Reason & Category Tag' : 'Status & Issues'}
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

                  // Run tracking checks
                  const isNextInRun = nextInRunTaskIds.has(t.id);
                  const isDoneInRun = runCompletedTaskIds.has(t.id) || (currentRunId && t.run_id === currentRunId);

                  // Custom Dispatch Order Rank
                  const activeRank = activeTaskPositionMap.get(t.id);
                  const totalActiveCount = activeUpcomingTasks.length;

                  return (
                    <tr
                      key={t.id}
                      className={`transition-colors group ${
                        t.status === 'PAUSED'
                          ? 'opacity-70 bg-gray-950/40 hover:bg-gray-900/50 hover:opacity-100'
                          : 'hover:bg-gray-800/35'
                      }`}
                    >
                      {/* Selection Checkbox for all non-done modes */}
                      {viewMode !== 'DONE' && (
                        <td className="py-4 px-3 align-top text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleSelect(t.id)}
                            className="text-gray-400 hover:text-white transition cursor-pointer pt-0.5"
                            title={selectedTaskIds.has(t.id) ? "Deselect contact" : "Select contact"}
                          >
                            {selectedTaskIds.has(t.id) ? (
                              <CheckSquare className="w-4 h-4 text-[#e5a84b]" />
                            ) : (
                              <Square className="w-4 h-4 text-gray-600 hover:text-gray-400" />
                            )}
                          </button>
                        </td>
                      )}

                      {/* Queue Position & Custom Order Controls */}
                      <td className="py-4 px-3 align-top text-center">
                        {t.status === 'RUNNING' ? (
                          <div className="flex flex-col items-center">
                            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-500/20 text-indigo-300 font-mono text-xs font-black border border-indigo-400 animate-pulse">
                              <Play className="w-3 h-3 fill-indigo-400" />
                            </span>
                            <span className="text-[9px] text-indigo-400 font-bold mt-0.5">Active</span>
                          </div>
                        ) : t.status === 'PAUSED' ? (
                          <div className="flex flex-col items-center py-1">
                            <span className="text-gray-600 font-mono text-xs">—</span>
                            <span className="text-[9px] text-amber-500/70 font-semibold mt-0.5">Excluded</span>
                          </div>
                        ) : (viewMode === 'UPCOMING' || viewMode === 'ALL') && activeRank ? (
                          <div className="inline-flex items-center justify-center space-x-1.5">
                            <div className="flex flex-col items-center">
                              <span
                                className={`inline-flex items-center justify-center px-2 py-0.5 rounded-lg font-mono text-xs font-black border shadow-sm ${
                                  isNextInRun
                                    ? 'bg-amber-500/25 text-amber-300 border-amber-400/60 shadow-amber-500/10'
                                    : 'bg-[#d49237]/20 text-[#e5a84b] border-[#d49237]/50 shadow-[#d49237]/10'
                                }`}
                                title={`Send Order #${activeRank}. This contact is #${activeRank} in line to be messaged.`}
                              >
                                #{activeRank}
                              </span>
                              {isNextInRun && (
                                <span className="text-[9px] text-amber-400/80 font-semibold mt-0.5">Next in Run</span>
                              )}
                            </div>

                            {/* Up & Down arrow buttons for custom order */}
                            <div className="flex flex-col space-y-0.5">
                              <button
                                type="button"
                                onClick={() => handleMoveTask(t.id, 'UP')}
                                disabled={activeRank <= 1 || isBulkSelecting || actionLoadingId === t.id}
                                className="p-0.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white disabled:opacity-20 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed transition"
                                title="Move up in order (message earlier)"
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMoveTask(t.id, 'DOWN')}
                                disabled={activeRank >= totalActiveCount || isBulkSelecting || actionLoadingId === t.id}
                                className="p-0.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white disabled:opacity-20 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed transition"
                                title="Move down in order (message later)"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-500 font-mono text-[11px]">
                            #{overallRank}
                          </span>
                        )}
                      </td>

                      {/* Contact & Task ID */}
                      <td className="py-4 px-4 align-top">
                        <div className="flex items-start space-x-3">
                          {/* Instagram Gradient Avatar Circle (matching Contacts) */}
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

                            <div className="flex items-center space-x-2 mt-1">
                              {t.contact_instagram && (
                                <a
                                  href={t.contact_instagram}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center space-x-1 text-indigo-400 hover:text-indigo-300 font-medium text-[11px] transition group-hover:underline"
                                >
                                  <span>View Profile</span>
                                  <ArrowUpRight className="w-3 h-3 shrink-0" />
                                </a>
                              )}

                              {/* Run Tracking Tag */}
                              {isNextInRun && (
                                <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded font-mono text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-400/40 animate-pulse">
                                  <Zap className="w-2.5 h-2.5" />
                                  <span>Next in Run</span>
                                </span>
                              )}
                              {isDoneInRun && (
                                <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded font-mono text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                                  <CheckCheck className="w-2.5 h-2.5" />
                                  <span>Done in Run</span>
                                </span>
                              )}
                              {t.run_id && !isDoneInRun && (
                                <span className="font-mono text-[9px] text-gray-500">
                                  {t.run_id.replace(/^run_/, 'R#')}
                                </span>
                              )}
                            </div>
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

                      {/* Status & Retries / Error Categorization */}
                      <td className="py-4 px-4 align-top space-y-1.5">
                        {(() => {
                          const err = parseTaskError(t);
                          const hasIssue = Boolean(err && (viewMode === 'ISSUES' || issueStatuses.includes(t.status)));

                          if (hasIssue && err) {
                            return (
                              <div className="space-y-1.5">
                                {/* Primary Real Reason & Category Tag */}
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span
                                    className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border shadow-sm ${err.badgeClass}`}
                                    title={`Real Reason: ${err.description}`}
                                  >
                                    <AlertTriangle className="w-3 h-3 shrink-0" />
                                    <span>{err.label}</span>
                                  </span>
                                  <span
                                    className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-gray-900 border border-gray-800 text-gray-400 font-semibold"
                                    title={`Internal state machine status: ${t.status}`}
                                  >
                                    {t.status.replace('_', ' ')}
                                  </span>
                                </div>

                                <div className="text-[10px] text-gray-400 font-mono pl-1">
                                  Attempt: <span className="text-gray-200 font-semibold">{t.attempt_count ?? t.retry_count ?? 0}</span> / {t.max_retries ?? 3}
                                </div>

                                {/* Plain English Explanation & Tag */}
                                <div className="mt-1 text-[10px] text-gray-300 font-sans leading-relaxed bg-gray-950/90 p-2 rounded-xl border border-gray-800/90 shadow-inner">
                                  <span className="font-bold text-amber-400 font-mono text-[9px] uppercase tracking-wider block mb-0.5">
                                    Category: [{err.tag}]
                                  </span>
                                  {err.description}
                                </div>
                              </div>
                            );
                          }

                          return (
                            <>
                              <span
                                className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${getStatusBadge(
                                  t.status
                                )}`}
                              >
                                {t.status === 'COMPLETED' ? (
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                ) : t.status === 'RUNNING' ? (
                                  <Play className="w-3 h-3 text-indigo-400 fill-indigo-400" />
                                ) : t.status === 'PAUSED' ? (
                                  <Pause className="w-3 h-3 text-amber-400" />
                                ) : (
                                  <Clock className="w-3 h-3 text-sky-400" />
                                )}
                                <span>{t.status === 'PAUSED' ? 'Excluded / Paused' : t.status.replace('_', ' ')}</span>
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
                            </>
                          );
                        })()}
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
                        <div className="flex flex-col items-end space-y-1.5">
                          {/* Inline Follow-up or verification approval controls if in review */}
                          {(t.status === 'MANUAL_REVIEW' || t.status === 'AWAITING_APPROVAL' || t.type?.startsWith('FOLLOW_UP')) && (
                            <div className="flex items-center space-x-1">
                              <button
                                onClick={() => handleConfirmFollowups([t.id])}
                                disabled={actionLoadingId === t.id || isConfirmingFollowups}
                                className="inline-flex items-center space-x-1 px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/40 rounded-lg text-[10px] font-bold transition cursor-pointer"
                                title="Approve and send follow-up"
                              >
                                <ThumbsUp className="w-2.5 h-2.5" />
                                <span>Approve</span>
                              </button>
                              <button
                                onClick={() => handleCancelFollowups([t.id])}
                                disabled={actionLoadingId === t.id || isConfirmingFollowups}
                                className="inline-flex items-center space-x-1 px-1.5 py-1 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-700/40 rounded-lg text-[10px] font-bold transition cursor-pointer"
                                title="Cancel follow-up"
                              >
                                <ThumbsDown className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          )}

                          <div className="flex items-center justify-end space-x-1">
                            {/* Pause / Resume Button */}
                            {['READY', 'QUEUED', 'PAUSED'].includes(t.status) && (
                              <button
                                onClick={() => handleTogglePause(t.id)}
                                disabled={actionLoadingId === t.id}
                                className={`inline-flex items-center space-x-1 px-2 py-1 rounded-lg text-xs font-semibold transition cursor-pointer disabled:opacity-50 border ${
                                  t.status === 'PAUSED'
                                    ? 'bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 border-emerald-500/40'
                                    : 'bg-amber-600/20 hover:bg-amber-600/35 text-amber-300 border-amber-500/40'
                                }`}
                                title={t.status === 'PAUSED' ? 'Resume task (set to READY)' : 'Pause task'}
                              >
                                {t.status === 'PAUSED' ? (
                                  <>
                                    <Play className="w-3 h-3 fill-emerald-400/30" />
                                    <span>Resume</span>
                                  </>
                                ) : (
                                  <>
                                    <Pause className="w-3 h-3" />
                                    <span>Pause</span>
                                  </>
                                )}
                              </button>
                            )}

                            {/* Edit Button */}
                            <button
                              onClick={() => handleOpenEdit(t)}
                              className="inline-flex items-center space-x-1 px-2 py-1 bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-300 border border-indigo-500/40 rounded-lg text-xs font-semibold transition cursor-pointer"
                              title="Edit sequence, messages & schedule"
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>Edit</span>
                            </button>

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
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={viewMode !== 'DONE' ? 8 : 7} className="py-16 text-center text-gray-400">
                    <div className="max-w-sm mx-auto space-y-2">
                      <ListOrdered className="w-8 h-8 text-gray-600 mx-auto" />
                      <div className="font-bold text-white text-sm">
                        {runFilter === 'NEXT_IN_RUN'
                          ? 'No Upcoming Tasks in Current Run'
                          : runFilter === 'DONE_IN_RUN'
                          ? 'No Tasks Completed in Current Run Yet'
                          : viewMode === 'UPCOMING'
                          ? 'No Upcoming Tasks in Queue'
                          : viewMode === 'DONE'
                          ? 'No Completed Tasks Yet'
                          : 'No Tasks Found'}
                      </div>
                      <p className="text-xs text-gray-500">
                        {runFilter === 'NEXT_IN_RUN'
                          ? 'All leads allocated for this run have been executed or queue is empty.'
                          : 'Adjust your run filters, date range, or search above.'}
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

      {/* Edit Single Task & Outreach Sequence Modal */}
      {editingTask && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700/80 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3.5 sticky top-0 bg-gray-900 z-10">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                  <Edit3 className="w-4 h-4 text-indigo-400" />
                  <span>Customize Sequence & Task Schedule</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Target: <span className="text-white font-semibold">{editingTask.contact_name || editingTask.contact?.name || 'Recipient'}</span> (@{editingTask.username || editingTask.contact?.username || editingTask.contact_instagram || 'target'})
                  <span className="ml-2 text-gray-500 font-mono">Task: {editingTask.type} (#{editingTask.id.slice(0, 8)})</span>
                </p>
              </div>
              <button
                onClick={() => setEditingTask(null)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {editSuccessMsg && (
              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-400 text-xs font-bold flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>{editSuccessMsg}</span>
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
              {/* Task Details - Sky Theme */}
              <div className="bg-sky-950/20 border border-sky-500/25 p-3.5 rounded-xl space-y-2">
                <label className="block text-sky-300 font-bold flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <Clock className="w-3.5 h-3.5 text-sky-400" />
                    <span>Task Execution Details</span>
                  </span>
                  <span className="text-gray-500 font-normal">
                    Current Status: <span className="font-semibold text-sky-300">{editingTask.status}</span>
                  </span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">Execution Scheduled At</label>
                    <input
                      type="datetime-local"
                      value={editForm.task_scheduled_at}
                      onChange={(e) => setEditForm({ ...editForm, task_scheduled_at: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-sky-500 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">Priority (1 = standard, higher = prioritized)</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={editForm.task_priority}
                      onChange={(e) => setEditForm({ ...editForm, task_priority: parseInt(e.target.value, 10) || 1 })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-sky-500 text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* 1st Message - Emerald Theme */}
              <div className="bg-emerald-950/15 border border-emerald-500/25 p-3.5 rounded-xl space-y-1.5">
                <label className="block text-emerald-300 font-bold flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <Send className="w-3.5 h-3.5 text-emerald-400" />
                    <span>1. Initial Outreach (1st Message)</span>
                  </span>
                  <span className="text-gray-500 font-normal">Initial batch message</span>
                </label>
                <textarea
                  rows={3}
                  value={editForm.contact_message}
                  onChange={(e) => setEditForm({ ...editForm, contact_message: e.target.value })}
                  placeholder="Enter initial direct message..."
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:outline-none focus:border-emerald-500 resize-none font-sans"
                />
              </div>

              {/* Follow-Up 1 - Indigo Theme */}
              <div className="bg-indigo-950/15 border border-indigo-500/25 p-3.5 rounded-xl space-y-2">
                <label className="block text-indigo-300 font-bold flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-400" />
                    <span>2. Follow-Up 1</span>
                  </span>
                  <span className="text-gray-500 font-normal">Default delay: {editForm.followup_1_delay_days} days</span>
                </label>
                <textarea
                  rows={2}
                  value={editForm.followup_1_message}
                  onChange={(e) => setEditForm({ ...editForm, followup_1_message: e.target.value })}
                  placeholder="Enter Follow-Up 1 message..."
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 resize-none font-sans"
                />
                
                {/* Follow-Up 1 Schedule & Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-indigo-500/20">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">Delay (Days)</label>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={editForm.followup_1_delay_days}
                      onChange={(e) => setEditForm({ ...editForm, followup_1_delay_days: parseInt(e.target.value, 10) || 3 })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">Custom Scheduled Date/Time</label>
                    <input
                      type="datetime-local"
                      value={editForm.followup_1_scheduled_at}
                      onChange={(e) => setEditForm({ ...editForm, followup_1_scheduled_at: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:border-indigo-500 text-[11px]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">Task Status</label>
                    <select
                      value={editForm.followup_1_status}
                      onChange={(e) => setEditForm({ ...editForm, followup_1_status: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="SCHEDULED">Scheduled / Ready</option>
                      <option value="PAUSED">Paused</option>
                      <option value="CANCELLED">Cancelled</option>
                      <option value="COMPLETED">Completed</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Follow-Up 2 - Purple Theme */}
              <div className="bg-purple-950/15 border border-purple-500/25 p-3.5 rounded-xl space-y-2">
                <label className="block text-purple-300 font-bold flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <Calendar className="w-3.5 h-3.5 text-purple-400" />
                    <span>3. Follow-Up 2</span>
                  </span>
                  <span className="text-gray-500 font-normal">Default delay: {editForm.followup_2_delay_days} days</span>
                </label>
                <textarea
                  rows={2}
                  value={editForm.followup_2_message}
                  onChange={(e) => setEditForm({ ...editForm, followup_2_message: e.target.value })}
                  placeholder="Enter Follow-Up 2 message..."
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:outline-none focus:border-purple-500 resize-none font-sans"
                />

                {/* Follow-Up 2 Schedule & Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-purple-500/20">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">Delay (Days)</label>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={editForm.followup_2_delay_days}
                      onChange={(e) => setEditForm({ ...editForm, followup_2_delay_days: parseInt(e.target.value, 10) || 5 })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">Custom Scheduled Date/Time</label>
                    <input
                      type="datetime-local"
                      value={editForm.followup_2_scheduled_at}
                      onChange={(e) => setEditForm({ ...editForm, followup_2_scheduled_at: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:border-purple-500 text-[11px]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-400 mb-1">Task Status</label>
                    <select
                      value={editForm.followup_2_status}
                      onChange={(e) => setEditForm({ ...editForm, followup_2_status: e.target.value })}
                      className="w-full bg-gray-950 border border-gray-800 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:border-purple-500"
                    >
                      <option value="SCHEDULED">Scheduled / Ready</option>
                      <option value="PAUSED">Paused</option>
                      <option value="CANCELLED">Cancelled</option>
                      <option value="COMPLETED">Completed</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-gray-800">
                <button
                  type="button"
                  onClick={() => setEditingTask(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-white hover:bg-gray-800 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl text-xs font-bold transition shadow-lg shadow-indigo-600/30 cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingEdit ? 'Saving...' : 'Save Sequence & Schedule'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
