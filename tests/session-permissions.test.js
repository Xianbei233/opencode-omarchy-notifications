import assert from "node:assert/strict";
import test from "node:test";
import { readSessionPermissions } from "../session-permissions.js";
import { createSessionIdleCheck } from "../session-idle.js";
import { createPermissionNotifier } from "../permission-notifier.js";

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
