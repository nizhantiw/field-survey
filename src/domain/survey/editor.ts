import { newChoiceId, newId, newQuestionId } from './ids';
import { validateForPublish } from './schema';
import { SCHEMA_VERSION, type Choice, type Question, type QuestionType, type SurveyDefinition } from './types';

export function createEmptySurvey(title: string): SurveyDefinition {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    title,
    questions: [],
  };
}

export function createQuestion(type: QuestionType, label = 'Untitled question'): Question {
  const question: Question = {
    id: newQuestionId(),
    type,
    label,
    required: type !== 'section',
  };
  if (type === 'single_choice' || type === 'multi_choice') {
    question.choices = [
      { id: newChoiceId(), label: 'Option A' },
      { id: newChoiceId(), label: 'Option B' },
    ];
  }
  if (type === 'gps') question.allowManualLocation = true;
  if (type === 'section') question.required = false;
  return question;
}

export function duplicateQuestion(question: Question): Question {
  const copy: Question = {
    ...question,
    id: newQuestionId(),
    label: `${question.label} copy`,
    choices: question.choices?.map((choice) => ({ ...choice, id: newChoiceId() })),
    validation: question.validation ? { ...question.validation } : undefined,
    visibility: question.visibility
      ? {
          match: question.visibility.match,
          conditions: question.visibility.conditions.map((condition) => ({ ...condition })),
        }
      : undefined,
  };
  return copy;
}

export function moveQuestion(questions: Question[], from: number, to: number):
  | { ok: true; questions: Question[] }
  | { ok: false; message: string } {
  if (from === to) return { ok: true, questions };
  const moving = questions[from];
  if (!moving || to < 0 || to >= questions.length) {
    return { ok: false, message: 'Cannot move the question to that position' };
  }
  const next = questions.slice();
  next.splice(from, 1);
  next.splice(to, 0, moving);
  const published = validateForPublish({
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    title: 'reorder-check',
    questions: next,
  });
  if (!published.ok) {
    const reference = published.issues.find((issue) => issue.code === 'missing_reference' || issue.code === 'invalid_operand');
    if (reference) {
      return { ok: false, message: 'That order would make a condition reference a later question' };
    }
  }
  return { ok: true, questions: next };
}

export function deleteQuestion(questions: Question[], id: string):
  | { ok: true; questions: Question[] }
  | { ok: false; message: string } {
  const dependents = questions.filter((question) =>
    question.visibility?.conditions.some((condition) => condition.questionId === id),
  );
  if (dependents.length > 0) {
    return {
      ok: false,
      message: `Remove conditions that reference this question first (${dependents.map((q) => q.label).join(', ')})`,
    };
  }
  return { ok: true, questions: questions.filter((question) => question.id !== id) };
}

export function updateChoice(choices: Choice[], choiceId: string, label: string): Choice[] {
  return choices.map((choice) => (choice.id === choiceId ? { ...choice, label } : choice));
}

export function addChoice(choices: Choice[]): Choice[] {
  return [...choices, { id: newChoiceId(), label: `Option ${choices.length + 1}` }];
}

export function cloneSurvey(survey: SurveyDefinition): SurveyDefinition {
  return structuredClone(survey);
}
