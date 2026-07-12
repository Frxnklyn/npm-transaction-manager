import type { TransactionEntry } from "../transaction/TransactionEntry.js";

export class CommitError extends Error {
  readonly cause: unknown;
  readonly entry: TransactionEntry;

  constructor(message: string, entry: TransactionEntry, cause: unknown) {
    super(message);
    this.name = "CommitError";
    this.entry = entry;
    this.cause = cause;
  }
}
