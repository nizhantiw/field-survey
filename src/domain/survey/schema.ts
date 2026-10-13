import { z } from 'zod';
import {
  CONDITION_OPERATORS,
  QUESTION_TYPES,
  SCHEMA_VERSION,
  type Choice,
  type Question,
  type QuestionType,
  type SurveyDefinition,
} from './types';

const conditionValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

const conditionSchema = z
  .object({
    questionId: z.string().min(1),
    operator: z.enum(CONDITION_OPERATORS),
    value: conditionValueSchema.optional(),
  })
  .strict();

const visibilitySchema = z
  .object({
    match: z.enum(['all', 'any']),
    conditions: z.array(conditionSchema).min(1),
  })
  .strict();

const validationSchema = z
  .object({
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    integer: z.boolean().optional(),
    maxPhotos: z.number().int().positive().optional(),
  })
  .strict();

const choiceSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
  })
  .strict();

const questionSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(QUESTION_TYPES),
    label: z.string().min(1),
    description: z.string().optional(),
    required: z.boolean(),
    validation: validationSchema.optional(),
    choices: z.array(choiceSchema).optional(),
    allowManualLocation: z.boolean().optional(),
    visibility: visibilitySchema.optional(),
  })
  .strict();

export const surveySchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: z.string().uuid(),
    title: z.string().min(1),
    questions: z.array(questionSchema),
  })
  .strict();

export type SchemaIssue = { path: string; message: string };

export function parseSurvey(input: unknown): { ok: true; survey: SurveyDefinition } | { ok: false; issues: SchemaIssue[] } {
  const parsed = surveySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    };
  }
  return { ok: true, survey: parsed.data };
}

export type PublishIssue = { path: string; code: string; message: string };

export function validateForPublish(survey: SurveyDefinition): { ok: true } | { ok: false; issues: PublishIssue[] } {
  const structural = parseSurvey(survey);
  if (!structural.ok) {
    return {
      ok: false,
      issues: structural.issues.map((issue) => ({
        path: issue.path,
        code: 'schema',
        message: issue.message,
      })),
    };
  }
  const issues: PublishIssue[] = [];
  const seen = new Map<string, Question>();
  survey.questions.forEach((question, index) => {
    if (seen.has(question.id)) {
      issues.push({
        path: `questions.${index}.id`,
        code: 'duplicate_id',
        message: `Duplicate question id ${question.id}`,
      });
    }
    seen.set(question.id, question);
    issues.push(...validateQuestionShape(question, index));
    if (question.visibility) {
      issues.push(...validateVisibility(question, index, survey.questions));
    }
  });
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true };
}

function validateQuestionShape(question: Question, index: number): PublishIssue[] {
  const issues: PublishIssue[] = [];
  const path = `questions.${index}`;
  if (question.type === 'single_choice' || question.type === 'multi_choice') {
    if (!question.choices || question.choices.length === 0) {
      issues.push({
        path: `${path}.choices`,
        code: 'missing_choices',
        message: 'Choice questions need at least one option',
      });
    } else {
      const choiceIds = new Set<string>();
      question.choices.forEach((choice, choiceIndex) => {
        if (choiceIds.has(choice.id)) {
          issues.push({
            path: `${path}.choices.${choiceIndex}.id`,
            code: 'duplicate_choice_id',
            message: `Duplicate choice id ${choice.id}`,
          });
        }
        choiceIds.add(choice.id);
      });
    }
  }
  const validation = question.validation;
  if (validation) {
    if (
      validation.minLength !== undefined &&
      validation.maxLength !== undefined &&
      validation.minLength > validation.maxLength
    ) {
      issues.push({
        path: `${path}.validation`,
        code: 'invalid_bounds',
        message: 'minLength cannot exceed maxLength',
      });
    }
    if (validation.min !== undefined && validation.max !== undefined && validation.min > validation.max) {
      issues.push({
        path: `${path}.validation`,
        code: 'invalid_bounds',
        message: 'min cannot exceed max',
      });
    }
  }
  if (question.type === 'section' && question.required) {
    issues.push({
      path: `${path}.required`,
      code: 'section_required',
      message: 'Sections cannot be required',
    });
  }
  return issues;
}

function validateVisibility(question: Question, index: number, questions: Question[]): PublishIssue[] {
  const issues: PublishIssue[] = [];
  const rule = question.visibility;
  if (!rule) return issues;
  const earlier = new Map<string, Question>();
  for (let i = 0; i < index; i += 1) {
    const previous = questions[i];
    if (previous) earlier.set(previous.id, previous);
  }
  rule.conditions.forEach((condition, conditionIndex) => {
    const path = `questions.${index}.visibility.conditions.${conditionIndex}`;
    const referenced = earlier.get(condition.questionId);
    if (!referenced) {
      issues.push({
        path,
        code: 'missing_reference',
        message: `Condition must reference an earlier question (${condition.questionId})`,
      });
      return;
    }
    const operand = operandError(referenced, condition.operator, condition.value);
    if (operand) {
      issues.push({ path, code: 'invalid_operand', message: operand });
    }
  });
  return issues;
}

function operandError(
  question: Question,
  operator: string,
  value: string | number | boolean | string[] | undefined,
): string | null {
  if (question.type === 'section') return 'Sections cannot be referenced by conditions';
  if (operator === 'is_empty' || operator === 'is_not_empty') {
    if (value !== undefined) return 'Empty checks do not take a comparison value';
    if (question.type === 'photo' || question.type === 'gps') return null;
    return null;
  }
  if (question.type === 'photo' || question.type === 'gps') {
    return `${question.type} questions only support empty checks`;
  }
  if (operator === 'contains' || operator === 'not_contains') {
    if (question.type !== 'multi_choice' && question.type !== 'text') {
      return 'contains is only valid for text and multi-choice questions';
    }
    if (typeof value !== 'string') return 'contains requires a string value';
    if (question.type === 'multi_choice' && !hasChoice(question.choices, value)) {
      return 'contains value is not an option id';
    }
    return null;
  }
  if (operator === 'gt' || operator === 'lt' || operator === 'gte' || operator === 'lte') {
    if (question.type === 'number') {
      return typeof value === 'number' ? null : 'numeric comparison requires a number';
    }
    if (question.type === 'date') {
      return typeof value === 'string' && isDate(value) ? null : 'date comparison requires an ISO date';
    }
    return 'ordered comparison is only valid for numbers and dates';
  }
  if (operator === 'eq' || operator === 'neq') {
    if (question.type === 'multi_choice') return 'use contains for multi-choice questions';
    if (question.type === 'text') return typeof value === 'string' ? null : 'text comparison requires a string';
    if (question.type === 'number') return typeof value === 'number' ? null : 'number comparison requires a number';
    if (question.type === 'boolean') return typeof value === 'boolean' ? null : 'boolean comparison requires true or false';
    if (question.type === 'date') {
      return typeof value === 'string' && isDate(value) ? null : 'date comparison requires an ISO date';
    }
    if (question.type === 'single_choice') {
      if (typeof value !== 'string') return 'choice comparison requires an option id';
      if (!hasChoice(question.choices, value)) return 'comparison value is not an option id';
      return null;
    }
  }
  return 'unsupported condition';
}

function hasChoice(choices: Choice[] | undefined, id: string): boolean {
  return Boolean(choices?.some((choice) => choice.id === id));
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function assertQuestionType(value: string): QuestionType {
  const found = QUESTION_TYPES.find((type) => type === value);
  if (!found) throw new Error(`Unsupported question type ${value}`);
  return found;
}
