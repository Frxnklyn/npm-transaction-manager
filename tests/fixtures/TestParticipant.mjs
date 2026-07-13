import { TransactionOperation } from "../../dist/index.js";

export class RecordingUpdater {
  constructor(onUpdate = undefined) {
    this.calls = 0;
    this.onUpdate = onUpdate;
  }

  async update() {
    this.calls += 1;
    await this.onUpdate?.();
  }
}

export class TestParticipant {
  #updater;

  constructor(updater, hooks = {}) {
    this.#updater = updater;
    this.hooks = hooks;
    this.transactionContext = null;
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

  attachTransaction(context) {
    this.attachCalls += 1;

    if (
      this.transactionContext !== null
      && this.transactionContext !== context
    ) {
      throw new Error("The fixture is already attached to another transaction.");
    }

    this.transactionContext = context;
    this.hooks.onAttach?.(context, this);
  }

  detachTransaction(context) {
    this.detachCalls += 1;

    if (this.transactionContext !== context) {
      throw new Error("The fixture was detached with an unexpected context.");
    }

    this.hooks.onDetach?.(context, this);
    this.transactionContext = null;
  }

  async perform(name, apply, rollback) {
    await apply();

    const operation = new TransactionOperation(
      name,
      this,
      rollback,
    );

    if (this.transactionContext !== null) {
      this.transactionContext.register(operation);
      return;
    }

    await this.#updater.update();
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
