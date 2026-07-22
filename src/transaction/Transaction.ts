import type { TransactionCommitStrategyInterface } from "../interfaces/TransactionCommitStrategyInterface.js";
import type { TransactionParticipantInterface } from "../interfaces/TransactionParticipantInterface.js";
import type { UpdaterInterface } from "../interfaces/UpdaterInterface.js";
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

  /** Installs a fresh no-op updater for each attached participant. */
  protected override createTransactionUpdater(
    _participant: TransactionParticipantInterface,
  ): UpdaterInterface {
    return this.disabledUpdater;
  }

  /** Backwards-compatible alias for {@link submit}. */
  async commit(): Promise<void> {
    return this.submit();
  }
}
