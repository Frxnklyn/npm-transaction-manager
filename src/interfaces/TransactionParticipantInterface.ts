import type { UpdaterInterface } from "./UpdaterInterface.js";
import type { TransactionContextInterface } from "./TransactionContextInterface.js";

/** Contract implemented by domain objects participating in a transaction. */
export interface TransactionParticipantInterface {
  /** Returns the updater currently installed on the participant. */
  getUpdater(): UpdaterInterface;

  /** Replaces the updater currently installed on the participant. */
  setUpdater(updater: UpdaterInterface): void;

  /** Stores the context while the participant is attached to a transaction. */
  attachTransaction(context: TransactionContextInterface): void;

  /** Removes the context after the participant is detached. */
  detachTransaction(context: TransactionContextInterface): void;
}
