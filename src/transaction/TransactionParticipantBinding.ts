import type { UpdaterInterface } from "../interfaces/UpdaterInterface.js";
import type { TransactionParticipantInterface } from "../interfaces/TransactionParticipantInterface.js";

/** Internal cleanup state for one participant attached to a transaction. */
export interface TransactionParticipantBinding {
  /** Participant managed by the transaction. */
  readonly participant: TransactionParticipantInterface;
  /** Exact updater instance installed before the transaction started. */
  readonly originalUpdater: UpdaterInterface;
  /** Optional updater installed while persistence is deferred. */
  readonly transactionUpdater: UpdaterInterface | undefined;
  /** Whether the original updater is currently installed. */
  updaterRestored: boolean;
  /** Whether the operation registrar is currently detached. */
  detached: boolean;
}
