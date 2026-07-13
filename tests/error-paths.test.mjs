import assert from "node:assert/strict";
import test from "node:test";

import {
  CommitError,
  DisabledUpdater,
  RollbackError,
  Transaction,
  TransactionOperation,
  TransactionState,
} from "../dist/index.js";
import {
  RecordingUpdater,
  TestParticipant,
} from "./fixtures/TestParticipant.mjs";

test("a commit failure still restores the original updater and removes context", async () => {
  const persistenceError = new Error("persistence failed");
  const originalUpdater = new RecordingUpdater(() => {
    throw persistenceError;
  });
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.add(participant);
  await participant.append("dirty");

  await assert.rejects(transaction.commit(), (error) => {
    assert.ok(error instanceof CommitError);
    assert.strictEqual(error.cause, persistenceError);
    return true;
  });

  assert.equal(transaction.getState(), TransactionState.Failed);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(participant.transactionContext, null);
});

test("a rollback operation failure still restores the original updater and removes context", async () => {
  const operationRollbackError = new Error("rollback failed");
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.add(participant);
  await participant.append("dirty", { rollbackError: operationRollbackError });

  await assert.rejects(transaction.rollback(), (error) => {
    assert.ok(error instanceof RollbackError);
    assert.deepEqual(error.errors, [operationRollbackError]);
    return true;
  });

  assert.equal(transaction.getState(), TransactionState.Failed);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(participant.transactionContext, null);
  assert.equal(originalUpdater.calls, 0);
});

test("commit aggregates persistence and detach failures while restoring the updater", async () => {
  const persistenceError = new Error("persistence failed");
  const detachError = new Error("detach failed");
  const originalUpdater = new RecordingUpdater(() => {
    throw persistenceError;
  });
  const participant = new TestParticipant(originalUpdater, {
    onDetach() {
      throw detachError;
    },
  });
  const transaction = new Transaction();

  transaction.add(participant);
  await participant.append("dirty");

  await assert.rejects(transaction.commit(), (error) => {
    assert.ok(error instanceof CommitError);
    assert.ok(error.cause instanceof AggregateError);
    assert.deepEqual(error.cause.errors, [persistenceError, detachError]);
    return true;
  });

  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.strictEqual(participant.transactionContext, transaction);
});

test("rollback attempts every reversal and aggregates rollback plus detach failures", async () => {
  const firstRollbackError = new Error("first rollback failed");
  const secondRollbackError = new Error("second rollback failed");
  const detachError = new Error("detach failed");
  const events = [];
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater, {
    onDetach() {
      throw detachError;
    },
  });
  const transaction = new Transaction();

  transaction.add(participant);
  await participant.append("first", {
    events,
    rollbackError: firstRollbackError,
  });
  await participant.append("second", {
    events,
    rollbackError: secondRollbackError,
  });

  await assert.rejects(transaction.rollback(), (error) => {
    assert.ok(error instanceof RollbackError);
    assert.deepEqual(error.errors, [
      secondRollbackError,
      firstRollbackError,
      detachError,
    ]);
    return true;
  });

  assert.deepEqual(events, [
    "execute:first",
    "execute:second",
    "rollback:second",
    "rollback:first",
  ]);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
});

test("an attach failure detaches partial context and restores the original updater", () => {
  const attachError = new Error("attach failed");
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater, {
    onAttach() {
      throw attachError;
    },
  });
  const transaction = new Transaction();

  assert.throws(
    () => transaction.add(participant),
    (error) => error === attachError,
  );

  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(participant.transactionContext, null);
  assert.equal(participant.attachCalls, 1);
  assert.equal(participant.detachCalls, 1);
  assert.equal(transaction.getState(), TransactionState.Pending);
});

test("an attach failure aggregates detach and updater-restoration cleanup errors", () => {
  const attachError = new Error("attach failed");
  const detachError = new Error("detach failed");
  const restoreError = new Error("restore failed");
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater, {
    onAttach() {
      throw attachError;
    },
    onDetach() {
      throw detachError;
    },
    onSetUpdater(updater) {
      if (updater === originalUpdater) {
        throw restoreError;
      }
    },
  });
  const transaction = new Transaction();

  assert.throws(() => transaction.add(participant), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [attachError, detachError, restoreError]);
    return true;
  });

  assert.ok(participant.getUpdater() instanceof DisabledUpdater);
  assert.strictEqual(participant.transactionContext, transaction);
});

