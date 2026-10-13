import { payloadHash, type HashInput } from '../hash';
import { SyncRequestError, classifyError, shouldRetry, type FailureClass } from './retry';
import { transition, type IngestionStatus, type LocalSyncState } from './states';

export type SyncBoundary =
  | 'validate'
  | 'create_or_recover'
  | 'register_attachments'
  | 'upload_attachment'
  | 'verify_attachments'
  | 'finalize';

export interface AttachmentUpload {
  id: string;
  questionId: string;
  contentType: string;
  byteSize: number;
  checksum: string;
  bytes: ArrayBuffer;
}

export interface CreateSubmissionBody extends HashInput {
  id: string;
  projectId: string;
  attachments: Array<Omit<AttachmentUpload, 'bytes'>>;
}

export type CreateSubmissionResult =
  | { status: 'created' | 'recovered'; ingestionStatus: IngestionStatus; payloadHash: string }
  | { status: 'conflict'; payloadHash: string };

export interface SyncTransport {
  createOrRecover(body: CreateSubmissionBody): Promise<CreateSubmissionResult>;
  registerAttachments(submissionId: string, attachments: CreateSubmissionBody['attachments']): Promise<void>;
  uploadAttachment(submissionId: string, attachment: AttachmentUpload): Promise<void>;
  verifyAttachments(submissionId: string): Promise<{ ok: boolean; missing: string[] }>;
  finalize(submissionId: string, hash: string): Promise<{ ingestionStatus: 'complete' }>;
}

export interface SyncRecord {
  id: string;
  projectId: string;
  formVersionId: string;
  answers: HashInput['answers'];
  location: HashInput['location'];
  clientCapturedAt: string;
  status: LocalSyncState;
  step: SyncBoundary | 'synced' | 'idle';
  attempts: number;
  permanent: boolean;
  blockedReason?: 'conflict' | 'reauth' | 'forbidden' | 'validation';
  lastError?: string;
}

export interface SyncOutcome {
  record: SyncRecord;
  serverConfirmed: boolean;
}

export class InjectingTransport implements SyncTransport {
  constructor(
    private readonly inner: SyncTransport,
    private fault: { boundary: SyncBoundary; times: number; error: unknown; when?: 'before' | 'after' } | null,
  ) {}

  setFault(fault: { boundary: SyncBoundary; times: number; error: unknown; when?: 'before' | 'after' } | null): void {
    this.fault = fault;
  }

  private async gate(boundary: SyncBoundary, when: 'before' | 'after'): Promise<void> {
    if (!this.fault || this.fault.boundary !== boundary || this.fault.times <= 0) return;
    if ((this.fault.when ?? 'after') !== when) return;
    const error = this.fault.error;
    this.fault = { ...this.fault, times: this.fault.times - 1 };
    throw error;
  }

  async createOrRecover(body: CreateSubmissionBody): Promise<CreateSubmissionResult> {
    await this.gate('create_or_recover', 'before');
    const result = await this.inner.createOrRecover(body);
    await this.gate('create_or_recover', 'after');
    return result;
  }

  async registerAttachments(submissionId: string, attachments: CreateSubmissionBody['attachments']): Promise<void> {
    await this.gate('register_attachments', 'before');
    await this.inner.registerAttachments(submissionId, attachments);
    await this.gate('register_attachments', 'after');
  }

  async uploadAttachment(submissionId: string, attachment: AttachmentUpload): Promise<void> {
    await this.gate('upload_attachment', 'before');
    await this.inner.uploadAttachment(submissionId, attachment);
    await this.gate('upload_attachment', 'after');
  }

  async verifyAttachments(submissionId: string): Promise<{ ok: boolean; missing: string[] }> {
    await this.gate('verify_attachments', 'before');
    const result = await this.inner.verifyAttachments(submissionId);
    await this.gate('verify_attachments', 'after');
    return result;
  }

