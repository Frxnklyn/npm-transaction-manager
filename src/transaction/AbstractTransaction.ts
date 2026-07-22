import { CommitError } from "../errors/CommitError.js";
import { RollbackError } from "../errors/RollbackError.js";
import type { TransactionCommitStrategyInterface } from "../interfaces/TransactionCommitStrategyInterface.js";
import type { TransactionInterface } from "../interfaces/TransactionInterface.js";
import type { TransactionOperationInterface } from "../interfaces/TransactionOperationInterface.js";
import type { TransactionParticipantInterface } from "../interfaces/TransactionParticipantInterface.js";
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

  private readonly bindings = new Map<TransactionParticipantInterface, TransactionParticipantBinding>();
  private readonly operations: TransactionOperationInterface[] = [];
  private readonly stateMachine = new TransactionStateMachine();

  /** Creates a transaction using the supplied commit strategy. */
  protected constructor(private readonly commitStrategy: TransactionCommitStrategyInterface) {}

  /** Returns the current lifecycle state. */
  getState(): TransactionState {
    return this.stateMachine.getState();
  }

  /** Starts tracking one or more participants by activating all attached bindings. */
  start(participants?: TransactionParticipantInterface | readonly TransactionParticipantInterface[]): void {
    if (participants !== undefined) {
      this.attach(participants);
    }

    try {
      this.stateMachine.transitionTo(TransactionState.Initialized);
    } catch (error) {
      //TODO: error in einen Logger als Warning speichern
    }

    for (const binding of this.bindings.values()) {
      this.activateBinding(binding);
    }
  }

  /** Registers participants without activating them or replacing their updaters. */
  attach(participants: TransactionParticipantInterface | readonly TransactionParticipantInterface[]): this {
    const participantList = Array.isArray(participants) ? participants : [participants];

    for (const participant of participantList) {
      const existingBinding = this.bindings.get(participant);

      if (existingBinding !== undefined) {
        continue;
      }

      const binding: TransactionParticipantBinding = {
        participant,
        originalUpdater: undefined,
        transactionUpdater: undefined,
        updaterRestored: true,
        detached: true,
      };

      this.bindings.set(participant, binding);
    }

    return this;
  }

  /** Attaches one added participant and optionally installs a transaction updater. */
  private activateBinding(binding: TransactionParticipantBinding): void {
    binding.originalUpdater = binding.participant.getUpdater();
    binding.transactionUpdater = this.disabledUpdater;

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
        throw new AggregateError([error, ...cleanupErrors], "Attaching the transaction participant failed and cleanup was incomplete.");
      }

      this.stateMachine.transitionTo(TransactionState.Pending);
      throw error;
    }
  }

  /** Registers an already-applied operation in registration order. */
  registerOperation(operation: TransactionOperationInterface): void {
    const binding = this.bindings.get(operation.participant);

    if (binding === undefined || !this.isBindingActive(binding)) {
      throw new Error(`Cannot register operation "${operation.name}" for an unknown participant.`);
    }

    this.stateMachine.transitionTo(TransactionState.Running);
    this.operations.push(operation);
  }

  /** Enables updates and commits while keeping participants attached. */
  async submit(): Promise<void> {
    this.stateMachine.transitionTo(TransactionState.Committing);
    const restoreErrors: unknown[] = [];

    for (const binding of this.bindings.values()) {
      try {
        binding.participant.setUpdater(this.enabledUpdater);
        binding.updaterRestored = false;
      } catch (error) {
        restoreErrors.push(error);
      }
    }

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

    errors.push(...this.restoreUpdaters());
    this.operations.length = 0;

    if (errors.length > 0) {
      this.stateMachine.transitionTo(TransactionState.Failed);
      throw new RollbackError("Transaction rollback failed.", errors);
    }
    this.stateMachine.transitionTo(TransactionState.RolledBack);
    this.stateMachine.transitionTo(TransactionState.Pending);
  }

  /** Restores original updaters while discarding persistence and undo work. */
  async stop(): Promise<void> {
    this.stateMachine.transitionTo(TransactionState.Stopping);
    const errors = this.restoreUpdaters();
    this.operations.length = 0;

    if (errors.length > 0) {
      this.stateMachine.transitionTo(TransactionState.Failed);
      throw this.toCause(errors, "Transaction stop cleanup failed.");
    }
    this.stateMachine.transitionTo(TransactionState.Stopped);
    this.stateMachine.transitionTo(TransactionState.Pending);
  }

  /** Detaches participants explicitly through the shared binding cleanup path. */
  detach(
    participants?: TransactionParticipantInterface | readonly TransactionParticipantInterface[],
  ): void {
    const errors = this.detachParticipants(participants);

    if (errors.length > 0) {
      throw this.toCause(errors, "Transaction detach failed.");
    }
  }

  /** Marks commit failure, performs best-effort cleanup, and throws. */
  private failCommit(initialErrors: readonly unknown[], message: string): never {
    const errors = [...initialErrors];
    this.operations.length = 0;
    this.stateMachine.transitionTo(TransactionState.Failed);
    throw new CommitError(message, this.toCause(errors, message));
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

  /** Cleans selected bindings through the same restore and detach path. */
  private detachParticipants(
    participants?: TransactionParticipantInterface | readonly TransactionParticipantInterface[],
  ): unknown[] {
    const errors: unknown[] = [];
    const participantSet = participants === undefined
      ? undefined
      : new Set(Array.isArray(participants) ? participants : [participants]);

    for (const binding of this.bindings.values()) {
      if (participantSet !== undefined && !participantSet.has(binding.participant)) {
        continue;
      }

      errors.push(...this.cleanupBinding(binding));
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
    return !binding.detached && (binding.transactionUpdater === undefined || !binding.updaterRestored);
  }

  /** Returns a single cause directly and aggregates multiple causes. */
  private toCause(errors: readonly unknown[], message: string): unknown {
    return errors.length === 1 ? errors[0] : new AggregateError(errors, message);
  }
}
