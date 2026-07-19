import type { UpdaterInterface } from "./UpdaterInterface.js";
import type { TransactionOperationRegistrarInterface } from "./TransactionOperationRegistrarInterface.js";

/** Contract implemented by domain objects participating in a transaction. */
export interface TransactionParticipantInterface {
  /** Persists the participant's current state through its installed updater. */
  update(): void | Promise<void>;

  /** Returns the updater currently installed on the participant. */
  getUpdater(): UpdaterInterface;

  /** Replaces the updater currently installed on the participant. */
  setUpdater(updater: UpdaterInterface): void;

  /** Attaches the capability used to report already-applied operations. */
  attachTransaction(transaction: TransactionOperationRegistrarInterface): void;

  /** Detaches the previously attached operation registrar. */
  detachTransaction(transaction: TransactionOperationRegistrarInterface): void;
}
