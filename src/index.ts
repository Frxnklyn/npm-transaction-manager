/** Public package API for transaction handling and the existing updater types. */
export * from "./updater/index.js";
export type { TransactionContextInterface } from "./interfaces/TransactionContextInterface.js";
export { TransactionOperation, type TransactionRollbackFunction } from "./transaction/TransactionOperation.js";
export type { TransactionOperationInterface } from "./interfaces/TransactionOperationInterface.js";
export type { TransactionParticipantInterface } from "./interfaces/TransactionParticipantInterface.js";
export * from "./transaction/TransactionState.js";
export * from "./transaction/Transaction.js";
export * from "./transaction/TransactionStateMachine.js";
export * from "./errors/CommitError.js";
export * from "./errors/RollbackError.js";
export { CommitError as TransactionCommitError } from "./errors/CommitError.js";
export { RollbackError as TransactionRollbackError } from "./errors/RollbackError.js";
export * from "./TransactionManager.js";
