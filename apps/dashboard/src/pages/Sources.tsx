import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  UploadCloud,
  Link2,
  CheckCircle2,
  FileSpreadsheet,
  AlertCircle,
  ArrowRight,
  Download,
  RefreshCw,
  Trash2,
  Database,
  Layers,
  Copy,
  Check,
  Search,
  UserCheck,
  AlertTriangle,
  ShieldCheck,
  Table as TableIcon,
  XCircle,
  Clock,
  ListOrdered,
  Calendar,
  Play,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  Users,
  MessageSquare,
  Send,
  Sparkles,
  X,
  CheckCheck,
  ShieldAlert,
  Zap,
  Filter,
  ArrowUpDown,
  ThumbsUp,
  ThumbsDown,
  CheckSquare,
  Square,
  Edit3,
  Pause,
  Save,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  Settings2
} from 'lucide-react';
import { Source, Task, TaskStatus, Contact, LiveAutomationState } from '../types';
import {
  analyzeSourceXlsx,
  analyzeSourceUrl,
  confirmSourceImport,
  fetchTablesData,
  retryTask,
  cancelTask,
  deleteTask,
  updateTask,
  toggleTaskPause,
  bulkSetTaskSelection,
  reorderTasks,
  updateContactMessages,
  updateFollowupSchedule,
  deleteContact,
  bulkDeleteTasks,
  bulkUpdateTasks,
  bulkDeleteContacts,
  bulkUpdateContacts,
  clearOutreachHistory,
  clearSourcesOnly,
  clearAllSourcesAndHistory,
  clearAuditEvents
} from '../services/api';
import { DateFilterMode, matchesDateFilter, formatDisplayDate, toDatetimeLocalValue } from '../utils/date';
import { getStatusBadgeClass } from '../components/common/StatusBadge';

interface SourcesProps {
  sources: Source[];
  tasks?: Task[];
  contacts?: Contact[];
  automationState?: LiveAutomationState | null;
  onImportSuccess: () => void;
  onNavigate: (tab: string) => void;
  onRefresh?: () => void;
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
  const isAttentionStatus = ['ACTION_NEEDED', 'MANUAL_REVIEW', 'RETRY_WAIT', 'AWAITING_APPROVAL', 'RECONCILING', 'FAILED', 'INTERRUPTED', 'SKIPPED'].includes(statusStr);
  const hasRepliedStatus = task.contact?.replied_status === 'DM_RESTRICTED' || task.contact?.replied_status === 'YES' || task.contact?.replied_status === 'AUTOMATED_MESSAGE';

