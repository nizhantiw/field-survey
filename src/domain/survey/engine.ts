import type {
  AnswerMap,
  AnswerValue,
  AttachmentPresence,
  Condition,
  LocationReading,
  PhotoAnswer,
  Question,
  SurveyDefinition,
} from './types';

/**
 * Hidden answers are kept on the draft so they can return if the question
 * becomes visible again, but they are excluded from the completed payload.
 * Preview and collection both call this module.
 */
export function evaluateVisibility(definition: SurveyDefinition, answers: AnswerMap): Record<string, boolean> {
  const visibility: Record<string, boolean> = {};
  for (const question of definition.questions) {
    visibility[question.id] = isQuestionVisible(question, answers);
  }
  return visibility;
}

export function isQuestionVisible(question: Question, answers: AnswerMap): boolean {
  const rule = question.visibility;
  if (!rule) return true;
  const results = rule.conditions.map((condition) => matchCondition(condition, answers[condition.questionId]));
  return rule.match === 'all' ? results.every(Boolean) : results.some(Boolean);
}

export interface FieldError {
  questionId: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: FieldError[];
  visibility: Record<string, boolean>;
}

export function validateAnswers(
  definition: SurveyDefinition,
  answers: AnswerMap,
  attachments: AttachmentPresence[] = [],
): ValidationResult {
  const visibility = evaluateVisibility(definition, answers);
  const errors: FieldError[] = [];
  for (const question of definition.questions) {
    if (!visibility[question.id]) continue;
    if (question.type === 'section') continue;
    const value = answers[question.id];
    if (isEmptyAnswer(question, value)) {
      if (question.required) {
        errors.push({ questionId: question.id, message: 'This question is required' });
      }
      continue;
    }
    errors.push(...validateValue(question, value, attachments));
  }
  return { ok: errors.length === 0, errors, visibility };
}

export interface SubmissionPayload {
  formVersionId?: string;
  answers: AnswerMap;
  attachments: AttachmentPresence[];
}

export function buildSubmissionPayload(
  definition: SurveyDefinition,
  answers: AnswerMap,
  attachments: AttachmentPresence[],
): SubmissionPayload {
  const visibility = evaluateVisibility(definition, answers);
  const payloadAnswers: AnswerMap = {};
  const used = new Set<string>();
  for (const question of definition.questions) {
    if (!visibility[question.id]) continue;
    if (question.type === 'section') continue;
    const value = answers[question.id];
    if (value === undefined) continue;
    payloadAnswers[question.id] = value;
    if (isPhotoAnswer(value)) used.add(value.attachmentId);
  }
  return {
    answers: payloadAnswers,
    attachments: attachments.filter((attachment) => used.has(attachment.id)),
  };
}

export function requiredAttachmentsPresent(payload: SubmissionPayload, storedByteLengths: Map<string, number>): string[] {
  const missing: string[] = [];
  for (const attachment of payload.attachments) {
    const size = storedByteLengths.get(attachment.id);
    if (size === undefined || size < 1) missing.push(attachment.id);
  }
  return missing;
}

