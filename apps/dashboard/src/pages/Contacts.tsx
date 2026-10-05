import React, { useState, useMemo } from 'react';
import { 
  Search, ExternalLink, Check, Download, Edit3, X, Save, Clock, 
  CheckCircle2, Calendar, Send, Sliders, RefreshCw, Users, 
  Sparkles, MessageSquare, ChevronLeft, ChevronRight, ArrowUpRight, Trash2,
  Bot, Phone, Mail, Link2, ShieldAlert, Eye, MessageCircle,
  Zap, CheckCheck, ListOrdered, ArrowUpDown, Filter, Play
} from 'lucide-react';
import { Contact, Task, LiveAutomationState } from '../types';
import { 
  toggleReplied, 
  updateContactMessages, 
  fetchMessageTemplates, 
  applyBulkTemplates,
  deleteContact,
  triggerReplyScan,
  updateFollowupSchedule
} from '../services/api';

interface ContactsProps {
  contacts: Contact[];
  tasks?: Task[];
  automationState?: LiveAutomationState | null;
  onRefresh: () => void;
}

type RunFilterMode = 'ALL' | 'NEXT_IN_RUN' | 'DONE_IN_RUN';
type DateFilterMode = 'ALL' | 'TODAY' | 'YESTERDAY' | 'WEEK';
type TimeSortMode = 'DEFAULT' | 'SCHEDULED_ASC' | 'SCHEDULED_DESC' | 'COMPLETED_DESC' | 'NAME_ASC';
type StageFilterMode = 'ALL' | 'MESSAGE' | 'FOLLOW_UP_1' | 'FOLLOW_UP_2';

function matchesDateFilter(dateStr: string | null | undefined, filter: DateFilterMode): boolean {
  if (filter === 'ALL' || !dateStr) return filter === 'ALL';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const targetTime = d.getTime();

    if (filter === 'TODAY') {
      return targetTime >= todayStart;
    }
    if (filter === 'YESTERDAY') {
      const yesterdayStart = todayStart - 86400000;
      return targetTime >= yesterdayStart && targetTime < todayStart;
    }
    if (filter === 'WEEK') {
      const weekStart = todayStart - 7 * 86400000;
      return targetTime >= weekStart;
    }
    return true;
  } catch {
    return false;
  }
}

function toDatetimeLocalValue(dateStr?: string | null): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const pad = (n: number) => n.toString().padStart(2, '0');
      const year = d.getFullYear();
      const month = pad(d.getMonth() + 1);
      const day = pad(d.getDate());
      const hours = pad(d.getHours());
      const minutes = pad(d.getMinutes());
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    }
    return '';
  } catch {
    return '';
  }
}

function formatDisplayDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
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

