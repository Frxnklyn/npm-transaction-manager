export interface TransactionParticipantInterface {
  commit(): void | Promise<void>;
  rollback(): void | Promise<void>;
}
