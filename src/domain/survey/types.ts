export const SCHEMA_VERSION = 1 as const;

export const QUESTION_TYPES = [
  'text',
  'number',
  'single_choice',
  'multi_choice',
  'date',
  'boolean',
  'gps',
  'photo',
  'section',
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export const CONDITION_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'contains',
  'not_contains',
  'is_empty',
  'is_not_empty',
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export interface Choice {
  id: string;
  label: string;
}

export type ConditionValue = string | number | boolean | string[];

export interface Condition {
  questionId: string;
  operator: ConditionOperator;
  value?: ConditionValue;
}

export interface VisibilityRule {
  match: 'all' | 'any';
  conditions: Condition[];
}

export interface QuestionValidation {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  maxPhotos?: number;
}

export interface Question {
  id: string;
  type: QuestionType;
  label: string;
  description?: string;
  required: boolean;
  validation?: QuestionValidation;
  choices?: Choice[];
  allowManualLocation?: boolean;
  visibility?: VisibilityRule;
}

export interface SurveyDefinition {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  title: string;
  questions: Question[];
}

export interface DeviceFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: string;
}

export interface LocationReading {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: string;
  source: 'device' | 'manual';
  originalDevice?: DeviceFix;
}

export interface PhotoAnswer {
  attachmentId: string;
  byteSize: number;
  checksum: string;
  contentType: string;
}

export type AnswerValue =
  | string
  | number
  | boolean
  | string[]
  | LocationReading
  | PhotoAnswer
  | null;

export type AnswerMap = Record<string, AnswerValue>;

export interface AttachmentPresence {
  id: string;
  questionId: string;
  byteSize: number;
  checksum: string;
  contentType: string;
  byteLength: number;
}
