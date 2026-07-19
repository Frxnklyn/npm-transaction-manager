import assert from "node:assert/strict";
import test from "node:test";

import {
  DisabledUpdater,
  Transaction,
  TransactionOperation,
  TransactionState,
} from "../dist/index.js";
import {
  RecordingUpdater,
  TestParticipant,
} from "./fixtures/TestParticipant.mjs";

test("add() captures the original updater for the eventual commit", async () => {
  let updaterInstalledDuringCommit;
  let participant;
  const originalUpdater = new RecordingUpdater(() => {
    updaterInstalledDuringCommit = participant.getUpdater();
  });
  participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.add(participant);
  await participant.append("first");
  await transaction.commit();

  assert.equal(originalUpdater.calls, 1);
  assert.strictEqual(updaterInstalledDuringCommit, originalUpdater);
});

test("add() installs a DisabledUpdater immediately", () => {
  const participant = new TestParticipant(new RecordingUpdater());
  const transaction = new Transaction();

  transaction.add(participant);

  assert.ok(participant.getUpdater() instanceof DisabledUpdater);
});

test("DisabledUpdater suppresses persistence without side effects", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.add(participant);
  await participant.update();

  assert.equal(originalUpdater.calls, 0);

  await transaction.rollback();
});

test("normal operations do not call the original updater while pending", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.add(participant);
  await participant.append("first");
  await participant.append("second");

  assert.equal(originalUpdater.calls, 0);
  assert.deepEqual(participant.values, ["first", "second"]);

  await transaction.rollback();
});

test("commit updates a dirty participant exactly once for several operations", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.add(participant);
  await participant.append("first");
  await participant.append("second");
  await participant.append("third");
  await transaction.commit();

  assert.equal(originalUpdater.calls, 1);
  assert.deepEqual(participant.values, ["first", "second", "third"]);
});

test("submit updates an attached participant even without operations", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.add(participant);
  await transaction.submit();

  assert.equal(originalUpdater.calls, 1);
});

test("commit restores the exact original updater instance", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.add(participant);
  await participant.append("first");
  await transaction.commit();

  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(transaction.getState(), TransactionState.Committed);
});

test("rollback restores the exact original updater instance", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.add(participant);
  await participant.append("first");
  await transaction.rollback();

  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(originalUpdater.calls, 0);
  assert.equal(transaction.getState(), TransactionState.RolledBack);
});

test("rollback executes successful operations in reverse order", async () => {
  const events = [];
  const participant = new TestParticipant(new RecordingUpdater());
  const transaction = new Transaction();

  transaction.add(participant);
  await participant.append("parent", { events });
  await participant.append("child", { events });
  await transaction.rollback();

  assert.deepEqual(events, [
    "execute:parent",
    "execute:child",
    "rollback:child",
    "rollback:parent",
  ]);
  assert.deepEqual(participant.values, []);
});

test("submit restores original updaters before persisting participants sequentially", async () => {
  const events = [];
  let firstParticipant;
  let secondParticipant;
  const firstUpdater = new RecordingUpdater(() => {
    events.push(`update:first:${firstParticipant.getUpdater().constructor.name}`);
  });
  const secondUpdater = new RecordingUpdater(() => {
    events.push(`update:second:${secondParticipant.getUpdater().constructor.name}`);
  });
  firstParticipant = new TestParticipant(firstUpdater);
  secondParticipant = new TestParticipant(secondUpdater);
  const transaction = new Transaction();

  transaction.add(firstParticipant).add(secondParticipant);
  await transaction.submit();

  assert.deepEqual(events, [
    "update:first:RecordingUpdater",
    "update:second:RecordingUpdater",
  ]);
  assert.strictEqual(firstParticipant.getUpdater(), firstUpdater);
  assert.strictEqual(secondParticipant.getUpdater(), secondUpdater);
});

test("a failed operation is not retained for rollback or marked dirty", async () => {
  const executeError = new Error("execute failed");
  const events = [];
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.add(participant);

  await assert.rejects(
    participant.append("failed", { events, executeError }),
    (error) => error === executeError,
  );

  await transaction.rollback();

  assert.deepEqual(events, ["execute:failed"]);
  assert.equal(originalUpdater.calls, 0);
});

test("registerOperation() rejects an operation from an unattached participant", async () => {
  const attached = new TestParticipant(new RecordingUpdater());
  const unattached = new TestParticipant(new RecordingUpdater());
  const transaction = new Transaction();

  transaction.add(attached);

  assert.throws(
    () => transaction.registerOperation(new TransactionOperation(
      "unattached-operation",
      unattached,
      () => {
        unattached.values.pop();
      },
    )),
    /unknown participant/,
  );

  assert.deepEqual(unattached.values, []);
  await transaction.rollback();
});

test("adding the same participant twice is idempotent", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  assert.strictEqual(transaction.add(participant), transaction);
  const disabledUpdater = participant.getUpdater();
  assert.strictEqual(transaction.add(participant), transaction);

  assert.strictEqual(participant.getUpdater(), disabledUpdater);
  assert.equal(participant.attachCalls, 1);
  assert.equal(participant.setUpdaterCalls, 1);

  await transaction.rollback();

  assert.equal(participant.detachCalls, 1);
  assert.equal(participant.setUpdaterCalls, 2);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
});

test("the operation registrar is attached and removed during detach", async () => {
  const participant = new TestParticipant(new RecordingUpdater());
  const transaction = new Transaction();

  transaction.add(participant);

  assert.strictEqual(participant.transactionRegistrar, transaction);
  assert.equal(participant.attachCalls, 1);

  await transaction.commit();

  assert.equal(participant.transactionRegistrar, null);
  assert.equal(participant.detachCalls, 1);
});
