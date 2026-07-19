/** Lifecycle states of a single transaction. */
export enum TransactionState {
  /** The transaction accepts participants and rollback operations. */
  Pending = "pending",
  /** The transaction is persisting original updaters. */
  Committing = "committing",
  /** Submit completed successfully and cannot be rolled back. */
  Committed = "committed",
  /** The transaction is executing rollback operations. */
  RollingBack = "rolling-back",
  /** Rollback completed successfully. */
  RolledBack = "rolled-back",
  /** The transaction is ending tracking without commit or rollback. */
  Stopping = "stopping",
  /** Tracking ended while current in-memory changes were retained. */
  Stopped = "stopped",
  /** Persistence succeeded, but one or more participants remain attached. */
  CommitCleanupFailed = "commit-cleanup-failed",
  /** A lifecycle operation did not complete successfully. */
  Failed = "failed",
}
