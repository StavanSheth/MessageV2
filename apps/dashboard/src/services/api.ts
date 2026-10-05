import { Contact, Task, LiveAutomationState, EventLog, Source } from '../types';

const BASE_URL = '';

export async function fetchHealth(): Promise<{ status: string; service: string }> {
  const res = await fetch(`${BASE_URL}/api/health`);
  return res.json();
}

export async function fetchAutomationStatus(): Promise<LiveAutomationState> {
  const res = await fetch(`${BASE_URL}/api/automation/status`);
  return res.json();
}

export async function startAutomation(options?: { batch_limit?: number | null; delay_seconds?: number }): Promise<{ status: string }> {
  const res = await fetch(`${BASE_URL}/api/automation/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options || {})
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || 'Failed to start automation');
  }
  return res.json();
}

export async function pauseAutomation(): Promise<{ status: string }> {
  const res = await fetch(`${BASE_URL}/api/automation/pause`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to pause automation');
  }
  return res.json();
}

export async function resumeAutomation(): Promise<{ status: string }> {
  const res = await fetch(`${BASE_URL}/api/automation/resume`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to resume automation');
  }
  return res.json();
}

export async function stopAutomation(): Promise<{ status: string }> {
  const res = await fetch(`${BASE_URL}/api/automation/stop`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to stop automation');
  }
  return res.json();
}

export async function openBrowserWindow(): Promise<{ status: string }> {
  const res = await fetch(`${BASE_URL}/api/browser/open`, { method: 'POST' });
  return res.json();
}


export async function fetchContacts(): Promise<Contact[]> {
  const res = await fetch(`${BASE_URL}/api/contacts`);
  return res.json();
}

export async function updateContactMessages(
  contactId: string,
  messages: {
    message?: string;
    followup_1_message?: string;
    followup_2_message?: string;
  }
): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/contacts/${contactId}/messages`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to update messages');
  }
  return res.json();
}

export async function fetchMessageTemplates(): Promise<{
  default_message: string;
  followup_1_message: string;
  followup_2_message: string;
  followup_1_delay_days: number;
  followup_2_delay_days: number;
}> {
  const res = await fetch(`${BASE_URL}/api/contacts/templates`);
  return res.json();
}

export async function applyBulkTemplates(data: {
  default_message?: string;
  followup_1_message?: string;
  followup_2_message?: string;
  followup_1_delay_days?: number;
  followup_2_delay_days?: number;
  apply_to_all?: boolean;
  reschedule_existing?: boolean;
}): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/contacts/templates/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to apply templates');
  }
  return res.json();
}

export async function updateFollowupSchedule(
  contactId: string,
  data: {
    followup_1_scheduled_at?: string | null;
    followup_1_status?: string | null;
    followup_1_delay_days?: number | null;
    followup_2_scheduled_at?: string | null;
    followup_2_status?: string | null;
    followup_2_delay_days?: number | null;
  }
): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/contacts/${contactId}/followup_schedule`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to update follow-up schedule');
  }
  return res.json();
}

export async function toggleReplied(contactId: string, hasReplied: boolean): Promise<Contact> {
  const res = await fetch(`${BASE_URL}/api/contacts/${contactId}/replied?status=${hasReplied ? 'YES' : 'NO'}`, {
    method: 'PATCH',
  });
  return res.json();
}

export async function updateContactDetails(
  contactId: string,
  data: {
    name?: string;
    username?: string;
    instagram_url?: string;
    notes?: string;
    expected_followers?: number;
  }
): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/contacts/${contactId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to update contact details');
  }
  return res.json();
}

export async function bulkDeleteContacts(contactIds: string[]): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/contacts/bulk_delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contact_ids: contactIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to bulk delete contacts');
  }
  return res.json();
}

export async function clearAllContacts(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/contacts/clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to clear all contacts');
  }
  return res.json();
}

export async function bulkUpdateReplied(status: 'YES' | 'NO' | 'UNKNOWN', contactIds?: string[]): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/contacts/bulk_replied`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, contact_ids: contactIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to bulk update replied status');
  }
  return res.json();
}

export async function getHardwareCapabilities(): Promise<{
  has_nvidia_gpu: boolean;
  gpu_name: string | null;
  vram_mb: number;
  supported_modes: string[];
  recommended_mode: string;
  enforce_single_browser: boolean;
}> {
  const res = await fetch(`${BASE_URL}/api/automation/hardware`);
  if (!res.ok) {
    return {
      has_nvidia_gpu: false,
      gpu_name: null,
      vram_mb: 0,
      supported_modes: ['SINGLE_BROWSER'],
      recommended_mode: 'SINGLE_BROWSER',
      enforce_single_browser: true,
    };
  }
  return res.json();
}

