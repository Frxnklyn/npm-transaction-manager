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

test("running work can return to initialized before completion", () => {
  const stateMachine = new TransactionStateMachine();

  stateMachine.transitionTo(TransactionState.Initialized);
  stateMachine.transitionTo(TransactionState.Running);
  assert.equal(stateMachine.transitionTo(TransactionState.Running), TransactionState.Running);
  assert.equal(stateMachine.transitionTo(TransactionState.Initialized), TransactionState.Initialized);
});

test("Failed can recover to pending or retry rollback", () => {
  const stateMachine = new TransactionStateMachine();
  stateMachine.transitionTo(TransactionState.Failed);

  assert.equal(stateMachine.canTransitionTo(TransactionState.Pending), true);
  assert.equal(stateMachine.canTransitionTo(TransactionState.RollingBack), true);
  assert.equal(stateMachine.canTransitionTo(TransactionState.Committing), false);
  assert.equal(stateMachine.canTransitionTo(TransactionState.Initialized), false);

  assert.equal(stateMachine.transitionTo(TransactionState.RollingBack), TransactionState.RollingBack);
});

test("Failed can return to pending", () => {
  const stateMachine = new TransactionStateMachine();

  stateMachine.transitionTo(TransactionState.Failed);

  assert.equal(stateMachine.transitionTo(TransactionState.Pending), TransactionState.Pending);
});
