import assert from "node:assert/strict";
import test from "node:test";

import {
  TransactionManager,
  TransactionState,
  TransactionStateMachine,
} from "../dist/index.js";

test("each transaction owns independent state", async () => {
  const manager = new TransactionManager();
  const committed = manager.createTransaction();
  const pending = manager.createTransaction();

  committed.start();
  await committed.commit();

  assert.equal(committed.getState(), TransactionState.Pending);
  assert.equal(pending.getState(), TransactionState.Pending);

  pending.start();
  await pending.rollback();

  assert.equal(committed.getState(), TransactionState.Pending);
  assert.equal(pending.getState(), TransactionState.Pending);
});

test("successful completion states return to pending", () => {
  const committed = new TransactionStateMachine();
  committed.transitionTo(TransactionState.Initialized);
  committed.transitionTo(TransactionState.Committing);
  committed.transitionTo(TransactionState.Committed);
  assert.equal(committed.canTransitionTo(TransactionState.Pending), true);
  committed.transitionTo(TransactionState.Pending);

  const rolledBack = new TransactionStateMachine();
  rolledBack.transitionTo(TransactionState.Initialized);
  rolledBack.transitionTo(TransactionState.RollingBack);
  rolledBack.transitionTo(TransactionState.RolledBack);
  assert.equal(rolledBack.canTransitionTo(TransactionState.Pending), true);
  rolledBack.transitionTo(TransactionState.Pending);

  const stopped = new TransactionStateMachine();
  stopped.transitionTo(TransactionState.Initialized);
  stopped.transitionTo(TransactionState.Stopping);
  stopped.transitionTo(TransactionState.Stopped);
  assert.equal(stopped.canTransitionTo(TransactionState.Pending), true);
  stopped.transitionTo(TransactionState.Pending);

  assert.equal(committed.getState(), TransactionState.Pending);
  assert.equal(rolledBack.getState(), TransactionState.Pending);
  assert.equal(stopped.getState(), TransactionState.Pending);
});

test("commit cleanup can only finish as committed", () => {
  const stateMachine = new TransactionStateMachine();
  stateMachine.transitionTo(TransactionState.Initialized);
  stateMachine.transitionTo(TransactionState.Committing);
  stateMachine.transitionTo(TransactionState.CommitCleanupFailed);

  assert.equal(stateMachine.canTransitionTo(TransactionState.Committed), true);
  assert.equal(stateMachine.canTransitionTo(TransactionState.Failed), false);
  assert.equal(
    stateMachine.transitionTo(TransactionState.Committed),
    TransactionState.Committed,
  );
});

test("running work can return to initialized before completion", () => {
  const stateMachine = new TransactionStateMachine();

  stateMachine.transitionTo(TransactionState.Initialized);
  stateMachine.transitionTo(TransactionState.Running);
  assert.equal(stateMachine.transitionTo(TransactionState.Initialized), TransactionState.Initialized);
});

test("Failed is terminal because commit persistence may be partial", () => {
  const stateMachine = new TransactionStateMachine();
  stateMachine.transitionTo(TransactionState.Failed);

  for (const state of Object.values(TransactionState)) {
    assert.equal(stateMachine.canTransitionTo(state), false);
  }

  assert.throws(
    () => stateMachine.transitionTo(TransactionState.RollingBack),
    /Invalid transaction transition/,
  );
});
