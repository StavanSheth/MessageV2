import React from 'react';
import { AlertTriangle, CheckCircle, ExternalLink, ShieldCheck } from 'lucide-react';
import { LiveAutomationState } from '../types';

interface AttentionCenterProps {
  state: LiveAutomationState;
  onDismiss?: () => void;
}

export const AttentionCenter: React.FC<AttentionCenterProps> = ({ state }) => {
  const isLoginNeeded = state.instagram_login_status === 'LOGIN_REQUIRED' || state.stage === 'CHECKING_LOGIN';
  const isReviewNeeded = state.stage === 'MANUAL_ATTENTION' || state.status === 'ERROR';

  if (!isLoginNeeded && !isReviewNeeded) {
    return null;
  }

  return (
    <div className="bg-gradient-to-r from-amber-950/80 via-amber-900/60 to-orange-950/80 border border-amber-600/50 rounded-xl p-5 shadow-2xl backdrop-blur-md mb-6 animate-pulse">
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
                ? 'The automation detected that Instagram is not logged in. Please switch to the visible Chrome browser window opened on your screen, complete the login manually (or handle 2FA/challenge), and the worker will automatically detect your logged-in state and proceed.'
                : state.last_error || 'A verification mismatch or suspicious rate-limit state occurred. Review current contact before resuming.'}
            </p>

            <div className="flex items-center space-x-4 mt-3">
              <span className="inline-flex items-center space-x-1.5 text-xs font-semibold px-2.5 py-1 rounded bg-amber-900/60 border border-amber-700/60 text-amber-300">
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Visible Chrome Window Active</span>
              </span>
              <span className="text-xs text-amber-400/80">
                Credentials are never stored or requested by MessageV2.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
