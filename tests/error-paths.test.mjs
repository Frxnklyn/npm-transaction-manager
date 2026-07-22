import assert from "node:assert/strict";
import test from "node:test";

import {
  CommitError,
  DisabledUpdater,
  EnabledUpdater,
  RollbackError,
  Transaction,
  TransactionState,
} from "../dist/index.js";
import {
  RecordingUpdater,
  TestParticipant,
} from "./fixtures/TestParticipant.mjs";

test("a commit failure leaves the enabled updater installed and keeps the registrar attached", async () => {
  const persistenceError = new Error("persistence failed");
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater, {
    onUpdate() {
      throw persistenceError;
    },
  });
  const transaction = new Transaction();

  transaction.attach(participant);
  transaction.start();
  await participant.append("dirty");

  await assert.rejects(transaction.commit(), (error) => {
    assert.ok(error instanceof CommitError);
    assert.strictEqual(error.cause, persistenceError);
    return true;
  });

  assert.equal(transaction.getState(), TransactionState.Failed);
  assert.ok(participant.getUpdater() instanceof EnabledUpdater);
  assert.strictEqual(participant.transactionRegistrar, transaction);
  assert.equal(participant.updateCalls, 1);
  assert.equal(originalUpdater.calls, 0);
});

test("a rollback failure leaves the enabled updater installed and keeps the registrar attached", async () => {
  const operationRollbackError = new Error("rollback failed");
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.attach(participant);
  transaction.start();
  await participant.append("dirty", { rollbackError: operationRollbackError });

  await assert.rejects(transaction.rollback(), (error) => {
    assert.ok(error instanceof RollbackError);
    assert.deepEqual(error.errors, [operationRollbackError]);
    return true;
  });

  assert.equal(transaction.getState(), TransactionState.Failed);
  assert.ok(participant.getUpdater() instanceof EnabledUpdater);
  assert.strictEqual(participant.transactionRegistrar, transaction);
  assert.equal(originalUpdater.calls, 0);
});

test("commit reports persistence failure while leaving updates enabled", async () => {
  const persistenceError = new Error("persistence failed");
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater, {
    onUpdate() {
      throw persistenceError;
    },
  });
  const transaction = new Transaction();

  transaction.attach(participant);
  transaction.start();
  await participant.append("dirty");

  await assert.rejects(transaction.commit(), (error) => {
    assert.ok(error instanceof CommitError);
    assert.strictEqual(error.cause, persistenceError);
    return true;
  });

  assert.ok(participant.getUpdater() instanceof EnabledUpdater);
  assert.strictEqual(participant.transactionRegistrar, transaction);
  assert.equal(participant.updateCalls, 1);
  assert.equal(originalUpdater.calls, 0);
});

test("commit strategies can remove persisted operations before a later failure", async () => {
  const persistenceError = new Error("second persistence failed");
  const participant = new TestParticipant(new RecordingUpdater());
  const transaction = new Transaction({
    async commit(_participants, operations, cleanup) {
      await operations[0].participant.update();
      cleanup.removeOperation(operations[0]);
      throw persistenceError;
    },
  });
  let firstRollbackCalls = 0;
  let secondRollbackCalls = 0;

  transaction.attach(participant);
  transaction.start();
  await participant.perform(
    "first",
    () => participant.values.push("first"),
    () => {
      firstRollbackCalls += 1;
      participant.values.splice(participant.values.indexOf("first"), 1);
    },
  );
  await participant.perform(
    "second",
    () => participant.values.push("second"),
    () => {
      secondRollbackCalls += 1;
      participant.values.splice(participant.values.indexOf("second"), 1);
    },
  );

  await assert.rejects(transaction.commit(), (error) => {
    assert.ok(error instanceof CommitError);
    assert.strictEqual(error.cause, persistenceError);
    return true;
  });

  await transaction.rollback();

  assert.deepEqual(participant.values, ["first"]);
  assert.equal(firstRollbackCalls, 0);
  assert.equal(secondRollbackCalls, 1);
  assert.ok(participant.getUpdater() instanceof DisabledUpdater);
});