  if (!rawCat && !rawMsg && !isAttentionStatus && !hasRepliedStatus) {
    return null;
  }

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
    matchedTag.includes('ACCOUNT_NOT_FOUND') ||
    lowerMsg.includes('page not found') ||
    lowerMsg.includes('profile not found') ||
    lowerMsg.includes('account not found') ||
    lowerMsg.includes("sorry, this page isn't available") ||
    lowerMsg.includes("sorry, this page isn’t available") ||
    lowerMsg.includes("page isn't available") ||
    lowerMsg.includes("page isn’t available") ||
    lowerMsg.includes("page is not available") ||
    lowerMsg.includes("link you followed may be broken") ||
    lowerMsg.includes("page may have been removed") ||
    lowerMsg.includes('404')
  ) {
    return {
      tag: 'PAGE_NOT_FOUND',
      label: 'Account Not Found (404)',
      badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40 font-bold',
      description: cleanMsg || "Sorry, this page isn't available. The link you followed may be broken, or the page may have been removed."
    };
  }

  // 3. DM Restricted / Closed
  if (
    matchedTag.includes('DM_RESTRICTED') ||
    matchedTag.includes('DM_NOT_AVAILABLE') ||
    cleanMsg.toLowerCase().includes('does not accept') ||
    cleanMsg.toLowerCase().includes('message button not available') ||
    cleanMsg.toLowerCase().includes('message button not found') ||
    cleanMsg.toLowerCase().includes('cannot receive') ||
    cleanMsg.toLowerCase().includes('no message button') ||
    cleanMsg.toLowerCase().includes('restricted') ||
    task.contact?.replied_status === 'DM_RESTRICTED'
  ) {
    return {
      tag: 'DM_RESTRICTED',
      label: 'DMs Closed / Restricted',
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
    cleanMsg.toLowerCase().includes('prior conversation') ||
    cleanMsg.toLowerCase().includes('already messaged')
  ) {
    return {
      tag: 'EXISTING_HISTORY',
      label: 'Prior Chat History with Lead',
      badgeClass: 'bg-sky-500/20 text-sky-300 border-sky-500/40 font-bold',
      description: cleanMsg || 'Prior conversation history detected in this Instagram thread before automation ran.'
    };
  }

  // 7. Rate limit
  if (
    matchedTag.includes('RATE_LIMITED') ||
    matchedTag.includes('ACTION_BLOCKED') ||
    cleanMsg.toLowerCase().includes('rate limit') ||
    cleanMsg.toLowerCase().includes('action blocked') ||
    cleanMsg.toLowerCase().includes('pacing delay')
  ) {
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

  // 9. Chatbox unavailable
  if (
    matchedTag.includes('CHATBOX_UNAVAILABLE') ||
    matchedTag.includes('COMPOSER_UNAVAILABLE') ||
    cleanMsg.toLowerCase().includes('chatbox') ||
    cleanMsg.toLowerCase().includes('composer') ||
    cleanMsg.toLowerCase().includes('typing')
  ) {
    return {
      tag: 'CHATBOX_UNAVAILABLE',
      label: 'Chatbox Unavailable',
      badgeClass: 'bg-red-500/20 text-red-300 border-red-500/40 font-bold',
      description: cleanMsg || 'Instagram message input field/chatbox could not be focused or typed into.'
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
  if (
    matchedTag.includes('AUTH') ||
    matchedTag.includes('LOGIN_REQUIRED') ||
    cleanMsg.toLowerCase().includes('login') ||
    cleanMsg.toLowerCase().includes('not logged in')
  ) {
    return {
      tag: 'AUTHENTICATION_REQUIRED',
      label: 'Instagram Login Required',
      badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40 font-bold',
      description: cleanMsg || 'Instagram session expired or account is not logged in on active Chrome profile.'
    };
  }

  // 12. Initial message pending
  if (
    matchedTag.includes('INITIAL_MESSAGE_PENDING') ||
    cleanMsg.toLowerCase().includes('initial outreach message was not completed') ||
    cleanMsg.toLowerCase().includes('follow-up 1 was not completed') ||
    cleanMsg.toLowerCase().includes('follow-up 1 was cancelled') ||
    cleanMsg.toLowerCase().includes('out of order')
  ) {
    return {
      tag: 'INITIAL_MESSAGE_PENDING',
      label: 'Initial Outreach Pending',
      badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold',
      description: cleanMsg || 'Primary outreach message was not completed. Follow-up cannot proceed without initial send.'
    };
  }

  // 13. Stale follow-up
  if (matchedTag.includes('STALE_FOLLOWUP') || cleanMsg.toLowerCase().includes('stale') || cleanMsg.toLowerCase().includes('30 days overdue')) {
    return {
      tag: 'STALE_FOLLOWUP',
      label: 'Stale Follow-Up (>30d)',
      badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold',
      description: cleanMsg || 'Follow-up is >30 days overdue. Operator review recommended before dispatch.'
    };
  }

  // 14. Fallback based on specific attention task status
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
      description: cleanMsg || 'Task requires attention.'
    };
  }

  return null;
}


interface StagedAnalysis {
  staging_id: string;
  source_name: string;
  source_type: string;
  total_fetched: number;
  unique_count: number;
  duplicate_count: number;
  invalid_count: number;
  unique_records: any[];
  duplicate_records: any[];
  invalid_records: any[];
  sheets_processed: string[];
  sheets_skipped: string[];
}

export const Sources: React.FC<SourcesProps> = ({
  sources,
  tasks = [],
  contacts = [],
  automationState,
  onImportSuccess,
  onNavigate,
  onRefresh
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'url'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Staged Redundancy Review State
  const [stagedData, setStagedData] = useState<StagedAnalysis | null>(null);
  const [reviewTab, setReviewTab] = useState<'unique' | 'duplicates' | 'invalid'>('unique');
  const [selectedUniqueIndices, setSelectedUniqueIndices] = useState<Set<number>>(new Set());
  const [selectedDuplicateIndices, setSelectedDuplicateIndices] = useState<Set<number>>(new Set());
  const [duplicateMode, setDuplicateMode] = useState<'SKIP' | 'ADD_SEPARATELY' | 'MERGE_UPDATE'>('SKIP');
  const [importResult, setImportResult] = useState<any | null>(null);

  // In-App Database Tables Browser State
  const [tablesData, setTablesData] = useState<any | null>(null);
  const [activeTableKey, setActiveTableKey] = useState<string>('tasks');
  const [tableSearch, setTableSearch] = useState('');
  const [loadingTables, setLoadingTables] = useState(false);

  // ── Enhanced Tasks Filtering & View State ───────────────────
  const [queueViewMode, setQueueViewMode] = useState<QueueViewMode>('UPCOMING');
  const [taskRunFilter, setTaskRunFilter] = useState<RunFilterMode>('ALL');
  const [taskDateFilter, setTaskDateFilter] = useState<DateFilterMode>('ALL');
  const [taskTimeSort, setTaskTimeSort] = useState<TimeSortMode>('DEFAULT');
  const [taskFilterStatus, setTaskFilterStatus] = useState<string>('ALL');
  const [taskFilterStage, setTaskFilterStage] = useState<string>('ALL');
  const [taskIssueCategoryFilter, setTaskIssueCategoryFilter] = useState<string>('ALL');
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [taskPageSize, setTaskPageSize] = useState<number>(25);
  const [taskCurrentPage, setTaskCurrentPage] = useState<number>(1);

  // ── Enhanced Contacts Filtering & View State ────────────────
  const [contactRepliedFilter, setContactRepliedFilter] = useState<string>('all');
  const [contactDateFilter, setContactDateFilter] = useState<DateFilterMode>('ALL');
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [contactPageSize, setContactPageSize] = useState<number>(25);
  const [contactCurrentPage, setContactCurrentPage] = useState<number>(1);

  // ── Actions & Operational State ─────────────────────────────
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [isBulkOperating, setIsBulkOperating] = useState(false);

  // Single Edit Task Modal State
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskEditForm, setTaskEditForm] = useState({
    scheduled_at: '',
    priority: 1,
    message: '',
    followup_1_message: '',
    followup_1_delay_days: 3,
    followup_1_scheduled_at: '',
    followup_1_status: 'SCHEDULED',
    followup_2_message: '',
    followup_2_delay_days: 5,
    followup_2_scheduled_at: '',
    followup_2_status: 'SCHEDULED',
  });
  const [isSavingTaskEdit, setIsSavingTaskEdit] = useState(false);

  // Single Edit Contact Modal State
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [contactEditForm, setContactEditForm] = useState({
    message: '',
    followup_1_message: '',
    followup_1_delay_days: 3,
    followup_2_message: '',
    followup_2_delay_days: 5,
    replied_status: 'UNKNOWN',
  });
  const [isSavingContactEdit, setIsSavingContactEdit] = useState(false);

  // Mass Edit Modal State
  const [isMassEditModalOpen, setIsMassEditModalOpen] = useState(false);
  const [massEditScope, setMassEditScope] = useState<'SELECTED' | 'ALL_FILTERED'>('SELECTED');
  const [massEditFields, setMassEditFields] = useState({
    applyStatus: false,
    status: 'READY',
    applyPriority: false,
    priority: 1,
    applySchedule: false,
    scheduled_at: '',
    applyMessage: false,
    message: '',
    applyFollowup1: false,
    followup_1_message: '',
    followup_1_delay_days: 3,
    applyFollowup2: false,
    followup_2_message: '',
    followup_2_delay_days: 5,
    applyRepliedStatus: false,
    replied_status: 'UNKNOWN'
  });
  const [isApplyingMassEdit, setIsApplyingMassEdit] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load database tables on initial mount
  useEffect(() => {
    loadDatabaseTables();
  }, []);

  const loadDatabaseTables = async () => {
    setLoadingTables(true);
    try {
      const data = await fetchTablesData();
      setTablesData(data);
    } catch (err: any) {
      console.error('Failed to load database tables:', err);
    } finally {
      setLoadingTables(false);
    }
  };

  const [isClearingTable, setIsClearingTable] = useState(false);

  const handleClearActiveTable = async () => {
    if (activeTableKey === 'history') {
      if (!window.confirm('Are you sure you want to permanently clear all Outreach History records? This will remove all archived rows.')) return;
      try {
        setIsClearingTable(true);
        const res = await clearOutreachHistory();
        alert(`Cleared ${res.deleted_count} outreach history record(s).`);
        await loadDatabaseTables();
        await onRefresh?.();
      } catch (e: any) {
        alert(`Failed to clear outreach history: ${e.message}`);
      } finally {
        setIsClearingTable(false);
      }
    } else if (activeTableKey === 'sources') {
      if (!window.confirm('Are you sure you want to permanently clear all Ingested Sources?')) return;
      try {
        setIsClearingTable(true);
        await clearSourcesOnly();
        alert('Cleared all ingested source records.');
        await loadDatabaseTables();
        await onRefresh?.();
      } catch (e: any) {
        alert(`Failed to clear sources: ${e.message}`);
      } finally {
        setIsClearingTable(false);
      }
    } else if (activeTableKey === 'events') {
      if (!window.confirm('Are you sure you want to permanently clear all Audit Event Logs?')) return;
      try {
        setIsClearingTable(true);
        const res = await clearAuditEvents();
        alert(`Cleared ${res.deleted_count} audit event log(s).`);
        await loadDatabaseTables();
        await onRefresh?.();
      } catch (e: any) {
        alert(`Failed to clear audit events: ${e.message}`);
      } finally {
        setIsClearingTable(false);
      }
    }
  };

  const [isDeleteEntireHistoryModalOpen, setIsDeleteEntireHistoryModalOpen] = useState(false);
  const [deleteScope, setDeleteScope] = useState<'ALL_HISTORY' | 'OUTREACH_ONLY'>('ALL_HISTORY');
  const [isDeletingEntireHistory, setIsDeletingEntireHistory] = useState(false);

  const handleConfirmDeleteEntireHistory = async () => {
    setIsDeletingEntireHistory(true);
    try {
      if (deleteScope === 'ALL_HISTORY') {
        const res = await clearAllSourcesAndHistory();
        alert(`Successfully deleted entire history from database:\n• Outreach History: ${res.history_cleared} records\n• Ingested Sources: ${res.sources_cleared} files (${res.records_cleared} rows)\n• Audit Event Logs: ${res.events_cleared} logs`);
      } else {
        const res = await clearOutreachHistory();
        alert(`Successfully cleared ${res.deleted_count} Outreach History record(s) from database.`);
      }
      setIsDeleteEntireHistoryModalOpen(false);
      await loadDatabaseTables();
      await onRefresh?.();
    } catch (e: any) {
      alert(`Failed to delete history: ${e.message}`);
    } finally {
      setIsDeletingEntireHistory(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
      setStagedData(null);
      setImportResult(null);
    }
  };

  const handleAnalyzeXlsx = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setImportResult(null);
    try {
      const res: StagedAnalysis = await analyzeSourceXlsx(file);
      setStagedData(res);
      // Default: select all unique records
      setSelectedUniqueIndices(new Set(res.unique_records.map((r) => r.index)));
      setSelectedDuplicateIndices(new Set());
      setReviewTab(res.unique_records.length > 0 ? 'unique' : 'duplicates');
    } catch (e: any) {
      setError(e.message || 'Failed to analyze spreadsheet');
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzeUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    setLoading(true);
    setError(null);
    setImportResult(null);
    try {
      const res: StagedAnalysis = await analyzeSourceUrl(url, sheetName || 'Web Spreadsheet');
      setStagedData(res);
      setSelectedUniqueIndices(new Set(res.unique_records.map((r) => r.index)));
      setSelectedDuplicateIndices(new Set());
      setReviewTab(res.unique_records.length > 0 ? 'unique' : 'duplicates');
    } catch (e: any) {
      setError(e.message || 'Failed to analyze spreadsheet URL');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!stagedData) return;
    setLoading(true);
    setError(null);
    try {
      const res = await confirmSourceImport({
        staging_id: stagedData.staging_id,
        source_name: stagedData.source_name,
        selected_unique_indices: Array.from(selectedUniqueIndices),
        selected_duplicate_indices: Array.from(selectedDuplicateIndices),
        duplicate_mode: duplicateMode
      });
      setImportResult(res);
      setStagedData(null);
      setFile(null);
      setUrl('');
      onImportSuccess();
      loadDatabaseTables();
    } catch (e: any) {
      setError(e.message || 'Failed to complete import');
    } finally {
      setLoading(false);
    }
  };

  const toggleUniqueIndex = (index: number) => {
    const next = new Set(selectedUniqueIndices);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setSelectedUniqueIndices(next);
  };

  const removeUniqueRecord = (index: number) => {
    const next = new Set(selectedUniqueIndices);
    next.delete(index);
    setSelectedUniqueIndices(next);
  };

  const toggleDuplicateIndex = (index: number) => {
    const next = new Set(selectedDuplicateIndices);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setSelectedDuplicateIndices(next);
  };

  const selectAllUnique = () => {
    if (!stagedData) return;
    setSelectedUniqueIndices(new Set(stagedData.unique_records.map((r) => r.index)));
  };

  const deselectAllUnique = () => {
    setSelectedUniqueIndices(new Set());
  };

  const selectAllDuplicates = () => {
    if (!stagedData) return;
    setSelectedDuplicateIndices(new Set(stagedData.duplicate_records.map((r) => r.index)));
  };

  const deselectAllDuplicates = () => {
    setSelectedDuplicateIndices(new Set());
  };

  // ── Run Tracking Logic for Tasks in Explorer ────────────────
  const currentRunId = automationState?.current_run_id;
  const batchLimit = automationState?.batch_limit;
  const batchSentCount = automationState?.batch_sent_count ?? 0;
  const isWorkerRunning = automationState?.status === 'RUNNING';

  const runCompletedTaskIds = useMemo(() => {
    return new Set(automationState?.run_completed_task_ids || []);
  }, [automationState]);

  const activeBatchQuota = batchLimit ? batchLimit : 10;
  const remainingInRunQuota = isWorkerRunning 
    ? Math.max(0, activeBatchQuota - batchSentCount) 
    : activeBatchQuota;

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

  const nextInRunTaskIds = useMemo(() => {
    return new Set(upcomingSortedTasks.slice(0, remainingInRunQuota).map((t) => t.id));
  }, [upcomingSortedTasks, remainingInRunQuota]);

  const activeUpcomingTasks = useMemo(() => {
    return upcomingSortedTasks.filter((t) => t.status !== 'PAUSED');
  }, [upcomingSortedTasks]);

  const activeTaskPositionMap = useMemo(() => {
    const map = new Map<string, number>();
    activeUpcomingTasks.forEach((t, i) => {
      map.set(t.id, i + 1);
    });
    return map;
  }, [activeUpcomingTasks]);

  const issueStatuses = ['RETRY_WAIT', 'MANUAL_REVIEW', 'AWAITING_APPROVAL', 'RECONCILING', 'FAILED', 'INTERRUPTED', 'SKIPPED'];
  const upcomingStatuses = ['READY', 'QUEUED', 'RUNNING', 'PAUSED'];

  // ── Filtered & Sorted Tasks ─────────────────────────────────
  const filteredAndSortedTasks = useMemo(() => {
    let result = tasks.filter((t) => {
      // 1. Search filter
      const term = tableSearch.toLowerCase();
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
      if (taskFilterStage === 'MESSAGE' && t.type !== 'MESSAGE') return false;
      if (taskFilterStage === 'FOLLOW_UP_1' && t.type !== 'FOLLOW_UP_1') return false;
      if (taskFilterStage === 'FOLLOW_UP_2' && t.type !== 'FOLLOW_UP_2') return false;

      // 3. Run Filter
      if (taskRunFilter === 'NEXT_IN_RUN') {
        if (!nextInRunTaskIds.has(t.id)) return false;
      } else if (taskRunFilter === 'DONE_IN_RUN') {
        const isDoneInRun = runCompletedTaskIds.has(t.id) || (currentRunId && t.run_id === currentRunId);
        if (!isDoneInRun) return false;
      }

      // 4. Date filter
      if (taskDateFilter !== 'ALL') {
        const relevantDate = t.status === 'COMPLETED' ? (t.completed_at || t.updated_at) : (t.scheduled_at || t.created_at);
        if (!matchesDateFilter(relevantDate, taskDateFilter)) return false;
      }

      // 5. View Mode filter
      if (queueViewMode === 'UPCOMING') {
        return upcomingStatuses.includes(t.status);
      } else if (queueViewMode === 'DONE') {
        return t.status === 'COMPLETED';
      } else if (queueViewMode === 'ISSUES') {
        if (!issueStatuses.includes(t.status)) return false;
        if (taskIssueCategoryFilter !== 'ALL') {
          const err = parseTaskError(t);
          if (!err || err.tag !== taskIssueCategoryFilter) return false;
        }
        return true;
      } else {
        if (taskFilterStatus === 'ISSUES') {
          return issueStatuses.includes(t.status);
        } else if (taskFilterStatus !== 'ALL') {
          return t.status === taskFilterStatus;
        }
        return true;
      }
    });

    // 6. Sorting
    result = [...result].sort((a, b) => {
      if (taskTimeSort === 'SCHEDULED_ASC') {
        const timeA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
        const timeB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
        return timeA - timeB;
      } else if (taskTimeSort === 'SCHEDULED_DESC') {
        const timeA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
        const timeB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
        return timeB - timeA;
      } else if (taskTimeSort === 'COMPLETED_DESC') {
        const timeA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const timeB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        return timeB - timeA;
      } else if (taskTimeSort === 'COMPLETED_ASC') {
        const timeA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const timeB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        return timeA - timeB;
      }

      if (queueViewMode === 'UPCOMING') {
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
      } else if (queueViewMode === 'DONE') {
        const compA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const compB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        return compB - compA;
      } else if (queueViewMode === 'ISSUES') {
        const upA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const upB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return upB - upA;
      }
      return 0;
    });

    return result;
  }, [tasks, tableSearch, queueViewMode, taskFilterStage, taskFilterStatus, taskRunFilter, taskDateFilter, taskTimeSort, taskIssueCategoryFilter, nextInRunTaskIds, runCompletedTaskIds, currentRunId]);

  // Tasks Pagination
  const totalFilteredTasks = filteredAndSortedTasks.length;
  const totalTaskPages = Math.ceil(totalFilteredTasks / taskPageSize) || 1;
  const paginatedTasks = useMemo(() => {
    const start = (taskCurrentPage - 1) * taskPageSize;
    return filteredAndSortedTasks.slice(start, start + taskPageSize);
  }, [filteredAndSortedTasks, taskCurrentPage, taskPageSize]);

  // ── Filtered Contacts ───────────────────────────────────────
  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      const term = tableSearch.toLowerCase();
      if (term) {
        const matchesSearch =
          (c.name || '').toLowerCase().includes(term) ||
          (c.username || '').toLowerCase().includes(term) ||
          (c.instagram_url || '').toLowerCase().includes(term) ||
          (c.message || '').toLowerCase().includes(term) ||
          (c.notes || '').toLowerCase().includes(term);
        if (!matchesSearch) return false;
      }

      if (contactRepliedFilter === 'replied' && c.replied_status !== 'YES') return false;
      if (contactRepliedFilter === 'automated' && c.replied_status !== 'AUTOMATED_MESSAGE') return false;
      if (contactRepliedFilter === 'unreplied' && (c.replied_status === 'YES' || c.replied_status === 'AUTOMATED_MESSAGE')) return false;

      if (contactDateFilter !== 'ALL') {
        if (!matchesDateFilter(c.created_at, contactDateFilter)) return false;
      }

      return true;
    });
  }, [contacts, tableSearch, contactRepliedFilter, contactDateFilter]);

  // Contacts Pagination
  const totalFilteredContacts = filteredContacts.length;
  const totalContactPages = Math.ceil(totalFilteredContacts / contactPageSize) || 1;
  const paginatedContacts = useMemo(() => {
    const start = (contactCurrentPage - 1) * contactPageSize;
    return filteredContacts.slice(start, start + contactPageSize);
  }, [filteredContacts, contactCurrentPage, contactPageSize]);

  // ── Filter rows for generic tables (Sources, History, Events) ─
  const currentTable = tablesData?.tables?.[activeTableKey];
  const filteredTableRows = (currentTable?.rows || []).filter((row: any) => {
    if (!tableSearch) return true;
    const query = tableSearch.toLowerCase();
    return Object.values(row).some((val) => String(val).toLowerCase().includes(query));
  });

  // ── Task Handlers ───────────────────────────────────────────
  const handleToggleSelectTask = (taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const handleSelectAllTasksOnPage = (idsOnPage: string[]) => {
    if (idsOnPage.length === 0) return;
    const allSelected = idsOnPage.every((id) => selectedTaskIds.has(id));
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (allSelected) idsOnPage.forEach((id) => next.delete(id));
      else idsOnPage.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleSelectAllFilteredTasks = () => {
    setSelectedTaskIds(new Set(filteredAndSortedTasks.map((t) => t.id)));
  };

  const handleDeselectAllTasks = () => {
    setSelectedTaskIds(new Set());
  };

  const handleQuickPickTasks = (count: number, pageIds: string[]) => {
    setSelectedTaskIds(new Set(pageIds.slice(0, count)));
  };

  const handleRetryTask = async (taskId: string) => {
    try {
      setActionLoadingId(taskId);
      await retryTask(taskId);
      await onRefresh?.();
      await loadDatabaseTables();
    } catch (e: any) {
      alert(`Failed to retry task: ${e.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancelTask = async (taskId: string) => {
    try {
      setActionLoadingId(taskId);
      await cancelTask(taskId);
      await onRefresh?.();
      await loadDatabaseTables();
    } catch (e: any) {
      alert(`Failed to cancel task: ${e.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeleteSingleTask = async (taskId: string) => {
    if (!window.confirm('Are you sure you want to permanently delete this task?')) return;
    try {
      setActionLoadingId(taskId);
      await deleteTask(taskId);
      await onRefresh?.();
      await loadDatabaseTables();
    } catch (e: any) {
      alert(`Failed to delete task: ${e.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleTogglePauseTask = async (taskId: string) => {
    try {
      setActionLoadingId(taskId);
      await toggleTaskPause(taskId);
      await onRefresh?.();
      await loadDatabaseTables();
    } catch (e: any) {
      alert(`Failed to toggle pause: ${e.message}`);
    } finally {
      setActionLoadingId(null);
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
      await onRefresh?.();
      await loadDatabaseTables();
    } catch (e: any) {
      alert(`Could not reorder tasks: ${e.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleOpenEditTask = (t: Task) => {
    setEditingTask(t);
    const c = t.contact;
    setTaskEditForm({
      scheduled_at: toDatetimeLocalValue(t.scheduled_at_raw || t.scheduled_at),
      priority: t.priority ?? 1,
      message: c?.message || c?.custom_message || t.message || '',
      followup_1_message: c?.followup_1_message || 'Hey! Just following up on my previous message.',
      followup_1_delay_days: c?.followup_1_delay_days ?? 3,
      followup_1_scheduled_at: toDatetimeLocalValue(c?.followup_1_scheduled_at_raw || c?.followup_1_scheduled_at),
      followup_1_status: c?.followup_1_status || 'SCHEDULED',
      followup_2_message: c?.followup_2_message || 'Hey! One last quick check-in before I close this thread.',
      followup_2_delay_days: c?.followup_2_delay_days ?? 5,
      followup_2_scheduled_at: toDatetimeLocalValue(c?.followup_2_scheduled_at_raw || c?.followup_2_scheduled_at),
      followup_2_status: c?.followup_2_status || 'SCHEDULED',
    });
  };

  const handleSaveTaskEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask) return;
    setIsSavingTaskEdit(true);
    try {
      const activeMsg = editingTask.type === 'FOLLOW_UP_1' 
        ? taskEditForm.followup_1_message 
        : editingTask.type === 'FOLLOW_UP_2' 
        ? taskEditForm.followup_2_message 
        : taskEditForm.message;

      await updateTask(editingTask.id, {
        scheduled_at: taskEditForm.scheduled_at ? new Date(taskEditForm.scheduled_at).toISOString() : null,
        priority: Number(taskEditForm.priority) || 1,
        message: activeMsg,
      });

      if (editingTask.contact_id) {
        await updateContactMessages(editingTask.contact_id, {
          message: taskEditForm.message,
          followup_1_message: taskEditForm.followup_1_message,
          followup_2_message: taskEditForm.followup_2_message,
        });

        await updateFollowupSchedule(editingTask.contact_id, {
          followup_1_scheduled_at: taskEditForm.followup_1_scheduled_at ? new Date(taskEditForm.followup_1_scheduled_at).toISOString() : null,
          followup_1_status: taskEditForm.followup_1_status,
          followup_1_delay_days: Number(taskEditForm.followup_1_delay_days) || 3,
          followup_2_scheduled_at: taskEditForm.followup_2_scheduled_at ? new Date(taskEditForm.followup_2_scheduled_at).toISOString() : null,
          followup_2_status: taskEditForm.followup_2_status,
          followup_2_delay_days: Number(taskEditForm.followup_2_delay_days) || 5,
        });
      }

      setEditingTask(null);
      await onRefresh?.();
      await loadDatabaseTables();
    } catch (err: any) {
      alert(`Error updating task: ${err.message}`);
    } finally {
      setIsSavingTaskEdit(false);
    }
  };

  // ── Contact Handlers ────────────────────────────────────────
  const handleToggleSelectContact = (contactId: string) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  };

  const handleSelectAllContactsOnPage = (idsOnPage: string[]) => {
    if (idsOnPage.length === 0) return;
    const allSelected = idsOnPage.every((id) => selectedContactIds.has(id));
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (allSelected) idsOnPage.forEach((id) => next.delete(id));
      else idsOnPage.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleSelectAllFilteredContacts = () => {
    setSelectedContactIds(new Set(filteredContacts.map((c) => c.id)));
  };

  const handleDeselectAllContacts = () => {
    setSelectedContactIds(new Set());
  };

  const handleQuickPickContacts = (count: number, pageIds: string[]) => {
    setSelectedContactIds(new Set(pageIds.slice(0, count)));
  };

  const handleDeleteSingleContact = async (contactId: string) => {
    if (!window.confirm('Are you sure you want to permanently delete this contact and all its tasks?')) return;
    try {
      setActionLoadingId(contactId);
      await deleteContact(contactId);
      await onRefresh?.();
      await loadDatabaseTables();
    } catch (e: any) {
      alert(`Failed to delete contact: ${e.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleOpenEditContact = (c: Contact) => {
    setEditingContact(c);
    setContactEditForm({
      message: c.message || c.custom_message || '',
      followup_1_message: c.followup_1_message || 'Hey! Just following up on my previous message.',
      followup_1_delay_days: c.followup_1_delay_days ?? 3,
      followup_2_message: c.followup_2_message || 'Hey! One final check-in.',
      followup_2_delay_days: c.followup_2_delay_days ?? 5,
      replied_status: c.replied_status || 'UNKNOWN',
    });
  };

  const handleSaveContactEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContact) return;
    setIsSavingContactEdit(true);
    try {
      await updateContactMessages(editingContact.id, {
        message: contactEditForm.message,
        followup_1_message: contactEditForm.followup_1_message,
        followup_2_message: contactEditForm.followup_2_message,
      });
      await updateFollowupSchedule(editingContact.id, {
        followup_1_delay_days: Number(contactEditForm.followup_1_delay_days) || 3,
        followup_2_delay_days: Number(contactEditForm.followup_2_delay_days) || 5,
      });
      setEditingContact(null);
      await onRefresh?.();
      await loadDatabaseTables();
    } catch (err: any) {
      alert(`Error updating contact: ${err.message}`);
    } finally {
      setIsSavingContactEdit(false);
    }
  };

  // ── Mass Actions ────────────────────────────────────────────
  const handleOpenMassEditModal = (scope: 'SELECTED' | 'ALL_FILTERED') => {
    setMassEditScope(scope);
    setIsMassEditModalOpen(true);
  };

  const handleExecuteMassEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (activeTableKey === 'tasks') {
      const targetIds = massEditScope === 'ALL_FILTERED'
        ? filteredAndSortedTasks.map((t) => t.id)
        : Array.from(selectedTaskIds);
      if (targetIds.length === 0) return;

      const updates: any = {};
      if (massEditFields.applyStatus) updates.status = massEditFields.status;
      if (massEditFields.applyPriority) updates.priority = Number(massEditFields.priority);
      if (massEditFields.applySchedule) updates.scheduled_at = massEditFields.scheduled_at ? new Date(massEditFields.scheduled_at).toISOString() : null;
      if (massEditFields.applyMessage) updates.message = massEditFields.message;
      if (massEditFields.applyFollowup1) {
        updates.followup_1_message = massEditFields.followup_1_message;
        updates.followup_1_delay_days = Number(massEditFields.followup_1_delay_days);
      }
      if (massEditFields.applyFollowup2) {
        updates.followup_2_message = massEditFields.followup_2_message;
        updates.followup_2_delay_days = Number(massEditFields.followup_2_delay_days);
      }

      try {
        setIsApplyingMassEdit(true);
        const res = await bulkUpdateTasks(targetIds, updates);
        alert(`Successfully updated ${res.updated_count} task(s).`);
        setIsMassEditModalOpen(false);
        setSelectedTaskIds(new Set());
        await onRefresh?.();
        await loadDatabaseTables();
      } catch (err: any) {
        alert(`Failed to mass update tasks: ${err.message}`);
      } finally {
        setIsApplyingMassEdit(false);
      }
    } else if (activeTableKey === 'contacts') {
      const targetIds = massEditScope === 'ALL_FILTERED'
        ? filteredContacts.map((c) => c.id)
        : Array.from(selectedContactIds);
      if (targetIds.length === 0) return;

      const updates: any = {};
      if (massEditFields.applyMessage) updates.message = massEditFields.message;
      if (massEditFields.applyFollowup1) {
        updates.followup_1_message = massEditFields.followup_1_message;
        updates.followup_1_delay_days = Number(massEditFields.followup_1_delay_days);
      }
      if (massEditFields.applyFollowup2) {
        updates.followup_2_message = massEditFields.followup_2_message;
        updates.followup_2_delay_days = Number(massEditFields.followup_2_delay_days);
      }
      if (massEditFields.applyRepliedStatus) updates.replied_status = massEditFields.replied_status;

      try {
        setIsApplyingMassEdit(true);
        const res = await bulkUpdateContacts(targetIds, updates);
        alert(`Successfully updated ${res.updated_count} contact(s).`);
        setIsMassEditModalOpen(false);
        setSelectedContactIds(new Set());
        await onRefresh?.();
        await loadDatabaseTables();
      } catch (err: any) {
        alert(`Failed to mass update contacts: ${err.message}`);
      } finally {
        setIsApplyingMassEdit(false);
      }
    }
  };

  const handleExecuteMassDelete = async (scope: 'SELECTED' | 'ALL_FILTERED') => {
    if (activeTableKey === 'tasks') {
      const targetIds = scope === 'ALL_FILTERED'
        ? filteredAndSortedTasks.map((t) => t.id)
        : Array.from(selectedTaskIds);
      if (targetIds.length === 0) return;
      if (!window.confirm(`Are you sure you want to PERMANENTLY delete ${targetIds.length} task(s) from the database?`)) return;
      try {
        setIsBulkOperating(true);
        const res = await bulkDeleteTasks(targetIds);
        setSelectedTaskIds(new Set());
        alert(`Successfully deleted ${res.deleted_count} task(s).`);
        await onRefresh?.();
        await loadDatabaseTables();
      } catch (err: any) {
        alert(`Failed to bulk delete tasks: ${err.message}`);
      } finally {
        setIsBulkOperating(false);
      }
    } else if (activeTableKey === 'contacts') {
      const targetIds = scope === 'ALL_FILTERED'
        ? filteredContacts.map((c) => c.id)
        : Array.from(selectedContactIds);
      if (targetIds.length === 0) return;
      if (!window.confirm(`Are you sure you want to PERMANENTLY delete ${targetIds.length} contact(s) and their queued tasks?`)) return;
      try {
        setIsBulkOperating(true);
        const res = await bulkDeleteContacts(targetIds);
        setSelectedContactIds(new Set());
        alert(`Successfully deleted ${res.deleted_count} contact(s).`);
        await onRefresh?.();
        await loadDatabaseTables();
      } catch (err: any) {
        alert(`Failed to bulk delete contacts: ${err.message}`);
      } finally {
        setIsBulkOperating(false);
      }
    }
  };

  const handleMassIncludeTasks = async () => {
    const targetIds = Array.from(selectedTaskIds);
    if (targetIds.length === 0) return;
    try {
      setIsBulkOperating(true);
      await bulkSetTaskSelection(targetIds, true);
      await onRefresh?.();
      await loadDatabaseTables();
    } catch (err: any) {
      alert(`Could not include tasks: ${err.message}`);
    } finally {
      setIsBulkOperating(false);
    }
  };

  const handleMassExcludeTasks = async () => {
    const targetIds = Array.from(selectedTaskIds);
    if (targetIds.length === 0) return;
    try {
      setIsBulkOperating(true);
      await bulkSetTaskSelection(targetIds, false);
      await onRefresh?.();
      await loadDatabaseTables();
    } catch (err: any) {
      alert(`Could not exclude tasks: ${err.message}`);
    } finally {
      setIsBulkOperating(false);
    }
  };

  const handleMassRetryTasks = async () => {
    const targetIds = Array.from(selectedTaskIds);
    if (targetIds.length === 0) return;
    try {
      setIsBulkOperating(true);
      for (const id of targetIds) {
        await retryTask(id).catch(() => {});
      }
      await onRefresh?.();
      await loadDatabaseTables();
      alert(`Re-queued ${targetIds.length} task(s).`);
    } catch (err: any) {
      alert(`Could not retry tasks: ${err.message}`);
    } finally {
      setIsBulkOperating(false);
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
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-white tracking-tight flex items-center space-x-2.5">
            <span>Sources, Deduplication & Database Center</span>
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Analyze spreadsheets for database duplicates, customize duplicate handling, and view or export all database tables.
          </p>
        </div>
      </div>

      {/* Universal Export Highlight Card */}
      <div className="bg-gradient-to-r from-gray-900 via-indigo-950/40 to-gray-900 border border-indigo-500/30 rounded-2xl p-5 shadow-xl flex flex-col lg:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center shrink-0">
            <Database className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-bold text-white">Universal Excel Workbook (.xlsx)</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                5 Sheets Synchronized
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              Includes complete sheets: <span className="text-gray-300 font-semibold">1. Contacts Directory</span> | <span className="text-gray-300 font-semibold">2. Dispatch Queue</span> | <span className="text-gray-300 font-semibold">3. Ingested Sources</span> | <span className="text-gray-300 font-semibold">4. Outreach History</span> | <span className="text-gray-300 font-semibold">5. Audit Events</span>.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3 shrink-0">
          <a
            href={`/api/sources/export/universal?t=${Date.now()}`}
            download
            className="flex items-center space-x-2 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/30 transition hover:scale-105 active:scale-95 cursor-pointer"
            title="Download Universal Excel containing all 5 database tables"
          >
            <Download className="w-4 h-4" />
            <span>Universal Download (All 5 Tables)</span>
          </a>
        </div>
      </div>

      {/* Main Grid: Upload / URL & Redundancy Staging */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-xl space-y-6">
          {/* Method Tabs */}
          <div className="flex border-b border-gray-800 pb-3 space-x-6">
            <button
              onClick={() => {
                setActiveTab('upload');
                setStagedData(null);
                setImportResult(null);
                setError(null);
              }}
              className={`flex items-center space-x-2 text-sm font-bold pb-2 transition-all border-b-2 -mb-[13px] ${
                activeTab === 'upload'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <UploadCloud className="w-4 h-4" />
              <span>Upload Local XLSX</span>
            </button>
            <button
              onClick={() => {
                setActiveTab('url');
                setStagedData(null);
                setImportResult(null);
                setError(null);
              }}
              className={`flex items-center space-x-2 text-sm font-bold pb-2 transition-all border-b-2 -mb-[13px] ${
                activeTab === 'url'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <Link2 className="w-4 h-4" />
              <span>Spreadsheet URL</span>
            </button>
          </div>

          {/* Upload XLSX Mode */}
          {activeTab === 'upload' && !stagedData && (
            <div className="space-y-4">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".xlsx, .xls"
                className="hidden"
              />

              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-700 hover:border-indigo-500 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors bg-gray-950/40 hover:bg-indigo-950/10"
              >
                <FileSpreadsheet className="w-12 h-12 text-indigo-400 mb-3 opacity-80" />
                <p className="text-sm font-bold text-gray-200">
                  {file ? file.name : 'Click to select an Excel (.xlsx) file'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Supports columns: Instagram URL / Username, Name, Message, Expected Followers, Follow-Up Messages
                </p>
              </div>

              {file && (
                <div className="flex items-center space-x-3">
                  <button
                    onClick={handleAnalyzeXlsx}
                    disabled={loading}
                    className="flex-1 py-3 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:bg-gray-800 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/30 transition flex items-center justify-center space-x-2 cursor-pointer"
                  >
                    <Search className="w-4 h-4" />
                    <span>{loading ? 'Inspecting Redundancy & Validating...' : 'Analyze Data & Inspect Redundancy'}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* URL Mode */}
          {activeTab === 'url' && !stagedData && (
            <form onSubmit={handleAnalyzeUrl} className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 font-semibold uppercase block mb-1.5">
                  Spreadsheet URL (Google Sheets or web sheet)
                </label>
                <input
                  type="url"
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 font-semibold uppercase block mb-1.5">
                  Source Identifier Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Q4 Outreach Leads"
                  value={sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <p className="text-xs text-gray-500 leading-relaxed">
                Playwright will access the sheet URL and inspect all rows against existing database records for redundancy.
              </p>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/30 transition flex items-center justify-center space-x-2 cursor-pointer"
              >
                <Search className="w-4 h-4" />
                <span>{loading ? 'Inspecting Redundancy & Reading Sheet...' : 'Analyze Data & Inspect Redundancy'}</span>
              </button>
            </form>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-4 bg-rose-950/60 border border-rose-800 rounded-xl flex items-center space-x-3 text-rose-300 text-xs">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────
              STAGED DEDUPLICATION & REDUNDANCY REVIEW PANEL
              ───────────────────────────────────────────────────────────── */}
          {stagedData && (
            <div className="space-y-6 bg-gray-950/70 border border-indigo-500/40 rounded-2xl p-6 shadow-2xl">
              {/* Header Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-800">
                <div>
                  <div className="flex items-center space-x-2">
                    <Layers className="w-5 h-5 text-indigo-400" />
                    <h3 className="text-base font-bold text-white">Redundancy & Deduplication Review</h3>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Source: <span className="text-gray-200 font-mono font-medium">{stagedData.source_name}</span>
                  </p>
                </div>

                <button
                  onClick={() => setStagedData(null)}
                  className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg border border-gray-800 hover:border-gray-700 transition"
                >
                  Cancel / Re-upload
                </button>
              </div>

              {/* Stat Counters */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-gray-900/90 border border-gray-800 p-3 rounded-xl text-center">
                  <span className="text-[10px] text-gray-400 block font-semibold">Total Fetched</span>
                  <span className="text-lg font-black text-white">{stagedData.total_fetched}</span>
                </div>
                <div className="bg-emerald-950/40 border border-emerald-500/40 p-3 rounded-xl text-center">
                  <span className="text-[10px] text-emerald-300 block font-semibold">Unique Leads</span>
                  <span className="text-lg font-black text-emerald-400">{stagedData.unique_count}</span>
                </div>
                <div className="bg-amber-950/40 border border-amber-500/40 p-3 rounded-xl text-center">
                  <span className="text-[10px] text-amber-300 block font-semibold">Duplicates in DB</span>
                  <span className="text-lg font-black text-amber-400">{stagedData.duplicate_count}</span>
                </div>
                <div className="bg-gray-900/90 border border-gray-800 p-3 rounded-xl text-center">
                  <span className="text-[10px] text-gray-400 block font-semibold">Invalid Rows</span>
                  <span className="text-lg font-black text-rose-400">{stagedData.invalid_count}</span>
                </div>
              </div>

              {/* Review Tabs */}
              <div className="flex border-b border-gray-800 space-x-6 text-xs font-bold">
                <button
                  onClick={() => setReviewTab('unique')}
                  className={`pb-2.5 transition flex items-center space-x-1.5 border-b-2 -mb-[1px] ${
                    reviewTab === 'unique'
                      ? 'border-emerald-500 text-emerald-400'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Unique Leads ({selectedUniqueIndices.size}/{stagedData.unique_records.length} selected)</span>
                </button>

                <button
                  onClick={() => setReviewTab('duplicates')}
                  className={`pb-2.5 transition flex items-center space-x-1.5 border-b-2 -mb-[1px] ${
                    reviewTab === 'duplicates'
                      ? 'border-amber-500 text-amber-400'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Duplicates in Database ({stagedData.duplicate_records.length})</span>
                </button>

                {stagedData.invalid_records.length > 0 && (
                  <button
                    onClick={() => setReviewTab('invalid')}
                    className={`pb-2.5 transition flex items-center space-x-1.5 border-b-2 -mb-[1px] ${
                      reviewTab === 'invalid'
                        ? 'border-rose-500 text-rose-400'
                        : 'border-transparent text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Invalid Rows ({stagedData.invalid_records.length})</span>
                  </button>
                )}
              </div>

              {/* TAB 1: Unique Leads Review */}
              {reviewTab === 'unique' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">
                      These leads are completely new and not present in your database. You can review and remove any you do not want to add.
                    </span>
                    <div className="flex items-center space-x-2 shrink-0">
                      <button
                        onClick={selectAllUnique}
                        className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-[11px] font-medium transition"
                      >
                        Select All
                      </button>
                      <button
                        onClick={deselectAllUnique}
                        className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-[11px] font-medium transition"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto max-h-[360px] border border-gray-800 rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-900/90 text-gray-400 text-[11px] uppercase tracking-wider sticky top-0">
                        <tr>
                          <th className="py-2.5 px-3 w-10 text-center">Add</th>
                          <th className="py-2.5 px-3">Name</th>
                          <th className="py-2.5 px-3">Instagram / Username</th>
                          <th className="py-2.5 px-3">1st Message Copy</th>
                          <th className="py-2.5 px-3 w-20 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60 font-sans">
                        {stagedData.unique_records.map((rec) => {
                          const isSelected = selectedUniqueIndices.has(rec.index);
                          return (
                            <tr
                              key={rec.index}
                              className={`transition ${
                                isSelected ? 'bg-gray-900/40 hover:bg-gray-800/40' : 'bg-gray-950/40 opacity-40'
                              }`}
                            >
                              <td className="py-2 px-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleUniqueIndex(rec.index)}
                                  className="rounded border-gray-700 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                />
                              </td>
                              <td className="py-2 px-3 font-semibold text-white truncate max-w-[150px]">
                                {rec.name || '—'}
                              </td>
                              <td className="py-2 px-3 text-gray-300 truncate max-w-[180px]">
                                <span className="font-mono text-indigo-400">@{rec.username || 'unknown'}</span>
                              </td>
                              <td className="py-2 px-3 text-gray-400 truncate max-w-[240px]">
                                {rec.message || 'Hey'}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <button
                                  onClick={() => removeUniqueRecord(rec.index)}
                                  className="text-rose-400 hover:text-rose-300 hover:bg-rose-950/50 p-1 rounded transition cursor-pointer"
                                  title="Remove from import"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 2: Duplicates Review */}
              {reviewTab === 'duplicates' && (
                <div className="space-y-4">
                  {/* Duplicate Handling Strategies (Entire Batch) */}
                  <div className="bg-gray-900/80 border border-gray-800 p-4 rounded-xl space-y-3">
                    <span className="text-xs font-bold text-white block">
                      Duplicate Ingestion Policy (Entire Batch Mode):
                    </span>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                      <label
                        className={`flex items-start space-x-2.5 p-3 rounded-lg border cursor-pointer transition ${
                          duplicateMode === 'SKIP'
                            ? 'bg-amber-950/40 border-amber-500 text-amber-200'
                            : 'bg-gray-950/50 border-gray-800 text-gray-400 hover:border-gray-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="duplicateMode"
                          value="SKIP"
                          checked={duplicateMode === 'SKIP'}
                          onChange={() => setDuplicateMode('SKIP')}
                          className="mt-0.5 text-amber-500 focus:ring-amber-400"
                        />
                        <div>
                          <span className="text-xs font-bold block">Skip All Duplicates</span>
                          <span className="text-[11px] opacity-80 leading-tight">
                            Recommended. Only adds new unique leads and leaves existing leads untouched.
                          </span>
                        </div>
                      </label>

                      <label
                        className={`flex items-start space-x-2.5 p-3 rounded-lg border cursor-pointer transition ${
                          duplicateMode === 'ADD_SEPARATELY'
                            ? 'bg-indigo-950/40 border-indigo-500 text-indigo-200'
                            : 'bg-gray-950/50 border-gray-800 text-gray-400 hover:border-gray-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="duplicateMode"
                          value="ADD_SEPARATELY"
                          checked={duplicateMode === 'ADD_SEPARATELY'}
                          onChange={() => setDuplicateMode('ADD_SEPARATELY')}
                          className="mt-0.5 text-indigo-500 focus:ring-indigo-400"
                        />
                        <div>
                          <span className="text-xs font-bold block">Add All Separately</span>
                          <span className="text-[11px] opacity-80 leading-tight">
                            Creates duplicate contacts separately with a designated duplicate tag.
                          </span>
                        </div>
                      </label>

                      <label
                        className={`flex items-start space-x-2.5 p-3 rounded-lg border cursor-pointer transition ${
                          duplicateMode === 'MERGE_UPDATE'
                            ? 'bg-emerald-950/40 border-emerald-500 text-emerald-200'
                            : 'bg-gray-950/50 border-gray-800 text-gray-400 hover:border-gray-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="duplicateMode"
                          value="MERGE_UPDATE"
                          checked={duplicateMode === 'MERGE_UPDATE'}
                          onChange={() => setDuplicateMode('MERGE_UPDATE')}
                          className="mt-0.5 text-emerald-500 focus:ring-emerald-400"
                        />
                        <div>
                          <span className="text-xs font-bold block">Merge & Enrich Existing</span>
                          <span className="text-[11px] opacity-80 leading-tight">
                            Enriches existing contact notes and message copy without creating duplicate records.
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Individual Duplicates Table */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">
                      You can also cherry-pick specific duplicates to <strong className="text-white">Add Separately</strong> even if the entire batch is set to Skip:
                    </span>
                    <div className="flex items-center space-x-2 shrink-0">
                      <button
                        onClick={selectAllDuplicates}
                        className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-[11px] font-medium transition"
                      >
                        Select All
                      </button>
                      <button
                        onClick={deselectAllDuplicates}
                        className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-[11px] font-medium transition"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto max-h-[360px] border border-gray-800 rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-900/90 text-gray-400 text-[11px] uppercase tracking-wider sticky top-0">
                        <tr>
                          <th className="py-2.5 px-3 w-28 text-center">Add Separately</th>
                          <th className="py-2.5 px-3">Lead in Sheet</th>
                          <th className="py-2.5 px-3">Database Match</th>
                          <th className="py-2.5 px-3">Outreach Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60 font-sans">
                        {stagedData.duplicate_records.map((rec) => {
                          const isIndividuallySelected = selectedDuplicateIndices.has(rec.index);
                          return (
                            <tr key={rec.index} className="bg-gray-900/30 hover:bg-gray-800/40 transition">
                              <td className="py-2 px-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={isIndividuallySelected || duplicateMode === 'ADD_SEPARATELY'}
                                  disabled={duplicateMode === 'ADD_SEPARATELY'}
                                  onChange={() => toggleDuplicateIndex(rec.index)}
                                  className="rounded border-gray-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                />
                              </td>
                              <td className="py-2 px-3">
                                <span className="font-semibold text-white block">{rec.name || '—'}</span>
                                <span className="font-mono text-[11px] text-gray-400">@{rec.username || 'unknown'}</span>
                              </td>
                              <td className="py-2 px-3">
                                <span className="text-amber-300 text-xs block font-medium">{rec.reason}</span>
                                {rec.previously_contacted && (
                                  <span className="text-[10px] text-emerald-400 font-semibold inline-block mt-0.5">
                                    ✓ Previously Contacted In Prior Run
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3">
                                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-gray-800 text-gray-300">
                                  {rec.existing_replied_status || 'UNKNOWN'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 3: Invalid Rows */}
              {reviewTab === 'invalid' && (
                <div className="space-y-4">
                  <p className="text-xs text-rose-300">
                    The following rows could not be parsed due to missing Instagram URLs or corrupt data and will be skipped.
                  </p>
                  <div className="overflow-x-auto max-h-[300px] border border-gray-800 rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-900/90 text-gray-400 text-[11px] uppercase tracking-wider sticky top-0">
                        <tr>
                          <th className="py-2 px-3">Row Index</th>
                          <th className="py-2 px-3">Issue Reason</th>
                          <th className="py-2 px-3">Raw Content</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60 font-sans">
                        {stagedData.invalid_records.map((inv) => (
                          <tr key={inv.index} className="bg-gray-900/30">
                            <td className="py-2 px-3 font-mono text-gray-400">Row #{inv.index + 1}</td>
                            <td className="py-2 px-3 text-rose-400 font-semibold">{inv.error}</td>
                            <td className="py-2 px-3 font-mono text-gray-500 text-[11px] truncate max-w-[250px]">
                              {JSON.stringify(inv.raw)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Bottom Ingest Action Bar */}
              <div className="pt-4 border-t border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="text-xs text-gray-300">
                  Ready to ingest: <strong className="text-emerald-400">{selectedUniqueIndices.size}</strong> unique leads +{' '}
                  <strong className="text-indigo-400">
                    {duplicateMode === 'ADD_SEPARATELY'
                      ? stagedData.duplicate_records.length
                      : selectedDuplicateIndices.size}
                  </strong>{' '}
                  separate duplicates.
                </div>

                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => setStagedData(null)}
                    disabled={loading}
                    className="px-4 py-2.5 rounded-xl border border-gray-700 hover:border-gray-600 text-gray-300 text-xs font-semibold transition cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    onClick={handleConfirmImport}
                    disabled={loading || (selectedUniqueIndices.size === 0 && selectedDuplicateIndices.size === 0 && duplicateMode !== 'ADD_SEPARATELY')}
                    className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:bg-gray-800 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/30 transition flex items-center space-x-2 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {loading
                        ? 'Writing Database Records...'
                        : `Confirm & Ingest (${
                            selectedUniqueIndices.size +
                            (duplicateMode === 'ADD_SEPARATELY'
                              ? stagedData.duplicate_records.length
                              : selectedDuplicateIndices.size)
                          } Leads)`}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Ingestion Result Summary */}
          {importResult && (
            <div className="p-5 bg-emerald-950/40 border border-emerald-500/50 rounded-xl space-y-4">
              <div className="flex items-center space-x-2 text-emerald-400 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5" />
                <span>Spreadsheet Ingestion & Deduplication Successfully Completed!</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="bg-gray-900/80 p-2.5 rounded-lg border border-gray-800 text-center">
                  <span className="text-[10px] text-gray-400 block font-semibold">Total Processed</span>
                  <span className="text-base font-bold text-white">{importResult.total_records}</span>
                </div>
                <div className="bg-gray-900/80 p-2.5 rounded-lg border border-gray-800 text-center">
                  <span className="text-[10px] text-emerald-300 block font-semibold">Unique Added</span>
                  <span className="text-base font-bold text-emerald-400">{importResult.unique_added}</span>
                </div>
                <div className="bg-gray-900/80 p-2.5 rounded-lg border border-gray-800 text-center">
                  <span className="text-[10px] text-indigo-300 block font-semibold">Duplicates Added</span>
                  <span className="text-base font-bold text-indigo-400">{importResult.duplicates_added}</span>
                </div>
                <div className="bg-gray-900/80 p-2.5 rounded-lg border border-gray-800 text-center">
                  <span className="text-[10px] text-amber-300 block font-semibold">Duplicates Skipped</span>
                  <span className="text-base font-bold text-amber-400">{importResult.duplicates_skipped}</span>
                </div>
              </div>

              <div className="pt-2 flex justify-end space-x-3">
                <button
                  onClick={() => onNavigate('contacts')}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-bold transition cursor-pointer"
                >
                  View in Contacts Directory
                </button>
                <button
                  onClick={() => onNavigate('automation')}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold shadow transition cursor-pointer"
                >
                  <span>Launch Live Automation</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Col: Ingested Sources History */}
        <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white">Import History</h3>
            <span className="text-xs font-mono text-gray-400">{sources.length} sources</span>
          </div>
          <div className="space-y-3 overflow-y-auto max-h-[460px] pr-1">
            {sources.length > 0 ? (
              sources.map((s) => (
                <div
                  key={s.id}
                  className="p-3.5 bg-gray-950/60 border border-gray-800 rounded-xl space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-200 truncate max-w-[160px]">{s.name}</span>
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-gray-800 text-gray-400">
                      {s.type}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-gray-400">
                    <span>{s.valid_count} valid / {s.record_count} total</span>
                    <span className="text-gray-500">{new Date(s.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-gray-500 italic py-6 text-center">
                No spreadsheets imported yet.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          IN-APP DATABASE TABLES EXPLORER WITH FULL QUEUE FILTERING & EDITING
          ───────────────────────────────────────────────────────────── */}
      <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-xl space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2.5">
              <TableIcon className="w-5 h-5 text-indigo-400" />
              <h3 className="text-lg font-bold text-white">Live Database Tables Explorer & Batch Operations</h3>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Direct live viewer and editor for database records. Filter, reorder, single-edit, mass-edit, or mass-delete across queue tasks and contacts in-app.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => setIsDeleteEntireHistoryModalOpen(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-950/70 hover:bg-rose-900 text-rose-300 border border-rose-800/80 rounded-xl text-xs font-bold transition shadow-sm hover:shadow-rose-950/50 cursor-pointer"
              title="Delete entire database history with confirmation modal"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>Delete Entire History</span>
            </button>
            {activeTableKey === 'history' && (tablesData?.tables?.history?.count || 0) > 0 && (
              <button
                onClick={handleClearActiveTable}
                disabled={isClearingTable}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/80 rounded-xl text-xs font-semibold transition cursor-pointer"
                title="Permanently clear all archived Outreach History"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isClearingTable ? 'Purging History...' : 'Clear Outreach History'}</span>
              </button>
            )}

            {activeTableKey === 'sources' && (sources.length > 0 || (tablesData?.tables?.sources?.count || 0) > 0) && (
              <button
                onClick={handleClearActiveTable}
                disabled={isClearingTable}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/80 rounded-xl text-xs font-semibold transition cursor-pointer"
                title="Permanently clear all Ingested Sources"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isClearingTable ? 'Clearing Sources...' : 'Clear Sources History'}</span>
              </button>
            )}

            {activeTableKey === 'events' && (tablesData?.tables?.events?.count || 0) > 0 && (
              <button
                onClick={handleClearActiveTable}
                disabled={isClearingTable}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/80 rounded-xl text-xs font-semibold transition cursor-pointer"
                title="Permanently clear all Audit Event Logs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isClearingTable ? 'Clearing Logs...' : 'Clear Audit Logs'}</span>
              </button>
            )}

            <button
              onClick={async () => {
                await onRefresh?.();
                await loadDatabaseTables();
              }}
              disabled={loadingTables}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-medium transition cursor-pointer"
              title="Refresh database records"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingTables ? 'animate-spin' : ''}`} />
              <span>Refresh Tables</span>
            </button>
          </div>
        </div>

        {/* 5 Table Selector Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-gray-800 pb-3">
          {[
            { key: 'tasks', title: 'Dispatch Queue (Tasks)', count: tasks.length || tablesData?.tables?.tasks?.count || 0 },
            { key: 'contacts', title: 'Contacts Directory', count: contacts.length || tablesData?.tables?.contacts?.count || 0 },
            { key: 'sources', title: 'Ingested Sources', count: sources.length || tablesData?.tables?.sources?.count || 0 },
            { key: 'history', title: 'Outreach History', count: tablesData?.tables?.history?.count || 0 },
            { key: 'events', title: 'Audit Event Logs', count: tablesData?.tables?.events?.count || 0 },
          ].map((tbl) => (
            <button
              key={tbl.key}
              onClick={() => {
                setActiveTableKey(tbl.key);
                setTableSearch('');
              }}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTableKey === tbl.key
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                  : 'bg-gray-950/60 hover:bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-800'
              }`}
            >
              <span>{tbl.title}</span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                  activeTableKey === tbl.key ? 'bg-indigo-800/80 text-indigo-100' : 'bg-gray-800 text-gray-400'
                }`}
              >
                {tbl.count}
              </span>
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════
            1. ACTIVE TAB: DISPATCH QUEUE (TASKS)
            ══════════════════════════════════════════════════════════════ */}
        {activeTableKey === 'tasks' && (
          <div className="space-y-4">
            {/* View Mode Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800/70 pb-3">
              <div className="flex items-center space-x-1.5 bg-gray-950/80 p-1 rounded-xl border border-gray-800">
                {[
                  { id: 'UPCOMING', label: 'Upcoming', count: tasks.filter((t) => upcomingStatuses.includes(t.status)).length },
                  { id: 'DONE', label: 'Delivered', count: tasks.filter((t) => t.status === 'COMPLETED').length },
                  { id: 'ISSUES', label: 'Action Needed', count: tasks.filter((t) => issueStatuses.includes(t.status)).length },
                  { id: 'ALL', label: 'All Tasks', count: tasks.length },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setQueueViewMode(tab.id as QueueViewMode);
                      setTaskCurrentPage(1);
                    }}
                    className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                      queueViewMode === tab.id
                        ? tab.id === 'ISSUES' ? 'bg-amber-600 text-white' : 'bg-indigo-600 text-white'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className="font-mono text-[10px] opacity-80">({tab.count})</span>
                  </button>
                ))}
              </div>

              {/* Run Filter Tabs */}
              <div className="flex items-center space-x-1 bg-gray-950/80 p-1 rounded-xl border border-gray-800">
                {[
                  { id: 'ALL', label: 'All in Queue' },
                  { id: 'NEXT_IN_RUN', label: 'Next in Batch' },
                  { id: 'DONE_IN_RUN', label: 'Sent in Batch' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => {
                      setTaskRunFilter(opt.id as RunFilterMode);
                      setTaskCurrentPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      taskRunFilter === opt.id
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-gray-950/90 p-3 rounded-2xl border border-gray-800">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search contact, @handle, task ID, or message..."
                  value={tableSearch}
                  onChange={(e) => {
                    setTableSearch(e.target.value);
                    setTaskCurrentPage(1);
                  }}
                  className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-9 pr-8 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
                />
                {tableSearch && (
                  <button
                    onClick={() => setTableSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 p-0.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {/* Date Filter */}
                <div className="flex items-center rounded-xl bg-gray-900 border border-gray-800 p-1">
                  <span className="text-[10px] text-gray-500 uppercase font-bold px-2 hidden sm:inline">Date:</span>
                  {[
                    { id: 'ALL', label: 'All' },
                    { id: 'TODAY', label: 'Today' },
                    { id: 'YESTERDAY', label: 'Yesterday' },
                    { id: 'WEEK', label: '7d' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setTaskDateFilter(opt.id as DateFilterMode);
                        setTaskCurrentPage(1);
                      }}
                      className={`px-2 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        taskDateFilter === opt.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Stage Filter */}
                <div className="flex items-center rounded-xl bg-gray-900 border border-gray-800 p-1">
                  <span className="text-[10px] text-gray-500 uppercase font-bold px-2 hidden sm:inline">Stage:</span>
                  {[
                    { id: 'ALL', label: 'All' },
                    { id: 'MESSAGE', label: '1st DM' },
                    { id: 'FOLLOW_UP_1', label: 'FU 1' },
                    { id: 'FOLLOW_UP_2', label: 'FU 2' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setTaskFilterStage(opt.id);
                        setTaskCurrentPage(1);
                      }}
                      className={`px-2 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        taskFilterStage === opt.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Issue Category Filter for ISSUES mode */}
                {queueViewMode === 'ISSUES' && (
                  <div className="flex items-center rounded-xl bg-gray-900 border border-amber-500/30 p-1 flex-wrap gap-1">
                    <span className="text-[10px] text-amber-400 uppercase font-bold px-2 hidden sm:inline">Issue:</span>
                    {[
                      { id: 'ALL', label: 'All' },
                      { id: 'AWAITING_APPROVAL', label: 'Approval' },
                      { id: 'REPLY_RECEIVED', label: 'Replied' },
                      { id: 'DM_RESTRICTED', label: 'No DMs' },
                      { id: 'PAGE_NOT_FOUND', label: '404' },
                      { id: 'RATE_LIMITED', label: 'Cooldown' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => {
                          setTaskIssueCategoryFilter(opt.id);
                          setTaskCurrentPage(1);
                        }}
                        className={`px-2 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                          taskIssueCategoryFilter === opt.id ? 'bg-amber-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Sub-status Filter for ALL mode */}
                {queueViewMode === 'ALL' && (
                  <div className="flex items-center rounded-xl bg-gray-900 border border-gray-800 p-1">
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
                        onClick={() => {
                          setTaskFilterStatus(opt.id);
                          setTaskCurrentPage(1);
                        }}
                        className={`px-2 py-1 rounded-lg text-xs font-semibold capitalize transition cursor-pointer ${
                          taskFilterStatus === opt.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Time Sort */}
                <div className="flex items-center rounded-xl bg-gray-900 border border-gray-800 px-2 py-1 space-x-1.5">
                  <ArrowUpDown className="w-3 h-3 text-gray-500" />
                  <select
                    value={taskTimeSort}
                    onChange={(e) => setTaskTimeSort(e.target.value as TimeSortMode)}
                    className="bg-transparent text-xs text-gray-300 font-semibold focus:outline-none cursor-pointer"
                  >
                    <option value="DEFAULT" className="bg-gray-900 text-white">Default Dispatch</option>
                    <option value="SCHEDULED_ASC" className="bg-gray-900 text-white">Scheduled (Earliest)</option>
                    <option value="SCHEDULED_DESC" className="bg-gray-900 text-white">Scheduled (Latest)</option>
                    <option value="COMPLETED_DESC" className="bg-gray-900 text-white">Delivered (Recent)</option>
                  </select>
                </div>

                {/* Page Size */}
                <div className="flex items-center rounded-xl bg-gray-900 border border-gray-800 px-2 py-1 space-x-1.5">
                  <span className="text-[10px] text-gray-500 font-bold uppercase">Per Page:</span>
                  <select
                    value={taskPageSize}
                    onChange={(e) => {
                      setTaskPageSize(Number(e.target.value));
                      setTaskCurrentPage(1);
                    }}
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

            {/* Mass Actions Control Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-950/70 border border-indigo-500/30 p-3 rounded-xl backdrop-blur-md">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold border ${
                  selectedTaskIds.size > 0
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                    : 'bg-gray-900 text-gray-500 border-gray-800'
                }`}>
                  {selectedTaskIds.size} Selected
                </span>

                {/* Quick Pick buttons */}
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => handleQuickPickTasks(10, paginatedTasks.map((t) => t.id))}
                    className="px-2 py-0.5 rounded bg-gray-900 hover:bg-gray-800 text-[11px] text-gray-300 font-mono border border-gray-800 transition cursor-pointer"
                  >
                    Top 10
                  </button>
                  <button
                    onClick={() => handleQuickPickTasks(25, paginatedTasks.map((t) => t.id))}
                    className="px-2 py-0.5 rounded bg-gray-900 hover:bg-gray-800 text-[11px] text-gray-300 font-mono border border-gray-800 transition cursor-pointer"
                  >
                    Top 25
                  </button>
                  <button
                    onClick={handleSelectAllFilteredTasks}
                    className="px-2 py-0.5 rounded bg-indigo-950/60 hover:bg-indigo-900/80 text-[11px] text-indigo-300 font-semibold border border-indigo-700/50 transition cursor-pointer"
                    title={`Select all ${totalFilteredTasks} filtered records`}
                  >
                    Select All Filtered ({totalFilteredTasks})
                  </button>
                  {selectedTaskIds.size > 0 && (
                    <button
                      onClick={handleDeselectAllTasks}
                      className="px-2 py-0.5 rounded bg-gray-900 hover:bg-gray-800 text-[11px] text-gray-400 font-mono border border-gray-800 transition cursor-pointer"
                    >
                      Deselect
                    </button>
                  )}
                </div>
              </div>

              {/* Mass Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Mass Edit */}
                <button
                  onClick={() => handleOpenMassEditModal(selectedTaskIds.size > 0 ? 'SELECTED' : 'ALL_FILTERED')}
                  disabled={totalFilteredTasks === 0 || isBulkOperating}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-md shadow-indigo-900/30 transition disabled:opacity-40 cursor-pointer active:scale-95"
                  title="Mass edit message copy, schedule, status, or priority"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>
                    Mass Edit ({selectedTaskIds.size > 0 ? `${selectedTaskIds.size} Selected` : `All ${totalFilteredTasks} Filtered`})
                  </span>
                </button>

                {/* Mass Delete */}
                <button
                  onClick={() => handleExecuteMassDelete(selectedTaskIds.size > 0 ? 'SELECTED' : 'ALL_FILTERED')}
                  disabled={totalFilteredTasks === 0 || isBulkOperating}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white shadow-md shadow-rose-900/30 transition disabled:opacity-40 cursor-pointer active:scale-95"
                  title="Permanently mass delete tasks matching selection or filters"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>
                    Mass Delete ({selectedTaskIds.size > 0 ? `${selectedTaskIds.size} Selected` : `All ${totalFilteredTasks} Filtered`})
                  </span>
                </button>

                {/* Include / Exclude batch */}
                {selectedTaskIds.size > 0 && (
                  <>
                    <button
                      onClick={handleMassIncludeTasks}
                      disabled={isBulkOperating}
                      className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/50 transition cursor-pointer"
                      title="Set selected tasks to READY status"
                    >
                      <CheckSquare className="w-3.5 h-3.5" />
                      <span>Include</span>
                    </button>
                    <button
                      onClick={handleMassExcludeTasks}
                      disabled={isBulkOperating}
                      className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 border border-amber-700/50 transition cursor-pointer"
                      title="Set selected tasks to PAUSED status"
                    >
                      <Pause className="w-3.5 h-3.5" />
                      <span>Exclude</span>
                    </button>
                    <button
                      onClick={handleMassRetryTasks}
                      disabled={isBulkOperating}
                      className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-gray-900 hover:bg-gray-800 text-gray-300 border border-gray-700 transition cursor-pointer"
                      title="Retry selected tasks"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Retry</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Queue Tasks Table */}
            <div className="overflow-x-auto max-h-[520px] border border-gray-800 rounded-xl">
              <table className="w-full text-left text-xs border-collapse min-w-[960px]">
                <thead className="bg-gray-950 text-gray-400 text-[11px] uppercase tracking-wider sticky top-0 border-b border-gray-800 z-10">
                  <tr>
                    <th className="py-3 px-3 w-[4%] text-center">
                      <button
                        type="button"
                        onClick={() => handleSelectAllTasksOnPage(paginatedTasks.map((t) => t.id))}
                        className="text-gray-400 hover:text-white transition cursor-pointer"
                        title={paginatedTasks.length > 0 && paginatedTasks.every((t) => selectedTaskIds.has(t.id)) ? 'Deselect All on Page' : 'Select All on Page'}
                      >
                        {paginatedTasks.length > 0 && paginatedTasks.every((t) => selectedTaskIds.has(t.id)) ? (
                          <CheckSquare className="w-4 h-4 text-amber-400" />
                        ) : (
                          <Square className="w-4 h-4 text-gray-500 hover:text-gray-300" />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-3 w-[8%] text-center">Queue #</th>
                    <th className="py-3 px-4 w-[24%]">Contact Profile & Handle</th>
                    <th className="py-3 px-3 w-[16%]">Outreach Stage</th>
                    <th className="py-3 px-4 w-[22%]">Message Copy</th>
                    <th className="py-3 px-3 w-[16%]">Priority & Status</th>
                    <th className="py-3 px-3 w-[12%]">Scheduled / Delivered</th>
                    <th className="py-3 px-3 text-right w-[8%]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60 font-sans">
                  {paginatedTasks.length > 0 ? (
                    paginatedTasks.map((t, idx) => {
                      const stage = getStageBadge(t.type);
                      const StageIcon = stage.icon;
                      const initials = (t.contact_name || t.username || 'U').substring(0, 2).toUpperCase();
                      const err = parseTaskError(t);
                      const activeRank = activeTaskPositionMap.get(t.id);
                      const isNextInRun = nextInRunTaskIds.has(t.id);

                      return (
                        <tr
                          key={t.id}
                          className={`transition hover:bg-gray-800/40 ${
                            t.status === 'PAUSED' ? 'opacity-70 bg-gray-950/40' : 'bg-gray-900/30'
                          }`}
                        >
                          {/* Selection Checkbox */}
                          <td className="py-3 px-3 text-center align-top">
                            <button
                              type="button"
                              onClick={() => handleToggleSelectTask(t.id)}
                              className="text-gray-400 hover:text-white transition cursor-pointer pt-0.5"
                            >
                              {selectedTaskIds.has(t.id) ? (
                                <CheckSquare className="w-4 h-4 text-amber-400" />
                              ) : (
                                <Square className="w-4 h-4 text-gray-600 hover:text-gray-400" />
                              )}
                            </button>
                          </td>

                          {/* Queue Position & Ordering */}
                          <td className="py-3 px-3 text-center align-top">
                            {t.status === 'RUNNING' ? (
                              <div className="flex flex-col items-center">
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-300 font-mono text-xs font-black border border-indigo-400 animate-pulse">
                                  <Play className="w-3 h-3 fill-indigo-400" />
                                </span>
                                <span className="text-[9px] text-indigo-400 font-bold mt-0.5">Active</span>
                              </div>
                            ) : t.status === 'PAUSED' ? (
                              <div className="flex flex-col items-center">
                                <span className="text-gray-600 font-mono text-xs">—</span>
                                <span className="text-[9px] text-amber-500/70 font-semibold">Paused</span>
                              </div>
                            ) : activeRank ? (
                              <div className="inline-flex items-center justify-center space-x-1">
                                <span className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded font-mono text-xs font-bold border ${
                                  isNextInRun
                                    ? 'bg-amber-500/25 text-amber-300 border-amber-400/60'
                                    : 'bg-indigo-950/60 text-indigo-300 border-indigo-700/50'
                                }`}>
                                  #{activeRank}
                                </span>
                                <div className="flex flex-col">
                                  <button
                                    onClick={() => handleMoveTask(t.id, 'UP')}
                                    disabled={activeRank <= 1 || actionLoadingId === t.id}
                                    className="p-0.5 hover:text-white text-gray-500 disabled:opacity-20 cursor-pointer"
                                  >
                                    <ChevronUp className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => handleMoveTask(t.id, 'DOWN')}
                                    disabled={activeRank >= activeUpcomingTasks.length || actionLoadingId === t.id}
                                    className="p-0.5 hover:text-white text-gray-500 disabled:opacity-20 cursor-pointer"
                                  >
                                    <ChevronDown className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <span className="text-gray-500 font-mono text-[11px]">
                                #{(taskCurrentPage - 1) * taskPageSize + idx + 1}
                              </span>
                            )}
                          </td>

                          {/* Contact Profile & Handle */}
                          <td className="py-3 px-4 align-top">
                            <div className="flex items-start space-x-2.5">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 p-[1.5px] shrink-0">
                                <div className="w-full h-full rounded-full bg-gray-950 flex items-center justify-center text-[10px] font-black text-white">
                                  {initials}
                                </div>
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-white truncate max-w-[170px] text-xs">
                                  {t.contact_name || 'Unnamed Lead'}
                                </div>
                                <div className="flex items-center space-x-1.5 mt-0.5">
                                  {t.username ? (
                                    <span className="font-mono text-indigo-400 text-[11px]">@{t.username}</span>
                                  ) : (
                                    <span className="text-gray-500 text-[11px]">—</span>
                                  )}
                                  {t.contact_instagram && (
                                    <a
                                      href={t.contact_instagram}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-gray-500 hover:text-gray-300"
                                      title="Open Instagram Profile"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Outreach Stage */}
                          <td className="py-3 px-3 align-top">
                            <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${stage.className}`}>
                              <StageIcon className="w-3 h-3" />
                              <span>{stage.label}</span>
                            </span>
                          </td>

                          {/* Message Copy */}
                          <td className="py-3 px-4 align-top">
                            <div className="flex items-start justify-between group/msg">
                              <p className="text-gray-300 text-xs line-clamp-2 pr-2 leading-relaxed">
                                {t.message || '—'}
                              </p>
                              <button
                                onClick={() => handleOpenEditTask(t)}
                                className="opacity-0 group-hover/msg:opacity-100 p-1 text-gray-400 hover:text-indigo-300 transition cursor-pointer"
                                title="Edit message copy"
                              >
                                <Edit3 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>

                          {/* Priority & Status / Reason */}
                          <td className="py-3 px-3 align-top">
                            <div className="space-y-1">
                              <div className="flex items-center space-x-1.5">
                                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${getStatusBadgeClass(t.status)}`}>
                                  {t.status}
                                </span>
                                <span className="text-[10px] font-mono text-gray-400 px-1.5 py-0.2 rounded bg-gray-800">
                                  P{t.priority ?? 1}
                                </span>
                              </div>
                              {err && (
                                <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border ${err.badgeClass}`} title={err.description}>
                                  {err.label}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Scheduled / Delivered At */}
                          <td className="py-3 px-3 align-top text-gray-400 font-mono text-[11px]">
                            {t.status === 'COMPLETED'
                              ? (t.completed_at ? formatDisplayDate(t.completed_at) : '—')
                              : (t.scheduled_at ? formatDisplayDate(t.scheduled_at) : '—')}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-3 align-top text-right">
                            <div className="flex items-center justify-end space-x-1">
                              <button
                                onClick={() => handleOpenEditTask(t)}
                                className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition cursor-pointer"
                                title="Edit task"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              {issueStatuses.includes(t.status) && (
                                <button
                                  onClick={() => handleRetryTask(t.id)}
                                  disabled={actionLoadingId === t.id}
                                  className="p-1 rounded bg-amber-950/60 hover:bg-amber-900 text-amber-300 transition cursor-pointer"
                                  title="Retry task"
                                >
                                  <RefreshCw className={`w-3.5 h-3.5 ${actionLoadingId === t.id ? 'animate-spin' : ''}`} />
                                </button>
                              )}
                              <button
                                onClick={() => handleTogglePauseTask(t.id)}
                                disabled={actionLoadingId === t.id}
                                className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition cursor-pointer"
                                title={t.status === 'PAUSED' ? 'Resume / Include' : 'Pause / Exclude'}
                              >
                                <Pause className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteSingleTask(t.id)}
                                disabled={actionLoadingId === t.id}
                                className="p-1 rounded bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 transition cursor-pointer"
                                title="Delete task"
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
                      <td colSpan={8} className="py-10 text-center text-gray-500 italic text-xs">
                        No tasks match the active filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between pt-2 text-xs text-gray-400">
              <div>
                Showing {totalFilteredTasks > 0 ? (taskCurrentPage - 1) * taskPageSize + 1 : 0} to{' '}
                {Math.min(taskCurrentPage * taskPageSize, totalFilteredTasks)} of {totalFilteredTasks} tasks
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setTaskCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={taskCurrentPage <= 1}
                  className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed transition"
                >
                  Previous
                </button>
                <span className="font-mono text-gray-300">
                  {taskCurrentPage} / {totalTaskPages}
                </span>
                <button
                  onClick={() => setTaskCurrentPage((p) => Math.min(totalTaskPages, p + 1))}
                  disabled={taskCurrentPage >= totalTaskPages}
                  className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed transition"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            2. ACTIVE TAB: CONTACTS DIRECTORY
            ══════════════════════════════════════════════════════════════ */}
        {activeTableKey === 'contacts' && (
          <div className="space-y-4">
            {/* Filter and Search Bar */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-gray-950/90 p-3 rounded-2xl border border-gray-800">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search contact, @handle, URL, or message..."
                  value={tableSearch}
                  onChange={(e) => {
                    setTableSearch(e.target.value);
                    setContactCurrentPage(1);
                  }}
                  className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-9 pr-8 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
                />
                {tableSearch && (
                  <button
                    onClick={() => setTableSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 p-0.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {/* Replied Filter */}
                <div className="flex items-center rounded-xl bg-gray-900 border border-gray-800 p-1">
                  <span className="text-[10px] text-gray-500 uppercase font-bold px-2 hidden sm:inline">Replied:</span>
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'replied', label: 'Replied' },
                    { id: 'automated', label: 'Auto' },
                    { id: 'unreplied', label: 'Waiting' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setContactRepliedFilter(opt.id);
                        setContactCurrentPage(1);
                      }}
                      className={`px-2 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        contactRepliedFilter === opt.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Date Filter */}
                <div className="flex items-center rounded-xl bg-gray-900 border border-gray-800 p-1">
                  <span className="text-[10px] text-gray-500 uppercase font-bold px-2 hidden sm:inline">Date:</span>
                  {[
                    { id: 'ALL', label: 'All' },
                    { id: 'TODAY', label: 'Today' },
                    { id: 'YESTERDAY', label: 'Yesterday' },
                    { id: 'WEEK', label: '7d' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setContactDateFilter(opt.id as DateFilterMode);
                        setContactCurrentPage(1);
                      }}
                      className={`px-2 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        contactDateFilter === opt.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Page Size */}
                <div className="flex items-center rounded-xl bg-gray-900 border border-gray-800 px-2 py-1 space-x-1.5">
                  <span className="text-[10px] text-gray-500 font-bold uppercase">Per Page:</span>
                  <select
                    value={contactPageSize}
                    onChange={(e) => {
                      setContactPageSize(Number(e.target.value));
                      setContactCurrentPage(1);
                    }}
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

            {/* Mass Actions Control Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-950/70 border border-indigo-500/30 p-3 rounded-xl backdrop-blur-md">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold border ${
                  selectedContactIds.size > 0
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                    : 'bg-gray-900 text-gray-500 border-gray-800'
                }`}>
                  {selectedContactIds.size} Selected
                </span>

                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => handleQuickPickContacts(10, paginatedContacts.map((c) => c.id))}
                    className="px-2 py-0.5 rounded bg-gray-900 hover:bg-gray-800 text-[11px] text-gray-300 font-mono border border-gray-800 transition cursor-pointer"
                  >
                    Top 10
                  </button>
                  <button
                    onClick={() => handleQuickPickContacts(25, paginatedContacts.map((c) => c.id))}
                    className="px-2 py-0.5 rounded bg-gray-900 hover:bg-gray-800 text-[11px] text-gray-300 font-mono border border-gray-800 transition cursor-pointer"
                  >
                    Top 25
                  </button>
                  <button
                    onClick={handleSelectAllFilteredContacts}
                    className="px-2 py-0.5 rounded bg-indigo-950/60 hover:bg-indigo-900/80 text-[11px] text-indigo-300 font-semibold border border-indigo-700/50 transition cursor-pointer"
                    title={`Select all ${totalFilteredContacts} filtered contacts`}
                  >
                    Select All Filtered ({totalFilteredContacts})
                  </button>
                  {selectedContactIds.size > 0 && (
                    <button
                      onClick={handleDeselectAllContacts}
                      className="px-2 py-0.5 rounded bg-gray-900 hover:bg-gray-800 text-[11px] text-gray-400 font-mono border border-gray-800 transition cursor-pointer"
                    >
                      Deselect
                    </button>
                  )}
                </div>
              </div>

              {/* Mass Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleOpenMassEditModal(selectedContactIds.size > 0 ? 'SELECTED' : 'ALL_FILTERED')}
                  disabled={totalFilteredContacts === 0 || isBulkOperating}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-md shadow-indigo-900/30 transition disabled:opacity-40 cursor-pointer active:scale-95"
                  title="Mass edit message templates or delay days"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>
                    Mass Edit ({selectedContactIds.size > 0 ? `${selectedContactIds.size} Selected` : `All ${totalFilteredContacts} Filtered`})
                  </span>
                </button>

                <button
                  onClick={() => handleExecuteMassDelete(selectedContactIds.size > 0 ? 'SELECTED' : 'ALL_FILTERED')}
                  disabled={totalFilteredContacts === 0 || isBulkOperating}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white shadow-md shadow-rose-900/30 transition disabled:opacity-40 cursor-pointer active:scale-95"
                  title="Permanently mass delete contacts and their tasks"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>
                    Mass Delete ({selectedContactIds.size > 0 ? `${selectedContactIds.size} Selected` : `All ${totalFilteredContacts} Filtered`})
                  </span>
                </button>
              </div>
            </div>

            {/* Contacts Table */}
            <div className="overflow-x-auto max-h-[520px] border border-gray-800 rounded-xl">
              <table className="w-full text-left text-xs border-collapse min-w-[960px]">
                <thead className="bg-gray-950 text-gray-400 text-[11px] uppercase tracking-wider sticky top-0 border-b border-gray-800 z-10">
                  <tr>
                    <th className="py-3 px-3 w-[4%] text-center">
                      <button
                        type="button"
                        onClick={() => handleSelectAllContactsOnPage(paginatedContacts.map((c) => c.id))}
                        className="text-gray-400 hover:text-white transition cursor-pointer"
                        title={paginatedContacts.length > 0 && paginatedContacts.every((c) => selectedContactIds.has(c.id)) ? 'Deselect All on Page' : 'Select All on Page'}
                      >
                        {paginatedContacts.length > 0 && paginatedContacts.every((c) => selectedContactIds.has(c.id)) ? (
                          <CheckSquare className="w-4 h-4 text-amber-400" />
                        ) : (
                          <Square className="w-4 h-4 text-gray-500 hover:text-gray-300" />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-4 w-[22%]">Contact Profile & Handle</th>
                    <th className="py-3 px-3 w-[12%]">Replied Status</th>
                    <th className="py-3 px-4 w-[24%]">1st Outreach Message</th>
                    <th className="py-3 px-3 w-[15%]">Follow-Up 1</th>
                    <th className="py-3 px-3 w-[15%]">Follow-Up 2</th>
                    <th className="py-3 px-3 text-right w-[8%]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60 font-sans">
                  {paginatedContacts.length > 0 ? (
                    paginatedContacts.map((c) => {
                      const initials = (c.name || c.username || 'U').substring(0, 2).toUpperCase();
                      return (
                        <tr key={c.id} className="bg-gray-900/30 hover:bg-gray-800/40 transition">
                          <td className="py-3 px-3 text-center align-top">
                            <button
                              type="button"
                              onClick={() => handleToggleSelectContact(c.id)}
                              className="text-gray-400 hover:text-white transition cursor-pointer pt-0.5"
                            >
                              {selectedContactIds.has(c.id) ? (
                                <CheckSquare className="w-4 h-4 text-amber-400" />
                              ) : (
                                <Square className="w-4 h-4 text-gray-600 hover:text-gray-400" />
                              )}
                            </button>
                          </td>

                          {/* Profile & Handle */}
                          <td className="py-3 px-4 align-top">
                            <div className="flex items-start space-x-2.5">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 p-[1.5px] shrink-0">
                                <div className="w-full h-full rounded-full bg-gray-950 flex items-center justify-center text-[10px] font-black text-white">
                                  {initials}
                                </div>
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-white truncate max-w-[170px] text-xs">
                                  {c.name || '—'}
                                </div>
                                <div className="flex items-center space-x-1.5 mt-0.5">
                                  {c.username ? (
                                    <span className="font-mono text-indigo-400 text-[11px]">@{c.username}</span>
                                  ) : (
                                    <span className="text-gray-500 text-[11px]">—</span>
                                  )}
                                  {c.instagram_url && (
                                    <a
                                      href={c.instagram_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-gray-500 hover:text-gray-300"
                                      title="Open Instagram"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Replied Status */}
                          <td className="py-3 px-3 align-top">
                            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                              c.replied_status === 'YES'
                                ? 'bg-emerald-950 border border-emerald-500/40 text-emerald-400'
                                : c.replied_status === 'AUTOMATED_MESSAGE'
                                ? 'bg-amber-950 border border-amber-500/40 text-amber-300'
                                : c.replied_status === 'DM_RESTRICTED'
                                ? 'bg-rose-950 border border-rose-500/40 text-rose-400'
                                : 'bg-gray-800 text-gray-400'
                            }`}>
                              {c.replied_status || 'UNKNOWN'}
                            </span>
                          </td>

                          {/* 1st Outreach Message */}
                          <td className="py-3 px-4 align-top text-gray-300 text-xs line-clamp-2 leading-relaxed">
                            {c.message || c.custom_message || '—'}
                          </td>

                          {/* Follow-Up 1 */}
                          <td className="py-3 px-3 align-top">
                            <div className="text-gray-300 text-xs line-clamp-2">
                              {c.followup_1_message || '—'}
                            </div>
                            <span className="text-[10px] text-gray-500 block mt-0.5">
                              Delay: +{c.followup_1_delay_days ?? 3}d
                            </span>
                          </td>

                          {/* Follow-Up 2 */}
                          <td className="py-3 px-3 align-top">
                            <div className="text-gray-300 text-xs line-clamp-2">
                              {c.followup_2_message || '—'}
                            </div>
                            <span className="text-[10px] text-gray-500 block mt-0.5">
                              Delay: +{c.followup_2_delay_days ?? 5}d
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-3 align-top text-right">
                            <div className="flex items-center justify-end space-x-1">
                              <button
                                onClick={() => handleOpenEditContact(c)}
                                className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition cursor-pointer"
                                title="Edit contact messages"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteSingleContact(c.id)}
                                disabled={actionLoadingId === c.id}
                                className="p-1 rounded bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 transition cursor-pointer"
                                title="Delete contact"
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
                      <td colSpan={7} className="py-10 text-center text-gray-500 italic text-xs">
                        No contacts match the active filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between pt-2 text-xs text-gray-400">
              <div>
                Showing {totalFilteredContacts > 0 ? (contactCurrentPage - 1) * contactPageSize + 1 : 0} to{' '}
                {Math.min(contactCurrentPage * contactPageSize, totalFilteredContacts)} of {totalFilteredContacts} contacts
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setContactCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={contactCurrentPage <= 1}
                  className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed transition"
                >
                  Previous
                </button>
                <span className="font-mono text-gray-300">
                  {contactCurrentPage} / {totalContactPages}
                </span>
                <button
                  onClick={() => setContactCurrentPage((p) => Math.min(totalContactPages, p + 1))}
                  disabled={contactCurrentPage >= totalContactPages}
                  className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed transition"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            3. GENERIC TABLES: SOURCES, HISTORY, EVENTS
            ══════════════════════════════════════════════════════════════ */}
        {activeTableKey !== 'tasks' && activeTableKey !== 'contacts' && (
          <div className="space-y-4">
            <div className="relative max-w-md">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search table data..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-gray-950 border border-gray-700 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 w-full"
              />
            </div>

            <div className="overflow-x-auto max-h-[460px] border border-gray-800 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-950 text-gray-400 text-[11px] uppercase tracking-wider sticky top-0 border-b border-gray-800">
                  <tr>
                    {currentTable?.columns?.map((col: string, idx: number) => (
                      <th key={idx} className="py-3 px-3.5 font-semibold">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60 font-sans">
                  {filteredTableRows.length > 0 ? (
                    filteredTableRows.map((row: any, rIdx: number) => (
                      <tr key={row.id || rIdx} className="bg-gray-900/30 hover:bg-gray-800/40 transition">
                        {Object.entries(row)
                          .filter(([k]) => k !== 'id')
                          .map(([k, val]: [string, any], cIdx: number) => (
                            <td key={cIdx} className="py-2.5 px-3.5">
                              {k === 'replied_status' || k === 'status' ? (
                                <span
                                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                                    val === 'YES' || val === 'COMPLETED' || val === 'ACTIVE'
                                      ? 'bg-emerald-950 border border-emerald-500/40 text-emerald-400'
                                      : val === 'FAILED' || val === 'ERROR'
                                      ? 'bg-rose-950 border border-rose-500/40 text-rose-400'
                                      : 'bg-indigo-950 border border-indigo-500/40 text-indigo-300'
                                  }`}
                                >
                                  {String(val)}
                                </span>
                              ) : k === 'username' ? (
                                <span className="font-mono text-indigo-400 text-xs">@{val}</span>
                              ) : (
                                <span className="text-gray-300 text-xs truncate max-w-[260px] block">
                                  {String(val ?? '—')}
                                </span>
                              )}
                            </td>
                          ))}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={currentTable?.columns?.length || 5}
                        className="py-10 text-center text-gray-500 italic text-xs"
                      >
                        {loadingTables ? 'Loading table data...' : 'No records found in this table.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          MODAL 1: SINGLE TASK EDIT MODAL
          ───────────────────────────────────────────────────────────── */}
      {editingTask && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Edit3 className="w-4 h-4 text-indigo-400" />
                <span>Edit Task #{editingTask.id}</span>
              </h3>
              <button
                onClick={() => setEditingTask(null)}
                className="text-gray-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTaskEdit} className="space-y-4 text-xs">
              <div>
                <label className="block text-gray-400 font-semibold mb-1">Target Contact</label>
                <div className="text-white font-medium bg-gray-950 p-2.5 rounded-xl border border-gray-800">
                  {editingTask.contact_name || 'Unnamed'} (@{editingTask.username || 'unknown'})
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-400 font-semibold mb-1">Scheduled Date & Time</label>
                  <input
                    type="datetime-local"
                    value={taskEditForm.scheduled_at}
                    onChange={(e) => setTaskEditForm({ ...taskEditForm, scheduled_at: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 font-semibold mb-1">Priority (1-10)</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={taskEditForm.priority}
                    onChange={(e) => setTaskEditForm({ ...taskEditForm, priority: Number(e.target.value) })}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-400 font-semibold mb-1">1st Outreach Message</label>
                <textarea
                  rows={2}
                  value={taskEditForm.message}
                  onChange={(e) => setTaskEditForm({ ...taskEditForm, message: e.target.value })}
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl p-2.5 text-white text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-gray-400 font-semibold mb-1">Follow-Up 1 Message</label>
                  <textarea
                    rows={2}
                    value={taskEditForm.followup_1_message}
                    onChange={(e) => setTaskEditForm({ ...taskEditForm, followup_1_message: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl p-2 text-white text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 font-semibold mb-1">FU 1 Delay (Days)</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={taskEditForm.followup_1_delay_days}
                    onChange={(e) => setTaskEditForm({ ...taskEditForm, followup_1_delay_days: Number(e.target.value) })}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl p-2 text-white text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-gray-400 font-semibold mb-1">Follow-Up 2 Message</label>
                  <textarea
                    rows={2}
                    value={taskEditForm.followup_2_message}
                    onChange={(e) => setTaskEditForm({ ...taskEditForm, followup_2_message: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl p-2 text-white text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 font-semibold mb-1">FU 2 Delay (Days)</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={taskEditForm.followup_2_delay_days}
                    onChange={(e) => setTaskEditForm({ ...taskEditForm, followup_2_delay_days: Number(e.target.value) })}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl p-2 text-white text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-gray-800 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setEditingTask(null)}
                  className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingTaskEdit}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition flex items-center space-x-1.5 cursor-pointer shadow-lg shadow-indigo-600/30"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingTaskEdit ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL 2: SINGLE CONTACT EDIT MODAL
          ───────────────────────────────────────────────────────────── */}
      {editingContact && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Edit3 className="w-4 h-4 text-indigo-400" />
                <span>Edit Contact: {editingContact.name}</span>
              </h3>
              <button
                onClick={() => setEditingContact(null)}
                className="text-gray-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveContactEdit} className="space-y-4 text-xs">
              <div>
                <label className="block text-gray-400 font-semibold mb-1">1st Outreach Message</label>
                <textarea
                  rows={2}
                  value={contactEditForm.message}
                  onChange={(e) => setContactEditForm({ ...contactEditForm, message: e.target.value })}
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl p-2.5 text-white text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-gray-400 font-semibold mb-1">Follow-Up 1 Message</label>
                  <textarea
                    rows={2}
                    value={contactEditForm.followup_1_message}
                    onChange={(e) => setContactEditForm({ ...contactEditForm, followup_1_message: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl p-2 text-white text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 font-semibold mb-1">FU 1 Delay (Days)</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={contactEditForm.followup_1_delay_days}
                    onChange={(e) => setContactEditForm({ ...contactEditForm, followup_1_delay_days: Number(e.target.value) })}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl p-2 text-white text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-gray-400 font-semibold mb-1">Follow-Up 2 Message</label>
                  <textarea
                    rows={2}
                    value={contactEditForm.followup_2_message}
                    onChange={(e) => setContactEditForm({ ...contactEditForm, followup_2_message: e.target.value })}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl p-2 text-white text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 font-semibold mb-1">FU 2 Delay (Days)</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={contactEditForm.followup_2_delay_days}
                    onChange={(e) => setContactEditForm({ ...contactEditForm, followup_2_delay_days: Number(e.target.value) })}
                    className="w-full bg-gray-950 border border-gray-700 rounded-xl p-2 text-white text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-gray-800 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setEditingContact(null)}
                  className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingContactEdit}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition flex items-center space-x-1.5 cursor-pointer shadow-lg shadow-indigo-600/30"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingContactEdit ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL 3: MASS EDIT MODAL (TASKS & CONTACTS)
          ───────────────────────────────────────────────────────────── */}
      {isMassEditModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center space-x-2">
                  <Settings2 className="w-4 h-4 text-indigo-400" />
                  <span>Mass Edit {activeTableKey === 'tasks' ? 'Tasks' : 'Contacts'}</span>
                </h3>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Check the fields you want to update across the target records.
                </p>
              </div>
              <button
                onClick={() => setIsMassEditModalOpen(false)}
                className="text-gray-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Target Scope Selector */}
            <div className="bg-gray-950 p-3 rounded-xl border border-gray-800 space-y-2">
              <span className="text-xs font-bold text-gray-300 block">Target Scope:</span>
              <div className="flex items-center space-x-3 text-xs">
                <label className="flex items-center space-x-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="massEditScope"
                    checked={massEditScope === 'SELECTED'}
                    onChange={() => setMassEditScope('SELECTED')}
                    className="text-indigo-600"
                  />
                  <span className="text-gray-200">
                    Selected Only ({activeTableKey === 'tasks' ? selectedTaskIds.size : selectedContactIds.size})
                  </span>
                </label>
                <label className="flex items-center space-x-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="massEditScope"
                    checked={massEditScope === 'ALL_FILTERED'}
                    onChange={() => setMassEditScope('ALL_FILTERED')}
                    className="text-indigo-600"
                  />
                  <span className="text-gray-200">
                    All Matching Filters ({activeTableKey === 'tasks' ? totalFilteredTasks : totalFilteredContacts})
                  </span>
                </label>
              </div>
            </div>

            <form onSubmit={handleExecuteMassEdit} className="space-y-4 text-xs">
              {activeTableKey === 'tasks' && (
                <>
                  {/* Status */}
                  <div className="p-3 bg-gray-950/70 border border-gray-800 rounded-xl space-y-2">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={massEditFields.applyStatus}
                        onChange={(e) => setMassEditFields({ ...massEditFields, applyStatus: e.target.checked })}
                        className="rounded text-indigo-600 cursor-pointer"
                      />
                      <span className="font-semibold text-white">Update Queue Status</span>
                    </label>
                    {massEditFields.applyStatus && (
                      <select
                        value={massEditFields.status}
                        onChange={(e) => setMassEditFields({ ...massEditFields, status: e.target.value })}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-xs mt-1"
                      >
                        <option value="READY">READY (Included in active queue)</option>
                        <option value="PAUSED">PAUSED (Excluded from dispatch)</option>
                        <option value="CANCELLED">CANCELLED (Closed outreach)</option>
                      </select>
                    )}
                  </div>

                  {/* Priority */}
                  <div className="p-3 bg-gray-950/70 border border-gray-800 rounded-xl space-y-2">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={massEditFields.applyPriority}
                        onChange={(e) => setMassEditFields({ ...massEditFields, applyPriority: e.target.checked })}
                        className="rounded text-indigo-600 cursor-pointer"
                      />
                      <span className="font-semibold text-white">Update Priority</span>
                    </label>
                    {massEditFields.applyPriority && (
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={massEditFields.priority}
                        onChange={(e) => setMassEditFields({ ...massEditFields, priority: Number(e.target.value) })}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-xs mt-1"
                      />
                    )}
                  </div>

                  {/* Schedule */}
                  <div className="p-3 bg-gray-950/70 border border-gray-800 rounded-xl space-y-2">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={massEditFields.applySchedule}
                        onChange={(e) => setMassEditFields({ ...massEditFields, applySchedule: e.target.checked })}
                        className="rounded text-indigo-600 cursor-pointer"
                      />
                      <span className="font-semibold text-white">Reschedule Date & Time</span>
                    </label>
                    {massEditFields.applySchedule && (
                      <input
                        type="datetime-local"
                        value={massEditFields.scheduled_at}
                        onChange={(e) => setMassEditFields({ ...massEditFields, scheduled_at: e.target.value })}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-xs mt-1"
                      />
                    )}
                  </div>
                </>
              )}

              {/* Message Copy */}
              <div className="p-3 bg-gray-950/70 border border-gray-800 rounded-xl space-y-2">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={massEditFields.applyMessage}
                    onChange={(e) => setMassEditFields({ ...massEditFields, applyMessage: e.target.checked })}
                    className="rounded text-indigo-600 cursor-pointer"
                  />
                  <span className="font-semibold text-white">Update 1st Message Copy</span>
                </label>
                {massEditFields.applyMessage && (
                  <textarea
                    rows={2}
                    value={massEditFields.message}
                    onChange={(e) => setMassEditFields({ ...massEditFields, message: e.target.value })}
                    placeholder="Enter new 1st message template..."
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-xs mt-1"
                  />
                )}
              </div>

              {/* Follow-Up 1 */}
              <div className="p-3 bg-gray-950/70 border border-gray-800 rounded-xl space-y-2">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={massEditFields.applyFollowup1}
                    onChange={(e) => setMassEditFields({ ...massEditFields, applyFollowup1: e.target.checked })}
                    className="rounded text-indigo-600 cursor-pointer"
                  />
                  <span className="font-semibold text-white">Update Follow-Up 1 Message & Delay</span>
                </label>
                {massEditFields.applyFollowup1 && (
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    <textarea
                      rows={2}
                      value={massEditFields.followup_1_message}
                      onChange={(e) => setMassEditFields({ ...massEditFields, followup_1_message: e.target.value })}
                      placeholder="FU 1 template..."
                      className="col-span-2 bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-xs"
                    />
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={massEditFields.followup_1_delay_days}
                      onChange={(e) => setMassEditFields({ ...massEditFields, followup_1_delay_days: Number(e.target.value) })}
                      placeholder="Delay (days)"
                      className="bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-xs"
                    />
                  </div>
                )}
              </div>

              {/* Follow-Up 2 */}
              <div className="p-3 bg-gray-950/70 border border-gray-800 rounded-xl space-y-2">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={massEditFields.applyFollowup2}
                    onChange={(e) => setMassEditFields({ ...massEditFields, applyFollowup2: e.target.checked })}
                    className="rounded text-indigo-600 cursor-pointer"
                  />
                  <span className="font-semibold text-white">Update Follow-Up 2 Message & Delay</span>
                </label>
                {massEditFields.applyFollowup2 && (
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    <textarea
                      rows={2}
                      value={massEditFields.followup_2_message}
                      onChange={(e) => setMassEditFields({ ...massEditFields, followup_2_message: e.target.value })}
                      placeholder="FU 2 template..."
                      className="col-span-2 bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-xs"
                    />
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={massEditFields.followup_2_delay_days}
                      onChange={(e) => setMassEditFields({ ...massEditFields, followup_2_delay_days: Number(e.target.value) })}
                      placeholder="Delay (days)"
                      className="bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-xs"
                    />
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-gray-800 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsMassEditModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isApplyingMassEdit}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition flex items-center space-x-1.5 cursor-pointer shadow-lg shadow-indigo-600/30"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isApplyingMassEdit ? 'Applying...' : 'Apply Mass Update'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL 4: DELETE ENTIRE HISTORY CONFIRMATION MODAL
          ───────────────────────────────────────────────────────────── */}
      {isDeleteEntireHistoryModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-rose-500/40 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-gray-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-rose-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Delete Entire History</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Permanent database purge of archived history & audit records
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsDeleteEntireHistoryModalOpen(false)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scope Selection Box */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-gray-300 uppercase tracking-wider block">
                Choose History Purge Scope:
              </label>

              <div className="space-y-2">
                <label
                  onClick={() => setDeleteScope('ALL_HISTORY')}
                  className={`flex items-start space-x-3 p-3.5 rounded-xl border transition cursor-pointer ${
                    deleteScope === 'ALL_HISTORY'
                      ? 'bg-rose-950/40 border-rose-500/60 text-white'
                      : 'bg-gray-950/60 border-gray-800 text-gray-400 hover:border-gray-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="deleteScope"
                    checked={deleteScope === 'ALL_HISTORY'}
                    onChange={() => setDeleteScope('ALL_HISTORY')}
                    className="mt-0.5 text-rose-600 focus:ring-rose-500"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-gray-200 block">
                      Purge All Inactive History (Recommended)
                    </span>
                    <span className="text-gray-400 text-[11px] block mt-0.5">
                      Clears Outreach History, Ingested Sources history, and Audit Event Logs. Keeps active contacts and dispatch queue intact.
                    </span>
                  </div>
                </label>

                <label
                  onClick={() => setDeleteScope('OUTREACH_ONLY')}
                  className={`flex items-start space-x-3 p-3.5 rounded-xl border transition cursor-pointer ${
                    deleteScope === 'OUTREACH_ONLY'
                      ? 'bg-rose-950/40 border-rose-500/60 text-white'
                      : 'bg-gray-950/60 border-gray-800 text-gray-400 hover:border-gray-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="deleteScope"
                    checked={deleteScope === 'OUTREACH_ONLY'}
                    onChange={() => setDeleteScope('OUTREACH_ONLY')}
                    className="mt-0.5 text-rose-600 focus:ring-rose-500"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-gray-200 block">
                      Outreach History Only
                    </span>
                    <span className="text-gray-400 text-[11px] block mt-0.5">
                      Clears only the Outreach History table (all archived contacts) to allow clean re-importing without duplicate conflicts.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* Current Table Record Counts Summary */}
            <div className="bg-gray-950/80 p-3.5 rounded-xl border border-gray-800 space-y-1.5 text-xs">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
                Current Records to be Purged:
              </span>
              <div className="flex items-center justify-between text-gray-300 py-0.5">
                <span>• Outreach History table:</span>
                <span className="font-mono font-bold text-amber-400">
                  {tablesData?.tables?.history?.count || 0} records
                </span>
              </div>
              {deleteScope === 'ALL_HISTORY' && (
                <>
                  <div className="flex items-center justify-between text-gray-300 py-0.5">
                    <span>• Ingested Sources table:</span>
                    <span className="font-mono font-bold text-indigo-400">
                      {sources.length || tablesData?.tables?.sources?.count || 0} sources
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-gray-300 py-0.5">
                    <span>• Audit Event Logs:</span>
                    <span className="font-mono font-bold text-rose-400">
                      {tablesData?.tables?.events?.count || 0} logs
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Warning Text */}
            <div className="p-3 bg-amber-950/30 border border-amber-600/30 rounded-xl text-amber-300 text-[11px] flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
              <span>
                This executes a direct database <code>DELETE</code>. Once purged, these records cannot be recovered.
              </span>
            </div>

            {/* Modal Actions */}
            <div className="pt-2 border-t border-gray-800 flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={() => setIsDeleteEntireHistoryModalOpen(false)}
                disabled={isDeletingEntireHistory}
                className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleConfirmDeleteEntireHistory}
                disabled={isDeletingEntireHistory}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition flex items-center space-x-2 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {isDeletingEntireHistory
                    ? 'Purging History Records...'
                    : 'Confirm & Delete Entire History'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

