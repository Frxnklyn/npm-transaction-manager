import type { TransactionState } from "../transaction/TransactionState.js";
import type { TransactionOperationRegistrarInterface } from "./TransactionOperationRegistrarInterface.js";
import type { TransactionParticipantInterface } from "./TransactionParticipantInterface.js";

/** Public contract for creating and controlling a transaction. */
export interface TransactionInterface extends TransactionOperationRegistrarInterface {
  /** Returns the current lifecycle state. */
  getState(): TransactionState;

  /** Starts tracking one or more participants in the default pending state. */
  start(
    participants:
      | TransactionParticipantInterface
      | readonly TransactionParticipantInterface[],
  ): void;

  /** Attaches a participant to the transaction. */
  add(participant: TransactionParticipantInterface): this;

  /** Persists the tracked changes using the configured commit strategy. */
  submit(): Promise<void>;

  /** Rolls back all tracked operations in reverse registration order. */
  rollback(): Promise<void>;

  /** Ends tracking without persisting or rolling back in-memory changes. */
  stop(): Promise<void>;

  /** Retries remaining cleanup after persistence completed successfully. */
  retryCleanup(): void;
}
