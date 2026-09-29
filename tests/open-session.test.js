import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startSessionIpc } from "../session-ipc.js";

const HELPER = fileURLToPath(new URL("../open-session.js", import.meta.url));
const TEMP_ROOT = process.env.OPENCODE_TEST_TMPDIR || (existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir());

function waitForFile(path) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const poll = () => {
      try {
        resolve(readFileSync(path).toString().split("\0").filter(Boolean));
      } catch (error) {
        if (error.code !== "ENOENT") return reject(error);
        if (++attempts >= 40) return reject(new Error("launcher did not record its arguments"));
        setTimeout(poll, 25);
      }
    };
    poll();
  });
}

test("launches the requested session through Omarchy when no TUI socket is live", async (t) => {
  const root = mkdtempSync(join(TEMP_ROOT, "omarchy-session-fallback-"));
  const bin = join(root, "bin");
  const runtime = join(root, "runtime");
  const capture = join(root, "launcher-argv");
  const project = join(root, "project with spaces");
  const ipcDirectory = join(runtime, "opencode-omarchy-notifications");
  const launcher = join(bin, "omarchy-launch-tui");
  const sessionID = "ses_fallbackTest123";
  t.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(bin, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  writeFileSync(launcher, '#!/bin/sh\nprintf \'%s\\0\' "$@" > "$CAPTURE_FILE"\n');
  chmodSync(launcher, 0o700);

  const env = {
    ...process.env,
    XDG_RUNTIME_DIR: runtime,
    CAPTURE_FILE: capture,
    PATH: `${bin}:${process.env.PATH}`,
  };
  delete env.KITTY_LISTEN_ON;
  delete env.KITTY_WINDOW_ID;

  const child = spawn(
    process.execPath,
    [HELPER, sessionID, "", project, ipcDirectory],
    { env, stdio: "ignore" },
  );
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`helper exited ${code}`)));
  });

  assert.deepEqual(await waitForFile(capture), [
    "--app-id=org.omarchy.agent",
    "opencode",
    "--session",
    sessionID,
    project,
  ]);
});

test("routes to a live TUI socket without launching another TUI", async (t) => {
  const root = mkdtempSync(join(TEMP_ROOT, "r-"));
  const bin = join(root, "bin");
  const runtime = join(root, "runtime");
  const capture = join(root, "launcher-argv");
  const project = join(root, "project");
  const ipcDirectory = join(runtime, "opencode-omarchy-notifications");
  const launcher = join(bin, "omarchy-launch-tui");
  const sessionID = "ses_liveTui123";
  const navigations = [];
  const originalKittyListenOn = process.env.KITTY_LISTEN_ON;
  const originalKittyWindowID = process.env.KITTY_WINDOW_ID;
  delete process.env.KITTY_LISTEN_ON;
  delete process.env.KITTY_WINDOW_ID;
  t.after(() => {
    if (originalKittyListenOn === undefined) delete process.env.KITTY_LISTEN_ON;
    else process.env.KITTY_LISTEN_ON = originalKittyListenOn;
    if (originalKittyWindowID === undefined) delete process.env.KITTY_WINDOW_ID;
    else process.env.KITTY_WINDOW_ID = originalKittyWindowID;
    rmSync(root, { recursive: true, force: true });
  });

  mkdirSync(bin, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  writeFileSync(launcher, '#!/bin/sh\nprintf \'%s\\0\' "$@" > "$CAPTURE_FILE"\n');
  chmodSync(launcher, 0o700);

  const ipc = startSessionIpc({
    data: {
      session: {
        get: (id) => id === sessionID ? { id } : undefined,
        sync: async () => {},
      },
    },
    ui: {
      router: {
        navigate: (destination) => navigations.push(destination),
      },
    },
  }, ipcDirectory);
  t.after(() => ipc.close());
  assert.equal(await ipc.ready, true);

  const env = {
    ...process.env,
    XDG_RUNTIME_DIR: runtime,
    CAPTURE_FILE: capture,
    PATH: `${bin}:${process.env.PATH}`,
  };
  delete env.KITTY_LISTEN_ON;
  delete env.KITTY_WINDOW_ID;
  const child = spawn(
    process.execPath,
    [HELPER, sessionID, ipc.socketPath, project, ipcDirectory],
    { env, stdio: "ignore" },
  );
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`helper exited ${code}`)));
  });

  assert.deepEqual(navigations, [{ type: "session", sessionID }]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.throws(() => readFileSync(capture), { code: "ENOENT" });
});