export async function fetchTasks(limit: number = 2000, status?: string): Promise<Task[]> {
  const params = new URLSearchParams();
  if (limit) params.set('limit', limit.toString());
  if (status) params.set('status', status);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${BASE_URL}/api/tasks${qs}`);
  return res.json();
}

export async function retryTask(taskId: string): Promise<Task> {
  const res = await fetch(`${BASE_URL}/api/tasks/${taskId}/retry`, { method: 'POST' });
  return res.json();
}

export async function retryAllTasks(): Promise<{ retried_count: number }> {
  const res = await fetch(`${BASE_URL}/api/tasks/retry-all`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to retry tasks');
  }
  return res.json();
}

export async function cancelTask(taskId: string): Promise<Task> {
  const res = await fetch(`${BASE_URL}/api/tasks/${taskId}/cancel`, { method: 'POST' });
  return res.json();
}

export async function confirmFollowups(taskIds?: string[], contactIds?: string[]): Promise<{ status: string; updated_count: number }> {
  const res = await fetch(`${BASE_URL}/api/tasks/confirm-followups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_ids: taskIds, contact_ids: contactIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to confirm follow-ups');
  }
  return res.json();
}

export async function cancelFollowups(taskIds?: string[], contactIds?: string[]): Promise<{ status: string; cancelled_count: number }> {
  const res = await fetch(`${BASE_URL}/api/tasks/cancel-followups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_ids: taskIds, contact_ids: contactIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to cancel follow-ups');
  }
  return res.json();
}

export async function updateTask(
  taskId: string,
  payload: {
    status?: string;
    scheduled_at?: string | null;
    priority?: number;
    message?: string;
  }
): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to update task');
  }
  return res.json();
}

export async function toggleTaskPause(taskId: string): Promise<{ task_id: string; status: string }> {
  const res = await fetch(`${BASE_URL}/api/tasks/${taskId}/toggle-pause`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to toggle task pause state');
  }
  return res.json();
}


export async function fetchSources(): Promise<Source[]> {
  const res = await fetch(`${BASE_URL}/api/sources`);
  return res.json();
}

export async function uploadXlsx(file: File): Promise<{ source_id: string; total_records: number; valid_records: number; tasks_created: number }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/api/sources/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || 'Upload failed');
  }
  return res.json();
}

export async function addUrlSource(url: string, name?: string): Promise<{ source_id: string; total_records: number; valid_records: number; tasks_created: number }> {
  const res = await fetch(`${BASE_URL}/api/sources/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, name }),
  });
  if (!res.ok) {
    let msg = 'URL ingestion failed';
    try {
      const err = await res.json();
      if (typeof err.detail === 'string') {
        msg = err.detail;
      } else if (Array.isArray(err.detail) && err.detail.length > 0) {
        msg = err.detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ');
      } else if (err.error) {
        msg = String(err.error);
      }
    } catch {
      msg = `Server returned status ${res.status}`;
    }
    throw new Error(msg);
  }
  return res.json();
}

export async function analyzeSourceXlsx(file: File): Promise<any> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/api/sources/analyze-xlsx`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Spreadsheet analysis failed');
  }
  return res.json();
}

export async function analyzeSourceUrl(url: string, name?: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/sources/analyze-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'URL analysis failed');
  }
  return res.json();
}

export async function confirmSourceImport(payload: {
  staging_id: string;
  source_name?: string;
  selected_unique_indices: number[];
  selected_duplicate_indices: number[];
  duplicate_mode: string;
}): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/sources/confirm-import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to confirm import');
  }
  return res.json();
}

export async function fetchTablesData(): Promise<{
  total_tables: number;
  tables: Record<string, {
    title: string;
    count: number;
    columns: string[];
    rows: any[];
  }>;
}> {
  const res = await fetch(`${BASE_URL}/api/sources/tables-data`);
  if (!res.ok) {
    throw new Error('Failed to fetch database tables data');
  }
  return res.json();
}


export async function fetchEvents(limit = 100): Promise<EventLog[]> {
  const res = await fetch(`${BASE_URL}/api/events?limit=${limit}`);
  return res.json();
}

export async function deleteContact(contactId: string): Promise<{ id: string; status: string }> {
  const res = await fetch(`${BASE_URL}/api/contacts/${contactId}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to delete contact');
  }
  return res.json();
}

