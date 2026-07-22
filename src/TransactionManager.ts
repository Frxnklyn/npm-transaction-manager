import { Transaction } from "./transaction/Transaction.js";
import type { TransactionParticipantInterface } from "./interfaces/TransactionParticipantInterface.js";
import { TransactionState } from "./transaction/TransactionState.js";

/** Creates transactions and runs callbacks with automatic submit or rollback. */
export class TransactionManager {
  /** Creates an empty transaction for manual use. */
  createTransaction(): Transaction {
    return new Transaction();
  }

  /**
   * Attaches participants, runs a callback, submits on success, and rolls back
   * registered operations if the callback or submit fails.
   */
  async run<TResult>(
    participants: readonly TransactionParticipantInterface[],
    callback: (transaction: Transaction) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    const transaction = this.createTransaction();

    try {
      for (const participant of participants) {
        transaction.attach(participant);
      }

      transaction.start();
      const result = await callback(transaction);
      await transaction.submit();

      return result;
    } catch (error) {
      const state = transaction.getState();

      if (
        state !== TransactionState.Initialized
        && state !== TransactionState.Running
      ) {
        throw error;
      }

      try {
        await transaction.rollback();
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Transaction execution and rollback both failed.",
        );
      }

      throw error;
    }
  }
}
