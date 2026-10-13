import Dexie, { type Table } from 'dexie';
import type { SurveyDefinition, AnswerMap, LocationReading } from '../domain/survey/types';
import type { LocalSyncState } from '../domain/sync/states';
import type { MapManifest } from '../domain/maps/manifest';

export interface LocalForm {
  key: string;
  userId: string;
  formId: string;
  projectId: string;
  versionId: string;
  versionNumber: number;
  title: string;
  definition: SurveyDefinition;
  downloadedAt: string;
}

export interface DraftLock {
  tabId: string;
  heartbeat: number;
}

export interface LocalRecord {
  id: string;
  userId: string;
  projectId: string;
  formId: string;
  formVersionId: string;
  versionNumber: number;
  definitionSnapshot: SurveyDefinition;
  answers: AnswerMap;
  submittedAnswers?: AnswerMap;
  status: LocalSyncState;
  clientCapturedAt?: string;
  location?: LocationReading | null;
  payloadHash?: string;
  lastError?: string;
  blockedReason?: 'conflict' | 'reauth' | 'forbidden' | 'validation';
  permanent?: boolean;
  syncStep?: string;
  attempts?: number;
  updatedAt: string;
  createdAt: string;
  schemaNote?: string;
  lock?: DraftLock;
}

export interface LocalAttachment {
  id: string;
  recordId: string;
  userId: string;
  questionId: string;
  data: ArrayBuffer;
  mimeType: string;
  byteSize: number;
  checksum: string;
  createdAt: string;
}

export interface TileRow {
  key: string;
  packageId: string;
  version: number;
  z: number;
  x: number;
  y: number;
  data: ArrayBuffer;
  checksum: string;
  bytes: number;
}

export interface MapPackageRow {
  id: string;
  packageId: string;
  version: number;
  manifest: MapManifest;
  status: 'idle' | 'downloading' | 'verifying' | 'ready' | 'failed' | 'cancelled';
  error?: string;
  updatedAt: string;
}

export interface MetaRow {
  key: string;
  value: string;
}

export class FieldSurveyDB extends Dexie {
  forms!: Table<LocalForm, string>;
  records!: Table<LocalRecord, string>;
  attachments!: Table<LocalAttachment, string>;
  tiles!: Table<TileRow, string>;
  packages!: Table<MapPackageRow, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'FieldSurveyDB') {
    super(name);
    this.version(1).stores({
      forms: 'key, userId, formId, projectId',
      records: 'id, userId, status, projectId',
      attachments: 'id, recordId, userId, questionId',
      tiles: 'key, packageId, version',
      packages: 'id, packageId, status',
      meta: 'key',
    });
    this.version(2)
      .stores({
        forms: 'key, userId, formId, projectId, versionId',
        records: 'id, userId, status, projectId, formVersionId',
        attachments: 'id, recordId, userId, questionId',
        tiles: 'key, packageId, version',
        packages: 'id, packageId, status',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('records')
          .toCollection()
          .modify((record: LocalRecord) => {
            if (!record.schemaNote) record.schemaNote = 'migrated-v2';
          });
      });
  }
}

export function openDatabase(name?: string): FieldSurveyDB {
  return new FieldSurveyDB(name);
}
