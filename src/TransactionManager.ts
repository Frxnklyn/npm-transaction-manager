import { Transaction } from "./transaction/Transaction.js";
import type { TransactionParticipantInterface } from "./transaction/TransactionParticipantInterface.js";

export class TransactionManager {
  createTransaction(): Transaction {
    return new Transaction();
  }

  async run(participants: readonly TransactionParticipantInterface[]): Promise<Transaction> {
    const transaction = this.createTransaction();

    for (const participant of participants) {
      transaction.add(participant);
    }

    await transaction.commit();
    return transaction;
  }
}
