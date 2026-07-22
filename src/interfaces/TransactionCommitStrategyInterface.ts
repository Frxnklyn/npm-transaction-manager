import type { TransactionOperationInterface } from "./TransactionOperationInterface.js";
import type { TransactionParticipantInterface } from "./TransactionParticipantInterface.js";

/** Defines how tracked transaction changes are persisted during submit. */
export interface TransactionCommitStrategyInterface {
  /**
   * Persists the participants' current state after the transaction enabled
   * updates through its fixed updater.
   */
  commit(
    participants: readonly TransactionParticipantInterface[],
    operations: readonly TransactionOperationInterface[],
  ): Promise<void>;
}
