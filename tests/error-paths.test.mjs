import assert from "node:assert/strict";
import test from "node:test";

import {
  CommitError,
  DisabledUpdater,
  RollbackError,
  Transaction,
  TransactionState,
} from "../dist/index.js";
import {
  RecordingUpdater,
  TestParticipant,
} from "./fixtures/TestParticipant.mjs";

test("a commit failure still restores the original updater and detaches the registrar", async () => {
  const persistenceError = new Error("persistence failed");
  const originalUpdater = new RecordingUpdater(() => {
    throw persistenceError;
  });
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.add(participant);
  transaction.start();
  await participant.append("dirty");

  await assert.rejects(transaction.commit(), (error) => {
    assert.ok(error instanceof CommitError);
    assert.strictEqual(error.cause, persistenceError);
    return true;
  });

  assert.equal(transaction.getState(), TransactionState.Failed);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(participant.transactionRegistrar, null);
});

test("a rollback failure still restores the original updater and detaches the registrar", async () => {
  const operationRollbackError = new Error("rollback failed");
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.add(participant);
  transaction.start();
  await participant.append("dirty", { rollbackError: operationRollbackError });

  await assert.rejects(transaction.rollback(), (error) => {
    assert.ok(error instanceof RollbackError);
    assert.deepEqual(error.errors, [operationRollbackError]);
    return true;
  });

  assert.equal(transaction.getState(), TransactionState.Failed);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(participant.transactionRegistrar, null);
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
  transaction.start();
  await participant.append("dirty");

  await assert.rejects(transaction.commit(), (error) => {
    assert.ok(error instanceof CommitError);
    assert.ok(error.cause instanceof AggregateError);
    assert.deepEqual(error.cause.errors, [persistenceError, detachError]);
    return true;
  });

  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.strictEqual(participant.transactionRegistrar, transaction);
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
  transaction.start();
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

test("an attach failure detaches a partial registrar and restores the updater", () => {
  const attachError = new Error("attach failed");
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater, {
    onAttach() {
      throw attachError;
    },
  });
  const transaction = new Transaction();

  transaction.add(participant);
  assert.throws(
    () => transaction.start(),
    (error) => error === attachError,
  );

  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(participant.transactionRegistrar, null);
  assert.equal(participant.attachCalls, 1);
  assert.equal(participant.detachCalls, 1);
  assert.equal(transaction.getState(), TransactionState.Pending);
});

test("an attach failure aggregates detach cleanup without replacing the updater", () => {
  const attachError = new Error("attach failed");
  const detachError = new Error("detach failed");
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater, {
    onAttach() {
      throw attachError;
    },
    onDetach() {
      throw detachError;
    },
  });
  const transaction = new Transaction();

  transaction.add(participant);
  assert.throws(() => transaction.start(), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [attachError, detachError]);
    return true;
  });

  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.strictEqual(participant.transactionRegistrar, transaction);
  assert.equal(transaction.getState(), TransactionState.Failed);
});

test("a temporary updater installation failure restores and detaches the participant", () => {
  const updaterError = new Error("temporary updater failed");
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater, {
    onSetUpdater(updater) {
      if (updater instanceof DisabledUpdater) {
        throw updaterError;
      }
    },
  });
  const transaction = new Transaction();

  transaction.add(participant);
  assert.throws(
    () => transaction.start(),
    (error) => error === updaterError,
  );

  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(participant.transactionRegistrar, null);
  assert.equal(participant.attachCalls, 1);
  assert.equal(participant.detachCalls, 1);
  assert.equal(transaction.getState(), TransactionState.Pending);
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
  transaction.start();
  await participant.append("dirty");

  await assert.rejects(transaction.commit(), (error) => {
    assert.ok(error instanceof CommitError);
    assert.strictEqual(error.cause, detachError);
    return true;
  });

  assert.equal(transaction.getState(), TransactionState.CommitCleanupFailed);
  assert.strictEqual(participant.transactionRegistrar, transaction);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(originalUpdater.calls, 1);
  assert.deepEqual(participant.values, ["dirty"]);

  transaction.retryCleanup();

  assert.equal(transaction.getState(), TransactionState.Pending);
  assert.equal(detachAttempts, 2);
  assert.equal(participant.transactionRegistrar, null);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(originalUpdater.calls, 1);
  assert.deepEqual(participant.values, ["dirty"]);

  assert.throws(
    () => transaction.retryCleanup(),
    /Cannot retry commit cleanup while the transaction is pending/,
  );
  assert.equal(detachAttempts, 2);
});

test("retryCleanup() is rejected before commit and after rollback", async () => {
  const pending = new Transaction();

  assert.throws(
    () => pending.retryCleanup(),
    /Cannot retry commit cleanup while the transaction is pending/,
  );

  const rolledBack = new Transaction();
  rolledBack.start();
  await rolledBack.rollback();

  assert.throws(
    () => rolledBack.retryCleanup(),
    /Cannot retry commit cleanup while the transaction is pending/,
  );
});

test("rollback cleanup failure is terminal", async () => {
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
  transaction.start();

  await assert.rejects(transaction.rollback(), (error) => {
    assert.ok(error instanceof RollbackError);
    assert.deepEqual(error.errors, [detachError]);
    return true;
  });

  assert.equal(transaction.getState(), TransactionState.Failed);
  assert.strictEqual(participant.transactionRegistrar, transaction);

  await assert.rejects(
    transaction.rollback(),
    /Invalid transaction transition from failed to rolling-back/,
  );

  assert.equal(detachAttempts, 1);
  assert.strictEqual(participant.transactionRegistrar, transaction);
  assert.equal(transaction.getState(), TransactionState.Failed);
});

test("a failed rollback cannot replay successful reversals", async () => {
  const transientRollbackError = new Error("first rollback failed once");
  const participant = new TestParticipant(new RecordingUpdater());
  const transaction = new Transaction();
  let firstRollbackCalls = 0;
  let secondRollbackCalls = 0;

  transaction.add(participant);
  transaction.start();
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

  await assert.rejects(
    transaction.rollback(),
    /Invalid transaction transition from failed to rolling-back/,
  );

  assert.deepEqual(participant.values, ["first"]);
  assert.equal(firstRollbackCalls, 1);
  assert.equal(secondRollbackCalls, 1);
});
