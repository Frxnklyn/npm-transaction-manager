import { CommitError } from "../errors/CommitError.js";
import type { TransactionContextInterface } from "../interfaces/TransactionContextInterface.js";
import type { TransactionOperationInterface } from "../interfaces/TransactionOperationInterface.js";
import type { TransactionParticipantInterface } from "../interfaces/TransactionParticipantInterface.js";
import { RollbackError } from "../errors/RollbackError.js";
import { DisabledUpdater } from "../updater/DisabledUpdater.js";
import type { UpdaterInterface } from "../interfaces/UpdaterInterface.js";
import type { TransactionParticipantBinding } from "./TransactionParticipantBinding.js";
import { TransactionState } from "./TransactionState.js";
import { TransactionStateMachine } from "./TransactionStateMachine.js";

/**
 * Coordinates in-memory rollback operations and delayed persistence for attached
 * participants. `submit()` persists every participant in attachment order.
 */
export class Transaction implements TransactionContextInterface {
  private readonly bindings = new Map<
    TransactionParticipantInterface,
    TransactionParticipantBinding
  >();
  private readonly operations: TransactionOperationInterface[] = [];
  private readonly stateMachine = new TransactionStateMachine();

  /** Returns the current lifecycle state. */
  getState(): TransactionState {
    return this.stateMachine.getState();
  }

  /**
   * Attaches a participant and temporarily replaces its updater with a no-op
   * updater, preventing persistence until the transaction is submitted.
   */
  add(participant: TransactionParticipantInterface): this {
    this.assertPending("add a participant");

    const existingBinding = this.bindings.get(participant);

    if (existingBinding !== undefined) {
      if (this.isBindingActive(existingBinding)) {
        return this;
      }

      throw new Error(
        "Cannot add a participant whose previous binding cleanup is incomplete.",
      );
    }

    const originalUpdater = participant.getUpdater();
    const disabledUpdater = new DisabledUpdater();
    const binding: TransactionParticipantBinding = {
      participant,
      originalUpdater,
      disabledUpdater,
      attachmentCompleted: false,
      detachRequired: false,
      updaterReplacementCompleted: false,
      updaterRestored: true,
    };

    this.bindings.set(participant, binding);

    try {
      binding.updaterRestored = false;
      participant.setUpdater(disabledUpdater);
      binding.updaterReplacementCompleted = true;
      binding.detachRequired = true;
      participant.attachTransaction(this);
      binding.attachmentCompleted = true;
    } catch (error) {
      const cleanupErrors = this.detachBinding(binding);

      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          "Attaching the transaction participant failed and cleanup was incomplete.",
        );
      }

