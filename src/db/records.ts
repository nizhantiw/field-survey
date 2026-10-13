import { payloadHash, sha256Hex } from '../domain/hash';
import { buildSubmissionPayload, requiredAttachmentsPresent, validateAnswers } from '../domain/survey/engine';
import type { AnswerMap, AttachmentPresence, SurveyDefinition } from '../domain/survey/types';
import { transition } from '../domain/sync/states';
import { FieldSurveyDB, type LocalAttachment, type LocalForm, type LocalRecord } from './db';

export const LOCK_STALE_MS = 5_000;

export class DraftLockError extends Error {
  constructor() {
    super('This draft is open in another tab. Your changes were not saved.');
    this.name = 'DraftLockError';
  }
}

export class SaveFailedError extends Error {
  constructor() {
    super('The draft could not be saved on this device.');
    this.name = 'SaveFailedError';
  }
}

export async function cacheForm(db: FieldSurveyDB, form: LocalForm): Promise<void> {
  await db.forms.put(form);
}

export async function listRecordsForUser(db: FieldSurveyDB, userId: string): Promise<LocalRecord[]> {
  return db.records.where('userId').equals(userId).toArray();
}

export async function claimLock(db: FieldSurveyDB, recordId: string, tabId: string, now = Date.now()): Promise<boolean> {
  return db.transaction('rw', db.records, async () => {
    const row = await db.records.get(recordId);
    if (!row) return false;
    if (row.lock && row.lock.tabId !== tabId && now - row.lock.heartbeat < LOCK_STALE_MS) return false;
    await db.records.update(recordId, { lock: { tabId, heartbeat: now } });
    return true;
  });
}

export async function saveDraft(
  db: FieldSurveyDB,
  recordId: string,
  tabId: string,
  answers: AnswerMap,
  now = Date.now(),
): Promise<LocalRecord> {
  try {
    return await db.transaction('rw', db.records, async () => {
      const row = await db.records.get(recordId);
      if (!row) throw new SaveFailedError();
      if (row.lock && row.lock.tabId !== tabId && now - row.lock.heartbeat < LOCK_STALE_MS) {
        throw new DraftLockError();
      }
      const next: Partial<LocalRecord> = {
        answers,
        updatedAt: new Date(now).toISOString(),
        lock: { tabId, heartbeat: now },
      };
      await db.records.update(recordId, next);
      const saved = await db.records.get(recordId);
      if (!saved) throw new SaveFailedError();
      return saved;
    });
  } catch (error) {
    if (error instanceof DraftLockError || error instanceof SaveFailedError) throw error;
    throw new SaveFailedError();
  }
}

export function rejectPreviewUrl(value: unknown): void {
  if (typeof value === 'string' && value.startsWith('blob:')) throw new SaveFailedError();
}

export async function readBlob(blob: Blob): Promise<ArrayBuffer> {
  rejectPreviewUrl(blob);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new SaveFailedError());
    reader.readAsArrayBuffer(blob);
  });
}

export async function storeAttachment(
  db: FieldSurveyDB,
  input: { id: string; recordId: string; userId: string; questionId: string; blob: Blob },
): Promise<LocalAttachment> {
  if (!(input.blob instanceof Blob)) throw new SaveFailedError();
  const data = await readBlob(input.blob);
  if (data.byteLength < 1) throw new SaveFailedError();
  const checksum = await sha256Hex(data);
  const row: LocalAttachment = {
    id: input.id,
    recordId: input.recordId,
    userId: input.userId,
    questionId: input.questionId,
    data,
    mimeType: input.blob.type || 'application/octet-stream',
    byteSize: data.byteLength,
    checksum,
    createdAt: new Date().toISOString(),
  };
  await db.attachments.put(row);
  const stored = await db.attachments.get(input.id);
  if (!stored || stored.data.byteLength < 1) throw new SaveFailedError();
  return stored;
}

export async function completeRecord(db: FieldSurveyDB, recordId: string, tabId: string, now = Date.now()): Promise<LocalRecord> {
  return db.transaction('rw', db.records, db.attachments, async () => {
    const row = await db.records.get(recordId);
    if (!row) throw new SaveFailedError();
    if (row.lock && row.lock.tabId !== tabId && now - row.lock.heartbeat < LOCK_STALE_MS) throw new DraftLockError();
    if (row.status !== 'draft' && row.status !== 'failed') {
      throw new SaveFailedError();
    }
    const stored = await db.attachments.where('recordId').equals(recordId).toArray();
    const presence = stored.map(toPresence);
    const validation = validateAnswers(row.definitionSnapshot, row.answers, presence);
    if (!validation.ok) {
      throw new SaveFailedError();
    }
    const payload = buildSubmissionPayload(row.definitionSnapshot, row.answers, presence);
    const lengths = new Map(stored.map((attachment) => [attachment.id, attachment.data.byteLength]));
    const missing = requiredAttachmentsPresent(payload, lengths);
    if (missing.length > 0) throw new SaveFailedError();
    const clientCapturedAt = row.clientCapturedAt ?? new Date(now).toISOString();
    const hash = await payloadHash({
      formVersionId: row.formVersionId,
      answers: payload.answers,
      location: row.location ?? null,
      clientCapturedAt,
    });
    const status = transition(row.status === 'failed' ? 'failed' : 'draft', row.status === 'failed' ? 'requeue' : 'complete_local');
    await db.records.update(recordId, {
      status,
      clientCapturedAt,
      payloadHash: hash,
      submittedAnswers: payload.answers,
      updatedAt: new Date(now).toISOString(),
      permanent: false,
    });
    const saved = await db.records.get(recordId);
    if (!saved || saved.status !== 'queued') throw new SaveFailedError();
    return saved;
  });
}

export async function createDraft(db: FieldSurveyDB, input: {
  id: string;
  userId: string;
  projectId: string;
  formId: string;
  formVersionId: string;
  versionNumber: number;
  definitionSnapshot: SurveyDefinition;
  tabId: string;
}): Promise<LocalRecord> {
  const now = new Date().toISOString();
  const row: LocalRecord = {
    id: input.id,
    userId: input.userId,
    projectId: input.projectId,
    formId: input.formId,
    formVersionId: input.formVersionId,
    versionNumber: input.versionNumber,
    definitionSnapshot: input.definitionSnapshot,
    answers: {},
    status: 'draft',
    updatedAt: now,
    createdAt: now,
    lock: { tabId: input.tabId, heartbeat: Date.now() },
  };
  await db.records.add(row);
  return row;
}

function toPresence(attachment: LocalAttachment): AttachmentPresence {
  return {
    id: attachment.id,
    questionId: attachment.questionId,
    byteSize: attachment.byteSize,
    checksum: attachment.checksum,
    contentType: attachment.mimeType,
    byteLength: attachment.data.byteLength,
  };
}

export async function unsyncedCount(db: FieldSurveyDB, userId: string): Promise<number> {
  const rows = await listRecordsForUser(db, userId);
  return rows.filter((row) => row.status !== 'synced').length;
}

export async function deleteSyncedRecords(db: FieldSurveyDB, userId: string): Promise<number> {
  const rows = await listRecordsForUser(db, userId);
  const synced = rows.filter((row) => row.status === 'synced');
  await db.transaction('rw', db.records, db.attachments, async () => {
    for (const row of synced) {
      await db.attachments.where('recordId').equals(row.id).delete();
      await db.records.delete(row.id);
    }
  });
  return synced.length;
}
