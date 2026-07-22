/** Lifecycle states of a single transaction. */
export enum TransactionState {
  /** The transaction waits for participants or a start signal. */
  Pending = "pending",
  /** The transaction has started and accepts rollback operations. */
  Initialized = "initialized",
  /** The transaction is currently applying participant work. */
  Running = "running",
  /** The transaction is persisting original updaters. */
  Committing = "committing",
  /** Submit completed successfully before the transaction returns to pending. */
  Committed = "committed",
  /** The transaction is executing rollback operations. */
  RollingBack = "rolling-back",
  /** Rollback completed successfully before the transaction returns to pending. */
  RolledBack = "rolled-back",
  /** The transaction is ending tracking without commit or rollback. */
  Stopping = "stopping",
  /** Tracking ended before the transaction returns to pending. */
  Stopped = "stopped",
  /** Persistence succeeded, but one or more participants remain attached. */
  CommitCleanupFailed = "commit-cleanup-failed",
  /** A lifecycle operation did not complete successfully. */
  Failed = "failed",
}
