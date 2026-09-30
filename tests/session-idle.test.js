import assert from "node:assert/strict";
import test from "node:test";
import {
  createIdleRechecker,
  createSessionIdleCheck,
  isSessionIdle,
} from "../session-idle.js";

const SESSION_ID = "ses_idleTest123";

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storeWith(statusResult, session) {
  return {
    status: () => statusResult,
    get: () => session,
  };
}

test("isSessionIdle recognises common idle status shapes", () => {
  for (const status of [
    { type: "idle" },
    "idle",
    { type: "waiting" },
    { status: "idle" },
    { state: "idle" },
    { idle: true },
  ]) {
    assert.equal(isSessionIdle(storeWith(status), SESSION_ID), true, JSON.stringify(status));
  }
});

test("isSessionIdle falls back to the session record's status", () => {
  const store = { get: () => ({ status: { type: "idle" } }) };
  assert.equal(isSessionIdle(store, SESSION_ID), true);
});

test("isSessionIdle rejects busy and unknown statuses", () => {
  for (const status of [
    { type: "busy" },
    "running",
    { type: "retry" },
    { busy: true },
    { running: true },
    {},
    undefined,
  ]) {
    assert.equal(isSessionIdle(storeWith(status), SESSION_ID), false, JSON.stringify(status));
  }
});

test("isSessionIdle rejects a missing store or accessor errors", () => {
  assert.equal(isSessionIdle(undefined, SESSION_ID), false);
  assert.equal(isSessionIdle({ status: () => { throw new Error("nope"); } }, SESSION_ID), false);
  assert.equal(isSessionIdle({ get: () => { throw new Error("nope"); } }, SESSION_ID), false);
});

test("idle check requires a clear session: pending permission suppresses", () => {
  const isIdle = createSessionIdleCheck({
    store: storeWith({ type: "idle" }),
    getPendingPermissions: () => [{ id: "per_stillOpen" }],
    getPendingForms: () => [],
  });
  assert.equal(isIdle(SESSION_ID), false);
});

test("idle check requires a clear session: pending form suppresses", () => {
  const isIdle = createSessionIdleCheck({
    store: storeWith({ type: "idle" }),
    getPendingPermissions: () => [],
    getPendingForms: () => [{ id: "form_stillOpen" }],
  });
  assert.equal(isIdle(SESSION_ID), false);
});

test("idle check treats unreadable pending accessors as pending", () => {
  const isIdle = createSessionIdleCheck({
    store: storeWith({ type: "idle" }),
    getPendingPermissions: () => { throw new Error("nope"); },
    getPendingForms: () => [],
  });
  assert.equal(isIdle(SESSION_ID), false);
});

test("idle check passes when the session is idle and nothing is pending", () => {
  const isIdle = createSessionIdleCheck({
    store: storeWith({ type: "idle" }),
    getPendingPermissions: () => [],
    getPendingForms: () => [],
  });
  assert.equal(isIdle(SESSION_ID), true);
});

test("recheck notifies only when the session is idle at check time", async () => {
  const notifications = [];
  let status = { type: "busy" };
  const rechecker = createIdleRechecker({
    isIdle: () => status.type === "idle",
    notify: (id, label) => notifications.push([id, label]),
    delayMs: 5,
  });

  rechecker.recheck(SESSION_ID, "任务完成");
  await pause(30);
  assert.deepEqual(notifications, []);

  status = { type: "idle" };
  rechecker.recheck(SESSION_ID, "任务完成");
  await pause(30);
  assert.deepEqual(notifications, [[SESSION_ID, "任务完成"]]);
  rechecker.dispose();
});

test("recheck coalesces repeated events for the same session", async () => {
  const notifications = [];
  let checks = 0;
  const rechecker = createIdleRechecker({
    isIdle: () => { checks += 1; return true; },
    notify: (id, label) => notifications.push([id, label]),
    delayMs: 10,
  });

  rechecker.recheck(SESSION_ID, "任务完成");
  rechecker.recheck(SESSION_ID, "任务完成");
  rechecker.recheck("ses_otherSession", "执行失败");
  await pause(40);
  rechecker.dispose();

  assert.equal(checks, 2);
  assert.deepEqual(notifications, [
    [SESSION_ID, "任务完成"],
    ["ses_otherSession", "执行失败"],
  ]);
});

test("recheck suppresses a pending notification on dispose", async () => {
  const notifications = [];
  const rechecker = createIdleRechecker({
    isIdle: () => true,
    notify: (id) => notifications.push(id),
    delayMs: 20,
  });

  rechecker.recheck(SESSION_ID, "任务完成");
  rechecker.dispose();
  await pause(40);

  assert.deepEqual(notifications, []);
});

test("recheck reports errors from the idle probe and notify", async () => {
  const errors = [];
  const notifications = [];
  const rechecker = createIdleRechecker({
    isIdle: () => { throw new Error("probe"); },
    notify: () => notifications.push("x"),
    onError: (error) => errors.push(error.message),
    delayMs: 5,
  });

  rechecker.recheck(SESSION_ID, "任务完成");
  await pause(30);
  assert.deepEqual(errors, ["probe"]);
  assert.deepEqual(notifications, []);
  rechecker.dispose();
});
