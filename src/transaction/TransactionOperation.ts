import type { TransactionOperationInterface } from "../interfaces/TransactionOperationInterface.js";
import type { TransactionParticipantInterface } from "../interfaces/TransactionParticipantInterface.js";

/** Function used to reverse an already-applied in-memory change. */
export type TransactionRollbackFunction = () => void | Promise<void>;

/** Default immutable implementation of a rollback-only transaction operation. */
export class TransactionOperation implements TransactionOperationInterface {
  /** Creates an operation for one participant and its rollback behavior. */
  constructor(
    public readonly name: string,
    public readonly participant: TransactionParticipantInterface,
    private readonly rollbackFunction: TransactionRollbackFunction,
  ) {}

  /** Executes the operation's rollback behavior. */
  rollback(): void | Promise<void> {
    return this.rollbackFunction();
  }
}
