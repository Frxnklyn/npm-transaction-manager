import type { TransactionEntry } from "../transaction/TransactionEntry.js";

export class RollbackError extends Error {
  readonly cause: unknown;
  readonly entry: TransactionEntry;

  constructor(message: string, entry: TransactionEntry, cause: unknown) {
    super(message);
    this.name = "RollbackError";
    this.entry = entry;
    this.cause = cause;
  }
}
