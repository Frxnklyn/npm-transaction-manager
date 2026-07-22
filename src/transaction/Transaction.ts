import type { TransactionCommitStrategyInterface } from "../interfaces/TransactionCommitStrategyInterface.js";
import { AbstractTransaction } from "./AbstractTransaction.js";
import { PerParticipantTransactionCommitStrategy } from "./CommitStrategies/PerParticipantTransactionCommitStrategy.js";

/** Transaction that defers persistence through a temporary no-op updater. */
export class Transaction extends AbstractTransaction {
  /** Creates a transaction with per-participant commit as its default strategy. */
  constructor(
    commitStrategy: TransactionCommitStrategyInterface =
      new PerParticipantTransactionCommitStrategy(),
  ) {
    super(commitStrategy);
  }

  /** Backwards-compatible alias for {@link submit}. */
  async commit(): Promise<void> {
    return this.submit();
  }
}
