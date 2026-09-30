import assert from "node:assert/strict";
import test from "node:test";
import { createPendingFormsReader, wireFormNotifications } from "../form-notifier.js";
import { createNotificationBatcher } from "../notification-batcher.js";

const SESSION_ID = "ses_formTest123";
const FORM_ID = "frm_formTest123";

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function eventData(id = FORM_ID) {
  return { form: { id, sessionID: SESSION_ID, title: "Choose an option", fields: [{ key: "choice", type: "string" }] } };
}

function harness({ forms, errors = [], delayMs = 500 }) {
  const listeners = new Map();
  const sent = [];
  const location = { directory: "/workspace" };
  const formAccessor = {
    sync: async (sessionID, ref) => {
      assert.equal(sessionID, SESSION_ID);
      assert.equal(ref, location);
    },
    list: (sessionID, ref) => {
      assert.equal(sessionID, SESSION_ID);
      assert.equal(ref, location);
      return forms();
    },
  };
  const data = {
    on: (type, handler) => {
      listeners.set(type, handler);
      return () => listeners.delete(type);
    },
    session: { form: formAccessor },
  };
  const batcher = createNotificationBatcher({
    send: (notification) => sent.push(notification),
    windowMs: 2,
  });
  const stop = wireFormNotifications({
    data,
    getPendingForms: createPendingFormsReader(data, location),
    notify: (sessionID) => batcher.notify({
      sessionID,
      agent: "build",
      status: "等待回答",
      message: "question pending",
    }),
    onError: (error) => errors.push(error),
    delayMs,
  });
  return { listeners, sent, stop: () => { stop(); batcher.dispose(); } };
}

test("V2 form.created event routes into delayed pending check and batch sender", async () => {
  const h = harness({ forms: () => [{ id: FORM_ID, sessionID: SESSION_ID, type: "question", data: {} }] });
  assert.deepEqual([...h.listeners.keys()], ["form.created", "form.replied", "form.cancelled"]);
  h.listeners.get("form.created")({ type: "form.created", data: eventData() });
  await pause(550);
  h.stop();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].sessionID, SESSION_ID);
  assert.match(h.sent[0].title, /等待回答/);
});

test("replied or cancelled forms are suppressed before the delayed check", async (t) => {
  for (const type of ["form.replied", "form.cancelled"]) {
    await t.test(type, async () => {
      let reads = 0;
      const h = harness({ forms: () => { reads++; return [{ id: FORM_ID }]; }, delayMs: 10 });
      h.listeners.get("form.created")({ data: eventData() });
      h.listeners.get(type)({ data: { id: FORM_ID, sessionID: SESSION_ID } });
      await pause(20);
      h.stop();
      assert.equal(reads, 0);
      assert.deepEqual(h.sent, []);
    });
  }
});

test("answered forms absent from the pending list do not notify", async () => {
  const h = harness({ forms: () => [], delayMs: 1 });
  h.listeners.get("form.created")({ data: eventData() });
  await pause(20);
  h.stop();
  assert.deepEqual(h.sent, []);
});

test("missing or malformed pending accessor is visible and fails closed", async (t) => {
  for (const [name, forms] of [["missing", () => undefined], ["throws", () => { throw Error("private details"); }]]) {
    await t.test(name, async () => {
      const errors = [];
      const h = harness({ forms, errors, delayMs: 1 });
      h.listeners.get("form.created")({ data: eventData() });
      await pause(20);
      h.stop();
      assert.equal(errors.length, 1);
      assert.deepEqual(h.sent, []);
    });
  }
});

test("created event accepts the flat event shape seen in an earlier runtime", async () => {
  const h = harness({ forms: () => [{ id: FORM_ID }], delayMs: 1 });
  h.listeners.get("form.created")({ data: { id: FORM_ID, sessionID: SESSION_ID } });
  await pause(20);
  h.stop();
  assert.equal(h.sent.length, 1);
});

test("child forms are filtered before pending state is read", async () => {
  let reads = 0;
  const sent = [];
  const notifier = (await import("../form-notifier.js")).createFormNotifier({
    getPendingForms: async () => { reads += 1; return [{ id: FORM_ID }]; },
    notify: (id) => sent.push(id),
    isRootSession: (id) => id === SESSION_ID,
    delayMs: 1,
  });
  notifier.created({ data: { form: { id: FORM_ID, sessionID: `${SESSION_ID}_child` } } });
  await pause(10);
  notifier.dispose();
  assert.equal(reads, 0);
  assert.deepEqual(sent, []);
});
