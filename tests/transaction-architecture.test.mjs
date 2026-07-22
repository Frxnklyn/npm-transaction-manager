import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  PerOperationTransactionCommitStrategy,
  PerParticipantTransactionCommitStrategy,
  Transaction,
  TransactionState,
} from "../dist/index.js";
import {
  RecordingUpdater,
  TestParticipant,
} from "./fixtures/TestParticipant.mjs";

test("start() activates one participant or an array in the default pending state", async () => {
  const first = new TestParticipant(new RecordingUpdater());
  const second = new TestParticipant(new RecordingUpdater());
  const singleTransaction = new Transaction();
  const arrayTransaction = new Transaction();

  assert.equal(singleTransaction.getState(), TransactionState.Pending);
  singleTransaction.start(first);
  assert.strictEqual(first.transactionRegistrar, singleTransaction);
  assert.equal(singleTransaction.getState(), TransactionState.Initialized);
  await singleTransaction.stop();

  arrayTransaction.start([first, second]);
  assert.strictEqual(first.transactionRegistrar, arrayTransaction);
  assert.strictEqual(second.transactionRegistrar, arrayTransaction);
  assert.equal(arrayTransaction.getState(), TransactionState.Initialized);

  await arrayTransaction.stop();
});

test("operation registration is rejected until attach and updater setup complete", () => {
  let participant;
  participant = new TestParticipant(new RecordingUpdater(), {
    onAttach(transaction) {
      transaction.registerOperation({
        name: "too-early",
        participant,
        rollback() {},
      });
    },
  });
  const transaction = new Transaction();

  transaction.add(participant);
  assert.throws(
    () => transaction.start(),
    /unknown participant/,
  );
  assert.equal(transaction.getState(), TransactionState.Pending);
  assert.equal(participant.transactionRegistrar, null);
});

test("per-participant commit updates each participant exactly once", async () => {
  const firstUpdater = new RecordingUpdater();
  const secondUpdater = new RecordingUpdater();
  const first = new TestParticipant(firstUpdater);
  const second = new TestParticipant(secondUpdater);
  const transaction = new Transaction(
    new PerParticipantTransactionCommitStrategy(),
  );

  transaction.start([first, second]);
  await first.append("one");
  await first.append("two");
  await second.append("three");
  await transaction.submit();

  assert.equal(firstUpdater.calls, 1);
  assert.equal(secondUpdater.calls, 1);
});

test("per-operation commit follows registration order and never replays changes", async () => {
  const events = [];
  const firstUpdater = new RecordingUpdater(() => events.push("update:first"));
  const secondUpdater = new RecordingUpdater(() => events.push("update:second"));
  const first = new TestParticipant(firstUpdater);
  const second = new TestParticipant(secondUpdater);
  const transaction = new Transaction(
    new PerOperationTransactionCommitStrategy(),
  );

  transaction.start([first, second]);
  await first.append("one");
  await first.append("two");
  await second.append("three");
  await transaction.submit();

  assert.deepEqual(events, ["update:first", "update:first", "update:second"]);
  assert.deepEqual(first.values, ["one", "two"]);
  assert.deepEqual(second.values, ["three"]);
});

test("commit strategy receives frozen snapshots after original updaters are restored", async () => {
  const originalUpdater = new RecordingUpdater();
  const participant = new TestParticipant(originalUpdater);
  let commitCalls = 0;
  const strategy = {
    async commit(participants, operations) {
      commitCalls += 1;
      assert.equal(Object.isFrozen(participants), true);
      assert.equal(Object.isFrozen(operations), true);
      assert.strictEqual(participants[0], participant);
      assert.strictEqual(participant.getUpdater(), originalUpdater);
      assert.throws(() => participants.push(participant), TypeError);
      assert.throws(() => operations.pop(), TypeError);
    },
  };
  const transaction = new Transaction(strategy);

  transaction.add(participant);
  transaction.start();
  await participant.append("tracked");
  await transaction.submit();

  assert.equal(commitCalls, 1);
});

test("rollback never invokes the commit strategy", async () => {
  let commitCalls = 0;
  const transaction = new Transaction({
    async commit() {
      commitCalls += 1;
    },
  });
  const participant = new TestParticipant(new RecordingUpdater());

  transaction.add(participant);
  transaction.start();
  await participant.append("temporary");
  await transaction.rollback();

  assert.equal(commitCalls, 0);
  assert.deepEqual(participant.values, []);
});

test("stop retains memory state without persistence or rollback", async () => {
  const updater = new RecordingUpdater();
  const participant = new TestParticipant(updater);
  let commitCalls = 0;
  let rollbackCalls = 0;
  const transaction = new Transaction({
    async commit() {
      commitCalls += 1;
    },
  });

  transaction.add(participant);
  transaction.start();
  await participant.perform(
    "retain",
    () => participant.values.push("retained"),
    () => {
      rollbackCalls += 1;
      participant.values.pop();
    },
  );
  await transaction.stop();

  assert.equal(transaction.getState(), TransactionState.Pending);
  assert.equal(commitCalls, 0);
  assert.equal(rollbackCalls, 0);
  assert.equal(updater.calls, 0);
  assert.deepEqual(participant.values, ["retained"]);
  assert.strictEqual(participant.getUpdater(), updater);
  assert.equal(participant.transactionRegistrar, null);
});

test("TransactionContextInterface file and source references are removed", () => {
  const sourceRoot = join(process.cwd(), "src");
  const removedFile = join(
    sourceRoot,
    "interfaces",
    "TransactionContextInterface.ts",
  );
  const sourceFiles = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.name.endsWith(".ts")) {
        sourceFiles.push(path);
      }
    }
  };

  visit(sourceRoot);

  assert.equal(existsSync(removedFile), false);

  for (const sourceFile of sourceFiles) {
    assert.doesNotMatch(
      readFileSync(sourceFile, "utf8"),
      /TransactionContextInterface/,
      sourceFile,
    );
  }
});
