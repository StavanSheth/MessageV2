import React, { useState, useMemo } from 'react';
import { 
  Search, ExternalLink, Check, Download, Edit3, X, Save, Clock, 
  CheckCircle2, Calendar, Send, Sliders, RefreshCw, Users, 
  Sparkles, MessageSquare, ChevronLeft, ChevronRight, ArrowUpRight
} from 'lucide-react';
import { Contact } from '../types';
import { 
  toggleReplied, 
  updateContactMessages, 
  fetchMessageTemplates, 
  applyBulkTemplates 
} from '../services/api';

interface ContactsProps {
  contacts: Contact[];
  onRefresh: () => void;
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

export const Contacts: React.FC<ContactsProps> = ({ contacts, onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [repliedFilter, setRepliedFilter] = useState<'all' | 'replied' | 'unreplied'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'sent' | 'scheduled' | 'pending'>('all');
  const [loadingContactId, setLoadingContactId] = useState<string | null>(null);

  // Pagination state
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Edit Single Contact Modal State
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [editForm, setEditForm] = useState({
    message: '',
    followup_1_message: '',
    followup_2_message: '',
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editSuccessMsg, setEditSuccessMsg] = useState('');

  // Bulk Template Modal State
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState({
    default_message: '',
    followup_1_message: '',
    followup_2_message: '',
    apply_to_all: true,
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
        followup_2_message: t.followup_2_message || "Hey! One final quick check-in — let me know if you'd like more details.",
        apply_to_all: true,
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
      await applyBulkTemplates(templateForm);
      setTemplateSuccessMsg('Templates applied successfully!');
      onRefresh();
      setTimeout(() => {
        setIsTemplateModalOpen(false);
        setTemplateSuccessMsg('');
      }, 1200);
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
      followup_2_message: c.followup_2_message || 'Hey! One last quick check-in before I close this thread.',
    });
    setEditSuccessMsg('');
  };

  const handleSaveContactMessages = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContact) return;
    setIsSavingEdit(true);
    setEditSuccessMsg('');
    try {
      await updateContactMessages(editingContact.id, editForm);
      setEditSuccessMsg('Messages updated successfully!');
      onRefresh();
      setTimeout(() => {
        setEditingContact(null);
        setEditSuccessMsg('');
      }, 1000);
    } catch (err: any) {
      alert(`Error updating messages: ${err.message}`);
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

  // Filter contacts
  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        (c.name || '').toLowerCase().includes(term) ||
        (c.username || '').toLowerCase().includes(term) ||
        (c.message || '').toLowerCase().includes(term) ||
        (c.custom_message || '').toLowerCase().includes(term);

      if (!matchesSearch) return false;

      if (repliedFilter === 'replied' && !c.has_replied) return false;
      if (repliedFilter === 'unreplied' && c.has_replied) return false;

      if (statusFilter === 'sent' && c.first_message_status !== 'SENT') return false;
      if (statusFilter === 'scheduled' && c.followup_1_status !== 'SCHEDULED' && c.followup_2_status !== 'SCHEDULED') return false;
      if (statusFilter === 'pending' && c.first_message_status === 'SENT') return false;

      return true;
    });
  }, [contacts, searchTerm, repliedFilter, statusFilter]);

  // Handle page resets on filter/search change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, repliedFilter, statusFilter, pageSize]);

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
  const repliedCount = contacts.filter((c) => c.has_replied).length;

  return (
    <div className="space-y-6">
      {/* Top Header & Global Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-gradient-to-r from-gray-900/90 via-[#0f172a]/90 to-gray-900/90 border border-gray-800/80 p-5 rounded-2xl shadow-xl backdrop-blur-md">
        <div>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <Users className="w-5 h-5 text-white" />
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

      {/* Metric Cards Banner - Semantic Color System */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* Total Leads */}
        <div className="bg-[#0f172a]/70 border border-gray-800 rounded-xl p-3.5 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Total Leads</span>
            <span className="text-2xl font-black text-white mt-1 block">{totalContacts}</span>
            <span className="text-[10px] text-gray-500 mt-0.5 block">Imported Lead Pool</span>
          </div>
          <div className="w-9 h-9 rounded-lg bg-gray-800/80 border border-gray-700 flex items-center justify-center">
            <Users className="w-4 h-4 text-gray-300" />
          </div>
        </div>

        {/* 1st Message Sent - Emerald */}
        <div className="bg-emerald-950/25 border border-emerald-500/30 rounded-xl p-3.5 flex items-center justify-between shadow-sm shadow-emerald-950/30">
          <div>
            <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block">1st Outreach Sent</span>
            <span className="text-2xl font-black text-emerald-300 mt-1 block">{firstSentCount}</span>
            <span className="text-[10px] text-emerald-500/80 mt-0.5 block">
              {totalContacts > 0 ? `${Math.round((firstSentCount / totalContacts) * 100)}% dispatched` : '0%'}
            </span>
          </div>
          <div className="w-9 h-9 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
            <Send className="w-4 h-4 text-emerald-400" />
          </div>
        </div>

        {/* Follow-Up 1 - Indigo */}
        <div className="bg-indigo-950/25 border border-indigo-500/30 rounded-xl p-3.5 flex items-center justify-between shadow-sm shadow-indigo-950/30">
          <div>
            <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider block">FU 1 Active (+3d)</span>
            <span className="text-2xl font-black text-indigo-300 mt-1 block">{fu1ScheduledCount}</span>
            <span className="text-[10px] text-indigo-400/80 mt-0.5 block">Scheduled / Sent</span>
          </div>
          <div className="w-9 h-9 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
            <Clock className="w-4 h-4 text-indigo-400" />
          </div>
        </div>

        {/* Follow-Up 2 - Purple */}
        <div className="bg-purple-950/25 border border-purple-500/30 rounded-xl p-3.5 flex items-center justify-between shadow-sm shadow-purple-950/30">
          <div>
            <span className="text-[10px] text-purple-400 font-bold uppercase tracking-wider block">FU 2 Active (+5d)</span>
            <span className="text-2xl font-black text-purple-300 mt-1 block">{fu2ScheduledCount}</span>
            <span className="text-[10px] text-purple-400/80 mt-0.5 block">Scheduled / Sent</span>
          </div>
          <div className="w-9 h-9 rounded-lg bg-purple-500/20 border border-purple-500/40 flex items-center justify-center">
            <Calendar className="w-4 h-4 text-purple-400" />
          </div>
        </div>

        {/* Replied Leads - Rose / Warm Conversion */}
        <div className="bg-rose-950/25 border border-rose-500/35 rounded-xl p-3.5 flex items-center justify-between shadow-sm shadow-rose-950/30">
          <div>
            <span className="text-[10px] text-rose-400 font-bold uppercase tracking-wider block">Replied Leads</span>
            <span className="text-2xl font-black text-rose-300 mt-1 block">{repliedCount}</span>
            <span className="text-[10px] text-rose-400/80 mt-0.5 block">
              {firstSentCount > 0 ? `${Math.round((repliedCount / firstSentCount) * 100)}% reply rate` : '0%'}
            </span>
          </div>
          <div className="w-9 h-9 rounded-lg bg-rose-500/20 border border-rose-500/40 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-rose-400" />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-[#0f172a]/80 p-3 rounded-2xl border border-gray-800 backdrop-blur-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by name, @handle, or message content..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-950/90 border border-gray-800 rounded-xl pl-9 pr-8 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Status Filter */}
          <div className="flex items-center rounded-xl bg-gray-950/90 border border-gray-800 p-1">
            <span className="text-[10px] text-gray-500 uppercase font-bold px-2 hidden sm:inline">Status:</span>
            {(['all', 'sent', 'scheduled', 'pending'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setStatusFilter(mode)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition cursor-pointer ${
                  statusFilter === mode
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {mode === 'all' ? 'All' : mode}
              </button>
            ))}
          </div>

          {/* Replied Filter */}
          <div className="flex items-center rounded-xl bg-gray-950/90 border border-gray-800 p-1">
            <span className="text-[10px] text-gray-500 uppercase font-bold px-2 hidden sm:inline">Replies:</span>
            {(['all', 'replied', 'unreplied'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setRepliedFilter(mode)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition cursor-pointer ${
                  repliedFilter === mode
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {mode === 'all' ? 'All' : mode === 'replied' ? 'Replied' : 'Pending'}
              </button>
            ))}
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
            </select>
          </div>
        </div>
      </div>

      {/* Main Contacts Table */}
      <div className="bg-[#0f172a]/70 border border-gray-800/90 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[960px]">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-950/90 text-[11px] font-bold uppercase tracking-wider">
                <th className="py-3.5 px-4 text-gray-400 w-[20%]">
                  <span className="flex items-center space-x-1.5">
                    <Users className="w-3.5 h-3.5 text-gray-400" />
                    <span>Contact Profile</span>
                  </span>
                </th>
                <th className="py-3.5 px-4 text-emerald-400/90 w-[23%]">
                  <span className="flex items-center space-x-1.5">
                    <Send className="w-3.5 h-3.5 text-emerald-400" />
                    <span>1. Initial Outreach</span>
                  </span>
                </th>
                <th className="py-3.5 px-4 text-indigo-400/90 w-[23%]">
                  <span className="flex items-center space-x-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-400" />
                    <span>2. Follow-Up 1 (+3d)</span>
                  </span>
                </th>
                <th className="py-3.5 px-4 text-purple-400/90 w-[23%]">
                  <span className="flex items-center space-x-1.5">
                    <Calendar className="w-3.5 h-3.5 text-purple-400" />
                    <span>3. Follow-Up 2 (+5d)</span>
                  </span>
                </th>
                <th className="py-3.5 px-3 text-rose-400/90 text-center w-[11%]">
                  <span className="flex items-center justify-center space-x-1">
                    <Sparkles className="w-3.5 h-3.5 text-rose-400" />
                    <span>Reply</span>
                  </span>
                </th>
                <th className="py-3.5 px-4 text-gray-400 text-right w-[10%]">Action</th>
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

                  return (
                    <tr key={c.id} className="hover:bg-gray-800/35 transition-colors group">
                      {/* Name & Username & IG Link */}
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
                            <a
                              href={c.instagram_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center space-x-1 text-indigo-400 hover:text-indigo-300 font-medium text-[11px] mt-1.5 transition group-hover:underline"
                            >
                              <span>View Profile</span>
                              <ArrowUpRight className="w-3 h-3 shrink-0" />
                            </a>
                          </div>
                        </div>
                      </td>

                      {/* 1st Message Tracking */}
                      <td className="py-4 px-4 align-top space-y-2">
                        <div className="flex items-center space-x-1.5">
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
                        <div className="flex items-center space-x-1.5">
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
                        <div className="flex items-center space-x-1.5">
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
                      <td className="py-4 px-3 align-top text-center">
                        <button
                          onClick={() => handleToggleReplied(c)}
                          disabled={loadingContactId === c.id}
                          className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition shadow-sm cursor-pointer ${
                            c.has_replied
                              ? 'bg-rose-500/20 border-rose-500/50 text-rose-300 shadow-rose-500/20 hover:bg-rose-500/30'
                              : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-700'
                          }`}
                          title={c.has_replied ? 'Click to mark as unreplied' : 'Click to mark lead as replied'}
                        >
                          {c.has_replied ? (
                            <>
                              <Sparkles className="w-3.5 h-3.5 text-rose-400" />
                              <span>Replied</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5 text-gray-500" />
                              <span>Mark Replied</span>
                            </>
                          )}
                        </button>
                      </td>

                      {/* Edit Messages Action */}
                      <td className="py-4 px-4 align-top text-right">
                        <button
                          onClick={() => handleOpenEditContact(c)}
                          className="inline-flex items-center space-x-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 px-3 py-1.5 rounded-xl text-xs font-semibold transition hover:scale-105 active:scale-95 cursor-pointer shadow-sm"
                          title="Edit 1st message and follow-up templates for this contact"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
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
              <div className="bg-indigo-950/15 border border-indigo-500/25 p-3.5 rounded-xl space-y-1.5">
                <label className="block text-indigo-300 font-bold flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-400" />
                    <span>2. Follow-Up 1 (+3 Days)</span>
                  </span>
                  <span className="text-gray-500 font-normal">Dispatches if no reply after 3 days</span>
                </label>
                <textarea
                  rows={2}
                  value={editForm.followup_1_message}
                  onChange={(e) => setEditForm({ ...editForm, followup_1_message: e.target.value })}
                  placeholder="Enter Follow-Up 1 message..."
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 resize-none font-sans"
                />
              </div>

              {/* Follow-Up 2 - Purple Theme */}
              <div className="bg-purple-950/15 border border-purple-500/25 p-3.5 rounded-xl space-y-1.5">
                <label className="block text-purple-300 font-bold flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <Calendar className="w-3.5 h-3.5 text-purple-400" />
                    <span>3. Follow-Up 2 (+5 Days)</span>
                  </span>
                  <span className="text-gray-500 font-normal">Dispatches if still no reply after 5 days</span>
                </label>
                <textarea
                  rows={2}
                  value={editForm.followup_2_message}
                  onChange={(e) => setEditForm({ ...editForm, followup_2_message: e.target.value })}
                  placeholder="Enter Follow-Up 2 message..."
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:outline-none focus:border-purple-500 resize-none font-sans"
                />
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
                  <span>{isSavingEdit ? 'Saving...' : 'Save Sequence'}</span>
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
                  <span>Outreach Sequence Templates</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Configure default outreach copy for initial messages and automated follow-ups.
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

              <div className="bg-indigo-950/15 border border-indigo-500/25 p-3.5 rounded-xl space-y-1.5">
                <label className="block text-indigo-300 font-bold flex items-center space-x-1.5">
                  <Clock className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Follow-Up 1 Default Message (+3 Days)</span>
                </label>
                <textarea
                  rows={2}
                  value={templateForm.followup_1_message}
                  onChange={(e) => setTemplateForm({ ...templateForm, followup_1_message: e.target.value })}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 resize-none font-sans"
                />
              </div>

              <div className="bg-purple-950/15 border border-purple-500/25 p-3.5 rounded-xl space-y-1.5">
                <label className="block text-purple-300 font-bold flex items-center space-x-1.5">
                  <Calendar className="w-3.5 h-3.5 text-purple-400" />
                  <span>Follow-Up 2 Default Message (+5 Days)</span>
                </label>
                <textarea
                  rows={2}
                  value={templateForm.followup_2_message}
                  onChange={(e) => setTemplateForm({ ...templateForm, followup_2_message: e.target.value })}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:outline-none focus:border-purple-500 resize-none font-sans"
                />
              </div>

              <div className="p-3.5 rounded-xl bg-gray-950/90 border border-gray-800 flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="apply_to_all"
                  checked={templateForm.apply_to_all}
                  onChange={(e) => setTemplateForm({ ...templateForm, apply_to_all: e.target.checked })}
                  className="w-4 h-4 rounded text-indigo-600 bg-gray-900 border-gray-700 focus:ring-0 cursor-pointer"
                />
                <label htmlFor="apply_to_all" className="text-gray-300 font-semibold cursor-pointer">
                  Apply to all contacts in database (overwrites custom templates)
                </label>
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
    </div>
  );
};
