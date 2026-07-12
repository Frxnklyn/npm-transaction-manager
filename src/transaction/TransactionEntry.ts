import { TransactionChange } from "./TransactionChange.js";
import type { TransactionParticipantInterface } from "./TransactionParticipantInterface.js";
import { TransactionState } from "./TransactionState.js";
import { TransactionStateMachine } from "./TransactionStateMachine.js";

export class TransactionEntry<TParticipant extends TransactionParticipantInterface = TransactionParticipantInterface> {
  readonly change: TransactionChange<TParticipant>;
  readonly stateMachine = new TransactionStateMachine();
  error?: unknown;

  constructor(change: TransactionChange<TParticipant>) {
    this.change = change;
  }

  getState(): TransactionState {
    return this.stateMachine.getState();
  }

  async commit(): Promise<void> {
    this.stateMachine.transitionTo(TransactionState.Committing);
    await this.change.commit();
    this.stateMachine.transitionTo(TransactionState.Committed);
  }

  async rollback(): Promise<void> {
    this.stateMachine.transitionTo(TransactionState.RollingBack);
    await this.change.rollback();
    this.stateMachine.transitionTo(TransactionState.RolledBack);
  }

  markFailed(error: unknown): void {
    this.error = error;
    if (this.stateMachine.canTransitionTo(TransactionState.Failed)) {
      this.stateMachine.transitionTo(TransactionState.Failed);
    }
  }
}
