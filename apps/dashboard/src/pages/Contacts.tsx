import React, { useState } from 'react';
import { Search, ExternalLink, Check, MessageSquare, ShieldCheck, Filter, Download } from 'lucide-react';
import { Contact } from '../types';
import { toggleReplied } from '../services/api';

interface ContactsProps {
  contacts: Contact[];
  onRefresh: () => void;
}

export const Contacts: React.FC<ContactsProps> = ({ contacts, onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [repliedFilter, setRepliedFilter] = useState<'all' | 'replied' | 'unreplied'>('all');
  const [loadingContactId, setLoadingContactId] = useState<string | null>(null);

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
    const matchesSearch =
      (c.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.custom_message || '').toLowerCase().includes(searchTerm.toLowerCase());

    if (repliedFilter === 'replied') return matchesSearch && c.has_replied;
    if (repliedFilter === 'unreplied') return matchesSearch && !c.has_replied;
    return matchesSearch;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-white tracking-tight">Contacts Directory</h2>
          <p className="text-sm text-gray-400 mt-1">
            All leads and recipients synchronized from spreadsheets with message and follow-up tracking.
          </p>
        </div>

        {/* Search, Filters, and Export */}
        <div className="flex items-center space-x-3">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by name, handle, message..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-gray-900 border border-gray-700/80 rounded-xl pl-9 pr-4 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500 w-64"
            />
          </div>

          <div className="flex rounded-xl bg-gray-900 border border-gray-800 p-1">
            {(['all', 'unreplied', 'replied'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setRepliedFilter(mode)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition ${
                  repliedFilter === mode
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          <a
            href="/api/contacts/export/excel"
            download
            className="flex items-center space-x-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-lg shadow-emerald-500/20 transition-all hover:scale-105 active:scale-95"
            title="Download full outreach report with 1st message, follow-up 1, and follow-up 2 timestamps in Excel format"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export Excel</span>
          </a>
        </div>
      </div>

      {/* Table Card */}
      <div className="bg-gray-900/80 border border-gray-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-950/60 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                <th className="py-3.5 px-6">Name & Handle</th>
                <th className="py-3.5 px-6">Instagram Link</th>
                <th className="py-3.5 px-6">Custom Message</th>
                <th className="py-3.5 px-6">Verification</th>
                <th className="py-3.5 px-6">Replied</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60 text-xs">
              {filteredContacts.length > 0 ? (
                filteredContacts.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="py-4 px-6">
                      <div className="font-bold text-white text-sm">{c.name || 'User'}</div>
                      <div className="text-gray-400 font-mono text-xs">@{c.username}</div>
                    </td>
                    <td className="py-4 px-6">
                      <a
                        href={c.instagram_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center space-x-1.5 text-indigo-400 hover:text-indigo-300 font-mono"
                      >
                        <span className="truncate max-w-[200px]">{c.instagram_url}</span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      </a>
                    </td>
                    <td className="py-4 px-6">
                      <div className="max-w-md truncate text-gray-300 font-sans">
                        "{c.custom_message || 'Hey'}"
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <span
                        className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider ${
                          c.verification_status === 'VERIFIED'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-gray-800 text-gray-400 border border-gray-700'
                        }`}
                      >
                        <ShieldCheck className="w-3 h-3" />
                        <span>{c.verification_status}</span>
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      <button
                        onClick={() => handleToggleReplied(c)}
                        disabled={loadingContactId === c.id}
                        className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
                          c.has_replied
                            ? 'bg-purple-950/60 border-purple-500/50 text-purple-300'
                            : 'bg-gray-800/60 border-gray-700/60 text-gray-400 hover:text-gray-200'
                        }`}
                      >
                        <Check className={`w-3.5 h-3.5 ${c.has_replied ? 'text-purple-400' : 'text-gray-500'}`} />
                        <span>{c.has_replied ? 'Replied' : 'Mark Replied'}</span>
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-500">
                    No contacts found. Ingest a spreadsheet in the Sources tab to populate contacts.
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
