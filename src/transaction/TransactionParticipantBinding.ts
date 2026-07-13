import type { UpdaterInterface } from "../interfaces/UpdaterInterface.js";
import type { TransactionParticipantInterface } from "../interfaces/TransactionParticipantInterface.js";

/** Internal bookkeeping for one participant attached to a transaction. */
export interface TransactionParticipantBinding {
  /** Participant currently managed by the transaction. */
  readonly participant: TransactionParticipantInterface;
  /** Updater restored after submit or rollback cleanup. */
  readonly originalUpdater: UpdaterInterface;
  /** Temporary updater used to suppress persistence during the transaction. */
  readonly disabledUpdater: UpdaterInterface;
  /** Whether attaching the transaction context completed. */
  attachmentCompleted: boolean;
  /** Whether the participant still needs to be detached. */
  detachRequired: boolean;
  /** Whether installing the temporary updater completed. */
  updaterReplacementCompleted: boolean;
  /** Whether the original updater is already restored. */
  updaterRestored: boolean;
}
