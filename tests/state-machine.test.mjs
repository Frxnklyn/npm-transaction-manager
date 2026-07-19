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

  await committed.commit();

  assert.equal(committed.getState(), TransactionState.Committed);
  assert.equal(pending.getState(), TransactionState.Pending);

  await pending.rollback();

  assert.equal(committed.getState(), TransactionState.Committed);
  assert.equal(pending.getState(), TransactionState.RolledBack);
});

test("successful completion states are terminal", () => {
  const committed = new TransactionStateMachine();
  committed.transitionTo(TransactionState.Committing);
  committed.transitionTo(TransactionState.Committed);

  const rolledBack = new TransactionStateMachine();
  rolledBack.transitionTo(TransactionState.RollingBack);
  rolledBack.transitionTo(TransactionState.RolledBack);

  const stopped = new TransactionStateMachine();
  stopped.transitionTo(TransactionState.Stopping);
  stopped.transitionTo(TransactionState.Stopped);

  for (const state of Object.values(TransactionState)) {
    assert.equal(committed.canTransitionTo(state), false);
    assert.equal(rolledBack.canTransitionTo(state), false);
    assert.equal(stopped.canTransitionTo(state), false);
  }

  assert.throws(
    () => committed.transitionTo(TransactionState.RollingBack),
    /Invalid transaction transition/,
  );
  assert.throws(
    () => rolledBack.transitionTo(TransactionState.Committing),
    /Invalid transaction transition/,
  );
});

test("commit cleanup can only finish as committed", () => {
  const stateMachine = new TransactionStateMachine();
  stateMachine.transitionTo(TransactionState.Committing);
  stateMachine.transitionTo(TransactionState.CommitCleanupFailed);

  assert.equal(stateMachine.canTransitionTo(TransactionState.Committed), true);
  assert.equal(stateMachine.canTransitionTo(TransactionState.Failed), false);
  assert.equal(
    stateMachine.transitionTo(TransactionState.Committed),
    TransactionState.Committed,
  );
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