  async finalize(submissionId: string, hash: string): Promise<{ ingestionStatus: 'complete' }> {
    await this.gate('finalize', 'before');
    const result = await this.inner.finalize(submissionId, hash);
    await this.gate('finalize', 'after');
    return result;
  }
}

export async function runSync(
  record: SyncRecord,
  transport: SyncTransport,
  loadAttachments: () => Promise<AttachmentUpload[]>,
  persist: (record: SyncRecord) => Promise<void>,
  localValid: boolean,
): Promise<SyncOutcome> {
  let current: SyncRecord = { ...record };
  const save = async (next: SyncRecord) => {
    current = next;
    await persist(current);
  };

  if (current.status === 'synced') return { record: current, serverConfirmed: true };

  if (!localValid) {
    const from = current.status === 'uploading' || current.status === 'queued' || current.status === 'draft' || current.status === 'failed'
      ? current.status
      : 'queued';
    await save({
      ...current,
      status: transition(from, 'invalidate'),
      permanent: true,
      blockedReason: 'validation',
      lastError: 'Local record failed validation',
      step: 'validate',
    });
    return { record: current, serverConfirmed: false };
  }

  if (current.status === 'draft') {
    await save({ ...current, status: transition('draft', 'complete_local'), step: 'validate' });
  }
  if (current.status === 'failed' || current.status === 'blocked') {
    if (current.permanent || current.blockedReason === 'conflict') {
      return { record: current, serverConfirmed: false };
    }
    await save({ ...current, status: transition(current.status, 'requeue'), lastError: undefined });
  }
  if (current.status === 'queued') {
    await save({ ...current, status: transition('queued', 'start_upload') });
  }
  if (current.status !== 'uploading') {
    return { record: current, serverConfirmed: false };
  }

  try {
    const attachments = await loadAttachments();
    const hash = await payloadHash({
      formVersionId: current.formVersionId,
      answers: current.answers,
      location: current.location,
      clientCapturedAt: current.clientCapturedAt,
    });
    const body: CreateSubmissionBody = {
      id: current.id,
      projectId: current.projectId,
      formVersionId: current.formVersionId,
      answers: current.answers,
      location: current.location,
      clientCapturedAt: current.clientCapturedAt,
      attachments: attachments.map(({ bytes: _bytes, ...meta }) => meta),
    };
    const created = await transport.createOrRecover(body);
    if (created.status === 'conflict') {
      await save(block(current, 'conflict', 'The server already has different content for this record'));
      return { record: current, serverConfirmed: false };
    }
    await save({ ...current, step: 'create_or_recover' });
    await transport.registerAttachments(current.id, body.attachments);
    await save({ ...current, step: 'register_attachments' });
    for (const attachment of attachments) {
      await transport.uploadAttachment(current.id, attachment);
    }
    await save({ ...current, step: 'upload_attachment' });
    const verified = await transport.verifyAttachments(current.id);
    if (!verified.ok) {
      await save({
        ...current,
        status: transition('uploading', 'permanent_failure'),
        permanent: true,
        blockedReason: 'validation',
        lastError: `Missing attachments: ${verified.missing.join(', ')}`,
        step: 'verify_attachments',
      });
      return { record: current, serverConfirmed: false };
    }
    await save({ ...current, step: 'verify_attachments' });
    const finalized = await transport.finalize(current.id, hash);
    if (finalized.ingestionStatus !== 'complete') {
      throw new Error('Server did not confirm complete ingestion');
    }
    await save({
      ...current,
      status: transition('uploading', 'confirm'),
      step: 'synced',
      lastError: undefined,
      blockedReason: undefined,
      permanent: false,
    });
    return { record: current, serverConfirmed: true };
  } catch (error) {
    const failureClass: FailureClass = classifyError(error);
    const attempts = current.attempts + 1;
    if (failureClass === 'conflict') {
      await save(block({ ...current, attempts }, 'conflict', messageOf(error)));
    } else if (failureClass === 'reauth') {
      await save(block({ ...current, attempts }, 'reauth', 'Sign in again to upload. Local answers were kept.'));
    } else if (failureClass === 'forbidden') {
      await save(block({ ...current, attempts }, 'forbidden', 'Upload was rejected. Local answers were kept.'));
    } else if (failureClass === 'permanent' || !shouldRetry('retry', attempts)) {
      const permanent = failureClass === 'permanent' || !shouldRetry('retry', attempts);
      await save({
        ...current,
        attempts,
        status: transition('uploading', permanent && failureClass !== 'retry' ? 'permanent_failure' : 'retryable_failure'),
        permanent: failureClass === 'permanent' || attempts >= 8,
        lastError: messageOf(error),
      });
    } else {
      await save({
        ...current,
        attempts,
        status: transition('uploading', 'retryable_failure'),
        permanent: false,
        lastError: messageOf(error),
      });
    }
    return { record: current, serverConfirmed: false };
  }
}