test("per-participant commit removes all operations for each persisted participant", async () => {
  const persistenceError = new Error("second participant failed");
  const first = new TestParticipant(new RecordingUpdater());
  const second = new TestParticipant(new RecordingUpdater(), {
    onUpdate() {
      throw persistenceError;
    },
  });
  const transaction = new Transaction();
  let firstRollbackCalls = 0;
  let secondRollbackCalls = 0;

  transaction.attach([first, second]);
  transaction.start();
  await first.perform(
    "first:one",
    () => first.values.push("one"),
    () => {
      firstRollbackCalls += 1;
      first.values.splice(first.values.indexOf("one"), 1);
    },
  );
  await first.perform(
    "first:two",
    () => first.values.push("two"),
    () => {
      firstRollbackCalls += 1;
      first.values.splice(first.values.indexOf("two"), 1);
    },
  );
  await second.perform(
    "second",
    () => second.values.push("second"),
    () => {
      secondRollbackCalls += 1;
      second.values.splice(second.values.indexOf("second"), 1);
    },
  );

  await assert.rejects(transaction.commit(), (error) => {
    assert.ok(error instanceof CommitError);
    assert.strictEqual(error.cause, persistenceError);
    return true;
  });

  await transaction.rollback();

  assert.deepEqual(first.values, ["one", "two"]);
  assert.deepEqual(second.values, []);
  assert.equal(firstRollbackCalls, 0);
  assert.equal(secondRollbackCalls, 1);
});

test("rollback attempts every reversal without detaching participants", async () => {
  const firstRollbackError = new Error("first rollback failed");
  const secondRollbackError = new Error("second rollback failed");
  const events = [];
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.attach(participant);
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
    ]);
    return true;
  });

  assert.deepEqual(events, [
    "execute:first",
    "execute:second",
    "rollback:second",
    "rollback:first",
  ]);
  assert.ok(participant.getUpdater() instanceof EnabledUpdater);
  assert.strictEqual(participant.transactionRegistrar, transaction);
  assert.equal(participant.detachCalls, 0);
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

  transaction.attach(participant);
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

  transaction.attach(participant);
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

  transaction.attach(participant);
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

test("detach() resolves a transient detach failure without new persistence", async () => {
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

  transaction.attach(participant);
  transaction.start();
  await participant.append("dirty");

  await transaction.commit();

  assert.equal(transaction.getState(), TransactionState.Initialized);
  assert.strictEqual(participant.transactionRegistrar, transaction);
  assert.ok(participant.getUpdater() instanceof DisabledUpdater);
  assert.equal(participant.updateCalls, 1);
  assert.equal(originalUpdater.calls, 0);
  assert.deepEqual(participant.values, ["dirty"]);

  assert.throws(
    () => transaction.detach(),
    (error) => error === detachError,
  );

  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.strictEqual(participant.transactionRegistrar, transaction);

  transaction.detach();

  assert.equal(transaction.getState(), TransactionState.Initialized);
  assert.equal(detachAttempts, 2);
  assert.equal(participant.transactionRegistrar, null);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(participant.updateCalls, 1);
  assert.equal(originalUpdater.calls, 0);
  assert.deepEqual(participant.values, ["dirty"]);

  transaction.detach();
  assert.equal(detachAttempts, 2);
});

test("detach failure can retry explicit detach", async () => {
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

  transaction.attach(participant);
  transaction.start();
  await participant.append("dirty");
  await transaction.commit();

  assert.equal(transaction.getState(), TransactionState.Initialized);
  assert.strictEqual(participant.transactionRegistrar, transaction);
  assert.ok(participant.getUpdater() instanceof DisabledUpdater);

  assert.throws(
    () => transaction.detach(),
    (error) => error === detachError,
  );

  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.strictEqual(participant.transactionRegistrar, transaction);

  transaction.detach();

  assert.equal(detachAttempts, 2);
  assert.equal(participant.transactionRegistrar, null);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(transaction.getState(), TransactionState.Initialized);
});

test("a failed rollback cannot replay successful reversals", async () => {
  const transientRollbackError = new Error("first rollback failed once");
  const participant = new TestParticipant(new RecordingUpdater());
  const transaction = new Transaction();
  let firstRollbackCalls = 0;
  let secondRollbackCalls = 0;

  transaction.attach(participant);
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

  await transaction.rollback();

  assert.deepEqual(participant.values, []);
  assert.equal(firstRollbackCalls, 2);
  assert.equal(secondRollbackCalls, 1);
  assert.equal(transaction.getState(), TransactionState.Initialized);
});
