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
}> {
  const res = await fetch(`${BASE_URL}/api/contacts/templates`);
  return res.json();
}

export async function applyBulkTemplates(data: {
  default_message?: string;
  followup_1_message?: string;
  followup_2_message?: string;
  apply_to_all?: boolean;
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

export async function toggleReplied(contactId: string, hasReplied: boolean): Promise<Contact> {
  const res = await fetch(`${BASE_URL}/api/contacts/${contactId}/replied?status=${hasReplied ? 'YES' : 'NO'}`, {
    method: 'PATCH',
  });
  return res.json();
}

export async function fetchTasks(): Promise<Task[]> {
  const res = await fetch(`${BASE_URL}/api/tasks`);
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

