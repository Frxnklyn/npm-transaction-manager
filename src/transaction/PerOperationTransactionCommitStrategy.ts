import type { TransactionCommitStrategyInterface } from "../interfaces/TransactionCommitStrategyInterface.js";
import type { TransactionOperationInterface } from "../interfaces/TransactionOperationInterface.js";
import type { TransactionParticipantInterface } from "../interfaces/TransactionParticipantInterface.js";

/** Persists once per operation, in operation registration order. */
export class PerOperationTransactionCommitStrategy
implements TransactionCommitStrategyInterface {
  /** Calls the owning participant's restored updater for every operation. */
  async commit(
    _participants: readonly TransactionParticipantInterface[],
    operations: readonly TransactionOperationInterface[],
  ): Promise<void> {
    for (const operation of operations) {
      await operation.participant.update();
    }
  }
}
