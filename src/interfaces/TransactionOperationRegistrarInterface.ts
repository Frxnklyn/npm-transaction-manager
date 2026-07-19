import type { TransactionOperationInterface } from "./TransactionOperationInterface.js";

/** Allows a participant to report already-applied operations to a transaction. */
export interface TransactionOperationRegistrarInterface {
  /** Registers one already-applied operation in the transaction's undo log. */
  registerOperation(operation: TransactionOperationInterface): void;
}
