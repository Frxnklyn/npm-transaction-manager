/** Reports a failed submit or a failed submit cleanup. */
export class CommitError extends Error {
  /** Original failure or aggregated failures that caused this error. */
  readonly cause: unknown;

  /** Creates a commit error with its originating cause. */
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "CommitError";
    this.cause = cause;
  }
}
