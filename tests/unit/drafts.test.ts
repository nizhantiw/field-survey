import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { FieldSurveyDB } from '../../src/db/db';
import { cacheForm, claimLock, completeRecord, createDraft, listRecordsForUser, saveDraft, storeAttachment } from '../../src/db/records';
import { parseSurvey } from '../../src/domain/survey/schema';
import siteVisit from '../../fixtures/forms/site-visit.json';
import type { SurveyDefinition } from '../../src/domain/survey/types';

const databases: FieldSurveyDB[] = [];

function survey(): SurveyDefinition {
  const parsed = parseSurvey(siteVisit);
  if (!parsed.ok) throw new Error('fixture');
  return parsed.survey;
}

async function database(): Promise<FieldSurveyDB> {
  const db = new FieldSurveyDB(`drafts-${crypto.randomUUID()}`);
  await db.open();
  databases.push(db);
  return db;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (db) => {
    db.close();
    await db.delete();
  }));
});

describe('local drafts', () => {
  it('P3-01 and P3-06 keep answers and photo bytes after reopening the database', async () => {
    const name = `persist-${crypto.randomUUID()}`;
    const db = new FieldSurveyDB(name);
    await db.open();
    const definition = survey();
    const draft = await createDraft(db, {
      id: crypto.randomUUID(),
      userId: 'user-a',
      projectId: 'project',
      formId: definition.id,
      formVersionId: 'version-1',
      versionNumber: 1,
      definitionSnapshot: definition,
      tabId: 'tab-a',
    });
    await saveDraft(db, draft.id, 'tab-a', { q_site_name: 'Cedar bend' });
    const blob = new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'image/png' });
    const stored = await storeAttachment(db, { id: crypto.randomUUID(), recordId: draft.id, userId: 'user-a', questionId: 'q_photo', blob });
    expect(stored.checksum).toMatch(/^[a-f0-9]{64}$/);
    db.close();
    const reopened = new FieldSurveyDB(name);
    await reopened.open();
    databases.push(reopened);
    const row = await reopened.records.get(draft.id);
    expect(row?.answers.q_site_name).toBe('Cedar bend');
    const attachment = await reopened.attachments.get(stored.id);
    expect(new Uint8Array(attachment!.data)).toEqual(Uint8Array.from([1, 2, 3, 4]));
    expect(JSON.stringify(row?.answers)).not.toContain('blob:');
  });

  it('P3-02 pins a draft to the version it was created from', async () => {
    const db = await database();
    const definition = survey();
    await cacheForm(db, {
      key: 'user-a:version-1',
      userId: 'user-a',
      formId: definition.id,
      projectId: 'project',
      versionId: 'version-1',
      versionNumber: 1,
      title: definition.title,
      definition: definition,
      downloadedAt: '2026-01-01T00:00:00.000Z',
    });
    const draft = await createDraft(db, {
      id: 'draft-1',
      userId: 'user-a',
      projectId: 'project',
      formId: definition.id,
      formVersionId: 'version-1',
      versionNumber: 1,
      definitionSnapshot: definition,
      tabId: 'tab-a',
    });
    const newer = structuredClone(definition);
    newer.questions[1] = { ...newer.questions[1]!, label: 'Renamed site' };
    await cacheForm(db, {
      key: 'user-a:version-2',
      userId: 'user-a',
      formId: definition.id,
      projectId: 'project',
      versionId: 'version-2',
      versionNumber: 2,
      title: newer.title,
      definition: newer,
      downloadedAt: '2026-02-01T00:00:00.000Z',
    });
    const row = await db.records.get(draft.id);
    expect(row?.formVersionId).toBe('version-1');
    expect(row?.definitionSnapshot.questions[1]?.label).toBe('Site name');
  });

  it('P3-08 and P3-10 refuse queued completion without a photo and refuse a second tab write', async () => {
    const db = await database();
    const definition = survey();
    const draft = await createDraft(db, {
      id: 'draft-lock',
      userId: 'user-a',
      projectId: 'project',
      formId: definition.id,
      formVersionId: 'version-1',
      versionNumber: 1,
      definitionSnapshot: definition,
      tabId: 'tab-a',
    });
    await saveDraft(db, draft.id, 'tab-a', {
      q_site_name: 'Alpha',
      q_habitat: 'c_riparian',
      q_location: { latitude: 1, longitude: 2, accuracy: 5, timestamp: '2026-01-01T00:00:00.000Z', source: 'device' },
    });
    await expect(completeRecord(db, draft.id, 'tab-a')).rejects.toThrow();
    expect((await db.records.get(draft.id))?.status).toBe('draft');
    expect(await claimLock(db, draft.id, 'tab-b', Date.now())).toBe(false);
    await expect(saveDraft(db, draft.id, 'tab-b', { q_site_name: 'Beta' }, Date.now())).rejects.toThrow(/another tab/i);
    expect((await db.records.get(draft.id))?.answers.q_site_name).toBe('Alpha');
  });

  it('P3-09 isolates drafts by account', async () => {
    const db = await database();
    const definition = survey();
    await createDraft(db, {
      id: 'draft-a',
      userId: 'user-a',
      projectId: 'project',
      formId: definition.id,
      formVersionId: 'version-1',
      versionNumber: 1,
      definitionSnapshot: definition,
      tabId: 'tab-a',
    });
    const visible = await listRecordsForUser(db, 'user-b');
    expect(visible).toEqual([]);
    expect((await listRecordsForUser(db, 'user-a')).map((row) => row.id)).toEqual(['draft-a']);
  });

  it('P4-08 preserves drafts across a local database upgrade', async () => {
    const name = `migrate-${crypto.randomUUID()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({
      forms: 'key, userId, formId, projectId',
      records: 'id, userId, status, projectId',
      attachments: 'id, recordId, userId, questionId',
      tiles: 'key, packageId, version',
      packages: 'id, packageId, status',
      meta: 'key',
    });
    await v1.open();
    await v1.table('records').add({
      id: 'legacy',
      userId: 'user-a',
      status: 'draft',
      projectId: 'project',
      answers: { q_site_name: 'Legacy' },
      definitionSnapshot: survey(),
    });
    await v1.table('attachments').add({
      id: 'att',
      recordId: 'legacy',
      userId: 'user-a',
      questionId: 'q_photo',
      data: Uint8Array.from([9, 9]).buffer,
      mimeType: 'image/png',
      byteSize: 2,
      checksum: 'abc',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    v1.close();
    const upgraded = new FieldSurveyDB(name);
    await upgraded.open();
    databases.push(upgraded);
    const row = await upgraded.records.get('legacy');
    expect(row?.answers.q_site_name).toBe('Legacy');
    expect(row?.schemaNote).toBe('migrated-v2');
    const attachment = await upgraded.attachments.get('att');
    expect(attachment?.data.byteLength).toBe(2);
  });
});
