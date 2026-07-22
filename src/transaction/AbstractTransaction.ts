import { CommitError } from "../errors/CommitError.js";
import { RollbackError } from "../errors/RollbackError.js";
import type { TransactionCommitStrategyInterface } from "../interfaces/TransactionCommitStrategyInterface.js";
import type { TransactionInterface } from "../interfaces/TransactionInterface.js";
import type { TransactionOperationInterface } from "../interfaces/TransactionOperationInterface.js";
import type { TransactionParticipantInterface } from "../interfaces/TransactionParticipantInterface.js";
import type { UpdaterInterface } from "../interfaces/UpdaterInterface.js";
import { DisabledUpdater } from "../updater/DisabledUpdater.js";
import { EnabledUpdater } from "../updater/EnabledUpdater.js";
import type { TransactionParticipantBinding } from "./TransactionParticipantBinding.js";
import { TransactionState } from "./TransactionState.js";
import { TransactionStateMachine } from "./TransactionStateMachine.js";

/** Manages the shared participant, undo-log, and lifecycle behavior. */
export abstract class AbstractTransaction implements TransactionInterface {
  /** Fixed updater for phases where participant autoupdate must be suppressed. */
  protected readonly disabledUpdater = new DisabledUpdater();

  /** Fixed updater for phases where participant autoupdate must remain enabled. */
  protected readonly enabledUpdater = new EnabledUpdater();

  private readonly bindings = new Map<
    TransactionParticipantInterface,
    TransactionParticipantBinding
  >();
  private readonly operations: TransactionOperationInterface[] = [];
  private readonly stateMachine = new TransactionStateMachine();

  /** Creates a transaction using the supplied commit strategy. */
  protected constructor(
    private readonly commitStrategy: TransactionCommitStrategyInterface,
  ) {}

  /** Returns the current lifecycle state. */
  getState(): TransactionState {
    return this.stateMachine.getState();
  }

  /** Starts tracking one or more participants by activating all added bindings. */
  start(
    participants?:
      | TransactionParticipantInterface
      | readonly TransactionParticipantInterface[],
  ): void {
    this.assertPending("start the transaction");

    if (participants !== undefined) {
      const participantList = Array.isArray(participants)
        ? participants
        : [participants];

      for (const participant of participantList) {
        this.add(participant);
      }
    }

    this.stateMachine.transitionTo(TransactionState.Initialized);

    for (const binding of this.bindings.values()) {
      this.activateBinding(binding);
    }
  }

  /** Adds a participant without attaching it or replacing its updater. */
  add(participant: TransactionParticipantInterface): this {
    this.assertPending("add a participant");

    const existingBinding = this.bindings.get(participant);

    if (existingBinding !== undefined) {
      return this;
    }

    const binding: TransactionParticipantBinding = {
      participant,
      originalUpdater: undefined,
      transactionUpdater: undefined,
      updaterRestored: true,
      detached: true,
    };

    this.bindings.set(participant, binding);

    return this;
  }

  /** Creates the temporary updater installed while the transaction is pending. */
  protected createTransactionUpdater(
    _participant: TransactionParticipantInterface,
  ): UpdaterInterface | undefined {
    return undefined;
  }

  /** Attaches one added participant and optionally installs a transaction updater. */
  private activateBinding(binding: TransactionParticipantBinding): void {
    binding.originalUpdater = binding.participant.getUpdater();
    binding.transactionUpdater = this.createTransactionUpdater(
      binding.participant,
    );

    try {
      binding.detached = false;
      binding.participant.attachTransaction(this);

      if (binding.transactionUpdater !== undefined) {
        binding.updaterRestored = false;
        binding.participant.setUpdater(binding.transactionUpdater);
      }
    } catch (error) {
      const cleanupErrors = this.cleanupBinding(binding);

      if (cleanupErrors.length > 0) {
        this.stateMachine.transitionTo(TransactionState.Failed);
        throw new AggregateError(
          [error, ...cleanupErrors],
          "Attaching the transaction participant failed and cleanup was incomplete.",
        );
      }

      this.stateMachine.transitionTo(TransactionState.Pending);
      throw error;
    }
  }

  /** Registers an already-applied operation in registration order. */
  registerOperation(operation: TransactionOperationInterface): void {
    this.assertInitialized("register an operation");
    const binding = this.bindings.get(operation.participant);

    if (binding === undefined || !this.isBindingActive(binding)) {
      throw new Error(
        `Cannot register operation "${operation.name}" for an unknown participant.`,
      );
    }

    this.operations.push(operation);
  }

  /** Backwards-compatible alias for {@link registerOperation}. */
  register(operation: TransactionOperationInterface): void {
    this.registerOperation(operation);
  }

  /** Restores real updaters, commits, and then detaches participants. */
  async submit(): Promise<void> {
    this.stateMachine.transitionTo(TransactionState.Committing);
    const restoreErrors = this.restoreUpdaters();

    if (restoreErrors.length > 0) {
      this.failCommit(restoreErrors, "Transaction submit setup failed.");
    }

    const participants = Object.freeze([...this.bindings.keys()]);
    const operations = Object.freeze([...this.operations]);

    try {
      await this.commitStrategy.commit(participants, operations);
    } catch (error) {
      this.failCommit([error], "Transaction submit failed.");
    }

    this.operations.length = 0;
    const cleanupErrors = this.detachParticipants();

    if (cleanupErrors.length > 0) {
      this.stateMachine.transitionTo(TransactionState.CommitCleanupFailed);
      throw new CommitError(
        "Transaction submitted, but cleanup failed.",
        this.toCause(cleanupErrors, "Transaction submit cleanup failed."),
      );
    }

    this.bindings.clear();
    this.stateMachine.transitionTo(TransactionState.Committed);
    this.stateMachine.transitionTo(TransactionState.Pending);
  }

