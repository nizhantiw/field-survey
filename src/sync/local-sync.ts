import type { FieldBackend } from '../backend/types';
import { validateAnswers } from '../domain/survey/engine';
import { runSync, type SyncRecord } from '../domain/sync/protocol';
import type { FieldSurveyDB } from '../db/db';
import { listRecordsForUser } from '../db/records';

export async function syncLocalRecord(db: FieldSurveyDB, backend: FieldBackend, recordId: string) {
  const row = await db.records.get(recordId);
  if (!row || row.status === 'draft' || row.status === 'synced' || !row.submittedAnswers || !row.clientCapturedAt) return row ?? null;
  const stored = await db.attachments.where('recordId').equals(recordId).toArray();
  const presence = stored.map((attachment) => ({
    id: attachment.id,
    questionId: attachment.questionId,
    byteSize: attachment.byteSize,
    checksum: attachment.checksum,
    contentType: attachment.mimeType,
    byteLength: attachment.data.byteLength,
  }));
  const validation = validateAnswers(row.definitionSnapshot, row.submittedAnswers, presence);
  const syncRecord: SyncRecord = {
    id: row.id,
    projectId: row.projectId,
    formVersionId: row.formVersionId,
    answers: row.submittedAnswers,
    location: row.location ?? null,
    clientCapturedAt: row.clientCapturedAt,
    status: row.status === 'uploading' ? 'uploading' : row.status,
    step: 'idle',
    attempts: row.attempts ?? 0,
    permanent: Boolean(row.permanent),
    ...(row.blockedReason ? { blockedReason: row.blockedReason } : {}),
    ...(row.lastError ? { lastError: row.lastError } : {}),
  };
  await runSync(
    syncRecord,
    backend.transport(),
    async () =>
      Promise.all(
        stored.map(async (attachment) => ({
          id: attachment.id,
          questionId: attachment.questionId,
          contentType: attachment.mimeType,
          byteSize: attachment.byteSize,
          checksum: attachment.checksum,
          bytes: attachment.data,
        })),
      ),
    async (next) => {
      await db.records.update(recordId, {
        status: next.status,
        attempts: next.attempts,
        permanent: next.permanent,
        blockedReason: next.blockedReason,
        lastError: next.lastError,
        syncStep: next.step,
        updatedAt: new Date().toISOString(),
      });
    },
    validation.ok,
  );
  return db.records.get(recordId);
}

export async function syncUserQueue(db: FieldSurveyDB, backend: FieldBackend, userId: string): Promise<void> {
  const exec = async () => {
    const rows = await listRecordsForUser(db, userId);
    for (const row of rows) {
      if (row.status === 'queued' || row.status === 'failed' || row.status === 'uploading' || (row.status === 'blocked' && !row.permanent)) {
        await syncLocalRecord(db, backend, row.id);
      }
    }
  };
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    await navigator.locks.request('fieldsurvey-sync', exec);
    return;
  }
  await exec();
}
