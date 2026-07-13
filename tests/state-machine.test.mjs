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

test("Committed and RolledBack are terminal states", () => {
  const committed = new TransactionStateMachine();
  committed.transitionTo(TransactionState.Committing);
  committed.transitionTo(TransactionState.Committed);

  const rolledBack = new TransactionStateMachine();
  rolledBack.transitionTo(TransactionState.RollingBack);
  rolledBack.transitionTo(TransactionState.RolledBack);

  for (const state of Object.values(TransactionState)) {
    assert.equal(committed.canTransitionTo(state), false);
    assert.equal(rolledBack.canTransitionTo(state), false);
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
