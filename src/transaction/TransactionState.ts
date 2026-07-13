/** Lifecycle states of a single transaction. */
export enum TransactionState {
  /** The transaction accepts participants and rollback operations. */
  Pending = "pending",
  /** The transaction is persisting original updaters. */
  Committing = "committing",
  /** Submit completed successfully and cannot be rolled back. */
  Committed = "committed",
  /** The transaction is executing rollback operations. */
  RollingBack = "rolling_back",
  /** Rollback completed successfully. */
  RolledBack = "rolled_back",
  /** Submit or rollback did not complete successfully. */
  Failed = "failed",
}
