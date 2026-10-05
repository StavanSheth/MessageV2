export type TaskStatus =
  | 'CREATED'
  | 'VALIDATING'
  | 'QUEUED'
  | 'READY'
  | 'RUNNING'
  | 'COMPLETED'
  | 'RETRY_WAIT'
  | 'MANUAL_REVIEW'
  | 'SKIPPED'
  | 'CANCELLED'
  | 'INTERRUPTED'
  | 'RECONCILING';

export type MessageStatus =
  | 'PENDING'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'SENDING'
  | 'SENT'
  | 'FAILED'
  | 'SKIPPED'
  | 'UNKNOWN';

export type WorkerStatus =
  | 'IDLE'
  | 'STARTING'
  | 'RUNNING'
  | 'PAUSED'
  | 'STOPPING'
  | 'STOPPED'
  | 'ERROR'
  | 'RECOVERING';

export type AutomationStage =
  | 'IDLE'
  | 'CHECKING_LOGIN'
  | 'NAVIGATING_PROFILE'
  | 'VERIFYING_IDENTITY'
  | 'CHECKING_MESSAGE_BUTTON'
  | 'OPENING_THREAD'
  | 'TYPING_MESSAGE'
  | 'SENDING_MESSAGE'
  | 'CONFIRMING_SEND'
  | 'WAITING_RATE_LIMIT'
  | 'RETRY_WAIT'
  | 'MANUAL_ATTENTION'
  | 'COMPLETED';

export interface Contact {
  id: string;
  source_id?: string;
  name?: string;
  instagram_url: string;
  username: string;
  message?: string;
  custom_message?: string;
  followup_1_message?: string;
  followup_1_delay_days?: number;
  followup_2_message?: string;
  followup_2_delay_days?: number;
  expected_followers?: number;
  extracted_followers?: number;
  verification_status: string;
  verification_confidence?: number;
  has_replied: boolean;
  replied_status?: string;
  replied_at?: string;
  auto_reply_message?: string;
  extracted_phone?: string;
  extracted_email?: string;
  extracted_link?: string;
  last_checked_reply_at?: string | null;
  reply_detected_at?: string | null;
  notes?: string;
  // Outreach & Follow-up Tracking
  first_message_status?: string;
  first_message_sent_at?: string | null;
  followup_1_status?: string;
  followup_1_scheduled_at?: string | null;
  followup_1_sent_at?: string | null;
  followup_2_status?: string;
  followup_2_scheduled_at?: string | null;
  followup_2_sent_at?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface Task {
  id: string;
  contact_id: string;
  contact_name?: string;
  contact_instagram?: string;
  username?: string;
  message?: string;
  type?: string;
  status: TaskStatus;
  sequence?: number;
  priority: number;
  retry_count: number;
  attempt_count?: number;
  max_retries: number;
  last_error?: string;
  error_code?: string;
  scheduled_at?: string;
  started_at?: string;
  completed_at?: string;
  next_retry_at?: string;
  claimed_by_worker_id?: string;
  worker_id?: string;
  created_at: string;
  updated_at?: string;
  contact?: Contact;
}

export interface MessageRecord {
  id: string;
  task_id: string;
  contact_id: string;
  body: string;
  status: MessageStatus;
  result_code?: string;
  sent_at?: string;
  created_at: string;
}

export interface VerificationSignal {
  name: string;
  expected: any;
  extracted: any;
  score: number;
  weight: number;
  notes?: string;
}

export interface VerificationOutput {
  confidence: number;
  signals: VerificationSignal[];
  decision: string;
  reason: string;
}

export interface LiveAutomationState {
  worker_id: string;
  worker_name: string;
  status: WorkerStatus;
  stage: AutomationStage;
  browser_status: string;
  instagram_login_status: string;
  current_task_id?: string;
  current_contact?: Contact;
  current_url?: string;
  latest_screenshot?: string;
  verification?: VerificationOutput;
  last_event?: string;
  last_error?: string;
  stats?: {
    total_processed: number;
    sent: number;
    failed: number;
    skipped: number;
  };
  task_counts?: Record<string, number>;
  batch_limit?: number | null;
  batch_sent_count?: number;
  delay_seconds?: number;
}

export interface EventLog {
  id: string;
  worker_id?: string;
  task_id?: string;
  contact_id?: string;
  event_code: string;
  stage?: string;
  message: string;
  payload_json?: any;
  screenshot_path?: string;
  created_at: string;
}

export interface Source {
  id: string;
  type: string;
  name: string;
  file_path?: string;
  url?: string;
  status: string;
  record_count: number;
  valid_count: number;
  invalid_count: number;
  created_at: string;
}

export interface ChromeProfile {
  id: string;
  name: string;
  path?: string;
  gaia_name?: string;
  email?: string;
  is_default?: boolean;
  avatar_url?: string;
  is_active?: boolean;
}