function block(record: SyncRecord, reason: NonNullable<SyncRecord['blockedReason']>, lastError: string): SyncRecord {
  return {
    ...record,
    status: transition('uploading', reason === 'conflict' ? 'conflict' : reason === 'reauth' ? 'auth_required' : 'membership_revoked'),
    blockedReason: reason,
    permanent: reason === 'conflict',
    lastError,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Sync failed';
}

export class MemorySyncServer {
  readonly submissions = new Map<
    string,
    {
      hash: string;
      body: CreateSubmissionBody;
      ingestionStatus: IngestionStatus;
      attachments: Map<string, { checksum: string; uploaded: boolean }>;
    }
  >();

  transport(): SyncTransport {
    return {
      createOrRecover: async (body) => {
        const hash = await payloadHash(body);
        const existing = this.submissions.get(body.id);
        if (existing) {
          if (existing.hash !== hash) return { status: 'conflict', payloadHash: existing.hash };
          return { status: 'recovered', ingestionStatus: existing.ingestionStatus, payloadHash: hash };
        }
        this.submissions.set(body.id, {
          hash,
          body,
          ingestionStatus: 'pending',
          attachments: new Map(body.attachments.map((attachment) => [attachment.id, { checksum: attachment.checksum, uploaded: false }])),
        });
        return { status: 'created', ingestionStatus: 'pending', payloadHash: hash };
      },
      registerAttachments: async (submissionId, attachments) => {
        const existing = this.require(submissionId);
        for (const attachment of attachments) {
          const prior = existing.attachments.get(attachment.id);
          if (prior && prior.checksum !== attachment.checksum) {
            throw new SyncRequestError('attachment conflict', 'conflict', 409);
          }
          if (!prior) existing.attachments.set(attachment.id, { checksum: attachment.checksum, uploaded: false });
        }
      },
      uploadAttachment: async (submissionId, attachment) => {
        const existing = this.require(submissionId);
        const slot = existing.attachments.get(attachment.id);
        if (!slot) throw new Error('attachment was not registered');
        if (slot.checksum !== attachment.checksum) throw new Error('checksum mismatch');
        slot.uploaded = attachment.bytes.byteLength > 0;
      },
      verifyAttachments: async (submissionId) => {
        const existing = this.require(submissionId);
        const missing = [...existing.attachments.entries()].filter(([, slot]) => !slot.uploaded).map(([id]) => id);
        return { ok: missing.length === 0, missing };
      },
      finalize: async (submissionId, hash) => {
        const existing = this.require(submissionId);
        if (existing.hash !== hash) {
          throw new SyncRequestError('payload conflict', 'conflict', 409);
        }
        const missing = [...existing.attachments.values()].some((slot) => !slot.uploaded);
        if (missing) {
          throw new SyncRequestError('expected attachment is absent', 'permanent', 422);
        }
        existing.ingestionStatus = 'complete';
        return { ingestionStatus: 'complete' as const };
      },
    };
  }

  private require(id: string) {
    const existing = this.submissions.get(id);
    if (!existing) throw new Error('submission not found');
    return existing;
  }
}