export const Contacts: React.FC<ContactsProps> = ({ contacts, tasks = [], automationState, onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [repliedFilter, setRepliedFilter] = useState<'all' | 'replied' | 'automated' | 'unreplied'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'sent' | 'scheduled' | 'pending' | 'restricted'>('all');
  const [runFilter, setRunFilter] = useState<RunFilterMode>('ALL');
  const [dateFilter, setDateFilter] = useState<DateFilterMode>('ALL');
  const [timeSort, setTimeSort] = useState<TimeSortMode>('DEFAULT');
  const [stageFilter, setStageFilter] = useState<StageFilterMode>('ALL');
  const [loadingContactId, setLoadingContactId] = useState<string | null>(null);

  // Reply Scanner State
  const [isScanningReplies, setIsScanningReplies] = useState(false);
  const [scanResultMsg, setScanResultMsg] = useState('');
  const [viewingAutoReplyContact, setViewingAutoReplyContact] = useState<Contact | null>(null);

  // Pagination state
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Edit Single Contact Modal State
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [editForm, setEditForm] = useState({
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
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editSuccessMsg, setEditSuccessMsg] = useState('');

  // Bulk Template Modal State
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState({
    default_message: '',
    followup_1_message: '',
    followup_1_delay_days: 3,
    followup_2_message: '',
    followup_2_delay_days: 5,
    apply_to_all: true,
    reschedule_existing: false,
  });
  const [isSavingTemplates, setIsSavingTemplates] = useState(false);
  const [templateSuccessMsg, setTemplateSuccessMsg] = useState('');

  // Load message templates when template modal opens
  const handleOpenTemplates = async () => {
    setIsTemplateModalOpen(true);
    setTemplateSuccessMsg('');
    try {
      const t = await fetchMessageTemplates();
      setTemplateForm({
        default_message: t.default_message || 'Hey! Saw your profile and loved your content. Wanted to connect!',
        followup_1_message: t.followup_1_message || 'Hey! Just following up on my previous message — would love to connect!',
        followup_1_delay_days: t.followup_1_delay_days ?? 3,
        followup_2_message: t.followup_2_message || "Hey! One final quick check-in — let me know if you'd like more details.",
        followup_2_delay_days: t.followup_2_delay_days ?? 5,
        apply_to_all: true,
        reschedule_existing: false,
      });
    } catch (e) {
      console.error('Failed to fetch templates', e);
    }
  };

  const handleSaveTemplates = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingTemplates(true);
    setTemplateSuccessMsg('');
    try {
      const res = await applyBulkTemplates(templateForm);
      setTemplateSuccessMsg(res.message || 'Templates and follow-up schedules updated successfully!');
      onRefresh();
      setTimeout(() => {
        setIsTemplateModalOpen(false);
        setTemplateSuccessMsg('');
      }, 1500);
    } catch (err: any) {
      alert(`Error applying templates: ${err.message}`);
    } finally {
      setIsSavingTemplates(false);
    }
  };

  const handleOpenEditContact = (c: Contact) => {
    setEditingContact(c);
    setEditForm({
      message: c.message || c.custom_message || 'Hey! Saw your profile and loved your work.',
      followup_1_message: c.followup_1_message || 'Hey! Just following up on my previous message.',
      followup_1_delay_days: c.followup_1_delay_days ?? 3,
      followup_1_scheduled_at: toDatetimeLocalValue(c.followup_1_scheduled_at),
      followup_1_status: c.followup_1_status || 'SCHEDULED',
      followup_2_message: c.followup_2_message || 'Hey! One last quick check-in before I close this thread.',
      followup_2_delay_days: c.followup_2_delay_days ?? 5,
      followup_2_scheduled_at: toDatetimeLocalValue(c.followup_2_scheduled_at),
      followup_2_status: c.followup_2_status || 'SCHEDULED',
    });
    setEditSuccessMsg('');
  };

  const handleSaveContactMessages = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContact) return;
    setIsSavingEdit(true);
    setEditSuccessMsg('');
    try {
      await updateContactMessages(editingContact.id, {
        message: editForm.message,
        followup_1_message: editForm.followup_1_message,
        followup_2_message: editForm.followup_2_message,
      });

      await updateFollowupSchedule(editingContact.id, {
        followup_1_scheduled_at: editForm.followup_1_scheduled_at ? new Date(editForm.followup_1_scheduled_at).toISOString() : null,
        followup_1_status: editForm.followup_1_status,
        followup_1_delay_days: Number(editForm.followup_1_delay_days) || 3,
        followup_2_scheduled_at: editForm.followup_2_scheduled_at ? new Date(editForm.followup_2_scheduled_at).toISOString() : null,
        followup_2_status: editForm.followup_2_status,
        followup_2_delay_days: Number(editForm.followup_2_delay_days) || 5,
      });

      setEditSuccessMsg('Sequence and schedule updated successfully!');
      onRefresh();
      setTimeout(() => {
        setEditingContact(null);
        setEditSuccessMsg('');
      }, 1000);
    } catch (err: any) {
      alert(`Error updating sequence: ${err.message}`);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleToggleReplied = async (c: Contact) => {
    try {
      setLoadingContactId(c.id);
      await toggleReplied(c.id, !c.has_replied);
      onRefresh();
    } catch (e) {
      console.error('Failed to toggle replied state', e);
    } finally {
      setLoadingContactId(null);
    }
  };

  const handleDeleteContact = async (c: Contact) => {
    if (!window.confirm(`Are you sure you want to delete contact "${c.name}" (@${c.username || 'unknown'})? This will also remove any queued tasks for this contact.`)) {
      return;
    }
    try {
      setLoadingContactId(c.id);
      await deleteContact(c.id);
      onRefresh();
    } catch (e: any) {
      alert(`Failed to delete contact: ${e.message}`);
    } finally {
      setLoadingContactId(null);
    }
  };

  const handleScanReplies = async () => {
    setIsScanningReplies(true);
    setScanResultMsg('');
    try {
      const res = await triggerReplyScan();
      setScanResultMsg(
        `Scan completed: Checked ${res.scanned_count} conversations. Found ${res.automated_found} automated replies, ${res.human_replies_found} human replies.`
      );
      onRefresh();
      setTimeout(() => setScanResultMsg(''), 8000);
    } catch (e: any) {
      alert(`Failed to scan inbox replies: ${e.message}`);
    } finally {
      setIsScanningReplies(false);
    }
  };

  // Run Tracking Logic (Harmonized with Queue)
  const currentRunId = automationState?.current_run_id;
  const batchLimit = automationState?.batch_limit;
  const batchSentCount = automationState?.batch_sent_count ?? 0;
  const isWorkerRunning = automationState?.status === 'RUNNING';

  const runCompletedContactIds = useMemo(() => {
    return new Set(automationState?.run_completed_contact_ids || []);
  }, [automationState]);

  const activeBatchQuota = batchLimit ? batchLimit : 10;
  const remainingInRunQuota = isWorkerRunning 
    ? Math.max(0, activeBatchQuota - batchSentCount) 
    : activeBatchQuota;

  // Upcoming tasks sorted strictly in operational dispatch order
  const upcomingSortedTasks = useMemo(() => {
    return (tasks || [])
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

  // Map contact ID or username to Next in Run details
  const nextInRunContactMap = useMemo(() => {
    const map = new Map<string, { position: number; taskType: string; taskId: string }>();
    upcomingSortedTasks.slice(0, remainingInRunQuota).forEach((t, i) => {
      if (t.contact_id && !map.has(t.contact_id)) {
        map.set(t.contact_id, { position: i + 1, taskType: t.type || 'MESSAGE', taskId: t.id });
      }
      if (t.username && !map.has(t.username.toLowerCase())) {
        map.set(t.username.toLowerCase(), { position: i + 1, taskType: t.type || 'MESSAGE', taskId: t.id });
      }
    });
    return map;
  }, [upcomingSortedTasks, remainingInRunQuota]);

  const isContactDoneInRun = (c: Contact) => {
    if (runCompletedContactIds.has(c.id)) return true;
    if (c.username && runCompletedContactIds.has(c.username.toLowerCase())) return true;
    if (currentRunId && c.last_run_id === currentRunId) return true;
    return false;
  };

  const getContactNextInRun = (c: Contact) => {
    return nextInRunContactMap.get(c.id) || (c.username ? nextInRunContactMap.get(c.username.toLowerCase()) : undefined);
  };

  const doneInRunCount = useMemo(() => {
    return contacts.filter(isContactDoneInRun).length;
  }, [contacts, runCompletedContactIds, currentRunId]);

  const nextInRunCount = useMemo(() => {
    return contacts.filter((c) => !!getContactNextInRun(c)).length;
  }, [contacts, nextInRunContactMap]);

  // Filter and sort contacts
  const filteredContacts = useMemo(() => {
    let result = contacts.filter((c) => {
      // 1. Search filter
      const term = searchTerm.toLowerCase();
      if (term) {
        const matchesSearch =
          (c.name || '').toLowerCase().includes(term) ||
          (c.username || '').toLowerCase().includes(term) ||
          (c.message || '').toLowerCase().includes(term) ||
          (c.custom_message || '').toLowerCase().includes(term) ||
          (c.auto_reply_message || '').toLowerCase().includes(term) ||
          (c.extracted_phone || '').toLowerCase().includes(term) ||
          (c.extracted_email || '').toLowerCase().includes(term);
        if (!matchesSearch) return false;
      }

      // 2. Replies Filter
      if (repliedFilter === 'replied' && !(c.has_replied || c.replied_status === 'YES')) return false;
      if (repliedFilter === 'automated' && c.replied_status !== 'AUTOMATED_MESSAGE') return false;
      if (repliedFilter === 'unreplied' && (c.has_replied || c.replied_status === 'YES' || c.replied_status === 'AUTOMATED_MESSAGE')) return false;

      // 3. Status Filter
      if (statusFilter === 'sent' && c.first_message_status !== 'SENT') return false;
      if (statusFilter === 'scheduled' && c.followup_1_status !== 'SCHEDULED' && c.followup_2_status !== 'SCHEDULED') return false;
      if (statusFilter === 'pending' && c.first_message_status === 'SENT') return false;
      if (statusFilter === 'restricted' && c.replied_status !== 'DM_RESTRICTED') return false;

      // 4. Stage Filter
      if (stageFilter === 'MESSAGE') {
        if (c.first_message_status !== 'SENT' && c.first_message_status !== 'READY') return false;
      } else if (stageFilter === 'FOLLOW_UP_1') {
        if (c.followup_1_status !== 'SENT' && c.followup_1_status !== 'SCHEDULED' && c.followup_1_status !== 'READY') return false;
      } else if (stageFilter === 'FOLLOW_UP_2') {
        if (c.followup_2_status !== 'SENT' && c.followup_2_status !== 'SCHEDULED' && c.followup_2_status !== 'READY') return false;
      }

      // 5. Run Filter
      if (runFilter === 'NEXT_IN_RUN') {
        if (!getContactNextInRun(c)) return false;
      } else if (runFilter === 'DONE_IN_RUN') {
        if (!isContactDoneInRun(c)) return false;
      }

      // 6. Date Filter
      if (dateFilter !== 'ALL') {
        let relevantDates: (string | null | undefined)[] = [];
        if (stageFilter === 'MESSAGE') {
          relevantDates = [c.first_message_sent_at, c.first_message_scheduled_at, c.created_at];
        } else if (stageFilter === 'FOLLOW_UP_1') {
          relevantDates = [c.followup_1_sent_at, c.followup_1_scheduled_at];
        } else if (stageFilter === 'FOLLOW_UP_2') {
          relevantDates = [c.followup_2_sent_at, c.followup_2_scheduled_at];
        } else {
          relevantDates = [
            c.first_message_sent_at,
            c.followup_1_sent_at,
            c.followup_2_sent_at,
            c.followup_1_scheduled_at,
            c.followup_2_scheduled_at,
            c.first_message_scheduled_at,
            c.created_at,
          ];
        }
        const hasMatchingDate = relevantDates.some((d) => matchesDateFilter(d, dateFilter));
        if (!hasMatchingDate) return false;
      }

      return true;
    });

    // 7. Time Sorting
    result = [...result].sort((a, b) => {
      if (timeSort === 'SCHEDULED_ASC') {
        const dateA = a.followup_1_scheduled_at || a.followup_2_scheduled_at || a.first_message_scheduled_at;
        const dateB = b.followup_1_scheduled_at || b.followup_2_scheduled_at || b.first_message_scheduled_at;
        const timeA = dateA ? new Date(dateA).getTime() : Infinity;
        const timeB = dateB ? new Date(dateB).getTime() : Infinity;
        return timeA - timeB;
      } else if (timeSort === 'SCHEDULED_DESC') {
        const dateA = a.followup_1_scheduled_at || a.followup_2_scheduled_at || a.first_message_scheduled_at;
        const dateB = b.followup_1_scheduled_at || b.followup_2_scheduled_at || b.first_message_scheduled_at;
        const timeA = dateA ? new Date(dateA).getTime() : 0;
        const timeB = dateB ? new Date(dateB).getTime() : 0;
        return timeB - timeA;
      } else if (timeSort === 'COMPLETED_DESC') {
        const dateA = a.followup_2_sent_at || a.followup_1_sent_at || a.first_message_sent_at;
        const dateB = b.followup_2_sent_at || b.followup_1_sent_at || b.first_message_sent_at;
        const timeA = dateA ? new Date(dateA).getTime() : 0;
        const timeB = dateB ? new Date(dateB).getTime() : 0;
        return timeB - timeA;
      } else if (timeSort === 'NAME_ASC') {
        const nameA = (a.name || a.username || '').toLowerCase();
        const nameB = (b.name || b.username || '').toLowerCase();
        return nameA.localeCompare(nameB);
      }
      return 0;
    });

    return result;
  }, [contacts, searchTerm, repliedFilter, statusFilter, stageFilter, runFilter, dateFilter, timeSort, nextInRunContactMap, runCompletedContactIds, currentRunId]);

  // Handle page resets on filter/search change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, repliedFilter, statusFilter, stageFilter, runFilter, dateFilter, timeSort, pageSize]);

  // Pagination calculation
  const totalContacts = contacts.length;
  const totalFiltered = filteredContacts.length;
  const totalPages = Math.ceil(totalFiltered / pageSize) || 1;
  const paginatedContacts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredContacts.slice(start, start + pageSize);
  }, [filteredContacts, currentPage, pageSize]);

  // Metrics
  const firstSentCount = contacts.filter((c) => c.first_message_status === 'SENT').length;
  const fu1ScheduledCount = contacts.filter((c) => c.followup_1_status === 'SCHEDULED' || c.followup_1_status === 'SENT').length;
  const fu2ScheduledCount = contacts.filter((c) => c.followup_2_status === 'SCHEDULED' || c.followup_2_status === 'SENT').length;
  const repliedCount = contacts.filter((c) => c.has_replied || c.replied_status === 'YES').length;
  const automatedCount = contacts.filter((c) => c.replied_status === 'AUTOMATED_MESSAGE').length;
  const restrictedCount = contacts.filter((c) => c.replied_status === 'DM_RESTRICTED').length;

  return (
    <div className="space-y-6">
      {/* Top Header & Global Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-gradient-to-r from-gray-900/90 via-[#08231a]/90 to-gray-900/90 border border-gray-800/80 p-5 rounded-2xl shadow-xl backdrop-blur-md">
        <div>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#d49237] to-[#99631b] flex items-center justify-center shadow-lg shadow-[#d49237]/25">
              <Users className="w-5 h-5 text-gray-950 font-black" />
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h2 className="text-xl font-black text-white tracking-tight">Contacts Directory & Outreach Lifecycle</h2>
                <span className="bg-indigo-500/20 text-indigo-400 font-mono text-xs px-2.5 py-0.5 rounded-full border border-indigo-500/30 font-semibold">
                  {totalContacts} Leads
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Manage recipients, monitor multi-touch day/time dispatch tracking, and customize outreach copy.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleScanReplies}
            disabled={isScanningReplies}
            className="flex items-center space-x-2 bg-gradient-to-r from-amber-600 via-orange-600 to-amber-600 hover:from-amber-500 hover:to-orange-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition shadow-lg shadow-amber-950/40 hover:scale-105 active:scale-95 disabled:opacity-50 cursor-pointer"
            title="Scan Instagram Direct Inbox for inbound messages, automated replies, and extracted phone/emails"
          >
            <Bot className={`w-4 h-4 ${isScanningReplies ? 'animate-spin text-amber-200' : 'text-amber-100'}`} />
            <span>{isScanningReplies ? 'Scanning Inbox...' : 'Scan Inbox Replies'}</span>
          </button>

          <button
            onClick={handleOpenTemplates}
            className="flex items-center space-x-2 bg-gray-800/90 hover:bg-gray-700 text-indigo-300 border border-indigo-500/40 px-3.5 py-2 rounded-xl text-xs font-bold transition shadow-sm hover:scale-105 active:scale-95 cursor-pointer"
            title="Edit default outreach sequence messages and apply across all contacts"
          >
            <Sliders className="w-4 h-4 text-indigo-400" />
            <span>Outreach Sequence Templates</span>
          </button>

          <a
            href="/api/contacts/export/excel"
            download
            className="flex items-center space-x-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-lg shadow-emerald-500/25 transition-all hover:scale-105 active:scale-95 cursor-pointer"
            title="Export complete table with 1st message, Follow-Up 1, and Follow-Up 2 day/time tracking into Excel"
          >
            <Download className="w-4 h-4" />
            <span>Export Excel (.xlsx)</span>
          </a>

          <button
            onClick={onRefresh}
            className="flex items-center space-x-1.5 bg-gray-900 border border-gray-700/80 text-gray-300 hover:text-white px-3 py-2 rounded-xl text-xs font-medium transition hover:border-gray-600 cursor-pointer"
            title="Refresh contacts"
          >
            <RefreshCw className="w-3.5 h-3.5 text-gray-400" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Notification Banner for Reply Scan */}
      {scanResultMsg && (
        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between shadow-lg shadow-amber-950/20">
          <div className="flex items-center space-x-2.5">
            <Bot className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
            <span className="font-semibold">{scanResultMsg}</span>
          </div>
          <button onClick={() => setScanResultMsg('')} className="text-amber-400 hover:text-white p-1">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Metric Cards Banner - Semantic Color System */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Total Leads */}
        <div className="bg-[#08231a]/70 border border-gray-800 rounded-xl p-3 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Total Leads</span>
            <span className="text-xl font-black text-white mt-0.5 block">{totalContacts}</span>
            <span className="text-[9px] text-gray-500 mt-0.5 block">Imported Pool</span>
          </div>
          <div className="w-8 h-8 rounded-lg bg-gray-800/80 border border-gray-700 flex items-center justify-center">
            <Users className="w-3.5 h-3.5 text-gray-300" />
          </div>
        </div>

        {/* 1st Message Sent - Emerald */}
        <div className="bg-emerald-950/25 border border-emerald-500/30 rounded-xl p-3 flex items-center justify-between shadow-sm shadow-emerald-950/30">
          <div>
            <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block">1st Sent</span>
            <span className="text-xl font-black text-emerald-300 mt-0.5 block">{firstSentCount}</span>
            <span className="text-[9px] text-emerald-500/80 mt-0.5 block">
              {totalContacts > 0 ? `${Math.round((firstSentCount / totalContacts) * 100)}% sent` : '0%'}
            </span>
          </div>
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
            <Send className="w-3.5 h-3.5 text-emerald-400" />
          </div>
        </div>

        {/* Follow-Up 1 - Indigo */}
        <div className="bg-indigo-950/25 border border-indigo-500/30 rounded-xl p-3 flex items-center justify-between shadow-sm shadow-indigo-950/30">
          <div>
            <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider block">FU 1 (+3d)</span>
            <span className="text-xl font-black text-indigo-300 mt-0.5 block">{fu1ScheduledCount}</span>
            <span className="text-[9px] text-indigo-400/80 mt-0.5 block">Active</span>
          </div>
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
          </div>
        </div>

        {/* Automated Replies - Amber */}
        <div className="bg-amber-950/25 border border-amber-500/35 rounded-xl p-3 flex items-center justify-between shadow-sm shadow-amber-950/30">
          <div>
            <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider block">Auto-Replies</span>
            <span className="text-xl font-black text-amber-300 mt-0.5 block">{automatedCount}</span>
            <span className="text-[9px] text-amber-400/80 mt-0.5 block">Extracted Leads</span>
          </div>
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-amber-400" />
          </div>
        </div>

        {/* Replied Leads - Rose / Warm Conversion */}
        <div className="bg-rose-950/25 border border-rose-500/35 rounded-xl p-3 flex items-center justify-between shadow-sm shadow-rose-950/30">
          <div>
            <span className="text-[10px] text-rose-400 font-bold uppercase tracking-wider block">Human Replies</span>
            <span className="text-xl font-black text-rose-300 mt-0.5 block">{repliedCount}</span>
            <span className="text-[9px] text-rose-400/80 mt-0.5 block">
              {firstSentCount > 0 ? `${Math.round((repliedCount / firstSentCount) * 100)}% rate` : '0%'}
            </span>
          </div>
          <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/40 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-rose-400" />
          </div>
        </div>

        {/* Restricted DMs - Red/Zinc */}
        <div className="bg-red-950/20 border border-red-500/30 rounded-xl p-3 flex items-center justify-between shadow-sm shadow-red-950/20">
          <div>
            <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider block">DM Restricted</span>
            <span className="text-xl font-black text-red-300 mt-0.5 block">{restrictedCount}</span>
            <span className="text-[9px] text-red-400/80 mt-0.5 block">No DM requests</span>
          </div>
          <div className="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/40 flex items-center justify-center">
            <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
          </div>
        </div>
      </div>

      {/* Run Tracker Banner & Active Session Telemetry (Matching Queue) */}
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
              <span>{nextInRunCount} recipients staged next in this run</span>
              {doneInRunCount > 0 && <span> • {doneInRunCount} completed during this active session</span>}
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

      {/* Filter, Search, Date & Time Sorting Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-[#08231a]/80 p-3 rounded-2xl border border-gray-800 backdrop-blur-sm">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search name, @handle, copy, phone, email..."
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

        <div className="flex flex-wrap items-center gap-2">
          {/* Date Filter (Harmonized with Queue) */}
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
                className={`px-2 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
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
                onClick={() => setStageFilter(opt.id as StageFilterMode)}
                className={`px-2 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  stageFilter === opt.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Status Filter */}
          <div className="flex items-center rounded-xl bg-gray-950/90 border border-gray-800 p-1">
            <span className="text-[10px] text-gray-500 uppercase font-bold px-2 hidden sm:inline">Status:</span>
            {(['all', 'sent', 'scheduled', 'pending', 'restricted'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setStatusFilter(mode)}
                className={`px-2 py-1 rounded-lg text-xs font-semibold capitalize transition cursor-pointer ${
                  statusFilter === mode
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {mode === 'all' ? 'All' : mode === 'restricted' ? 'Restricted' : mode}
              </button>
            ))}
          </div>

          {/* Replied Filter */}
          <div className="flex items-center rounded-xl bg-gray-950/90 border border-gray-800 p-1">
            <span className="text-[10px] text-gray-500 uppercase font-bold px-2 hidden sm:inline">Inbox:</span>
            {(['all', 'replied', 'automated', 'unreplied'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setRepliedFilter(mode)}
                className={`px-2 py-1 rounded-lg text-xs font-semibold capitalize transition cursor-pointer ${
                  repliedFilter === mode
                    ? mode === 'automated'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-rose-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {mode === 'all' ? 'All' : mode === 'replied' ? '💬 Human' : mode === 'automated' ? '🤖 Auto' : '⏳ None'}
              </button>
            ))}
          </div>

          {/* Time & Name Sorting Dropdown */}
          <div className="flex items-center rounded-xl bg-gray-950/90 border border-gray-800 px-2.5 py-1 space-x-1.5">
            <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
            <select
              value={timeSort}
              onChange={(e) => setTimeSort(e.target.value as TimeSortMode)}
              className="bg-transparent text-xs text-gray-300 font-semibold focus:outline-none cursor-pointer"
            >
              <option value="DEFAULT" className="bg-gray-900 text-white">Sort: Default</option>
              <option value="SCHEDULED_ASC" className="bg-gray-900 text-white">Scheduled (Earliest First)</option>
              <option value="SCHEDULED_DESC" className="bg-gray-900 text-white">Scheduled (Latest First)</option>
              <option value="COMPLETED_DESC" className="bg-gray-900 text-white">Recently Sent First</option>
              <option value="NAME_ASC" className="bg-gray-900 text-white">Name / Handle (A-Z)</option>
            </select>
          </div>

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

      {/* Main Contacts Table */}
      <div className="bg-[#08231a]/70 border border-gray-800/90 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[960px]">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-950/90 text-[11px] font-bold uppercase tracking-wider">
                <th className="py-3.5 px-4 text-gray-400 w-[22%]">
                  <span className="flex items-center space-x-1.5">
                    <Users className="w-3.5 h-3.5 text-gray-400" />
                    <span>Contact Profile & Run Tracking</span>
                  </span>
                </th>
                <th className="py-3.5 px-4 text-emerald-400/90 w-[22%]">
                  <span className="flex items-center space-x-1.5">
                    <Send className="w-3.5 h-3.5 text-emerald-400" />
                    <span>1. Initial Outreach</span>
                  </span>
                </th>
                <th className="py-3.5 px-4 text-indigo-400/90 w-[22%]">
                  <span className="flex items-center space-x-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-400" />
                    <span>2. Follow-Up 1 (+3d)</span>
                  </span>
                </th>
                <th className="py-3.5 px-4 text-purple-400/90 w-[22%]">
                  <span className="flex items-center space-x-1.5">
                    <Calendar className="w-3.5 h-3.5 text-purple-400" />
                    <span>3. Follow-Up 2 (+5d)</span>
                  </span>
                </th>
                <th className="py-3.5 px-3 text-rose-400/90 text-center w-[6%]">
                  <span className="flex items-center justify-center space-x-1">
                    <Sparkles className="w-3.5 h-3.5 text-rose-400" />
                    <span>Reply</span>
                  </span>
                </th>
                <th className="py-3.5 px-4 text-gray-400 text-right w-[6%]">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/70 text-xs">
              {paginatedContacts.length > 0 ? (
                paginatedContacts.map((c) => {
                  const is1stSent = c.first_message_status === 'SENT';
                  const isFu1Sent = c.followup_1_status === 'SENT';
                  const isFu1Scheduled = c.followup_1_status === 'SCHEDULED' || c.followup_1_status === 'READY';
                  const isFu2Sent = c.followup_2_status === 'SENT';
                  const isFu2Scheduled = c.followup_2_status === 'SCHEDULED' || c.followup_2_status === 'READY';

                  const initials = (c.name || c.username || 'U')
                    .substring(0, 2)
                    .toUpperCase();

                  const nextInfo = getContactNextInRun(c);
                  const isDone = isContactDoneInRun(c);

                  return (
                    <tr key={c.id} className="hover:bg-gray-800/35 transition-colors group">
                      {/* Name & Username & IG Link & Run Tracking */}
                      <td className="py-4 px-4 align-top">
                        <div className="flex items-start space-x-3">
                          {/* Instagram Gradient Avatar Circle */}
                          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 p-[1.5px] shrink-0 shadow-sm">
                            <div className="w-full h-full rounded-full bg-gray-950 flex items-center justify-center text-[11px] font-black text-white">
                              {initials}
                            </div>
                          </div>

                          <div className="min-w-0">
                            <div className="font-bold text-white text-sm truncate max-w-[150px]">
                              {c.name || 'Instagram User'}
                            </div>
                            <div className="text-gray-400 font-mono text-xs truncate">
                              @{c.username}
                            </div>
                            <div className="flex items-center space-x-2 mt-1">
                              <a
                                href={c.instagram_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center space-x-1 text-indigo-400 hover:text-indigo-300 font-medium text-[11px] transition group-hover:underline"
                              >
                                <span>View Profile</span>
                                <ArrowUpRight className="w-3 h-3 shrink-0" />
                              </a>
                            </div>

                            {/* Run Tracking Badges (Matching Queue) */}
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              {nextInfo && (
                                <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded font-mono text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-400/40 animate-pulse">
                                  <Zap className="w-2.5 h-2.5" />
                                  <span>#{nextInfo.position} Next in Run</span>
                                </span>
                              )}
                              {isDone && (
                                <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded font-mono text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                                  <CheckCheck className="w-2.5 h-2.5" />
                                  <span>Done in Run</span>
                                </span>
                              )}
                              {c.last_run_id && !isDone && (
                                <span className="font-mono text-[9px] text-gray-500" title={`Run ID: ${c.last_run_id}`}>
                                  {c.last_run_id.replace(/^run_/, 'R#')}
                                </span>
                              )}
                            </div>

                            {/* Status Badges for Auto Reply / DM Restricted */}
                            {c.replied_status === 'AUTOMATED_MESSAGE' && (
                              <div className="mt-2 space-y-1">
                                <div className="flex items-center space-x-1">
                                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
                                    <Bot className="w-3 h-3 text-purple-400" />
                                    <span>Automated Reply</span>
                                  </span>
                                </div>

                                {/* Extracted Asset Pills */}
                                <div className="flex flex-wrap gap-1 pt-0.5">
                                  {c.extracted_phone && (
                                    <a
                                      href={`tel:${c.extracted_phone}`}
                                      className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono hover:bg-emerald-500/20"
                                      title={`Call ${c.extracted_phone}`}
                                    >
                                      <Phone className="w-2.5 h-2.5" />
                                      <span>{c.extracted_phone}</span>
                                    </a>
                                  )}
                                  {c.extracted_email && (
                                    <a
                                      href={`mailto:${c.extracted_email}`}
                                      className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/30 text-[10px] font-mono hover:bg-sky-500/20"
                                      title={`Email ${c.extracted_email}`}
                                    >
                                      <Mail className="w-2.5 h-2.5" />
                                      <span className="max-w-[110px] truncate">{c.extracted_email}</span>
                                    </a>
                                  )}
                                  {c.extracted_link && (
                                    <a
                                      href={c.extracted_link}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 text-[10px] hover:bg-indigo-500/20"
                                      title={`Visit ${c.extracted_link}`}
                                    >
                                      <Link2 className="w-2.5 h-2.5" />
                                      <span className="max-w-[100px] truncate">{c.extracted_link.replace(/^https?:\/\//, '')}</span>
                                    </a>
                                  )}
                                </div>

                                {c.auto_reply_message && (
                                  <button
                                    onClick={() => setViewingAutoReplyContact(c)}
                                    className="inline-flex items-center space-x-1 text-[10px] font-semibold text-purple-400 hover:text-purple-300 hover:underline pt-0.5 cursor-pointer"
                                  >
                                    <Eye className="w-2.5 h-2.5" />
                                    <span>View captured reply</span>
                                  </button>
                                )}
                              </div>
                            )}

                            {c.replied_status === 'DM_RESTRICTED' && (
                              <div className="mt-2 space-y-1">
                                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                  <ShieldAlert className="w-3 h-3 text-amber-400" />
                                  <span>DM Restricted</span>
                                </span>
                                {c.auto_reply_message && (
                                  <div 
                                    onClick={() => setViewingAutoReplyContact(c)}
                                    className="text-[10px] text-amber-300/80 line-clamp-1 italic cursor-pointer hover:underline"
                                    title={c.auto_reply_message}
                                  >
                                    "{c.auto_reply_message}"
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 1st Message Tracking */}
                      <td className="py-4 px-4 align-top space-y-2">
                        <div className="flex items-center space-x-1.5 flex-wrap gap-1">
                          <span
                            className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              is1stSent
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm shadow-emerald-500/10'
                                : c.first_message_status === 'READY'
                                ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                                : c.first_message_status === 'RETRY_WAIT'
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                : 'bg-gray-800 text-gray-400 border border-gray-700'
                            }`}
                          >
                            {is1stSent ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Clock className="w-3 h-3 text-sky-400" />}
                            <span>{c.first_message_status || 'READY'}</span>
                          </span>

                          {nextInfo && nextInfo.taskType === 'MESSAGE' && (
                            <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/25 text-amber-300 border border-amber-400/50 animate-pulse">
                              <Zap className="w-2.5 h-2.5" />
                              <span>Next Up</span>
                            </span>
                          )}
                        </div>

                        {/* Sent Timestamp */}
                        {c.first_message_sent_at ? (
                          <div className="text-[11px] text-emerald-300/95 font-mono font-medium flex items-center space-x-1">
                            <Clock className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>{formatDisplayDate(c.first_message_sent_at)}</span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-gray-500 italic flex items-center space-x-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-600 inline-block" />
                            <span>Not dispatched yet</span>
                          </div>
                        )}

                        {/* Message Preview */}
                        <div 
                          className="text-[11px] text-gray-300 font-sans line-clamp-2 bg-gray-950/70 p-2 rounded-xl border border-gray-800/90 shadow-inner"
                          title={c.message || c.custom_message || 'Hey'}
                        >
                          "{c.message || c.custom_message || 'Hey'}"
                        </div>
                      </td>

                      {/* Follow-Up 1 Tracking */}
                      <td className="py-4 px-4 align-top space-y-2">
                        <div className="flex items-center space-x-1.5 flex-wrap gap-1">
                          <span
                            className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              isFu1Sent
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                : isFu1Scheduled
                                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-sm shadow-indigo-500/10'
                                : 'bg-gray-800/70 text-gray-500 border border-gray-700'
                            }`}
                          >
                            {isFu1Sent ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Calendar className="w-3 h-3 text-indigo-400" />}
                            <span>{c.followup_1_status || 'NOT_SCHEDULED'}</span>
                          </span>

                          {nextInfo && nextInfo.taskType === 'FOLLOW_UP_1' && (
                            <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/25 text-amber-300 border border-amber-400/50 animate-pulse">
                              <Zap className="w-2.5 h-2.5" />
                              <span>Next Up</span>
                            </span>
                          )}
                        </div>

                        {/* Follow-up 1 Timestamps */}
                        {isFu1Sent && c.followup_1_sent_at ? (
                          <div className="text-[11px] text-emerald-300/95 font-mono font-medium flex items-center space-x-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>Sent: {formatDisplayDate(c.followup_1_sent_at)}</span>
                          </div>
                        ) : c.followup_1_scheduled_at ? (
                          <div className="text-[11px] text-indigo-300/95 font-mono font-medium flex items-center space-x-1">
                            <Clock className="w-3 h-3 text-indigo-400 shrink-0" />
                            <span>Due: {formatDisplayDate(c.followup_1_scheduled_at)}</span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-gray-500 italic">
                            Auto-triggers 3 days after 1st msg
                          </div>
                        )}

                        {/* FU1 Message Preview */}
                        <div 
                          className="text-[11px] text-indigo-200/90 font-sans line-clamp-2 bg-indigo-950/20 p-2 rounded-xl border border-indigo-900/40"
                          title={c.followup_1_message || 'Hey! Following up on my previous message.'}
                        >
                          "{c.followup_1_message || 'Hey! Following up on my previous message.'}"
                        </div>
                      </td>

                      {/* Follow-Up 2 Tracking */}
                      <td className="py-4 px-4 align-top space-y-2">
                        <div className="flex items-center space-x-1.5 flex-wrap gap-1">
                          <span
                            className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              isFu2Sent
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                : isFu2Scheduled
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm shadow-purple-500/10'
                                : 'bg-gray-800/70 text-gray-500 border border-gray-700'
                            }`}
                          >
                            {isFu2Sent ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Calendar className="w-3 h-3 text-purple-400" />}
                            <span>{c.followup_2_status || 'NOT_SCHEDULED'}</span>
                          </span>

                          {nextInfo && nextInfo.taskType === 'FOLLOW_UP_2' && (
                            <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/25 text-amber-300 border border-amber-400/50 animate-pulse">
                              <Zap className="w-2.5 h-2.5" />
                              <span>Next Up</span>
                            </span>
                          )}
                        </div>

                        {/* Follow-up 2 Timestamps */}
                        {isFu2Sent && c.followup_2_sent_at ? (
                          <div className="text-[11px] text-emerald-300/95 font-mono font-medium flex items-center space-x-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>Sent: {formatDisplayDate(c.followup_2_sent_at)}</span>
                          </div>
                        ) : c.followup_2_scheduled_at ? (
                          <div className="text-[11px] text-purple-300/95 font-mono font-medium flex items-center space-x-1">
                            <Clock className="w-3 h-3 text-purple-400 shrink-0" />
                            <span>Due: {formatDisplayDate(c.followup_2_scheduled_at)}</span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-gray-500 italic">
                            Auto-triggers 5 days after FU1
                          </div>
                        )}

                        {/* FU2 Message Preview */}
                        <div 
                          className="text-[11px] text-purple-200/90 font-sans line-clamp-2 bg-purple-950/20 p-2 rounded-xl border border-purple-900/40"
                          title={c.followup_2_message || 'Hey! One last quick check-in before I close this thread.'}
                        >
                          "{c.followup_2_message || 'Hey! One last quick check-in before I close this thread.'}"
                        </div>
                      </td>

                      {/* Replied Toggle */}
                      <td className="py-4 px-3 align-top text-center space-y-1.5">
                        <button
                          onClick={() => handleToggleReplied(c)}
                          disabled={loadingContactId === c.id}
                          className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition shadow-sm cursor-pointer ${
                            c.replied_status === 'AUTOMATED_MESSAGE'
                              ? 'bg-purple-500/20 border-purple-500/50 text-purple-300 hover:bg-purple-500/30'
                              : c.replied_status === 'DM_RESTRICTED'
                              ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 hover:bg-amber-500/30'
                              : c.has_replied
                              ? 'bg-rose-500/20 border-rose-500/50 text-rose-300 shadow-rose-500/20 hover:bg-rose-500/30'
                              : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-700'
                          }`}
                          title={c.has_replied ? 'Click to toggle reply status' : 'Click to mark lead as replied'}
                        >
                          {c.replied_status === 'AUTOMATED_MESSAGE' ? (
                            <>
                              <Bot className="w-3.5 h-3.5 text-purple-400" />
                              <span>Auto-Reply</span>
                            </>
                          ) : c.replied_status === 'DM_RESTRICTED' ? (
                            <>
                              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                              <span>Restricted</span>
                            </>
                          ) : c.has_replied ? (
                            <>
                              <Sparkles className="w-3.5 h-3.5 text-rose-400" />
                              <span>Replied</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5 text-gray-500" />
                              <span>No Reply</span>
                            </>
                          )}
                        </button>

                        {/* Checked / Replied Timestamp Indicator */}
                        {c.reply_detected_at ? (
                          <div className="text-[10px] text-purple-300/90 font-mono">
                            {formatDisplayDate(c.reply_detected_at)}
                          </div>
                        ) : c.last_checked_reply_at ? (
                          <div className="text-[10px] text-gray-500 font-mono" title={`Checked on ${formatDisplayDate(c.last_checked_reply_at)}`}>
                            Checked {formatDisplayDate(c.last_checked_reply_at)}
                          </div>
                        ) : null}
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-4 align-top text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          <button
                            onClick={() => handleOpenEditContact(c)}
                            className="inline-flex items-center space-x-1 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition hover:scale-105 active:scale-95 cursor-pointer shadow-sm"
                            title="Edit message templates for this contact"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            onClick={() => handleDeleteContact(c)}
                            disabled={loadingContactId === c.id}
                            className="inline-flex items-center space-x-1 bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition hover:scale-105 active:scale-95 cursor-pointer shadow-sm disabled:opacity-50"
                            title="Delete contact and associated tasks"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-gray-400">
                    <div className="max-w-sm mx-auto space-y-2">
                      <Users className="w-8 h-8 text-gray-600 mx-auto" />
                      <div className="font-bold text-white text-sm">No contacts found</div>
                      <p className="text-xs text-gray-500">
                        No contacts match your active search term and filters. Try clearing your search or filters.
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
              <span className="text-white font-semibold">{totalFiltered}</span> contacts
              {totalFiltered !== totalContacts && (
                <span className="text-gray-500 ml-1"> (filtered from {totalContacts} total)</span>
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

      {/* Edit Single Contact Messages Modal */}
      {editingContact && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700/80 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3.5">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                  <Edit3 className="w-4 h-4 text-indigo-400" />
                  <span>Customize Outreach Sequence</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Target: <span className="text-white font-semibold">{editingContact.name || 'Recipient'}</span> (@{editingContact.username})
                </p>
              </div>
              <button
                onClick={() => setEditingContact(null)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition"
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

            <form onSubmit={handleSaveContactMessages} className="space-y-4 text-xs">
              {/* 1st Message - Emerald Theme */}
              <div className="bg-emerald-950/15 border border-emerald-500/25 p-3.5 rounded-xl space-y-1.5">
                <label className="block text-emerald-300 font-bold flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <Send className="w-3.5 h-3.5 text-emerald-400" />
                    <span>1. Initial Outreach (1st Message)</span>
                  </span>
                  <span className="text-gray-500 font-normal">Sent during initial batch</span>
                </label>
                <textarea
                  rows={3}
                  value={editForm.message}
                  onChange={(e) => setEditForm({ ...editForm, message: e.target.value })}
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
                  <span className="text-gray-500 font-normal">Default delay: {editForm.followup_1_delay_days} days after initial outreach</span>
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
                  <span className="text-gray-500 font-normal">Default delay: {editForm.followup_2_delay_days} days after Follow-Up 1</span>
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
                  onClick={() => setEditingContact(null)}
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

      {/* Global Templates Modal */}
      {isTemplateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700/80 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3.5">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                  <Sliders className="w-5 h-5 text-indigo-400" />
                  <span>Outreach Sequence Templates & Timing</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Configure default outreach copy and automated follow-up intervals for all contacts.
                </p>
              </div>
              <button
                onClick={() => setIsTemplateModalOpen(false)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {templateSuccessMsg && (
              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-400 text-xs font-bold flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>{templateSuccessMsg}</span>
              </div>
            )}

            <form onSubmit={handleSaveTemplates} className="space-y-4 text-xs">
              <div className="bg-emerald-950/15 border border-emerald-500/25 p-3.5 rounded-xl space-y-1.5">
                <label className="block text-emerald-300 font-bold flex items-center space-x-1.5">
                  <Send className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Default 1st Outreach Message</span>
                </label>
                <textarea
                  rows={3}
                  value={templateForm.default_message}
                  onChange={(e) => setTemplateForm({ ...templateForm, default_message: e.target.value })}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:outline-none focus:border-emerald-500 resize-none font-sans"
                />
              </div>

              <div className="bg-indigo-950/15 border border-indigo-500/25 p-3.5 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-indigo-300 font-bold flex items-center space-x-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Follow-Up 1 Default Message</span>
                  </label>
                  <div className="flex items-center space-x-1.5">
                    <span className="text-gray-400 text-[11px]">Interval:</span>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={templateForm.followup_1_delay_days}
                      onChange={(e) => setTemplateForm({ ...templateForm, followup_1_delay_days: parseInt(e.target.value, 10) || 3 })}
                      className="w-16 bg-gray-950 border border-gray-800 rounded px-2 py-0.5 text-white font-mono text-center focus:outline-none focus:border-indigo-500"
                    />
                    <span className="text-gray-400 text-[11px]">days</span>
                  </div>
                </div>
                <textarea
                  rows={2}
                  value={templateForm.followup_1_message}
                  onChange={(e) => setTemplateForm({ ...templateForm, followup_1_message: e.target.value })}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 resize-none font-sans"
                />
              </div>

              <div className="bg-purple-950/15 border border-purple-500/25 p-3.5 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-purple-300 font-bold flex items-center space-x-1.5">
                    <Calendar className="w-3.5 h-3.5 text-purple-400" />
                    <span>Follow-Up 2 Default Message</span>
                  </label>
                  <div className="flex items-center space-x-1.5">
                    <span className="text-gray-400 text-[11px]">Interval:</span>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={templateForm.followup_2_delay_days}
                      onChange={(e) => setTemplateForm({ ...templateForm, followup_2_delay_days: parseInt(e.target.value, 10) || 5 })}
                      className="w-16 bg-gray-950 border border-gray-800 rounded px-2 py-0.5 text-white font-mono text-center focus:outline-none focus:border-purple-500"
                    />
                    <span className="text-gray-400 text-[11px]">days</span>
                  </div>
                </div>
                <textarea
                  rows={2}
                  value={templateForm.followup_2_message}
                  onChange={(e) => setTemplateForm({ ...templateForm, followup_2_message: e.target.value })}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:outline-none focus:border-purple-500 resize-none font-sans"
                />
              </div>

              {/* Options */}
              <div className="space-y-2.5 p-3.5 rounded-xl bg-gray-950/90 border border-gray-800">
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="apply_to_all"
                    checked={templateForm.apply_to_all}
                    onChange={(e) => setTemplateForm({ ...templateForm, apply_to_all: e.target.checked })}
                    className="w-4 h-4 rounded text-indigo-600 bg-gray-900 border-gray-700 focus:ring-0 cursor-pointer"
                  />
                  <label htmlFor="apply_to_all" className="text-gray-300 font-semibold cursor-pointer">
                    Apply template text & delay intervals across all contacts
                  </label>
                </div>

                <div className="flex items-center space-x-3 pt-2 border-t border-gray-800/80">
                  <input
                    type="checkbox"
                    id="reschedule_existing"
                    checked={templateForm.reschedule_existing}
                    onChange={(e) => setTemplateForm({ ...templateForm, reschedule_existing: e.target.checked })}
                    className="w-4 h-4 rounded text-indigo-600 bg-gray-900 border-gray-700 focus:ring-0 cursor-pointer"
                  />
                  <label htmlFor="reschedule_existing" className="text-indigo-300 font-semibold cursor-pointer">
                    Recalculate & reschedule all pending/queued follow-up tasks using new intervals
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-gray-800">
                <button
                  type="button"
                  onClick={() => setIsTemplateModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-white hover:bg-gray-800 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingTemplates}
                  className="flex items-center space-x-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-5 py-2 rounded-xl text-xs font-bold transition shadow-lg cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingTemplates ? 'Applying...' : 'Apply Templates'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Captured Auto-Reply & Contact Details Modal */}
      {viewingAutoReplyContact && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700/80 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-gray-800 pb-3.5">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-purple-500 to-indigo-600 p-[1.5px] shrink-0">
                  <div className="w-full h-full rounded-full bg-gray-950 flex items-center justify-center text-xs font-bold text-white">
                    {(viewingAutoReplyContact.name || viewingAutoReplyContact.username || 'U').substring(0, 2).toUpperCase()}
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center space-x-2">
                    <span>{viewingAutoReplyContact.name || viewingAutoReplyContact.username}</span>
                    <span className="text-xs text-gray-400 font-mono font-normal">(@{viewingAutoReplyContact.username})</span>
                  </h3>
                  <div className="flex items-center space-x-2 mt-0.5">
                    {viewingAutoReplyContact.replied_status === 'AUTOMATED_MESSAGE' ? (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
                        <Bot className="w-3 h-3 text-purple-400" />
                        <span>Automated System Response</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        <ShieldAlert className="w-3 h-3 text-amber-400" />
                        <span>DM Delivery Restriction</span>
                      </span>
                    )}
                    {viewingAutoReplyContact.reply_detected_at && (
                      <span className="text-[11px] text-gray-400 font-mono">
                        Captured: {formatDisplayDate(viewingAutoReplyContact.reply_detected_at)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setViewingAutoReplyContact(null)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Message Content */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-300 flex items-center space-x-1.5">
                <MessageCircle className="w-3.5 h-3.5 text-indigo-400" />
                <span>Full Captured Message Bubble</span>
              </label>
              <div className="bg-gray-950 p-4 rounded-xl border border-gray-800 text-gray-200 text-xs font-sans whitespace-pre-wrap leading-relaxed shadow-inner max-h-48 overflow-y-auto">
                {viewingAutoReplyContact.auto_reply_message || 'No text captured.'}
              </div>
            </div>

            {/* Extracted Contact Assets */}
            {(viewingAutoReplyContact.extracted_phone || viewingAutoReplyContact.extracted_email || viewingAutoReplyContact.extracted_link) && (
              <div className="space-y-2 bg-gray-950/70 p-3.5 rounded-xl border border-gray-800">
                <label className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Extracted Contact Info</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {viewingAutoReplyContact.extracted_phone && (
                    <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                      <span className="flex items-center space-x-1.5">
                        <Phone className="w-3.5 h-3.5" />
                        <span className="font-mono font-semibold">{viewingAutoReplyContact.extracted_phone}</span>
                      </span>
                      <a
                        href={`tel:${viewingAutoReplyContact.extracted_phone}`}
                        className="px-2 py-0.5 rounded bg-emerald-500 text-gray-950 font-bold text-[10px] hover:bg-emerald-400"
                      >
                        Call
                      </a>
                    </div>
                  )}
                  {viewingAutoReplyContact.extracted_email && (
                    <div className="flex items-center justify-between p-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-300">
                      <span className="flex items-center space-x-1.5 truncate mr-2">
                        <Mail className="w-3.5 h-3.5 shrink-0" />
                        <span className="font-mono font-semibold truncate">{viewingAutoReplyContact.extracted_email}</span>
                      </span>
                      <a
                        href={`mailto:${viewingAutoReplyContact.extracted_email}`}
                        className="px-2 py-0.5 rounded bg-sky-500 text-gray-950 font-bold text-[10px] hover:bg-sky-400 shrink-0"
                      >
                        Email
                      </a>
                    </div>
                  )}
                  {viewingAutoReplyContact.extracted_link && (
                    <div className="sm:col-span-2 flex items-center justify-between p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-300">
                      <span className="flex items-center space-x-1.5 truncate mr-2">
                        <Link2 className="w-3.5 h-3.5 shrink-0" />
                        <span className="font-mono truncate">{viewingAutoReplyContact.extracted_link}</span>
                      </span>
                      <a
                        href={viewingAutoReplyContact.extracted_link}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2 py-0.5 rounded bg-indigo-500 text-white font-bold text-[10px] hover:bg-indigo-400 shrink-0"
                      >
                        Open
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Safety Notice */}
            <div className="text-[11px] text-gray-400 bg-gray-950/40 p-3 rounded-xl border border-gray-800/80 flex items-start space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                Outreach automation sequence has been paused for this contact to prevent sending irrelevant follow-ups.
              </span>
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-800">
              <a
                href={viewingAutoReplyContact.instagram_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center space-x-1 text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
              >
                <span>Open Instagram Profile</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
              <button
                onClick={() => setViewingAutoReplyContact(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-white transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
