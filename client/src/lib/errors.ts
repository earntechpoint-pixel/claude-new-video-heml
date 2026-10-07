/** An error with a message that is safe and useful to show directly to the user. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export const isAbortError = (e: unknown): boolean =>
  e instanceof DOMException && e.name === 'AbortError';

export const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
};

export function errorMessage(e: unknown): string {
  if (e instanceof UserError) return e.message;
  if (e instanceof Error) return `Something went wrong: ${e.message}`;
  return 'Something went wrong.';
}
