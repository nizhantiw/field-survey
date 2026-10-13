export const LOCAL_SYNC_STATES = ['draft', 'queued', 'uploading', 'synced', 'failed', 'blocked'] as const;
export type LocalSyncState = (typeof LOCAL_SYNC_STATES)[number];

export const INGESTION_STATES = ['pending', 'complete'] as const;
export type IngestionStatus = (typeof INGESTION_STATES)[number];

export const REVIEW_STATES = ['unreviewed', 'accepted', 'rejected', 'needs_followup'] as const;
export type ReviewStatus = (typeof REVIEW_STATES)[number];

export type SyncEvent =
  | 'complete_local'
  | 'start_upload'
  | 'confirm'
  | 'retryable_failure'
  | 'permanent_failure'
  | 'conflict'
  | 'auth_required'
  | 'membership_revoked'
  | 'retry'
  | 'requeue'
  | 'invalidate';

const TRANSITIONS: Record<LocalSyncState, Partial<Record<SyncEvent, LocalSyncState>>> = {
  draft: { complete_local: 'queued', invalidate: 'blocked' },
  queued: { start_upload: 'uploading', invalidate: 'blocked' },
  uploading: {
    confirm: 'synced',
    retryable_failure: 'failed',
    permanent_failure: 'failed',
    conflict: 'blocked',
    auth_required: 'blocked',
    membership_revoked: 'blocked',
    invalidate: 'blocked',
  },
  failed: { retry: 'queued', requeue: 'queued', invalidate: 'blocked' },
  blocked: { requeue: 'queued' },
  synced: {},
};

export function transition(from: LocalSyncState, event: SyncEvent): LocalSyncState {
  const next = TRANSITIONS[from][event];
  if (!next) {
    throw new Error(`Illegal sync transition: ${from} + ${event}`);
  }
  return next;
}

export function canMarkSynced(event: SyncEvent): boolean {
  return event === 'confirm';
}