  /** Executes undo operations in strict reverse registration order. */
  async rollback(): Promise<void> {
    this.stateMachine.transitionTo(TransactionState.RollingBack);
    const errors: unknown[] = [];

    for (let index = this.operations.length - 1; index >= 0; index -= 1) {
      try {
        await this.operations[index].rollback();
      } catch (error) {
        errors.push(error);
      }
    }

    errors.push(...this.cleanupParticipants());
    this.operations.length = 0;

    if (errors.length > 0) {
      this.stateMachine.transitionTo(TransactionState.Failed);
      throw new RollbackError("Transaction rollback failed.", errors);
    }

    this.bindings.clear();
    this.stateMachine.transitionTo(TransactionState.RolledBack);
    this.stateMachine.transitionTo(TransactionState.Pending);
  }

  /** Retains in-memory changes while discarding persistence and undo work. */
  async stop(): Promise<void> {
    this.stateMachine.transitionTo(TransactionState.Stopping);
    const errors = this.cleanupParticipants();
    this.operations.length = 0;

    if (errors.length > 0) {
      this.stateMachine.transitionTo(TransactionState.Failed);
      throw this.toCause(errors, "Transaction stop cleanup failed.");
    }

    this.bindings.clear();
    this.stateMachine.transitionTo(TransactionState.Stopped);
    this.stateMachine.transitionTo(TransactionState.Pending);
  }

  /** Retries only detach work left after an otherwise successful submit. */
  retryCleanup(): void {
    if (this.getState() !== TransactionState.CommitCleanupFailed) {
      throw new Error(
        `Cannot retry commit cleanup while the transaction is ${this.getState()}.`,
      );
    }

    const cleanupErrors = this.detachParticipants();

    if (cleanupErrors.length > 0) {
      throw new CommitError(
        "Transaction submitted, but cleanup retry failed.",
        this.toCause(cleanupErrors, "Transaction submit cleanup retry failed."),
      );
    }

    this.bindings.clear();
    this.stateMachine.transitionTo(TransactionState.Committed);
    this.stateMachine.transitionTo(TransactionState.Pending);
  }

  /** Marks commit failure, performs best-effort cleanup, and throws. */
  private failCommit(initialErrors: readonly unknown[], message: string): never {
    const errors = [...initialErrors, ...this.cleanupParticipants()];
    this.operations.length = 0;
    this.stateMachine.transitionTo(TransactionState.Failed);
    throw new CommitError(message, this.toCause(errors, message));
  }

  /** Restores all replaced updaters and then detaches all participants. */
  private cleanupParticipants(): unknown[] {
    const errors = this.restoreUpdaters();
    errors.push(...this.detachParticipants());
    return errors;
  }

  /** Restores every updater that was replaced by the transaction. */
  private restoreUpdaters(): unknown[] {
    const errors: unknown[] = [];

    for (const binding of this.bindings.values()) {
      if (binding.updaterRestored) {
        continue;
      }

      try {
        if (binding.originalUpdater !== undefined) {
          binding.participant.setUpdater(binding.originalUpdater);
        }

        binding.updaterRestored = true;
      } catch (error) {
        errors.push(error);
      }
    }

    return errors;
  }

  /** Detaches all remaining registrars without restoring or persisting again. */
  private detachParticipants(): unknown[] {
    const errors: unknown[] = [];

    for (const binding of this.bindings.values()) {
      if (!binding.detached) {
        try {
          binding.participant.detachTransaction(this);
          binding.detached = true;
        } catch (error) {
          errors.push(error);
        }
      }

      if (binding.detached && binding.updaterRestored) {
        this.bindings.delete(binding.participant);
      }
    }

    return errors;
  }

  /** Cleans one partially established binding. */
  private cleanupBinding(binding: TransactionParticipantBinding): unknown[] {
    const errors: unknown[] = [];

    if (!binding.updaterRestored) {
      try {
        if (binding.originalUpdater !== undefined) {
          binding.participant.setUpdater(binding.originalUpdater);
        }

        binding.updaterRestored = true;
      } catch (error) {
        errors.push(error);
      }
    }

    if (!binding.detached) {
      try {
        binding.participant.detachTransaction(this);
        binding.detached = true;
      } catch (error) {
        errors.push(error);
      }
    }

    if (binding.updaterRestored && binding.detached) {
      this.bindings.delete(binding.participant);
    }

    return errors;
  }

  /** Verifies that a participant has a complete live binding. */
  private isBindingActive(binding: TransactionParticipantBinding): boolean {
    return !binding.detached
      && (binding.transactionUpdater === undefined || !binding.updaterRestored);
  }

  /** Restricts participant collection and start to the waiting state. */
  private assertPending(action: string): void {
    if (this.getState() !== TransactionState.Pending) {
      throw new Error(`Cannot ${action} while the transaction is ${this.getState()}.`);
    }
  }

  /** Restricts operation registration and completion to the active state. */
  private assertInitialized(action: string): void {
    if (
      this.getState() !== TransactionState.Initialized
      && this.getState() !== TransactionState.Running
    ) {
      throw new Error(`Cannot ${action} while the transaction is ${this.getState()}.`);
    }
  }

  /** Returns a single cause directly and aggregates multiple causes. */
  private toCause(errors: readonly unknown[], message: string): unknown {
    return errors.length === 1 ? errors[0] : new AggregateError(errors, message);
  }
}
