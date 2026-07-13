/** Reports one or more failures while reversing a transaction. */
export class RollbackError extends Error {
  /** Single cause or aggregate of all rollback failures. */
  readonly cause: unknown;
  /** All collected rollback and cleanup failures. */
  readonly errors: readonly unknown[];

  /** Creates a rollback error from the collected failures. */
  constructor(message: string, errors: readonly unknown[]) {
    super(message);
    this.name = "RollbackError";
    this.errors = [...errors];
    this.cause = this.errors.length === 1
      ? this.errors[0]
      : new AggregateError(this.errors, message);
  }
}
