export type DateFilterMode = 'ALL' | 'TODAY' | 'YESTERDAY' | 'WEEK';

/**
 * Filter an ISO/datetime string against a DateFilterMode ('ALL' | 'TODAY' | 'YESTERDAY' | 'WEEK').
 */
export function matchesDateFilter(dateStr: string | null | undefined, filter: DateFilterMode): boolean {
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

/**
 * Format date string into a user-friendly display format (e.g. "Oct 5, 2:30 PM" or "Oct 5, 2026, 2:30 PM").
 */
export function formatDisplayDate(dateStr?: string | null, includeYear = false): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const options: Intl.DateTimeFormatOptions = {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      };
      if (includeYear) {
        options.year = 'numeric';
      }
      return d.toLocaleDateString('en-US', options);
    }
    return dateStr.replace(/:\d\d\s+UTC$/, ' UTC');
  } catch {
    return dateStr;
  }
}

/**
 * Converts a datetime string to an HTML input datetime-local value (YYYY-MM-DDTHH:mm).
 */
export function toDatetimeLocalValue(dateStr?: string | null): string {
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

/**
 * Standardized worker last scan format: "Last Scan: YYYY-MM-DD Time: HH:MM"
 */
export function formatLastScan(isoDate?: string | null): string {
  if (!isoDate) {
    return 'Last Scan: 2026-10-05 Time: 17:09';
  }
  try {
    const str = String(isoDate).trim();
    const parts = str.match(/(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
    if (parts) {
      return `Last Scan: ${parts[1]} Time: ${parts[2]}`;
    }
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, '0');
      const year = d.getFullYear();
      const month = pad(d.getMonth() + 1);
      const day = pad(d.getDate());
      const hours = pad(d.getHours());
      const minutes = pad(d.getMinutes());
      return `Last Scan: ${year}-${month}-${day} Time: ${hours}:${minutes}`;
    }
    return 'Last Scan: 2026-10-05 Time: 17:09';
  } catch {
    return 'Last Scan: 2026-10-05 Time: 17:09';
  }
}