      throw error;
    }

    return this;
  }

  /** Registers the rollback behavior for a change that has already been applied. */
  register(operation: TransactionOperationInterface): void {
    this.assertPending("register an operation");
    const binding = this.bindings.get(operation.participant);

    if (binding === undefined || !this.isBindingActive(binding)) {
      throw new Error(
        `Transaction operation "${operation.name}" belongs to a participant that is not attached.`,
      );
    }

    this.operations.push(operation);
  }

  /**
   * Persists every attached participant sequentially through its original
   * updater, then detaches participants and restores those original updaters.
   */
  async submit(): Promise<void> {
    this.stateMachine.transitionTo(TransactionState.Committing);
    const commitErrors: unknown[] = [];

    try {
      for (const binding of this.bindings.values()) {
        await this.persistWithOriginalUpdater(binding.originalUpdater);
      }
    } catch (error) {
      commitErrors.push(error);
    }

    if (commitErrors.length > 0) {
      commitErrors.push(...this.detachParticipants());
      this.stateMachine.transitionTo(TransactionState.Failed);
      const cause = commitErrors.length === 1
        ? commitErrors[0]
        : new AggregateError(commitErrors, "Transaction submit and cleanup failed.");

      throw new CommitError("Transaction submit failed.", cause);
    }

    this.stateMachine.transitionTo(TransactionState.Committed);
    const cleanupErrors = this.detachParticipants();

    if (cleanupErrors.length > 0) {
      const cause = cleanupErrors.length === 1
        ? cleanupErrors[0]
        : new AggregateError(cleanupErrors, "Transaction submit cleanup failed.");

      throw new CommitError("Transaction submitted, but cleanup failed.", cause);
    }
  }

  /** Backwards-compatible alias for {@link submit}. */
  async commit(): Promise<void> {
    return this.submit();
  }

  /** Reverses registered operations in reverse order and detaches participants. */
  async rollback(): Promise<void> {
    this.stateMachine.transitionTo(TransactionState.RollingBack);
    const rollbackErrors: unknown[] = [];

    for (let index = this.operations.length - 1; index >= 0; index -= 1) {
      try {
        await this.operations[index].rollback();
        this.operations.splice(index, 1);
      } catch (error) {
        rollbackErrors.push(error);
      }
    }

    rollbackErrors.push(...this.detachParticipants());

    if (rollbackErrors.length > 0) {
      this.stateMachine.transitionTo(TransactionState.Failed);
      throw new RollbackError("Transaction rollback failed.", rollbackErrors);
    }

    this.stateMachine.transitionTo(TransactionState.RolledBack);
  }

  /** Retries participant detachment after a successful submit whose cleanup failed. */
  retryCleanup(): void {
    if (this.getState() !== TransactionState.Committed) {
      throw new Error(
        `Cannot retry commit cleanup while the transaction is ${this.getState()}.`,
      );
    }

    const cleanupErrors = this.detachParticipants();

    if (cleanupErrors.length > 0) {
      const cause = cleanupErrors.length === 1
        ? cleanupErrors[0]
        : new AggregateError(cleanupErrors, "Transaction submit cleanup retry failed.");

      throw new CommitError("Transaction submitted, but cleanup retry failed.", cause);
    }
  }

  /** Ensures mutations of transaction setup only occur before finalization starts. */
  private assertPending(action: string): void {
    if (this.getState() !== TransactionState.Pending) {
      throw new Error(`Cannot ${action} while the transaction is ${this.getState()}.`);
    }
  }

  /** Detaches every remaining participant and collects cleanup failures. */
  private detachParticipants(): unknown[] {
    const errors: unknown[] = [];

    for (const binding of this.bindings.values()) {
      errors.push(...this.detachBinding(binding));
    }

    return errors;
  }

  /** Restores one participant binding; partial failures remain retryable. */
  private detachBinding(binding: TransactionParticipantBinding): unknown[] {
    const errors: unknown[] = [];

    if (binding.detachRequired) {
      try {
        binding.participant.detachTransaction(this);
        binding.attachmentCompleted = false;
        binding.detachRequired = false;
      } catch (error) {
        errors.push(error);
      }
    }

    if (!binding.updaterRestored) {
      try {
        binding.participant.setUpdater(binding.originalUpdater);
        binding.updaterReplacementCompleted = false;
        binding.updaterRestored = true;
      } catch (error) {
        errors.push(error);
      }
    }

    if (!binding.detachRequired && binding.updaterRestored) {
      this.bindings.delete(binding.participant);
    }

    return errors;
  }

  /** Reports whether a participant is fully attached with its updater disabled. */
  private isBindingActive(binding: TransactionParticipantBinding): boolean {
    return binding.attachmentCompleted
      && binding.updaterReplacementCompleted
      && !binding.updaterRestored;
  }

  /**
   * Invokes the optional runtime persistence hook of the original updater.
   * The public UpdaterInterface intentionally remains unchanged.
   */
  private async persistWithOriginalUpdater(
    updater: UpdaterInterface,
  ): Promise<void> {
    const persistingUpdater = updater as UpdaterInterface & {
      update?: () => void | Promise<void>;
    };

    if (typeof persistingUpdater.update !== "function") {
      throw new Error(
        "The original updater must provide an update() method to persist a transaction submit.",
      );
    }

    await persistingUpdater.update();
  }
}
