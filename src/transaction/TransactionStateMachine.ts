import { TransactionState } from "./TransactionState.js";

const transitions: Record<TransactionState, readonly TransactionState[]> = {
  [TransactionState.Pending]: [
    TransactionState.Committing,
    TransactionState.RollingBack,
    TransactionState.Stopping,
    TransactionState.Failed,
  ],
  [TransactionState.Committing]: [
    TransactionState.Committed,
    TransactionState.CommitCleanupFailed,
    TransactionState.Failed,
  ],
  [TransactionState.CommitCleanupFailed]: [TransactionState.Committed],
  [TransactionState.Committed]: [],
  [TransactionState.RollingBack]: [TransactionState.RolledBack, TransactionState.Failed],
  [TransactionState.RolledBack]: [],
  [TransactionState.Stopping]: [TransactionState.Stopped, TransactionState.Failed],
  [TransactionState.Stopped]: [],
  // A commit may have persisted an earlier participant before a later one
  // failed. An in-memory rollback cannot safely reverse that external state.
  [TransactionState.Failed]: [],
};

/** Validates and stores the lifecycle state of one transaction. */
export class TransactionStateMachine {
  private state: TransactionState;

  /** Creates a state machine with a configurable initial state. */
  constructor(initialState: TransactionState = TransactionState.Pending) {
    this.state = initialState;
  }

  /** Returns the current state. */
  getState(): TransactionState {
    return this.state;
  }

  /** Checks whether a transition to the given state is valid. */
  canTransitionTo(nextState: TransactionState): boolean {
    return transitions[this.state].includes(nextState);
  }

  /** Moves to the next state or throws for an invalid transition. */
  transitionTo(nextState: TransactionState): TransactionState {
    if (!this.canTransitionTo(nextState)) {
      throw new Error(`Invalid transaction transition from ${this.state} to ${nextState}.`);
    }

    this.state = nextState;
    return this.state;
  }
}
