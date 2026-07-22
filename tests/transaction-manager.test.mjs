import assert from "node:assert/strict";
import test from "node:test";

import {
  CommitError,
  EnabledUpdater,
  RollbackError,
  TransactionManager,
  TransactionState,
} from "../dist/index.js";
import {
  RecordingUpdater,
  TestParticipant,
} from "./fixtures/TestParticipant.mjs";

test("run() rolls back successful operations after a callback error", async () => {
  const callbackError = new Error("callback failed");
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const manager = new TransactionManager();
  let transactionFromCallback;

  await assert.rejects(
    manager.run([participant], async (transaction) => {
      transactionFromCallback = transaction;
      await participant.append("temporary");
      throw callbackError;
    }),
    (error) => error === callbackError,
  );

  assert.deepEqual(participant.values, []);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(originalUpdater.calls, 0);
  assert.equal(transactionFromCallback.getState(), TransactionState.Pending);
  assert.strictEqual(participant.transactionRegistrar, transactionFromCallback);
});

test("run() returns the callback result after committing", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const manager = new TransactionManager();
  const expectedResult = { id: 42 };

  const result = await manager.run([participant], async () => {
    await participant.append("persisted");
    return expectedResult;
  });

  assert.strictEqual(result, expectedResult);
  assert.equal(participant.updateCalls, 1);
  assert.equal(originalUpdater.calls, 0);
  assert.ok(participant.getUpdater() instanceof EnabledUpdater);
  assert.notEqual(participant.transactionRegistrar, null);
});

test("run() leaves committed participants attached for explicit detach", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const manager = new TransactionManager();
  let transactionFromCallback;
  let rollbackCalls = 0;

  await manager.run([participant], async (transaction) => {
    transactionFromCallback = transaction;
    await participant.perform(
      "persisted",
      () => {
        participant.values.push("persisted");
      },
      () => {
        rollbackCalls += 1;
        participant.values.pop();
      },
    );
  });

  assert.equal(transactionFromCallback.getState(), TransactionState.Pending);
  assert.equal(rollbackCalls, 0);
  assert.deepEqual(participant.values, ["persisted"]);
  assert.equal(participant.updateCalls, 1);
  assert.equal(originalUpdater.calls, 0);
  assert.ok(participant.getUpdater() instanceof EnabledUpdater);
  assert.strictEqual(participant.transactionRegistrar, transactionFromCallback);

  transactionFromCallback.detach();
  assert.equal(participant.transactionRegistrar, null);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
});

test("run() leaves explicit detach failures to the caller", async () => {
  const detachError = new Error("detach always fails");
  const originalUpdater = new RecordingUpdater();
  let detachAttempts = 0;
  const participant = new TestParticipant(originalUpdater, {
    onDetach() {
      detachAttempts += 1;
      throw detachError;
    },
  });
  const manager = new TransactionManager();
  let transactionFromCallback;
  let rollbackCalls = 0;

  await manager.run([participant], async (transaction) => {
    transactionFromCallback = transaction;
    await participant.perform(
      "persisted",
      () => {
        participant.values.push("persisted");
      },
      () => {
        rollbackCalls += 1;
        participant.values.pop();
      },
    );
  });

  assert.equal(transactionFromCallback.getState(), TransactionState.Pending);
  assert.throws(
    () => transactionFromCallback.detach(),
    (error) => error === detachError,
  );
  assert.equal(detachAttempts, 1);
  assert.equal(rollbackCalls, 0);
  assert.deepEqual(participant.values, ["persisted"]);
  assert.equal(participant.updateCalls, 1);
  assert.equal(originalUpdater.calls, 0);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.strictEqual(participant.transactionRegistrar, transactionFromCallback);
});

test("run() aggregates the callback and rollback failures without losing either", async () => {
  const callbackError = new Error("callback failed");
  const operationRollbackError = new Error("operation rollback failed");
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const manager = new TransactionManager();

  await assert.rejects(
    manager.run([participant], async () => {
      await participant.append("temporary", {
        rollbackError: operationRollbackError,
      });
      throw callbackError;
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.strictEqual(error.errors[0], callbackError);
      assert.ok(error.errors[1] instanceof RollbackError);
      assert.deepEqual(error.errors[1].errors, [operationRollbackError]);
      return true;
    },
  );

  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.notEqual(participant.transactionRegistrar, null);
});

test("run() submits registered changes after the callback", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const manager = new TransactionManager();

  const result = await manager.run([participant], async () => {
    await participant.perform(
      "delayed",
      () => {
        participant.values.push("delayed");
      },
      () => {
        participant.values.pop();
      },
    );

    return "committed";
  });

  assert.equal(result, "committed");
  assert.deepEqual(participant.values, ["delayed"]);
  assert.equal(participant.updateCalls, 1);
  assert.equal(originalUpdater.calls, 0);
  assert.ok(participant.getUpdater() instanceof EnabledUpdater);
  assert.notEqual(participant.transactionRegistrar, null);
});
