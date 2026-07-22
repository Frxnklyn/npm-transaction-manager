import type { TransactionOperationInterface } from "./TransactionOperationInterface.js";

/** Allows commit strategies to remove operations that were already persisted. */
export interface TransactionOperationCleanupInterface {
  /** Removes one tracked operation from the transaction undo log. */
  removeOperation(operation: TransactionOperationInterface): void;
}
