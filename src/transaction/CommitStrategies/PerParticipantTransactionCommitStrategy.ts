import type { TransactionCommitStrategyInterface } from "../../interfaces/TransactionCommitStrategyInterface.js";
import type { TransactionOperationInterface } from "../../interfaces/TransactionOperationInterface.js";
import type { TransactionParticipantInterface } from "../../interfaces/TransactionParticipantInterface.js";

/** Persists each unique attached participant once, in attachment order. */
export class PerParticipantTransactionCommitStrategy
implements TransactionCommitStrategyInterface {
  /** Persists every unique participant's current state once. */
  async commit(
    participants: readonly TransactionParticipantInterface[],
    _operations: readonly TransactionOperationInterface[],
  ): Promise<void> {
    const updatedParticipants = new Set<TransactionParticipantInterface>();

    for (const participant of participants) {
      if (updatedParticipants.has(participant)) {
        continue;
      }

      updatedParticipants.add(participant);
      await participant.update();
    }
  }
}