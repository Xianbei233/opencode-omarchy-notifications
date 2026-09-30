import assert from "node:assert/strict";
import test from "node:test";
import { createNotificationBatcher } from "../notification-batcher.js";

const SESSION_ID = "ses_batchTest123";

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function entry(status, sessionID = SESSION_ID, agent = "build") {
  return {
    sessionID,
    agent,
    status,
    message: `任务：${sessionID.slice(-8)}`,
    directory: "/tmp/project",
  };
}

test("merges notifications for one session inside the window", async () => {
  const sent = [];
  const batcher = createNotificationBatcher({ send: (n) => sent.push(n), windowMs: 20 });

  batcher.notify(entry("任务完成"));
  batcher.notify(entry("等待回答"));
  await pause(40);
  batcher.dispose();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, "build · 任务完成 + 等待回答");
  assert.equal(sent[0].message, `任务：${SESSION_ID.slice(-8)}`);
  assert.equal(sent[0].sessionID, SESSION_ID);
});

test("does not merge notifications across sessions", async () => {
  const sent = [];
  const batcher = createNotificationBatcher({ send: (n) => sent.push(n), windowMs: 20 });

  batcher.notify(entry("任务完成", "ses_one111111"));
  batcher.notify(entry("等待回答", "ses_two22222"));
  await pause(40);
  batcher.dispose();

  assert.equal(sent.length, 2);
  assert.equal(sent[0].title, "build · 任务完成");
  assert.equal(sent[1].title, "build · 等待回答");
});

test("sends separate batches once the window has elapsed", async () => {
  const sent = [];
  const batcher = createNotificationBatcher({ send: (n) => sent.push(n), windowMs: 20 });

  batcher.notify(entry("任务完成"));
  await pause(40);
  batcher.notify(entry("执行失败"));
  await pause(40);
  batcher.dispose();

  assert.equal(sent.length, 2);
  assert.equal(sent[0].title, "build · 任务完成");
  assert.equal(sent[1].title, "build · 执行失败");
});

test("flushes queued notifications on dispose", async () => {
  const sent = [];
  const batcher = createNotificationBatcher({ send: (n) => sent.push(n), windowMs: 10_000 });

  batcher.notify(entry("等待权限批准"));
  batcher.dispose();
  batcher.notify(entry("任务完成"));
  await pause(20);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, "build · 等待权限批准");
});
