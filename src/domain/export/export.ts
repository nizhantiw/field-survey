import { toGeoJsonPosition } from '../gps/location';
import { isLocation, isPhotoAnswer, choiceLabel } from '../survey/engine';
import type { Question, SurveyDefinition } from '../survey/types';
import type { ReviewStatus, IngestionStatus } from '../sync/states';

export interface ExportRecord {
  id: string;
  projectId: string;
  formId: string;
  formVersionId: string;
  versionNumber: number;
  collectorId: string;
  answers: Record<string, unknown>;
  location: unknown;
  clientCapturedAt: string;
  serverReceivedAt: string | null;
  payloadHash: string;
  ingestionStatus: IngestionStatus;
  reviewStatus: ReviewStatus;
}

export interface SubmissionFilter {
  ingestion?: IngestionStatus | 'all';
  review?: ReviewStatus | 'all';
  formVersionId?: string;
  collectorId?: string;
  from?: string;
  to?: string;
}

export function applySubmissionFilter(records: ExportRecord[], filter: SubmissionFilter = {}): ExportRecord[] {
  return records.filter((record) => {
    const ingestion = filter.ingestion ?? 'complete';
    if (ingestion !== 'all' && record.ingestionStatus !== ingestion) return false;
    if (filter.review && filter.review !== 'all' && record.reviewStatus !== filter.review) return false;
    if (filter.formVersionId && record.formVersionId !== filter.formVersionId) return false;
    if (filter.collectorId && record.collectorId !== filter.collectorId) return false;
    if (filter.from && record.clientCapturedAt < filter.from) return false;
    if (filter.to && record.clientCapturedAt > filter.to) return false;
    return true;
  });
}

export function reviewPatch(status: ReviewStatus): { review_status: ReviewStatus } {
  return { review_status: status };
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: string): string {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe) || safe !== value) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}

export function toCsv(records: ExportRecord[], definition: SurveyDefinition): string {
  const questions = definition.questions.filter((question) => question.type !== 'section');
  const headers = [
    'submission_id',
    'form_id',
    'form_version_id',
    'form_version',
    'collector_id',
    'client_captured_at',
    'server_received_at',
    'ingestion_status',
    'review_status',
    'latitude',
    'longitude',
    'accuracy_m',
    'location_source',
    ...questions.map((question) => question.id),
  ];
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const record of records) {
    const location = isLocation(record.location) ? record.location : null;
    const cells = [
      record.id,
      record.formId,
      record.formVersionId,
      String(record.versionNumber),
      record.collectorId,
      record.clientCapturedAt,
      record.serverReceivedAt ?? '',
      record.ingestionStatus,
      record.reviewStatus,
      location ? String(location.latitude) : '',
      location ? String(location.longitude) : '',
      location?.accuracy === null || location?.accuracy === undefined ? '' : String(location.accuracy),
      location?.source ?? '',
      ...questions.map((question) => formatAnswer(question, record.answers[question.id])),
    ];
    lines.push(cells.map((cell) => escapeCsvCell(cell)).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function toJson(records: ExportRecord[], definition: SurveyDefinition): string {
  return JSON.stringify(
    {
      form: { id: definition.id, title: definition.title, schemaVersion: definition.schemaVersion },
      records: records.map((record) => ({
        ...record,
        answers: presentAnswers(definition, record.answers),
      })),
    },
    null,
    2,
  );
}

export function toGeoJson(records: ExportRecord[], definition: SurveyDefinition): string {
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      features: records.map((record) => {
        const location = isLocation(record.location) ? record.location : null;
        return {
          type: 'Feature',
          id: record.id,
          geometry: location
            ? { type: 'Point', coordinates: toGeoJsonPosition(location) }
            : null,
          properties: {
            formId: record.formId,
            formVersionId: record.formVersionId,
            formVersion: record.versionNumber,
            collectorId: record.collectorId,
            clientCapturedAt: record.clientCapturedAt,
            serverReceivedAt: record.serverReceivedAt,
            ingestionStatus: record.ingestionStatus,
            reviewStatus: record.reviewStatus,
            accuracy: location?.accuracy ?? null,
            locationSource: location?.source ?? null,
            answers: presentAnswers(definition, record.answers),
          },
        };
      }),
    },
    null,
    2,
  );
}

function presentAnswers(definition: SurveyDefinition, answers: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const question of definition.questions) {
    if (question.type === 'section') continue;
    const value = answers[question.id];
    output[question.id] = value === undefined ? null : formatJsonAnswer(question, value);
  }
  return output;
}

function formatJsonAnswer(question: Question, value: unknown): unknown {
  if (value === undefined) return null;
  if (question.type === 'single_choice' && typeof value === 'string') {
    return { id: value, label: choiceLabel(question, value) };
  }
  if (question.type === 'multi_choice' && Array.isArray(value)) {
    return value.map((id) => ({ id: String(id), label: choiceLabel(question, String(id)) }));
  }
  if (isPhotoAnswer(value)) {
    return { attachmentId: value.attachmentId, contentType: value.contentType, byteSize: value.byteSize, checksum: value.checksum };
  }
  return value;
}

function formatAnswer(question: Question, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (question.type === 'single_choice' && typeof value === 'string') return choiceLabel(question, value);
  if (question.type === 'multi_choice' && Array.isArray(value)) {
    return value.map((id) => choiceLabel(question, String(id))).join('; ');
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (isPhotoAnswer(value)) return value.attachmentId;
  if (isLocation(value)) return `${value.latitude},${value.longitude}`;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
}
