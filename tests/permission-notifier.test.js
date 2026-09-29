import assert from "node:assert/strict";
import test from "node:test";
import { createPermissionNotifier } from "../permission-notifier.js";

const SESSION_ID = "ses_permissionTest123";
const REQUEST_ID = "per_permissionTest123";

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function event(data) {
  return { data };
}

test("does not notify when the request is no longer pending", async () => {
  const notifications = [];
  const notifier = createPermissionNotifier({
    getPendingPermissions: () => [],
    notify: (id) => notifications.push(id),
    delayMs: 1,
  });

  notifier.asked(event({ id: REQUEST_ID, sessionID: SESSION_ID }));
  await pause(20);
  notifier.dispose();

  assert.deepEqual(notifications, []);
});

test("notifies once only when that exact permission request remains pending", async () => {
  const notifications = [];
  let readCount = 0;
  const notifier = createPermissionNotifier({
    getPendingPermissions: () => {
      readCount += 1;
      return [{ id: "per_a_different_request" }, { id: REQUEST_ID }];
    },
    notify: (id) => notifications.push(id),
    delayMs: 1,
  });

  notifier.asked(event({ id: REQUEST_ID, sessionID: SESSION_ID }));
  notifier.asked(event({ id: REQUEST_ID, sessionID: SESSION_ID }));
  await pause(20);
  notifier.asked(event({ id: REQUEST_ID, sessionID: SESSION_ID }));
  await pause(20);
  notifier.dispose();

  assert.equal(readCount, 1);
  assert.deepEqual(notifications, [SESSION_ID]);
});

test("cancels an ask that is replied to before the pending-state check", async () => {
  const notifications = [];
  let readCount = 0;
  const notifier = createPermissionNotifier({
    getPendingPermissions: () => {
      readCount += 1;
      return [{ id: REQUEST_ID }];
    },
    notify: (id) => notifications.push(id),
    delayMs: 10,
  });

  notifier.asked(event({ id: REQUEST_ID, sessionID: SESSION_ID }));
  notifier.replied(event({ requestID: REQUEST_ID, sessionID: SESSION_ID, reply: "once" }));
  await pause(10);
  notifier.dispose();

  assert.equal(readCount, 0);
  assert.deepEqual(notifications, []);
});
