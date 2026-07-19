import { TransactionOperation } from "../../dist/index.js";

export class RecordingUpdater {
  constructor(onUpdate = undefined) {
    this.calls = 0;
    this.onUpdate = onUpdate;
  }

  async recordUpdate() {
    this.calls += 1;
    await this.onUpdate?.();
  }
}

export class TestParticipant {
  #updater;

  constructor(updater, hooks = {}) {
    this.#updater = updater;
    this.hooks = hooks;
    this.transactionRegistrar = null;
    this.values = [];
    this.attachCalls = 0;
    this.detachCalls = 0;
    this.setUpdaterCalls = 0;
    this.updaterAssignments = [];
  }

  getUpdater() {
    return this.#updater;
  }

  setUpdater(updater) {
    this.setUpdaterCalls += 1;
    this.hooks.onSetUpdater?.(updater, this);
    this.#updater = updater;
    this.updaterAssignments.push(updater);
  }

  async update() {
    if (
      typeof this.#updater.shouldUpdate === "function"
      && !this.#updater.shouldUpdate()
    ) {
      return;
    }

    await this.#updater.recordUpdate?.();
  }

  attachTransaction(transaction) {
    this.attachCalls += 1;

    if (
      this.transactionRegistrar !== null
      && this.transactionRegistrar !== transaction
    ) {
      throw new Error("The fixture is already attached to another transaction.");
    }

    this.transactionRegistrar = transaction;
    this.hooks.onAttach?.(transaction, this);
  }

  detachTransaction(transaction) {
    this.detachCalls += 1;

    if (this.transactionRegistrar !== transaction) {
      throw new Error("The fixture was detached with an unexpected registrar.");
    }

    this.hooks.onDetach?.(transaction, this);
    this.transactionRegistrar = null;
  }

  async perform(name, apply, rollback) {
    await apply();

    const operation = new TransactionOperation(
      name,
      this,
      rollback,
    );

    if (this.transactionRegistrar !== null) {
      this.transactionRegistrar.registerOperation(operation);
      return;
    }

    await this.update();
  }

  async append(
    value,
    {
      events = undefined,
      executeError = undefined,
      rollbackError = undefined,
    } = {},
  ) {
    await this.perform(
      `append:${value}`,
      () => {
        events?.push(`execute:${value}`);

        if (executeError !== undefined) {
          throw executeError;
        }

        this.values.push(value);
      },
      () => {
        events?.push(`rollback:${value}`);

        if (rollbackError !== undefined) {
          throw rollbackError;
        }

        const index = this.values.lastIndexOf(value);

        if (index >= 0) {
          this.values.splice(index, 1);
        }
      },
    );
  }
}
