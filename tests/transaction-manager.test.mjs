import assert from "node:assert/strict";
import test from "node:test";

import {
  CommitError,
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
  assert.equal(originalUpdater.calls, 1);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
});

test("run() retries transient committed cleanup without rollback or persistence", async () => {
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
  const manager = new TransactionManager();
  let transactionFromCallback;
  let rollbackCalls = 0;

  await assert.rejects(
    manager.run([participant], async (transaction) => {
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
    }),
    (error) => {
      assert.ok(error instanceof CommitError);
      assert.strictEqual(error.cause, detachError);
      return true;
    },
  );

  assert.equal(transactionFromCallback.getState(), TransactionState.Pending);
  assert.equal(rollbackCalls, 0);
  assert.deepEqual(participant.values, ["persisted"]);
  assert.equal(originalUpdater.calls, 1);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(participant.transactionRegistrar, null);
  assert.equal(detachAttempts, 2);
});

test("run() aggregates the initial and persistent committed cleanup failures", async () => {
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

  await assert.rejects(
    manager.run([participant], async (transaction) => {
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
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      assert.ok(error.errors[0] instanceof CommitError);
      assert.strictEqual(error.errors[0].cause, detachError);
      assert.ok(error.errors[1] instanceof CommitError);
      assert.strictEqual(error.errors[1].cause, detachError);
      return true;
    },
  );

  assert.equal(
    transactionFromCallback.getState(),
    TransactionState.CommitCleanupFailed,
  );
  assert.equal(detachAttempts, 2);
  assert.equal(rollbackCalls, 0);
  assert.deepEqual(participant.values, ["persisted"]);
  assert.equal(originalUpdater.calls, 1);
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
  assert.equal(participant.transactionRegistrar, null);
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
  assert.equal(originalUpdater.calls, 1);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(participant.transactionRegistrar, null);
});
