import { Serializer } from 'survey-core';
import { SCHEMA_VERSION, type Condition, type ConditionOperator, type Question, type QuestionType, type SurveyDefinition, type VisibilityRule } from '../domain/survey/types';

type Json = Record<string, unknown>;

const UNSUPPORTED = new Set([
  'paneldynamic',
  'matrix',
  'matrixdropdown',
  'matrixdynamic',
  'multipletext',
  'ranking',
  'imagepicker',
  'signaturepad',
  'file',
  'image',
  'expression',
]);

let registered = false;

export function registerFieldSurveyProperties(): void {
  if (registered) return;
  registered = true;
  Serializer.addProperty('question', { name: 'fieldSurveyType', type: 'string', visible: false });
  Serializer.addProperty('question', { name: 'allowManualLocation', type: 'boolean', visible: false });
  Serializer.addProperty('question', { name: 'fieldSurveyInteger', type: 'boolean', visible: false });
  Serializer.addProperty('question', { name: 'maxPhotos', type: 'number', visible: false });
  Serializer.addProperty('text', { name: 'minLength', type: 'number', visible: false });
}

export function toSurveyJson(survey: SurveyDefinition): Json {
  registerFieldSurveyProperties();
  const elements: Json[] = [];
  let bucket = elements;
  for (const question of survey.questions) {
    if (question.type === 'section') {
      const panel: Json = { type: 'panel', name: question.id, title: question.label, elements: [] };
      elements.push(panel);
      bucket = panel.elements as Json[];
      continue;
    }
    bucket.push(questionToElement(question));
  }
  return { title: survey.title, pages: [{ name: 'page1', elements }] };
}

export function fromSurveyJson(input: unknown, fallback: { id: string; title: string }): { ok: true; survey: SurveyDefinition } | { ok: false; issues: string[] } {
  const json = isRecord(input) ? input : {};
  const issues: string[] = [];
  const questions: Question[] = [];
  const pages = Array.isArray(json.pages) ? json.pages : [];
  if (pages.length === 0) issues.push('The SurveyJS form has no pages.');
  for (const page of pages) {
    if (!isRecord(page)) continue;
    const elements = Array.isArray(page.elements) ? page.elements : [];
    walk(elements, questions, issues);
  }
  if (issues.length > 0) return { ok: false, issues };
  const title = typeof json.title === 'string' && json.title.trim() ? json.title.trim() : fallback.title;
  return {
    ok: true,
    survey: { schemaVersion: SCHEMA_VERSION, id: fallback.id, title, questions },
  };
}

function walk(elements: unknown[], questions: Question[], issues: string[]): void {
  for (const element of elements) {
    if (!isRecord(element)) continue;
    const type = typeof element.type === 'string' ? element.type : '';
    if (UNSUPPORTED.has(type)) {
      issues.push(`${labelOf(element)} uses a ${type} question. FieldSurvey stores text, choices, dates, yes/no, GPS, and photos. Repeating tables and matrices are not saved.`);
      continue;
    }
    if (type === 'panel') {
      questions.push({
        id: stringOr(element.name, newLocalId('section')),
        type: 'section',
        label: stringOr(element.title, 'Section'),
        required: false,
      });
      if (Array.isArray(element.elements)) walk(element.elements, questions, issues);
      continue;
    }
    const question = elementToQuestion(element, issues);
    if (question) questions.push(question);
  }
}

function questionToElement(question: Question): Json {
  const base: Json = {
    name: question.id,
    title: question.label,
    isRequired: question.required,
  };
  if (question.description) base.description = question.description;
  if (question.visibility) base.visibleIf = toVisibleIf(question.visibility);
  if (question.type === 'text') {
    return { ...base, type: 'text', ...textValidation(question) };
  }
  if (question.type === 'number') {
    return {
      ...base,
      type: 'text',
      inputType: 'number',
      fieldSurveyInteger: question.validation?.integer === true,
      ...(question.validation?.min !== undefined ? { min: question.validation.min } : {}),
      ...(question.validation?.max !== undefined ? { max: question.validation.max } : {}),
    };
  }
  if (question.type === 'date') return { ...base, type: 'text', inputType: 'date' };
  if (question.type === 'boolean') return { ...base, type: 'boolean' };
  if (question.type === 'single_choice') return { ...base, type: 'radiogroup', choices: choicesToJson(question) };
  if (question.type === 'multi_choice') return { ...base, type: 'checkbox', choices: choicesToJson(question) };
  if (question.type === 'gps') {
    return { ...base, type: 'text', fieldSurveyType: 'gps', allowManualLocation: question.allowManualLocation !== false };
  }
  if (question.type === 'photo') {
    return { ...base, type: 'text', fieldSurveyType: 'photo', ...(question.validation?.maxPhotos ? { maxPhotos: question.validation.maxPhotos } : {}) };
  }
  return { ...base, type: 'text' };
}

function elementToQuestion(element: Json, issues: string[]): Question | null {
  const id = stringOr(element.name, '');
  if (!id) {
    issues.push('A question is missing a name.');
    return null;
  }
  const label = stringOr(element.title, id);
  const required = element.isRequired === true;
  const description = typeof element.description === 'string' ? element.description : undefined;
  const visibility = parseVisibleIf(element.visibleIf, issues, label);
  const fieldType = typeof element.fieldSurveyType === 'string' ? element.fieldSurveyType : '';
  const type = fieldType === 'gps' || fieldType === 'photo' ? fieldType : mapType(element);
  if (!type) {
    issues.push(`${label} has an unsupported SurveyJS type.`);
    return null;
  }
  const question: Question = { id, type, label, required, ...(description ? { description } : {}), ...(visibility ? { visibility } : {}) };
  if (type === 'single_choice' || type === 'multi_choice') {
    question.choices = readChoices(element, issues, label);
  }
  if (type === 'text') {
    const validation = readTextValidation(element);
    if (validation) question.validation = validation;
  }
  if (type === 'number') {
    const validation = readNumberValidation(element);
    if (validation) question.validation = validation;
  }
  if (type === 'gps') question.allowManualLocation = element.allowManualLocation !== false;
  if (type === 'photo' && typeof element.maxPhotos === 'number') question.validation = { maxPhotos: element.maxPhotos };
  return question;
}

