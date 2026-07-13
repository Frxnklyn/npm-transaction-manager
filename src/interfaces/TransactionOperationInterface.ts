import type { TransactionParticipantInterface } from "./TransactionParticipantInterface.js";

/** Represents one already-applied change that can be reversed. */
export interface TransactionOperationInterface {
  /** Human-readable identifier used for diagnostics. */
  readonly name: string;

  /** Participant whose in-memory state was changed. */
  readonly participant: TransactionParticipantInterface;

  /** Reverses the already-applied in-memory change. */
  rollback(): void | Promise<void>;
}
