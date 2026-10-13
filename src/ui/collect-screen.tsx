import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { captureDeviceLocation } from '../domain/gps/location';
import { buildSubmissionPayload, isLocation, validateAnswers } from '../domain/survey/engine';
import type { AnswerMap, PhotoAnswer } from '../domain/survey/types';
import { DraftLockError, SaveFailedError, claimLock, completeRecord, saveDraft, storeAttachment } from '../db/records';
import type { LocalRecord } from '../db/db';
import { FIRST_USE_OFFLINE } from '../domain/fieldwork/provision';
import { FormRenderer } from './form-renderer';
import { tabId, useApp } from './provider';

export function CollectScreen() {
  const { recordId = '' } = useParams();
  const app = useApp();
  const [record, setRecord] = useState<LocalRecord | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [locked, setLocked] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [locationMessage, setLocationMessage] = useState('');
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [basemapNote, setBasemapNote] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    app.setEditing(true);
    return () => app.setEditing(false);
  }, [app]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const row = await app.db.records.get(recordId);
      if (!active) return;
      if (!row || row.userId !== app.user?.id) {
        setRecord(null);
        setLoaded(true);
        return;
      }
      setRecord(row);
      setAnswers(row.answers);
      const claimed = await claimLock(app.db, row.id, tabId());
      setLocked(!claimed);
      const stored = await app.db.attachments.where('recordId').equals(row.id).toArray();
      const next: Record<string, string> = {};
      for (const attachment of stored) {
        next[attachment.questionId] = URL.createObjectURL(new Blob([attachment.data], { type: attachment.mimeType }));
      }
      setPreviews(next);
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [app.db, app.user?.id, recordId]);

  useEffect(() => {
    if (!record || locked) return;
    const timer = window.setInterval(() => {
      void claimLock(app.db, record.id, tabId());
    }, 2000);
    return () => window.clearInterval(timer);
  }, [app.db, locked, record]);

  useEffect(() => {
    if (!record || locked) return;
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (window.__FS_FAULTS?.failSave) throw new SaveFailedError();
          await saveDraft(app.db, record.id, tabId(), answers);
          setSaveState('saved');
          setSaveMessage('Saved');
        } catch (error) {
          setSaveState('error');
          setSaveMessage(error instanceof DraftLockError || error instanceof SaveFailedError ? error.message : 'Not saved');
        }
      })();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [answers, app.db, locked, record]);

  useEffect(() => {
    const template = app.config.basemapUrl;
    if (!template) {
      setBasemapNote('Coordinates-only. No basemap is configured.');
      return;
    }
    const url = template.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0');
    const controller = new AbortController();
    void fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('basemap failed');
        setBasemapNote('');
      })
      .catch(() => setBasemapNote('Basemap unavailable. Coordinates can still be saved.'));
    return () => controller.abort();
  }, [app.config.basemapUrl]);

  if (!loaded) return <p>Loading record…</p>;
  if (!record) {
    return (
      <section className="stack">
        <h1>Record unavailable</h1>
        <p>{FIRST_USE_OFFLINE}</p>
      </section>
    );
  }

  return (
    <section className="stack">
      <h1>{record.definitionSnapshot.title}</h1>
      <p className="muted">Form version {record.versionNumber}</p>
      <p role="status" aria-live="polite">
        {saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? saveMessage || 'Unsaved' : 'Unsaved'}
      </p>
      {locked ? <p className="banner bad" role="alert">This draft is open in another tab. Your changes were not saved.</p> : null}
      {basemapNote ? <p role="status">{basemapNote}</p> : null}
      <FormRenderer
        definition={record.definitionSnapshot}
        answers={answers}
        errors={errors}
        disabled={locked || record.status !== 'draft'}
        previews={previews}
        locationMessage={locationMessage}
        onChange={(questionId, value) => setAnswers((current) => ({ ...current, [questionId]: value }))}
        onCaptureLocation={(questionId) => void capture(questionId)}
        onPhoto={(questionId, file) => void savePhoto(questionId, file)}
      />
      {record.status === 'draft' ? (
        <button type="button" disabled={locked} onClick={() => void finish()}>
          Complete record
        </button>
      ) : (
        <p className="status-pill">Local status: {record.status}</p>
      )}
    </section>
  );

  async function capture(questionId: string) {
    const previous = answers;
    if (!navigator.geolocation) {
      setLocationMessage('Location is unavailable. No coordinates were recorded.');
      setAnswers(previous);
      return;
    }
    const result = await captureDeviceLocation(navigator.geolocation);
    if (!result.ok) {
      setLocationMessage(result.message);
      return;
    }
    setLocationMessage('');
    setAnswers((current) => ({ ...current, [questionId]: result.reading }));
  }

  async function savePhoto(questionId: string, file: File) {
    if (!record || !app.user) return;
    const stored = await storeAttachment(app.db, {
      id: crypto.randomUUID(),
      recordId: record.id,
      userId: app.user.id,
      questionId,
      blob: file,
    });
    const answer: PhotoAnswer = {
      attachmentId: stored.id,
      byteSize: stored.byteSize,
      checksum: stored.checksum,
      contentType: stored.mimeType,
    };
    setAnswers((current) => ({ ...current, [questionId]: answer }));
    setPreviews((current) => ({ ...current, [questionId]: URL.createObjectURL(new Blob([stored.data], { type: stored.mimeType })) }));
  }

  async function finish() {
    if (!record) return;
    const stored = await app.db.attachments.where('recordId').equals(record.id).toArray();
    const presence = stored.map((attachment) => ({
      id: attachment.id,
      questionId: attachment.questionId,
      byteSize: attachment.byteSize,
      checksum: attachment.checksum,
      contentType: attachment.mimeType,
      byteLength: attachment.data.byteLength,
    }));
    const validation = validateAnswers(record.definitionSnapshot, answers, presence);
    if (!validation.ok) {
      setErrors(Object.fromEntries(validation.errors.map((error) => [error.questionId, error.message])));
      setSaveMessage('Not saved');
      return;
    }
    const payload = buildSubmissionPayload(record.definitionSnapshot, answers, presence);
    if (JSON.stringify(payload.answers).includes('blob:')) {
      setSaveMessage('Not saved');
      return;
    }
    const gps = Object.values(answers).find((value) => isLocation(value));
    try {
      await saveDraft(app.db, record.id, tabId(), answers);
      await app.db.records.update(record.id, { location: isLocation(gps) ? gps : null });
      const saved = await completeRecord(app.db, record.id, tabId());
      setRecord(saved);
      setErrors({});
      setSaveState('saved');
      setSaveMessage('Saved');
    } catch (error) {
      setSaveState('error');
      setSaveMessage(error instanceof Error ? error.message : 'Not saved');
    }
  }
}
