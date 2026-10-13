export type FailureClass = 'retry' | 'permanent' | 'reauth' | 'conflict' | 'forbidden';

export class SyncRequestError extends Error {
  readonly status: number | null;
  readonly failureClass: FailureClass;

  constructor(message: string, failureClass: FailureClass, status: number | null = null) {
    super(message);
    this.name = 'SyncRequestError';
    this.failureClass = failureClass;
    this.status = status;
  }
}

export function classifyStatus(status: number): FailureClass {
  if (status === 401) return 'reauth';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 408 || status === 429 || status >= 500) return 'retry';
  if (status >= 400) return 'permanent';
  return 'retry';
}

export function classifyError(error: unknown): FailureClass {
  if (error instanceof SyncRequestError) return error.failureClass;
  if (error instanceof Error && error.name === 'PermissionError') return 'forbidden';
  if (error instanceof Error && error.name === 'AuthFailedError') return 'reauth';
  if (error && typeof error === 'object' && 'failureClass' in error) {
    const value = (error as { failureClass?: unknown }).failureClass;
    if (value === 'retry' || value === 'permanent' || value === 'reauth' || value === 'conflict' || value === 'forbidden') {
      return value;
    }
  }
  if (error instanceof TypeError) return 'retry';
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'NetworkError') return 'retry';
  if (error instanceof Error && /network|failed to fetch|unreachable/i.test(error.message)) return 'retry';
  return 'retry';
}

export const MAX_SYNC_ATTEMPTS = 8;

export function nextBackoffMs(attempt: number): number {
  const capped = Math.min(Math.max(attempt, 1), 8);
  return Math.min(30_000, 500 * 2 ** (capped - 1));
}

export function shouldRetry(failureClass: FailureClass, attempts: number): boolean {
  return failureClass === 'retry' && attempts < MAX_SYNC_ATTEMPTS;
}
