import assert from "node:assert/strict";
import test from "node:test";

import * as publicApi from "../dist/index.js";

test("the package entry point exposes all concrete public APIs and error aliases", () => {
  const constructorExports = [
    "TransactionManager",
    "Transaction",
    "TransactionStateMachine",
    "TransactionOperation",
    "PerParticipantTransactionCommitStrategy",
    "PerOperationTransactionCommitStrategy",
    "Updater",
    "DisabledUpdater",
    "EnabledUpdater",
    "CommitError",
    "RollbackError",
    "TransactionCommitError",
    "TransactionRollbackError",
  ];

  for (const exportName of constructorExports) {
    assert.equal(
      typeof publicApi[exportName],
      "function",
      `${exportName} should be a runtime constructor export`,
    );
  }

  assert.equal(typeof publicApi.TransactionState, "object");
  assert.strictEqual(publicApi.TransactionCommitError, publicApi.CommitError);
  assert.strictEqual(publicApi.TransactionRollbackError, publicApi.RollbackError);
});

test("EnabledUpdater keeps autoupdate enabled without side effects", () => {
  const updater = new publicApi.EnabledUpdater();
  const file = { getName: () => "settings.json" };

  assert.equal(updater.getIsAutoupdate(), true);
  assert.equal(updater.shouldUpdate(), true);
  assert.equal(updater.getValue(), true);

  assert.strictEqual(updater.disableAutoupdate(), updater);
  assert.equal(updater.getIsAutoupdate(), true);
  assert.strictEqual(updater.addFile(file), updater);
  assert.deepEqual(updater.getTrackedFiles(), []);
  assert.strictEqual(updater.removeFile(file), updater);
  assert.deepEqual(updater.getTrackedFiles(), []);
  assert.strictEqual(updater.enableAutoupdate(), updater);
  assert.equal(updater.getIsAutoupdate(), true);
});

test("Updater retains its original autoupdate and tracked-file contract", () => {
  const updater = new publicApi.Updater(false);
  const file = { getName: () => "settings.json" };

  assert.equal(updater.getIsAutoupdate(), false);
  assert.equal(updater.shouldUpdate(), false);
  assert.equal(updater.getValue(), false);

  assert.strictEqual(updater.enableAutoupdate(), updater);
  assert.equal(updater.getIsAutoupdate(), true);
  assert.strictEqual(updater.addFile(file), updater);
  assert.deepEqual(updater.getTrackedFiles(), [file]);
  assert.strictEqual(updater.removeFile(file), updater);
  assert.deepEqual(updater.getTrackedFiles(), []);
  assert.strictEqual(updater.disableAutoupdate(), updater);
  assert.equal(updater.getIsAutoupdate(), false);
});

test("TransactionOperation contains rollback behavior only", () => {
  const participant = {};
  const operation = new publicApi.TransactionOperation(
    "rollback-only",
    participant,
    () => undefined,
  );

  assert.equal(typeof operation.rollback, "function");
  assert.equal(typeof operation.execute, "undefined");
  assert.equal(typeof publicApi.Transaction.prototype.submit, "function");
  assert.equal(typeof publicApi.Transaction.prototype.registerOperation, "function");
  assert.equal(typeof publicApi.Transaction.prototype.stop, "function");
  assert.equal(typeof publicApi.Transaction.prototype.pause, "function");
  assert.equal(typeof publicApi.Transaction.prototype.attach, "function");
  assert.equal(typeof publicApi.Transaction.prototype.detach, "function");
  assert.equal(typeof publicApi.Transaction.prototype.add, "undefined");
});
