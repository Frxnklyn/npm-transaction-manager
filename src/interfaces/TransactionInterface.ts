import type { TransactionState } from "../transaction/TransactionState.js";
import type { TransactionOperationRegistrarInterface } from "./TransactionOperationRegistrarInterface.js";
import type { TransactionParticipantInterface } from "./TransactionParticipantInterface.js";

/** Public contract for creating and controlling a transaction. */
export interface TransactionInterface extends TransactionOperationRegistrarInterface {
  /** Returns the current lifecycle state. */
  getState(): TransactionState;

  /** Starts tracking attached participants in the default pending state. */
  start(
    participants?:
      | TransactionParticipantInterface
      | readonly TransactionParticipantInterface[],
  ): void;

  /** Registers one or more participants for activation on start. */
  attach(
    participants:
      | TransactionParticipantInterface
      | readonly TransactionParticipantInterface[],
  ): this;

  /** Persists the tracked changes using the configured commit strategy. */
  submit(): Promise<void>;

  /** Rolls back all tracked operations in reverse registration order. */
  rollback(): Promise<void>;

  /** Ends tracking without persisting or rolling back in-memory changes. */
  stop(): Promise<void>;

  /** Pauses tracking without persisting or rolling back in-memory changes. */
  pause(): Promise<void>;

  /** Restores and detaches one or more participants. */
  detach(
    participants?:
      | TransactionParticipantInterface
      | readonly TransactionParticipantInterface[],
  ): void;
}
