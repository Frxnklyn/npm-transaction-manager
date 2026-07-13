import type { TransactionState } from "../transaction/TransactionState.js";
import type { TransactionOperationInterface } from "./TransactionOperationInterface.js";

/** Exposes the minimal transaction functionality required by a participant. */
export interface TransactionContextInterface {
  /** Records a completed in-memory change for later rollback. */
  register(operation: TransactionOperationInterface): void;

  /** Returns the current lifecycle state of the transaction. */
  getState(): TransactionState;
}
