import assert from "node:assert/strict";
import test from "node:test";

import {
  DisabledUpdater,
  EnabledUpdater,
  Transaction,
  TransactionOperation,
  TransactionState,
} from "../dist/index.js";
import {
  RecordingUpdater,
  TestParticipant,
} from "./fixtures/TestParticipant.mjs";

test("start() captures the original updater for the eventual commit", async () => {
  let updaterInstalledDuringCommit;
  let participant;
  const originalUpdater = new RecordingUpdater(() => {
    updaterInstalledDuringCommit = participant.getUpdater();
  });
  participant = new TestParticipant(originalUpdater, {
    onUpdate() {
      updaterInstalledDuringCommit = participant.getUpdater();
    },
  });
  const transaction = new Transaction();

  transaction.attach(participant);
  transaction.start();
  await participant.append("first");
  await transaction.commit();

  assert.equal(participant.updateCalls, 1);
  assert.ok(updaterInstalledDuringCommit instanceof EnabledUpdater);
  assert.equal(originalUpdater.calls, 0);
  assert.ok(participant.getUpdater() instanceof DisabledUpdater);
});

test("attach() only registers a participant and start() installs a DisabledUpdater", () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.attach(participant);

  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(participant.attachCalls, 0);
  assert.equal(participant.setUpdaterCalls, 0);

  transaction.start();

  assert.ok(participant.getUpdater() instanceof DisabledUpdater);
  assert.equal(participant.attachCalls, 1);
  assert.equal(participant.setUpdaterCalls, 1);
});

test("DisabledUpdater suppresses persistence without side effects", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.attach(participant);
  transaction.start();
  await participant.update();

  assert.equal(originalUpdater.calls, 0);

  await transaction.rollback();
});

test("normal operations do not call the original updater while pending", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.attach(participant);
  transaction.start();
  await participant.append("first");
  await participant.append("second");

  assert.equal(originalUpdater.calls, 0);
  assert.deepEqual(participant.values, ["first", "second"]);

  await transaction.rollback();
});

test("registerOperation() moves the transaction to running for each operation", async () => {
  const participant = new TestParticipant(new RecordingUpdater());
  const transaction = new Transaction();

  transaction.attach(participant);
  transaction.start();

  assert.equal(transaction.getState(), TransactionState.Initialized);

  await participant.append("first");
  assert.equal(transaction.getState(), TransactionState.Running);

  await participant.append("second");
  assert.equal(transaction.getState(), TransactionState.Running);

  await transaction.rollback();
});

test("commit updates a dirty participant exactly once for several operations", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.attach(participant);
  transaction.start();
  await participant.append("first");
  await participant.append("second");
  await participant.append("third");
  await transaction.commit();

  assert.equal(participant.updateCalls, 1);
  assert.equal(originalUpdater.calls, 0);
  assert.deepEqual(participant.values, ["first", "second", "third"]);
});

test("submit updates an attached participant even without operations", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.attach(participant);
  transaction.start();
  await transaction.submit();

  assert.equal(participant.updateCalls, 1);
  assert.equal(originalUpdater.calls, 0);
});

test("commit returns participants to the fixed disabled updater", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.attach(participant);
  transaction.start();
  await participant.append("first");
  await transaction.commit();

  assert.ok(participant.getUpdater() instanceof DisabledUpdater);
  assert.equal(originalUpdater.calls, 0);
  assert.equal(transaction.getState(), TransactionState.Initialized);
});

test("rollback returns participants to the fixed disabled updater", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.attach(participant);
  transaction.start();
  await participant.append("first");
  await transaction.rollback();

  assert.ok(participant.getUpdater() instanceof DisabledUpdater);
  assert.equal(originalUpdater.calls, 0);
  assert.equal(transaction.getState(), TransactionState.Initialized);
});