function validateValue(question: Question, value: AnswerValue | undefined, attachments: AttachmentPresence[]): FieldError[] {
  const errors: FieldError[] = [];
  const fail = (message: string) => errors.push({ questionId: question.id, message });
  if (question.type === 'text' && typeof value === 'string') {
    const length = [...value].length;
    const min = question.validation?.minLength;
    const max = question.validation?.maxLength;
    if (min !== undefined && length < min) fail(`Enter at least ${min} characters`);
    if (max !== undefined && length > max) fail(`Enter at most ${max} characters`);
  } else if (question.type === 'number' && typeof value === 'number') {
    if (!Number.isFinite(value)) fail('Enter a finite number');
    if (question.validation?.integer && !Number.isInteger(value)) fail('Enter a whole number');
    const min = question.validation?.min;
    const max = question.validation?.max;
    if (min !== undefined && value < min) fail(`Enter a number of at least ${min}`);
    if (max !== undefined && value > max) fail(`Enter a number of at most ${max}`);
  } else if (question.type === 'single_choice' && typeof value === 'string') {
    if (!question.choices?.some((choice) => choice.id === value)) fail('Choose a listed option');
  } else if (question.type === 'multi_choice' && Array.isArray(value)) {
    const ids = new Set(question.choices?.map((choice) => choice.id) ?? []);
    if (value.some((id) => !ids.has(id))) fail('Choose only listed options');
  } else if (question.type === 'date' && typeof value === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Enter a date as YYYY-MM-DD');
  } else if (question.type === 'boolean' && typeof value === 'boolean') {
    return errors;
  } else if (question.type === 'gps' && isLocation(value)) {
    if (!validCoordinate(value.latitude, value.longitude)) fail('Latitude or longitude is out of range');
  } else if (question.type === 'photo' && isPhotoAnswer(value)) {
    const stored = attachments.find((attachment) => attachment.id === value.attachmentId);
    if (!stored || stored.byteLength < 1) fail('The photo file is missing from local storage');
    if (stored && stored.checksum !== value.checksum) fail('The photo checksum does not match the stored file');
  } else {
    fail('This answer does not match the question type');
  }
  return errors;
}

function isEmptyAnswer(question: Question, value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (question.type === 'photo' && isPhotoAnswer(value)) return false;
  if (question.type === 'gps' && isLocation(value)) return false;
  if (typeof value === 'number') return false;
  if (typeof value === 'boolean') return false;
  return false;
}

function matchCondition(condition: Condition, value: AnswerValue | undefined): boolean {
  const empty = isGenericEmpty(value);
  switch (condition.operator) {
    case 'is_empty':
      return empty;
    case 'is_not_empty':
      return !empty;
    case 'eq':
      return !empty && sameValue(value, condition.value);
    case 'neq':
      return empty || !sameValue(value, condition.value);
    case 'contains':
      return containsValue(value, condition.value);
    case 'not_contains':
      return !containsValue(value, condition.value);
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte':
      return compareOrdered(value, condition.value, condition.operator);
    default:
      return false;
  }
}

function isGenericEmpty(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function sameValue(value: AnswerValue | undefined, expected: Condition['value']): boolean {
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value === expected;
  }
  return false;
}

function containsValue(value: AnswerValue | undefined, expected: Condition['value']): boolean {
  if (typeof expected !== 'string') return false;
  if (typeof value === 'string') return value.includes(expected);
  if (Array.isArray(value)) return value.includes(expected);
  return false;
}

function compareOrdered(
  value: AnswerValue | undefined,
  expected: Condition['value'],
  operator: 'gt' | 'lt' | 'gte' | 'lte',
): boolean {
  if (typeof value === 'number' && typeof expected === 'number') {
    if (operator === 'gt') return value > expected;
    if (operator === 'lt') return value < expected;
    if (operator === 'gte') return value >= expected;
    return value <= expected;
  }
  if (typeof value === 'string' && typeof expected === 'string') {
    if (operator === 'gt') return value > expected;
    if (operator === 'lt') return value < expected;
    if (operator === 'gte') return value >= expected;
    return value <= expected;
  }
  return false;
}

export function isLocation(value: unknown): value is LocationReading {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<LocationReading>;
  return (
    typeof record.latitude === 'number' &&
    typeof record.longitude === 'number' &&
    (record.source === 'device' || record.source === 'manual') &&
    typeof record.timestamp === 'string'
  );
}

export function isPhotoAnswer(value: unknown): value is PhotoAnswer {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PhotoAnswer>;
  return (
    typeof record.attachmentId === 'string' &&
    typeof record.checksum === 'string' &&
    typeof record.contentType === 'string' &&
    typeof record.byteSize === 'number'
  );
}

export function validCoordinate(latitude: number, longitude: number): boolean {
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

export function choiceLabel(question: Question, id: string): string {
  return question.choices?.find((choice) => choice.id === id)?.label ?? id;
}
