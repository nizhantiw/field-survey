export function newId(): string {
  return crypto.randomUUID();
}

export function newQuestionId(): string {
  return `q_${crypto.randomUUID()}`;
}

export function newChoiceId(): string {
  return `c_${crypto.randomUUID()}`;
}
