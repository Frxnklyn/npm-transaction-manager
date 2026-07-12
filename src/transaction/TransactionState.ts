export enum TransactionState {
  Pending = "pending",
  Committing = "committing",
  Committed = "committed",
  RollingBack = "rolling_back",
  RolledBack = "rolled_back",
  Failed = "failed",
}