test("rollback executes successful operations in reverse order", async () => {
  const events = [];
  const participant = new TestParticipant(new RecordingUpdater());
  const transaction = new Transaction();

  transaction.attach(participant);
  transaction.start();
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

test("submit installs EnabledUpdater before persisting participants sequentially", async () => {
  const events = [];
  let firstParticipant;
  let secondParticipant;
  const firstUpdater = new RecordingUpdater();
  const secondUpdater = new RecordingUpdater();
  firstParticipant = new TestParticipant(firstUpdater, {
    onUpdate() {
      events.push(`update:first:${firstParticipant.getUpdater().constructor.name}`);
    },
  });
  secondParticipant = new TestParticipant(secondUpdater, {
    onUpdate() {
      events.push(`update:second:${secondParticipant.getUpdater().constructor.name}`);
    },
  });
  const transaction = new Transaction();

  transaction.attach(firstParticipant).attach(secondParticipant);
  transaction.start();
  await transaction.submit();

  assert.deepEqual(events, [
    "update:first:EnabledUpdater",
    "update:second:EnabledUpdater",
  ]);
  assert.equal(firstUpdater.calls, 0);
  assert.equal(secondUpdater.calls, 0);
  assert.equal(firstParticipant.updateCalls, 1);
  assert.equal(secondParticipant.updateCalls, 1);
  assert.ok(firstParticipant.getUpdater() instanceof DisabledUpdater);
  assert.ok(secondParticipant.getUpdater() instanceof DisabledUpdater);
});

test("submit disables updaters after the committed state", async () => {
  const assignments = [];
  let transaction;
  const participant = new TestParticipant(new RecordingUpdater(), {
    onSetUpdater(updater) {
      if (transaction !== undefined) {
        assignments.push(`${transaction.getState()}:${updater.constructor.name}`);
      }
    },
  });
  transaction = new Transaction();

  transaction.attach(participant);
  transaction.start();
  assignments.length = 0;
  await participant.append("first");
  await transaction.submit();

  assert.deepEqual(assignments, [
    "committing:EnabledUpdater",
    "initialized:DisabledUpdater",
  ]);
  assert.ok(participant.getUpdater() instanceof DisabledUpdater);
  assert.equal(transaction.getState(), TransactionState.Initialized);
});

test("a failed operation is not retained for rollback or marked dirty", async () => {
  const executeError = new Error("execute failed");
  const events = [];
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  transaction.attach(participant);
  transaction.start();

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

  transaction.attach(attached);
  transaction.start();

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

test("attaching the same participant twice is idempotent", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  const transaction = new Transaction();

  assert.strictEqual(transaction.attach(participant), transaction);
  assert.strictEqual(transaction.attach(participant), transaction);

  assert.strictEqual(participant.getUpdater(), originalUpdater);
  assert.equal(participant.attachCalls, 0);
  assert.equal(participant.setUpdaterCalls, 0);

  transaction.start();

  assert.ok(participant.getUpdater() instanceof DisabledUpdater);
  assert.equal(participant.attachCalls, 1);
  assert.equal(participant.setUpdaterCalls, 1);

  await transaction.rollback();

  assert.equal(participant.detachCalls, 0);
  assert.equal(participant.setUpdaterCalls, 3);
  assert.ok(participant.getUpdater() instanceof DisabledUpdater);

  transaction.detach();
  assert.equal(participant.detachCalls, 1);
  assert.equal(participant.transactionRegistrar, null);
  assert.strictEqual(participant.getUpdater(), originalUpdater);
});

test("commit keeps the registrar attached until explicit detach", async () => {
  const participant = new TestParticipant(new RecordingUpdater());
  const transaction = new Transaction();

  transaction.attach(participant);
  transaction.start();

  assert.strictEqual(participant.transactionRegistrar, transaction);
  assert.equal(participant.attachCalls, 1);

  await transaction.commit();

  assert.strictEqual(participant.transactionRegistrar, transaction);
  assert.equal(participant.detachCalls, 0);

  transaction.detach();

  assert.equal(participant.transactionRegistrar, null);
  assert.equal(participant.detachCalls, 1);
});