export async function deleteTask(taskId: string): Promise<{ id: string; status: string }> {
  const res = await fetch(`${BASE_URL}/api/tasks/${taskId}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to delete task');
  }
  return res.json();
}

export async function triggerReplyScan(): Promise<{
  success: boolean;
  scanned_count: number;
  automated_found: number;
  human_replies_found: number;
  no_reply_count: number;
  scanned_at?: string;
  error?: string;
}> {
  const res = await fetch(`${BASE_URL}/api/automation/replies/scan`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to scan inbox replies');
  }
  return res.json();
}

export async function fetchReplyScannerStatus(): Promise<{
  status: string;
  current_stage?: string;
  current_target?: {
    name?: string;
    username?: string;
    thread_href?: string;
    snippet?: string;
    has_reply?: boolean;
    full_text?: string;
    entities?: {
      phone?: string | null;
      email?: string | null;
      link?: string | null;
      is_automated?: boolean;
      confidence?: number;
      indicators?: string[];
    };
  } | null;
  last_scanned_at: string | null;
  stats: {
    total_scanned: number;
    automated_found: number;
    human_replies_found: number;
    no_reply_count: number;
  };
  is_connected: boolean;
  is_paused?: boolean;
  is_running?: boolean;
}> {
  const res = await fetch(`${BASE_URL}/api/automation/replies/status`);
  return res.json();
}

export async function fetchChromeProfiles(): Promise<{
  profiles: import('../types').ChromeProfile[];
  active_profile?: import('../types').ChromeProfile | null;
}> {
  try {
    const res = await fetch(`${BASE_URL}/api/browser/profiles`);
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    return {
      profiles: [{ id: 'Default', name: 'Default Chrome User', is_default: true, is_active: true }],
      active_profile: { id: 'Default', name: 'Default Chrome User', is_default: true, is_active: true }
    };
  }
}

export async function selectChromeProfile(profileId: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/browser/profiles/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile_id: profileId }),
  });
  return res.json().catch(() => ({ success: true }));
}

export async function launchChromeLive(profileId?: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/browser/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile_id: profileId }),
  });
  return res.json().catch(() => ({ success: true }));
}

// ─────────────────────────────────────────────────────────────
// Worker 3 & Coordinator API Clients
// ─────────────────────────────────────────────────────────────

export async function startWorker3(batchLimit?: number | null, delaySeconds?: number): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/automation/worker3/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch_limit: batchLimit, delay_seconds: delaySeconds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to start Worker 3');
  }
  return res.json();
}

export async function pauseWorker3(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/automation/worker3/pause`, { method: 'POST' });
  return res.json();
}

export async function resumeWorker3(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/automation/worker3/resume`, { method: 'POST' });
  return res.json();
}

export async function stopWorker3(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/automation/worker3/stop`, { method: 'POST' });
  return res.json();
}

export async function fetchWorker3Status(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/automation/worker3/status`);
  return res.json();
}

export async function makeFollowupsDueNow(count?: number | null): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/automation/worker3/make_due_now`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: count || null })
  });
  return res.json();
}

export async function fetchCoordinatorStatus(): Promise<{
  active_sender: string | null;
  mode: string;
  lock_held: boolean;
  lock_acquired_at: string | null;
  cold_due_count: number;
  followup_due_count: number;
}> {
  const res = await fetch(`${BASE_URL}/api/automation/coordinator/status`);
  return res.json();
}

export async function setCoordinatorMode(mode: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/automation/coordinator/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  return res.json();
}

// ─────────────────────────────────────────────────────────────
// Worker 2 (Reply Scanner) Lifecycle Controls
// ─────────────────────────────────────────────────────────────

export async function startRepliesWorker(intervalSeconds?: number): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/automation/replies/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interval_seconds: intervalSeconds || 45 }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to start Worker 2');
  }
  return res.json();
}

export async function pauseRepliesWorker(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/automation/replies/pause`, { method: 'POST' });
  return res.json();
}

export async function resumeRepliesWorker(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/automation/replies/resume`, { method: 'POST' });
  return res.json();
}

export async function stopRepliesWorker(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/automation/replies/stop`, { method: 'POST' });
  return res.json();
}

// ─────────────────────────────────────────────────────────────
// Unified Master Controls (All Workers: Start, Pause, Resume, Stop)
// ─────────────────────────────────────────────────────────────

export async function startAllWorkers(options?: { batch_limit?: number | null; delay_seconds?: number }): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/automation/all/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options || {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to start all workers');
  }
  return res.json();
}

export async function pauseAllWorkers(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/automation/all/pause`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to pause all workers');
  }
  return res.json();
}

export async function resumeAllWorkers(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/automation/all/resume`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to resume all workers');
  }
  return res.json();
}

export async function stopAllWorkers(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/automation/all/stop`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to stop all workers');
  }
  return res.json();
}

export async function fetchAllWorkersStatus(): Promise<{
  worker1: any;
  worker2: any;
  worker3: any;
  any_running: boolean;
  any_paused: boolean;
  all_idle: boolean;
  active_count: number;
  paused_count: number;
}> {
  const res = await fetch(`${BASE_URL}/api/automation/all/status`);
  return res.json();
}