test("incomplete attach binding rejects registration and second add before cleanup retry", async () => {
  const attachError = new Error("attach failed");
  const restoreError = new Error("restore failed once");
  const originalUpdater = new RecordingUpdater();
  let restoreAttempts = 0;
  const participant = new TestParticipant(originalUpdater, {
    onAttach() {
      throw attachError;
    },
    onSetUpdater(updater) {
      if (updater === originalUpdater) {
        restoreAttempts += 1;

        if (restoreAttempts === 1) {
          throw restoreError;
        }
      }
    },
  });
  const transaction = new Transaction();

  assert.throws(() => transaction.add(participant), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [attachError, restoreError]);
    return true;
  });

  assert.ok(participant.getUpdater() instanceof DisabledUpdater);
  assert.equal(participant.transactionContext, null);

  assert.throws(
    () => transaction.add(participant),
    /previous binding cleanup is incomplete/,
  );

  assert.throws(
    () => transaction.register(new TransactionOperation(
      "must-not-run",
      participant,
      () => {
        throw new Error("The rollback must not be registered.");
      },
    )),
    /participant that is not attached/,
  );

  await transaction.rollback();

  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(restoreAttempts, 2);
  assert.equal(transaction.getState(), TransactionState.RolledBack);
});

test("retryCleanup() resolves a transient cleanup failure without new persistence", async () => {
  const detachError = new Error("detach failed once");
  const originalUpdater = new RecordingUpdater();
  let detachAttempts = 0;
  const participant = new TestParticipant(originalUpdater, {
    onDetach() {
      detachAttempts += 1;

      if (detachAttempts === 1) {
        throw detachError;
      }
    },
  });
  const transaction = new Transaction();

  transaction.add(participant);
  await participant.append("dirty");

  await assert.rejects(transaction.commit(), (error) => {
    assert.ok(error instanceof CommitError);
    assert.strictEqual(error.cause, detachError);
    return true;
  });

  assert.equal(transaction.getState(), TransactionState.Committed);
  assert.strictEqual(participant.transactionContext, transaction);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(originalUpdater.calls, 1);
  assert.deepEqual(participant.values, ["dirty"]);

  transaction.retryCleanup();

  assert.equal(transaction.getState(), TransactionState.Committed);
  assert.equal(detachAttempts, 2);
  assert.equal(participant.transactionContext, null);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(originalUpdater.calls, 1);
  assert.deepEqual(participant.values, ["dirty"]);

  transaction.retryCleanup();
  assert.equal(detachAttempts, 2);
});

test("retryCleanup() is rejected before commit and after rollback", async () => {
  const pending = new Transaction();

  assert.throws(
    () => pending.retryCleanup(),
    /Cannot retry commit cleanup while the transaction is pending/,
  );

  const rolledBack = new Transaction();
  await rolledBack.rollback();

  assert.throws(
    () => rolledBack.retryCleanup(),
    /Cannot retry commit cleanup while the transaction is rolled_back/,
  );
});

test("rollback cleanup failure remains recoverable instead of becoming terminal", async () => {
  const detachError = new Error("detach failed once");
  const originalUpdater = new RecordingUpdater();
  let detachAttempts = 0;
  const participant = new TestParticipant(originalUpdater, {
    onDetach() {
      detachAttempts += 1;

      if (detachAttempts === 1) {
        throw detachError;
      }
    },
  });
  const transaction = new Transaction();

  transaction.add(participant);

  await assert.rejects(transaction.rollback(), (error) => {
    assert.ok(error instanceof RollbackError);
    assert.deepEqual(error.errors, [detachError]);
    return true;
  });

  assert.equal(transaction.getState(), TransactionState.Failed);
  assert.strictEqual(participant.transactionContext, transaction);

  await transaction.rollback();

  assert.equal(detachAttempts, 2);
  assert.equal(participant.transactionContext, null);
  assert.equal(transaction.getState(), TransactionState.RolledBack);
});

test("retrying a partial rollback does not execute successful reversals twice", async () => {
  const transientRollbackError = new Error("first rollback failed once");
  const participant = new TestParticipant(new RecordingUpdater());
  const transaction = new Transaction();
  let firstRollbackCalls = 0;
  let secondRollbackCalls = 0;

  transaction.add(participant);
  await participant.perform(
    "first",
    () => {
      participant.values.push("first");
    },
    () => {
      firstRollbackCalls += 1;

      if (firstRollbackCalls === 1) {
        throw transientRollbackError;
      }

      participant.values.splice(participant.values.indexOf("first"), 1);
    },
  );
  await participant.perform(
    "second",
    () => {
      participant.values.push("second");
    },
    () => {
      secondRollbackCalls += 1;
      participant.values.splice(participant.values.indexOf("second"), 1);
    },
  );

  await assert.rejects(transaction.rollback(), (error) => {
    assert.ok(error instanceof RollbackError);
    assert.deepEqual(error.errors, [transientRollbackError]);
    return true;
  });

  assert.deepEqual(participant.values, ["first"]);
  assert.equal(firstRollbackCalls, 1);
  assert.equal(secondRollbackCalls, 1);

  await transaction.rollback();

  assert.deepEqual(participant.values, []);
  assert.equal(firstRollbackCalls, 2);
  assert.equal(secondRollbackCalls, 1);
});
