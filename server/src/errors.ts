/** An error whose message is safe to show to the end user. */
export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    /** Worth another attempt (e.g. a frame timed out). */
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'UserFacingError';
  }
}

/** Removes anything that looks like a filesystem path. */
export function scrubPaths(message: string): string {
  return message.replace(/(?:[A-Za-z]:)?(?:[\\/][^\s\\/:'"`]+){2,}/g, '[path]').slice(0, 500);
}

export function publicMessage(e: unknown): string {
  if (e instanceof UserFacingError) return scrubPaths(e.message);
  return 'Rendering failed unexpectedly. Please try again, or simplify the animation.';
}
