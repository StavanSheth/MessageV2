import React, { useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { LiveAutomationState } from '../types';
import { openBrowserWindow } from '../services/api';

interface AttentionCenterProps {
  state: LiveAutomationState;
  onDismiss?: () => void;
}

export const AttentionCenter: React.FC<AttentionCenterProps> = ({ state }) => {
  const [isOpening, setIsOpening] = useState(false);
  const isLoginNeeded = state.instagram_login_status === 'LOGIN_REQUIRED' || state.stage === 'CHECKING_LOGIN';
  const isReviewNeeded = state.stage === 'MANUAL_ATTENTION' || state.status === 'ERROR';

  if (!isLoginNeeded && !isReviewNeeded) {
    return null;
  }

  const handleOpenChrome = async () => {
    setIsOpening(true);
    try {
      await openBrowserWindow();
    } catch (e) {
      console.error('Failed to open browser:', e);
    } finally {
      setTimeout(() => setIsOpening(false), 2500);
    }
  };

  return (
    <div className="bg-gradient-to-r from-amber-950/90 via-amber-900/70 to-orange-950/90 border border-amber-500/60 rounded-xl p-5 shadow-2xl backdrop-blur-md mb-6">
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-4">
          <div className="p-3 bg-amber-500/20 text-amber-400 rounded-lg border border-amber-500/30">
            <AlertTriangle className="w-6 h-6 animate-bounce" />
          </div>
          <div>
            <h3 className="text-base font-bold text-amber-200">
              {isLoginNeeded ? 'Instagram Login Required in Visible Browser' : 'Manual Attention Required'}
            </h3>
            <p className="text-sm text-amber-300/80 mt-1 max-w-2xl leading-relaxed">
              {isLoginNeeded
                ? 'The automation detected that Instagram is not logged in. Please click the button below to bring the visible Google Chrome window to the front, complete the login manually (or 2FA), and the automation will automatically resume.'
                : state.last_error || 'A verification mismatch or suspicious rate-limit state occurred. Review current contact before resuming.'}
            </p>

            <div className="flex flex-wrap items-center gap-3 mt-4">
              <button
                type="button"
                onClick={handleOpenChrome}
                disabled={isOpening}
                className="inline-flex items-center space-x-2 text-xs font-bold px-4 py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-black shadow-lg shadow-amber-500/40 transition hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-75"
              >
                {isOpening ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                <span>{isOpening ? 'Opening Chrome Window...' : 'Open / Focus Chrome Window'}</span>
              </button>
              <span className="text-xs text-amber-300/80">
                Credentials are never stored or requested by MessageV2.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
