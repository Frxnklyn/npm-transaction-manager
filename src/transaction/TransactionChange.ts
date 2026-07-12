import type { TransactionParticipantInterface } from "./TransactionParticipantInterface.js";

export interface TransactionChangeOptions {
  description?: string;
}

export class TransactionChange<TParticipant extends TransactionParticipantInterface = TransactionParticipantInterface> {
  readonly participant: TParticipant;
  readonly description?: string;

  constructor(participant: TParticipant, options: TransactionChangeOptions = {}) {
    this.participant = participant;
    this.description = options.description;
  }

  commit(): void | Promise<void> {
    return this.participant.commit();
  }

  rollback(): void | Promise<void> {
    return this.participant.rollback();
  }
}
