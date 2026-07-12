import { CommitError } from "../errors/CommitError.js";
import { RollbackError } from "../errors/RollbackError.js";
import { TransactionChange } from "./TransactionChange.js";
import { TransactionEntry } from "./TransactionEntry.js";
import type { TransactionParticipantInterface } from "./TransactionParticipantInterface.js";
import { TransactionState } from "./TransactionState.js";
import { TransactionStateMachine } from "./TransactionStateMachine.js";

export class Transaction {
  private readonly entries: TransactionEntry[] = [];
  private readonly stateMachine = new TransactionStateMachine();

  getState(): TransactionState {
    return this.stateMachine.getState();
  }

  getEntries(): readonly TransactionEntry[] {
    return this.entries;
  }

  add(participant: TransactionParticipantInterface, description?: string): TransactionEntry {
    const entry = new TransactionEntry(new TransactionChange(participant, { description }));
    this.entries.push(entry);
    return entry;
  }

  async commit(): Promise<void> {
    this.stateMachine.transitionTo(TransactionState.Committing);
    const committedEntries: TransactionEntry[] = [];

    for (const entry of this.entries) {
      try {
        await entry.commit();
        committedEntries.push(entry);
      } catch (error) {
        entry.markFailed(error);
        this.stateMachine.transitionTo(TransactionState.RollingBack);
        await this.rollbackEntries([...committedEntries].reverse());
        this.stateMachine.transitionTo(TransactionState.Failed);
        throw new CommitError("Transaction commit failed.", entry, error);
      }
    }

    this.stateMachine.transitionTo(TransactionState.Committed);
  }

  async rollback(): Promise<void> {
    this.stateMachine.transitionTo(TransactionState.RollingBack);
    await this.rollbackEntries([...this.entries].reverse());
    this.stateMachine.transitionTo(TransactionState.RolledBack);
  }

  private async rollbackEntries(entries: readonly TransactionEntry[]): Promise<void> {
    for (const entry of entries) {
      try {
        await entry.rollback();
      } catch (error) {
        entry.markFailed(error);
        throw new RollbackError("Transaction rollback failed.", entry, error);
      }
    }
  }
}
