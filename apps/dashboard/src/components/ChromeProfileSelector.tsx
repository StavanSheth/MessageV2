import React, { useState, useEffect } from 'react';
import { 
  Globe, ChevronDown, Check, RefreshCw, Monitor, 
  ExternalLink, Loader2, Sparkles, User, ShieldCheck
} from 'lucide-react';
import { ChromeProfile } from '../types';
import { fetchChromeProfiles, selectChromeProfile, launchChromeLive } from '../services/api';

interface ChromeProfileSelectorProps {
  onProfileChanged?: (profile: ChromeProfile) => void;
  compact?: boolean;
}

export const ChromeProfileSelector: React.FC<ChromeProfileSelectorProps> = ({
  onProfileChanged,
  compact = false
}) => {
  const [profiles, setProfiles] = useState<ChromeProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<ChromeProfile | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchMessage, setLaunchMessage] = useState<string | null>(null);

  const loadProfiles = async () => {
    setIsLoading(true);
    try {
      const data = await fetchChromeProfiles();
      setProfiles(data.profiles || []);
      setActiveProfile(data.active_profile || (data.profiles ? data.profiles[0] : null));
      if (data.active_profile && onProfileChanged) {
        onProfileChanged(data.active_profile);
      }
    } catch (e) {
      console.error('Failed to load Chrome profiles:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  const handleSelect = async (profile: ChromeProfile) => {
    try {
      setIsLoading(true);
      const res = await selectChromeProfile(profile.id);
      setActiveProfile(res.active_profile);
      setIsOpen(false);
      if (onProfileChanged) {
        onProfileChanged(res.active_profile);
      }
    } catch (e: any) {
      alert(`Could not select profile: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLaunch = async () => {
    setIsLaunching(true);
    setLaunchMessage(null);
    try {
      const res = await launchChromeLive(activeProfile?.id || 'Default');
      setLaunchMessage('Chrome is live on your screen!');
      setTimeout(() => setLaunchMessage(null), 4000);
    } catch (e: any) {
      setLaunchMessage(`Launch error: ${e.message}`);
      setTimeout(() => setLaunchMessage(null), 5000);
    } finally {
      setIsLaunching(false);
    }
  };

  const displayActiveName = activeProfile 
    ? (activeProfile.gaia_name || activeProfile.name || activeProfile.id)
    : 'Stavan Sheth (Default)';

  if (compact) {
    return (
      <div className="relative inline-block text-left">
        <div className="flex items-center space-x-1.5">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center space-x-2 bg-gray-900/90 hover:bg-gray-800 border border-gray-700/80 hover:border-indigo-500/50 rounded-lg px-2.5 py-1.5 text-xs transition cursor-pointer"
            title="Select Chrome profile for automation"
          >
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <Globe className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-gray-200 font-semibold max-w-[140px] truncate">
              {displayActiveName}
            </span>
            {activeProfile?.is_default && (
              <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.2 rounded font-bold uppercase border border-indigo-500/30">
                Default
              </span>
            )}
            <ChevronDown className="w-3 h-3 text-gray-400" />
          </button>

          <button
            type="button"
            onClick={handleLaunch}
            disabled={isLaunching}
            title="Open Desktop Chrome Live (Default, Zero cmd)"
            className="flex items-center space-x-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-2.5 py-1.5 text-xs font-bold transition shadow-sm hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50"
          >
            {isLaunching ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Monitor className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">Desktop Chrome</span>
          </button>
        </div>

        {isOpen && (
          <div className="origin-top-right absolute right-0 mt-2 w-80 rounded-xl shadow-2xl bg-gray-900 border border-gray-700/80 z-50 ring-1 ring-black ring-opacity-5 divide-y divide-gray-800">
            <div className="p-3">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-800">
                <span className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center space-x-1.5">
                  <Globe className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Select Chrome Profile</span>
                </span>
                <button
                  onClick={loadProfiles}
                  disabled={isLoading}
                  className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-800 transition"
                  title="Rescan Chrome profiles"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-1">
                {profiles.map((p) => {
                  const isSelected = activeProfile?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => handleSelect(p)}
                      className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition flex items-center justify-between ${
                        isSelected
                          ? 'bg-indigo-600/30 text-indigo-200 border border-indigo-500/40 font-bold'
                          : 'text-gray-300 hover:bg-gray-800/80 hover:text-white'
                      }`}
                    >
                      <div className="truncate mr-2">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-semibold text-gray-100 truncate">
                            {p.gaia_name || p.name || p.id}
                          </span>
                          {p.is_default && (
                            <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.2 rounded font-bold uppercase border border-emerald-500/30">
                              Default
                            </span>
                          )}
                        </div>
                        {p.email && (
                          <span className="text-[10px] text-gray-400 block truncate">
                            {p.email} ({p.id})
                          </span>
                        )}
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-indigo-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-2.5 bg-gray-950/70 rounded-b-xl flex items-center justify-between">
              <span className="text-[10px] text-gray-400">
                Selected profile runs live in foreground
              </span>
              <button
                onClick={() => {
                  setIsOpen(false);
                  handleLaunch();
                }}
                className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center space-x-1"
              >
                <span>Launch Now</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Expanded panel view for LiveAutomationView page
  return (
    <div className="bg-gradient-to-r from-gray-900 via-indigo-950/30 to-gray-900 border border-indigo-500/30 rounded-2xl p-5 shadow-xl relative overflow-hidden">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Info Left */}
        <div className="flex items-start space-x-3.5">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0 mt-0.5">
            <Globe className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-bold text-white text-base">Chrome Browser Profile</h3>
              {activeProfile?.is_default && (
                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-bold uppercase border border-emerald-500/30">
                  Default: Stavan Sheth
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              Active Profile: <strong className="text-gray-200">{displayActiveName}</strong>
              {activeProfile?.email ? ` (${activeProfile.email})` : ''} • Directory: <span className="font-mono text-indigo-300">{activeProfile?.id || 'Default'}</span>
            </p>
          </div>
        </div>

        {/* Action Controls Right */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <select
              value={activeProfile?.id || 'Default'}
              onChange={(e) => {
                const found = profiles.find((p) => p.id === e.target.value);
                if (found) handleSelect(found);
              }}
              className="bg-gray-950 border border-gray-700 hover:border-indigo-500/60 text-gray-200 text-xs rounded-lg px-3 py-2 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer max-w-[260px]"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.gaia_name || p.name || p.id} {p.email ? `(${p.email})` : ''} {p.is_default ? '★ [Default]' : ''}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={loadProfiles}
            disabled={isLoading}
            title="Rescan host Chrome profiles"
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={handleLaunch}
            disabled={isLaunching}
            className="flex items-center space-x-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-lg shadow-indigo-600/30 transition hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50"
          >
            {isLaunching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Monitor className="w-4 h-4" />
            )}
            <span>Open Desktop Chrome (Default)</span>
          </button>
        </div>
      </div>

      {launchMessage && (
        <div className="mt-3 py-1.5 px-3 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center space-x-2 animate-fadeIn">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>{launchMessage}</span>
        </div>
      )}
    </div>
  );
};