function mapType(element: Json): QuestionType | null {
  const type = typeof element.type === 'string' ? element.type : '';
  const inputType = typeof element.inputType === 'string' ? element.inputType : '';
  if (type === 'boolean') return 'boolean';
  if (type === 'radiogroup' || type === 'dropdown') return 'single_choice';
  if (type === 'checkbox') return 'multi_choice';
  if (type === 'comment' || type === 'text') {
    if (inputType === 'number') return 'number';
    if (inputType === 'date' || inputType === 'datetime-local') return 'date';
    return 'text';
  }
  return null;
}

function choicesToJson(question: Question): Json[] {
  return (question.choices ?? []).map((choice) => ({ value: choice.id, text: choice.label }));
}

function readChoices(element: Json, issues: string[], label: string) {
  if (!Array.isArray(element.choices) || element.choices.length === 0) {
    issues.push(`${label} needs at least one choice.`);
    return [];
  }
  return element.choices.map((choice, index) => {
    if (typeof choice === 'string') return { id: choice, label: choice };
    if (isRecord(choice)) {
      const id = stringOr(choice.value, stringOr(choice.text, `choice_${index + 1}`));
      const text = stringOr(choice.text, id);
      return { id, label: text };
    }
    return { id: `choice_${index + 1}`, label: `Choice ${index + 1}` };
  });
}

function textValidation(question: Question): Json {
  const validation: Json = {};
  if (question.validation?.minLength !== undefined) validation.minLength = question.validation.minLength;
  if (question.validation?.maxLength !== undefined) validation.maxLength = question.validation.maxLength;
  return validation;
}

function readTextValidation(element: Json) {
  const maxLength = numberOrUndefined(element.maxLength);
  const minLength = numberOrUndefined(element.minLength);
  if (maxLength === undefined && minLength === undefined) return undefined;
  return { ...(minLength !== undefined ? { minLength } : {}), ...(maxLength !== undefined ? { maxLength } : {}) };
}

function readNumberValidation(element: Json) {
  const min = numberOrUndefined(element.min);
  const max = numberOrUndefined(element.max);
  const integer = element.fieldSurveyInteger === true;
  if (min === undefined && max === undefined && !integer) return undefined;
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(integer ? { integer: true } : {}) };
}

function toVisibleIf(rule: VisibilityRule): string {
  const joiner = rule.match === 'any' ? ' or ' : ' and ';
  return rule.conditions.map(conditionToExpression).join(joiner);
}

function conditionToExpression(condition: Condition): string {
  const name = `{${condition.questionId}}`;
  if (condition.operator === 'is_empty') return `${name} empty`;
  if (condition.operator === 'is_not_empty') return `${name} notempty`;
  const operator = { eq: '=', neq: '<>', gt: '>', lt: '<', gte: '>=', lte: '<=', contains: 'contains', not_contains: 'notcontains' }[condition.operator];
  return `${name} ${operator} ${literal(condition.value)}`;
}

function literal(value: Condition['value']): string {
  if (typeof value === 'string') return `'${value.replaceAll("'", "\\'")}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => `'${item.replaceAll("'", "\\'")}'`).join(', ')}]`;
  return "''";
}

function parseVisibleIf(value: unknown, issues: string[], label: string): VisibilityRule | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const expression = value.trim();
  const hasAnd = expression.includes(' and ');
  const hasOr = expression.includes(' or ');
  if (hasAnd && hasOr) {
    issues.push(`${label} has a visibility rule FieldSurvey cannot store. Use only AND or only OR.`);
    return undefined;
  }
  const match = hasOr ? 'any' : 'all';
  const parts = expression.split(hasOr ? ' or ' : ' and ');
  const conditions: Condition[] = [];
  for (const part of parts) {
    const condition = parseCondition(part.trim());
    if (!condition) {
      issues.push(`${label} has a visibility rule FieldSurvey cannot store.`);
      return undefined;
    }
    conditions.push(condition);
  }
  return { match, conditions };
}

function parseCondition(part: string): Condition | null {
  const empty = part.match(/^\{([^}]+)\}\s+(empty|notempty)$/);
  if (empty) {
    return { questionId: empty[1] ?? '', operator: empty[2] === 'empty' ? 'is_empty' : 'is_not_empty' };
  }
  const compared = part.match(/^\{([^}]+)\}\s+(=|<>|>=|<=|>|<|contains|notcontains)\s+(.+)$/);
  if (!compared) return null;
  const operators: Record<string, ConditionOperator> = {
    '=': 'eq',
    '<>': 'neq',
    '>': 'gt',
    '<': 'lt',
    '>=': 'gte',
    '<=': 'lte',
    contains: 'contains',
    notcontains: 'not_contains',
  };
  const operator = operators[compared[2] ?? ''];
  if (!operator) return null;
  return { questionId: compared[1] ?? '', operator, value: parseLiteral(compared[3] ?? '') };
}

function parseLiteral(raw: string): Condition['value'] {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("\\'", "'");
  return value;
}

function labelOf(element: Json): string {
  return stringOr(element.title, stringOr(element.name, 'A question'));
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function newLocalId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
