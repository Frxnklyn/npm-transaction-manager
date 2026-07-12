import { TransactionState } from "./TransactionState.js";

const transitions: Record<TransactionState, readonly TransactionState[]> = {
  [TransactionState.Pending]: [TransactionState.Committing, TransactionState.RollingBack, TransactionState.Failed],
  [TransactionState.Committing]: [TransactionState.Committed, TransactionState.RollingBack, TransactionState.Failed],
  [TransactionState.Committed]: [TransactionState.RollingBack],
  [TransactionState.RollingBack]: [TransactionState.RolledBack, TransactionState.Failed],
  [TransactionState.RolledBack]: [],
  [TransactionState.Failed]: [TransactionState.RollingBack],
};

export class TransactionStateMachine {
  private state: TransactionState;

  constructor(initialState: TransactionState = TransactionState.Pending) {
    this.state = initialState;
  }

  getState(): TransactionState {
    return this.state;
  }

  canTransitionTo(nextState: TransactionState): boolean {
    return transitions[this.state].includes(nextState);
  }

  transitionTo(nextState: TransactionState): TransactionState {
    if (!this.canTransitionTo(nextState)) {
      throw new Error(`Invalid transaction transition from ${this.state} to ${nextState}.`);
    }

    this.state = nextState;
    return this.state;
  }
}
