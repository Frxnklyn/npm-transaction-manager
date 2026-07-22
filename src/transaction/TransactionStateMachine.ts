import { TransactionState } from "./TransactionState.js";

const transitions: Record<TransactionState, readonly TransactionState[]> = {
  [TransactionState.Pending]: [
    TransactionState.Initialized,
    TransactionState.Failed,
  ],
  [TransactionState.Initialized]: [
    TransactionState.Pending,
    TransactionState.Running,
    TransactionState.Committing,
    TransactionState.RollingBack,
    TransactionState.Stopping,
    TransactionState.Failed,
  ],
  [TransactionState.Running]: [
    TransactionState.Running,
    TransactionState.Initialized,
    TransactionState.Committing,
    TransactionState.RollingBack,
    TransactionState.Stopping,
    TransactionState.Failed,
  ],
  [TransactionState.Committing]: [
    TransactionState.Committed,
    TransactionState.Failed,
  ],
  [TransactionState.Committed]: [TransactionState.Pending],
  [TransactionState.RollingBack]: [TransactionState.RolledBack, TransactionState.Failed],
  [TransactionState.RolledBack]: [TransactionState.Pending],
  [TransactionState.Stopping]: [TransactionState.Stopped, TransactionState.Failed],
  [TransactionState.Stopped]: [TransactionState.Pending],
  [TransactionState.Failed]: [
    TransactionState.Pending,
    TransactionState.RollingBack,
  ],
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
