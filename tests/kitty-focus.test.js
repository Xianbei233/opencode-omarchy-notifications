import assert from "node:assert/strict";
import test from "node:test";
import { createKittyFocus } from "../kitty-focus.js";

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function kittyLs(windows) {
  return JSON.stringify([{ id: 1, is_focused: true, tabs: [{ id: 2, is_focused: true, windows }] }]);
}

function stubExecFile(impl, calls = []) {
  return {
    calls,
    execFile: (file, args, options, callback) => {
      calls.push([file, ...args]);
      impl(callback);
    },
  };
}

test("reports unfocused and never calls kitty when env is missing", async () => {
  const { calls, execFile } = stubExecFile(() => {
    throw new Error("should not run");
  });
  const focus = createKittyFocus({ execFile, env: {} });

  assert.equal(await focus.focused(), false);
  assert.equal(await focus.focused(), false);
  assert.deepEqual(calls, []);
});

test("reports focused only when our window is focused in kitty ls output", async () => {
  const output = kittyLs([
    { id: 42, is_focused: true },
    { id: 7, is_focused: false },
  ]);
  const { calls, execFile } = stubExecFile((callback) => callback(null, output, ""));
  const focus = createKittyFocus({
    execFile,
    env: { KITTY_LISTEN_ON: "unix:/tmp/kitty-1", KITTY_WINDOW_ID: "42" },
  });

  assert.equal(await focus.focused(), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["kitty", "@", "--to", "unix:/tmp/kitty-1", "ls"]);
});

test("reports unfocused when our window is not the focused one", async () => {
  const output = kittyLs([
    { id: 42, is_focused: false },
    { id: 7, is_focused: true },
  ]);
  const { execFile } = stubExecFile((callback) => callback(null, output, ""));
  const focus = createKittyFocus({
    execFile,
    env: { KITTY_LISTEN_ON: "unix:/tmp/kitty-1", KITTY_WINDOW_ID: "42" },
  });

  assert.equal(await focus.focused(), false);
});

test("reports unfocused when the kitty command fails or output is garbage", async () => {
  const errors = [];
  const failing = stubExecFile((callback) => callback(new Error("no kitty"), "", ""));
  const focus = createKittyFocus({
    execFile: failing.execFile,
    env: { KITTY_LISTEN_ON: "unix:/tmp/kitty-1", KITTY_WINDOW_ID: "42" },
    onError: (error) => errors.push(error),
  });

  assert.equal(await focus.focused(), false);
  assert.equal(errors.length, 1);

  const garbage = stubExecFile((callback) => callback(null, "not json", ""));
  const focus2 = createKittyFocus({
    execFile: garbage.execFile,
    env: { KITTY_LISTEN_ON: "unix:/tmp/kitty-1", KITTY_WINDOW_ID: "42" },
  });

  assert.equal(await focus2.focused(), false);
});

test("caches the focus result for the cache window", async () => {
  let focusedFlag = true;
  const { calls, execFile } = stubExecFile((callback) =>
    callback(null, kittyLs([{ id: 42, is_focused: focusedFlag }]), ""));
  const focus = createKittyFocus({
    execFile,
    env: { KITTY_LISTEN_ON: "unix:/tmp/kitty-1", KITTY_WINDOW_ID: "42" },
    cacheMs: 20,
  });

  assert.equal(await focus.focused(), true);
  focusedFlag = false;
  assert.equal(await focus.focused(), true);
  assert.equal(calls.length, 1);

  await pause(40);
  assert.equal(await focus.focused(), false);
  assert.equal(calls.length, 2);
});
