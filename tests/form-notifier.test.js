import assert from "node:assert/strict";
import test from "node:test";
import { createFormNotifier } from "../form-notifier.js";

const SESSION_ID = "ses_formTest123";
const FORM_ID = "frm_formTest123";

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function created(formID = FORM_ID, sessionID = SESSION_ID) {
  return { data: { form: { id: formID, sessionID } } };
}

function closedEvent(formID = FORM_ID, sessionID = SESSION_ID) {
  return { data: { id: formID, sessionID } };
}

test("does not notify when the form is no longer pending", async () => {
  const notifications = [];
  const notifier = createFormNotifier({
    getPendingForms: () => [],
    notify: (id) => notifications.push(id),
    delayMs: 1,
  });

  notifier.created(created());
  await pause(20);
  notifier.dispose();

  assert.deepEqual(notifications, []);
});

test("notifies once only when that exact form remains pending", async () => {
  const notifications = [];
  let readCount = 0;
  const notifier = createFormNotifier({
    getPendingForms: () => {
      readCount += 1;
      return [{ id: "frm_a_different_form" }, { id: FORM_ID }];
    },
    notify: (id) => notifications.push(id),
    delayMs: 1,
  });

  notifier.created(created());
  notifier.created(created());
  await pause(20);
  notifier.created(created());
  await pause(20);
  notifier.dispose();

  assert.equal(readCount, 1);
  assert.deepEqual(notifications, [SESSION_ID]);
});

test("cancels a form that is replied to before the pending-state check", async () => {
  const notifications = [];
  let readCount = 0;
  const notifier = createFormNotifier({
    getPendingForms: () => {
      readCount += 1;
      return [{ id: FORM_ID }];
    },
    notify: (id) => notifications.push(id),
    delayMs: 10,
  });

  notifier.created(created());
  notifier.closed(closedEvent());
  await pause(10);
  notifier.dispose();

  assert.equal(readCount, 0);
  assert.deepEqual(notifications, []);
});

test("cancels a form that is cancelled before the pending-state check", async () => {
  const notifications = [];
  const notifier = createFormNotifier({
    getPendingForms: () => [{ id: FORM_ID }],
    notify: (id) => notifications.push(id),
    delayMs: 10,
  });

  notifier.created(created());
  notifier.closed(closedEvent());
  await pause(20);
  notifier.dispose();

  assert.deepEqual(notifications, []);
});

test("falls back to the session still existing when no pending-form list is available", async () => {
  const notifications = [];
  const notifier = createFormNotifier({
    getPendingForms: () => undefined,
    isSessionAlive: (id) => id === SESSION_ID,
    notify: (id) => notifications.push(id),
    delayMs: 1,
  });

  notifier.created(created());
  await pause(20);
  notifier.dispose();

  assert.deepEqual(notifications, [SESSION_ID]);
});
