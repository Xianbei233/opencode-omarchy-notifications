import assert from "node:assert/strict";
import test from "node:test";
import { createPermissionErrorReporter, readSessionPermissions } from "../session-permissions.js";
import { createIdleRechecker, createSessionIdleCheck } from "../session-idle.js";
import { createPermissionNotifier } from "../permission-notifier.js";

test("permission diagnostics are shared, redacted, rate-limited and recover without blocking notifications", async () => {
  let time = 0;
  let requests;
  let broken = true;
  const errors = [];
  const store = {
    status: () => "idle",
    permission: { list() {
      if (broken) throw new Error("SECRET permission or reply content");
      return requests;
    } },
  };
  const onError = createPermissionErrorReporter({ now: () => time, onError: (error) => errors.push(error.message) });
  const getPendingPermissions = (id) => readSessionPermissions(store, id);
  const isIdle = createSessionIdleCheck({ store, getPendingPermissions, getPendingForms: () => [], onError });
  let permissions = 0;
  let completions = 0;
  const notifier = createPermissionNotifier({ getPendingPermissions, onError, notify: () => permissions++, delayMs: 1 });
  const rechecker = createIdleRechecker({ isIdle, notify: () => completions++, delayMs: 1 });
  const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
  try {
    rechecker.recheck("ses_test", "done");
    notifier.asked({ data: { sessionID: "ses_test", id: "perm1" } });
    await pause();
    assert.equal(completions, 0);
    assert.equal(permissions, 0);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].includes("SECRET"), false);
    for (let i = 0; i < 100; i++) assert.equal(isIdle("ses_test"), false);
    time = 59_999;
    assert.equal(isIdle("ses_test"), false);
    assert.equal(errors.length, 1);
    time = 60_000;
    assert.equal(isIdle("ses_test"), false);
    assert.equal(errors.length, 2);
    // Recovery is immediate, even inside the diagnostic cooldown.
    broken = false;
    requests = [{ id: "perm1" }];
    notifier.asked({ data: { sessionID: "ses_test", id: "perm1" } });
    rechecker.recheck("ses_test", "done");
    await pause();
    assert.equal(permissions, 1);
    assert.equal(completions, 0);
    requests = [];
    rechecker.recheck("ses_test", "done");
    await pause();
    assert.equal(completions, 1);
    assert.equal(errors.length, 2);
  } finally { notifier.dispose(); rechecker.dispose(); }
});

for (const shape of ["callable", "list"]) {
  test(`permission contract ${shape}: pending, busy, idle and notification`, async () => {
    let requests = [{ id: "perm1" }];
    let status = "idle";
    const accessor = (id) => { assert.equal(id, "ses_test"); return requests; };
    const store = { permission: shape === "list" ? { list: accessor } : accessor, status: () => status };
    const getPendingPermissions = (id) => readSessionPermissions(store, id);
    const isIdle = createSessionIdleCheck({ store, getPendingPermissions, getPendingForms: () => [] });
    assert.equal(isIdle("ses_test"), false);
    let notifications = 0;
    const notifier = createPermissionNotifier({ getPendingPermissions, notify: () => notifications++, delayMs: 1 });
    try {
      notifier.asked({ data: { sessionID: "ses_test", id: "perm1" } });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(notifications, 1);
      requests = [];
      status = "busy";
      assert.equal(isIdle("ses_test"), false);
      status = "idle";
      assert.equal(isIdle("ses_test"), true);
    } finally { notifier.dispose(); }
  });
}

for (const permission of [undefined, {}, { list: () => undefined }, { list: () => ({}) }, { list: () => [null] }, { list: () => { throw new Error("unreadable"); } }]) {
  test("unknown or unreadable permission cache suppresses notifications and completion", async () => {
    const store = { permission, status: () => "idle" };
    const getPendingPermissions = (id) => readSessionPermissions(store, id);
    assert.equal(createSessionIdleCheck({ store, getPendingPermissions })("ses_test"), false);
    let notifications = 0;
    let errors = 0;
    const notifier = createPermissionNotifier({ getPendingPermissions, notify: () => notifications++, onError: () => errors++, delayMs: 1 });
    try {
      notifier.asked({ data: { sessionID: "ses_test", id: "perm1" } });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(notifications, 0);
      assert.equal(errors, 1);
    } finally { notifier.dispose(); }
  });
}
