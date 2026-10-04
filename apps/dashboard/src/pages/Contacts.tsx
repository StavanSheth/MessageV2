import React, { useState, useEffect } from 'react';
import { 
  Search, ExternalLink, Check, MessageSquare, ShieldCheck, 
  Download, Edit3, X, Save, Clock, CheckCircle2, Calendar, 
  Send, Sliders, AlertCircle, RefreshCw, ChevronDown
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

export const Contacts: React.FC<ContactsProps> = ({ contacts, onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [repliedFilter, setRepliedFilter] = useState<'all' | 'replied' | 'unreplied'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'sent' | 'scheduled' | 'pending'>('all');
  const [loadingContactId, setLoadingContactId] = useState<string | null>(null);

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

  const filteredContacts = contacts.filter((c) => {
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

  // Calculate high-level stats
  const totalContacts = contacts.length;
  const firstSentCount = contacts.filter((c) => c.first_message_status === 'SENT').length;
  const fu1ScheduledCount = contacts.filter((c) => c.followup_1_status === 'SCHEDULED' || c.followup_1_status === 'SENT').length;
  const fu2ScheduledCount = contacts.filter((c) => c.followup_2_status === 'SCHEDULED' || c.followup_2_status === 'SENT').length;
  const repliedCount = contacts.filter((c) => c.has_replied).length;

  return (
    <div className="space-y-6">
      {/* Top Header & Stat Strip */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <h2 className="text-2xl font-black text-white tracking-tight">Contacts Directory & Outreach Tracking</h2>
            <span className="bg-indigo-500/20 text-indigo-400 font-mono text-xs px-2.5 py-0.5 rounded-full border border-indigo-500/30">
              {totalContacts} Leads
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Complete schedule, sent timestamps, and customizable message sequences for 1st message, Follow-Up 1, and Follow-Up 2.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleOpenTemplates}
            className="flex items-center space-x-2 bg-gray-800 hover:bg-gray-700 text-indigo-300 border border-indigo-500/30 px-3.5 py-2 rounded-xl text-xs font-bold transition shadow-sm hover:scale-105 active:scale-95"
            title="Edit default outreach sequence messages and apply across all contacts"
          >
            <Sliders className="w-4 h-4 text-indigo-400" />
            <span>Outreach Templates</span>
          </button>

          <a
            href="/api/contacts/export/excel"
            download
            className="flex items-center space-x-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-lg shadow-emerald-500/20 transition-all hover:scale-105 active:scale-95"
            title="Export complete table with 1st message, Follow-Up 1, and Follow-Up 2 day/time tracking into Excel"
          >
            <Download className="w-4 h-4" />
            <span>Export Excel (.xlsx)</span>
          </a>

          <button
            onClick={onRefresh}
            className="flex items-center space-x-1.5 bg-gray-900 border border-gray-700 text-gray-300 hover:text-white px-3 py-2 rounded-xl text-xs font-medium transition"
            title="Refresh contacts"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Metric Cards Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-gray-900/70 border border-gray-800 rounded-xl p-3">
          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Total Leads</span>
          <span className="text-xl font-extrabold text-white mt-1 block">{totalContacts}</span>
        </div>
        <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-3">
          <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block">1st Msg Sent</span>
          <span className="text-xl font-extrabold text-emerald-400 mt-1 block">{firstSentCount}</span>
        </div>
        <div className="bg-indigo-950/20 border border-indigo-500/30 rounded-xl p-3">
          <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider block">FU1 Active</span>
          <span className="text-xl font-extrabold text-indigo-400 mt-1 block">{fu1ScheduledCount}</span>
        </div>
        <div className="bg-purple-950/20 border border-purple-500/30 rounded-xl p-3">
          <span className="text-[10px] text-purple-400 font-bold uppercase tracking-wider block">FU2 Active</span>
          <span className="text-xl font-extrabold text-purple-400 mt-1 block">{fu2ScheduledCount}</span>
        </div>
        <div className="bg-pink-950/20 border border-pink-500/30 rounded-xl p-3">
          <span className="text-[10px] text-pink-400 font-bold uppercase tracking-wider block">Replied Leads</span>
          <span className="text-xl font-extrabold text-pink-400 mt-1 block">{repliedCount}</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-gray-900/60 p-3 rounded-2xl border border-gray-800">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by name, @handle, or message content..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-950 border border-gray-800 rounded-xl pl-9 pr-4 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter */}
          <div className="flex rounded-xl bg-gray-950 border border-gray-800 p-1">
            {(['all', 'sent', 'scheduled', 'pending'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setStatusFilter(mode)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
                  statusFilter === mode
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {mode === 'all' ? 'All Status' : mode}
              </button>
            ))}
          </div>

          {/* Replied Filter */}
          <div className="flex rounded-xl bg-gray-950 border border-gray-800 p-1">
            {(['all', 'unreplied', 'replied'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setRepliedFilter(mode)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
                  repliedFilter === mode
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {mode === 'all' ? 'All Replies' : mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Contacts Table */}
      <div className="bg-gray-900/80 border border-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-950/70 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                <th className="py-3.5 px-4">Contact</th>
                <th className="py-3.5 px-4 min-w-[220px]">1st Message & Timestamp</th>
                <th className="py-3.5 px-4 min-w-[220px]">Follow-Up 1 Tracking</th>
                <th className="py-3.5 px-4 min-w-[220px]">Follow-Up 2 Tracking</th>
                <th className="py-3.5 px-4 text-center">Reply</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60 text-xs">
              {filteredContacts.length > 0 ? (
                filteredContacts.map((c) => {
                  const is1stSent = c.first_message_status === 'SENT';
                  const isFu1Sent = c.followup_1_status === 'SENT';
                  const isFu1Scheduled = c.followup_1_status === 'SCHEDULED' || c.followup_1_status === 'READY';
                  const isFu2Sent = c.followup_2_status === 'SENT';
                  const isFu2Scheduled = c.followup_2_status === 'SCHEDULED' || c.followup_2_status === 'READY';

                  return (
                    <tr key={c.id} className="hover:bg-gray-800/40 transition-colors">
                      {/* Name & Username & IG Link */}
                      <td className="py-4 px-4 align-top">
                        <div className="font-bold text-white text-sm">{c.name || 'Recipient'}</div>
                        <div className="text-gray-400 font-mono text-xs mt-0.5">@{c.username}</div>
                        <a
                          href={c.instagram_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center space-x-1 text-indigo-400 hover:text-indigo-300 font-mono text-[11px] mt-1"
                        >
                          <span>Open IG Profile</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      </td>

                      {/* 1st Message Tracking */}
                      <td className="py-4 px-4 align-top space-y-1.5">
                        <div className="flex items-center space-x-1.5">
                          <span
                            className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              is1stSent
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : c.first_message_status === 'READY'
                                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                : c.first_message_status === 'RETRY_WAIT'
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                : 'bg-gray-800 text-gray-400 border border-gray-700'
                            }`}
                          >
                            {is1stSent ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                            <span>{c.first_message_status || 'READY'}</span>
                          </span>
                        </div>

                        {/* Sent Timestamp */}
                        {c.first_message_sent_at ? (
                          <div className="text-[11px] text-emerald-300/90 font-mono font-medium flex items-center space-x-1">
                            <Clock className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>{c.first_message_sent_at}</span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-gray-500 italic">Not sent yet</div>
                        )}

                        {/* Message Preview */}
                        <div className="text-[11px] text-gray-300 font-sans line-clamp-2 bg-gray-950/60 p-1.5 rounded-lg border border-gray-800/80">
                          "{c.message || c.custom_message || 'Hey'}"
                        </div>
                      </td>

                      {/* Follow-Up 1 Tracking */}
                      <td className="py-4 px-4 align-top space-y-1.5">
                        <div className="flex items-center space-x-1.5">
                          <span
                            className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              isFu1Sent
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : isFu1Scheduled
                                ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                                : 'bg-gray-800/70 text-gray-500 border border-gray-750'
                            }`}
                          >
                            <Calendar className="w-3 h-3" />
                            <span>{c.followup_1_status || 'NOT_SCHEDULED'}</span>
                          </span>
                        </div>

                        {/* Follow-up 1 Timestamps */}
                        {isFu1Sent && c.followup_1_sent_at ? (
                          <div className="text-[11px] text-emerald-300/90 font-mono font-medium flex items-center space-x-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>Sent: {c.followup_1_sent_at}</span>
                          </div>
                        ) : c.followup_1_scheduled_at ? (
                          <div className="text-[11px] text-indigo-300/90 font-mono font-medium flex items-center space-x-1">
                            <Calendar className="w-3 h-3 text-indigo-400 shrink-0" />
                            <span>Due: {c.followup_1_scheduled_at}</span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-gray-500 italic">Auto-triggers 3 days after 1st msg</div>
                        )}

                        {/* FU1 Message Preview */}
                        <div className="text-[11px] text-gray-400 font-sans line-clamp-1 bg-gray-950/40 p-1.5 rounded-lg border border-gray-800/60">
                          "{c.followup_1_message || 'Hey! Following up on my previous message.'}"
                        </div>
                      </td>

                      {/* Follow-Up 2 Tracking */}
                      <td className="py-4 px-4 align-top space-y-1.5">
                        <div className="flex items-center space-x-1.5">
                          <span
                            className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              isFu2Sent
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : isFu2Scheduled
                                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                                : 'bg-gray-800/70 text-gray-500 border border-gray-750'
                            }`}
                          >
                            <Calendar className="w-3 h-3" />
                            <span>{c.followup_2_status || 'NOT_SCHEDULED'}</span>
                          </span>
                        </div>

                        {/* Follow-up 2 Timestamps */}
                        {isFu2Sent && c.followup_2_sent_at ? (
                          <div className="text-[11px] text-emerald-300/90 font-mono font-medium flex items-center space-x-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>Sent: {c.followup_2_sent_at}</span>
                          </div>
                        ) : c.followup_2_scheduled_at ? (
                          <div className="text-[11px] text-purple-300/90 font-mono font-medium flex items-center space-x-1">
                            <Calendar className="w-3 h-3 text-purple-400 shrink-0" />
                            <span>Due: {c.followup_2_scheduled_at}</span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-gray-500 italic">Auto-triggers 5 days after FU1</div>
                        )}

                        {/* FU2 Message Preview */}
                        <div className="text-[11px] text-gray-400 font-sans line-clamp-1 bg-gray-950/40 p-1.5 rounded-lg border border-gray-800/60">
                          "{c.followup_2_message || 'Hey! One last quick check-in before I close this thread.'}"
                        </div>
                      </td>

                      {/* Replied Toggle */}
                      <td className="py-4 px-4 align-top text-center">
                        <button
                          onClick={() => handleToggleReplied(c)}
                          disabled={loadingContactId === c.id}
                          className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
                            c.has_replied
                              ? 'bg-purple-950/60 border-purple-500/50 text-purple-300'
                              : 'bg-gray-800/60 border-gray-700/60 text-gray-400 hover:text-gray-200'
                          }`}
                        >
                          <Check className={`w-3.5 h-3.5 ${c.has_replied ? 'text-purple-400' : 'text-gray-500'}`} />
                          <span>{c.has_replied ? 'Replied' : 'Mark Replied'}</span>
                        </button>
                      </td>

                      {/* Edit Messages Action */}
                      <td className="py-4 px-4 align-top text-right">
                        <button
                          onClick={() => handleOpenEditContact(c)}
                          className="inline-flex items-center space-x-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 px-3 py-1.5 rounded-lg text-xs font-semibold transition hover:scale-105 active:scale-95 cursor-pointer"
                          title="Edit 1st message and follow-up templates for this contact"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit Messages</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-500">
                    No contacts found matching the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Single Contact Messages Modal */}
      {editingContact && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700/80 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                  <Edit3 className="w-4 h-4 text-indigo-400" />
                  <span>Customize Outreach Sequence</span>
                </h3>
                <p className="text-xs text-gray-400">
                  Target: <span className="text-white font-semibold">{editingContact.name || 'Recipient'}</span> (@{editingContact.username})
                </p>
              </div>
              <button
                onClick={() => setEditingContact(null)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800"
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
              {/* 1st Message */}
              <div>
                <label className="block text-gray-300 font-bold mb-1 flex items-center justify-between">
                  <span>1. Initial Outreach (1st Message)</span>
                  <span className="text-gray-500 font-normal">Sent during initial batch</span>
                </label>
                <textarea
                  rows={3}
                  value={editForm.message}
                  onChange={(e) => setEditForm({ ...editForm, message: e.target.value })}
                  placeholder="Enter initial direct message..."
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 resize-none font-sans"
                />
              </div>

              {/* Follow-Up 1 */}
              <div>
                <label className="block text-indigo-300 font-bold mb-1 flex items-center justify-between">
                  <span>2. Follow-Up 1 (+3 Days)</span>
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

              {/* Follow-Up 2 */}
              <div>
                <label className="block text-purple-300 font-bold mb-1 flex items-center justify-between">
                  <span>3. Follow-Up 2 (+5 Days)</span>
                  <span className="text-gray-500 font-normal">Dispatches if still no reply after 5 days</span>
                </label>
                <textarea
                  rows={2}
                  value={editForm.followup_2_message}
                  onChange={(e) => setEditForm({ ...editForm, followup_2_message: e.target.value })}
                  placeholder="Enter Follow-Up 2 message..."
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 resize-none font-sans"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-gray-800">
                <button
                  type="button"
                  onClick={() => setEditingContact(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-white hover:bg-gray-800 transition"
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
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700/80 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                  <Sliders className="w-5 h-5 text-indigo-400" />
                  <span>Outreach Sequence Templates</span>
                </h3>
                <p className="text-xs text-gray-400">
                  Configure default outreach copy for initial messages and automated follow-ups.
                </p>
              </div>
              <button
                onClick={() => setIsTemplateModalOpen(false)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800"
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
              <div>
                <label className="block text-gray-300 font-bold mb-1">Default 1st Outreach Message</label>
                <textarea
                  rows={3}
                  value={templateForm.default_message}
                  onChange={(e) => setTemplateForm({ ...templateForm, default_message: e.target.value })}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 resize-none font-sans"
                />
              </div>

              <div>
                <label className="block text-indigo-300 font-bold mb-1">Follow-Up 1 Default Message (+3 Days)</label>
                <textarea
                  rows={2}
                  value={templateForm.followup_1_message}
                  onChange={(e) => setTemplateForm({ ...templateForm, followup_1_message: e.target.value })}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 resize-none font-sans"
                />
              </div>

              <div>
                <label className="block text-purple-300 font-bold mb-1">Follow-Up 2 Default Message (+5 Days)</label>
                <textarea
                  rows={2}
                  value={templateForm.followup_2_message}
                  onChange={(e) => setTemplateForm({ ...templateForm, followup_2_message: e.target.value })}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 resize-none font-sans"
                />
              </div>

              <div className="p-3 rounded-xl bg-gray-950/80 border border-gray-800 flex items-center space-x-3">
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
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-white hover:bg-gray-800 transition"
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
