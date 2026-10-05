import React from 'react';

export type BadgeStatus =
  | 'COMPLETED'
  | 'RUNNING'
  | 'READY'
  | 'QUEUED'
  | 'RETRY_WAIT'
  | 'MANUAL_REVIEW'
  | 'CANCELLED'
  | 'SKIPPED'
  | string;

export function getStatusBadgeClass(status?: BadgeStatus | null): string {
  const normalized = (status || '').toUpperCase();
  switch (normalized) {
    case 'COMPLETED':
    case 'DONE':
    case 'SENT':
      return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-sm shadow-emerald-500/10';
    case 'RUNNING':
    case 'SCANNING':
    case 'ACTIVE':
      return 'bg-indigo-500/20 text-indigo-400 border-indigo-500/40 animate-pulse';
    case 'READY':
    case 'QUEUED':
      return 'bg-sky-500/20 text-sky-400 border-sky-500/30';
    case 'RETRY_WAIT':
      return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
    case 'MANUAL_REVIEW':
      return 'bg-rose-500/20 text-rose-400 border-rose-500/40 font-bold';
    case 'CANCELLED':
    case 'SKIPPED':
      return 'bg-gray-800 text-gray-400 border-gray-700';
    default:
      return 'bg-gray-800 text-gray-300 border-gray-700';
  }
}

interface StatusBadgeProps {
  status?: BadgeStatus | null;
  label?: string;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, className = '' }) => {
  const badgeClass = getStatusBadgeClass(status);
  const displayLabel = label || status || 'UNKNOWN';

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${badgeClass} ${className}`}
    >
      {displayLabel}
    </span>
  );
};
