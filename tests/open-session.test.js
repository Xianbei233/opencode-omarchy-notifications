import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
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
    [HELPER, sessionID, project, ipcDirectory],
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
    [HELPER, sessionID, project, ipcDirectory],
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

test("selects only one of two handled listeners", async (t) => {
  const root = mkdtempSync(join(TEMP_ROOT, "r-"));
  const bin = join(root, "bin");
  const runtime = join(root, "runtime");
  const capture = join(root, "launcher-argv");
  const project = join(root, "project");
  const ipcDirectory = join(runtime, "opencode-omarchy-notifications");
  const launcher = join(bin, "omarchy-launch-tui");
  const sessionID = "ses_parallelClaim123";
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

  assert.equal(await startTuiStub(t, ipcDirectory, sessionID, navigations), true);

  const env = {
    ...process.env,
    XDG_RUNTIME_DIR: runtime,
    CAPTURE_FILE: capture,
    PATH: `${bin}:${process.env.PATH}`,
  };
  delete env.KITTY_LISTEN_ON;
  delete env.KITTY_WINDOW_ID;
  const started = Date.now();
  const child = spawn(
    process.execPath,
    [HELPER, sessionID, project, ipcDirectory],
    { env, stdio: "ignore" },
  );
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`helper exited ${code}`)));
  });

  assert.equal(Date.now() - started < 1500, true, "a wedged socket must not delay the live TUI");
  assert.deepEqual(navigations, [{ type: "session", sessionID }]);
  assert.throws(() => readFileSync(capture), { code: "ENOENT" });
});

function stubKittyEnvironment(t) {
  const originalKittyListenOn = process.env.KITTY_LISTEN_ON;
  const originalKittyWindowID = process.env.KITTY_WINDOW_ID;
  t.after(() => {
    if (originalKittyListenOn === undefined) delete process.env.KITTY_LISTEN_ON;
    else process.env.KITTY_LISTEN_ON = originalKittyListenOn;
    if (originalKittyWindowID === undefined) delete process.env.KITTY_WINDOW_ID;
    else process.env.KITTY_WINDOW_ID = originalKittyWindowID;
  });
  process.env.KITTY_LISTEN_ON = "unix:/tmp/kitty-test-stub";
  process.env.KITTY_WINDOW_ID = "42";
}

for (const scenario of ["timeout", "malformed", "disconnect", "decline", "decline-then-handled", "dead", "legacy"]) {
  test(`isolated routing: ${scenario}`, async (t) => {
    const root = mkdtempSync(join(TEMP_ROOT, "r-"));
    const bin = join(root, "bin");
    const ipcDirectory = join(root, "ipc");
    const capture = join(root, "launch");
    mkdirSync(bin);
    mkdirSync(ipcDirectory);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(bin, "omarchy-launch-tui"), '#!/bin/sh\nprintf \'%s\\0\' "$@" >> "$CAPTURE_FILE"\n');
    chmodSync(join(bin, "omarchy-launch-tui"), 0o700);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CAPTURE_FILE: capture };
    const first = join(ipcDirectory, "t-1-abcdef.sock");
    let firstRequests = 0;
    let secondRequests = 0;
    const sessionID = "ses_isolated123";
    const project = join(root, "project with spaces");
    if (scenario === "dead") {
      // Killing an isolated server leaves a real dead Unix socket inode.
      const child = spawn(process.execPath, ["--input-type=module", "-e",
        'import {createServer} from "node:net"; createServer().listen(process.argv[1], () => console.log("ready"));', first],
        { stdio: ["ignore", "pipe", "ignore"] });
      t.after(() => child.kill());
      await new Promise((resolve, reject) => { child.once("error", reject); child.stdout.once("data", resolve); });
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
    } else if (scenario !== "legacy") {
      const server = createServer((socket) => {
        socket.on("error", () => {});
        socket.once("data", () => {
          firstRequests++;
          if (scenario === "timeout") return;
          if (scenario === "disconnect") return socket.end();
          socket.end(scenario === "malformed" ? 'not-json\n' : '{"handled":false}\n');
        });
      });
      await new Promise((resolve) => server.listen(first, resolve));
      t.after(() => server.close());
      if (scenario !== "decline") {
        const second = createServer((socket) => socket.once("data", () => {
          secondRequests++;
          socket.end('{"handled":true}\n');
        }));
        await new Promise((resolve) => second.listen(join(ipcDirectory, "t-2-abcdef.sock"), resolve));
        t.after(() => second.close());
      }
    }
    if (scenario === "legacy") {
      const child = spawn(process.execPath, [HELPER, sessionID, first, project, ipcDirectory], { env, stdio: "ignore" });
      await new Promise((resolve) => child.once("exit", (code) => { assert.equal(code, 0); resolve(); }));
    } else {
      await runHelper(env, sessionID, project, ipcDirectory,
        ["dead", "decline-then-handled"].includes(scenario) ? 0 : 1);
    }
    if (["dead", "legacy"].includes(scenario)) {
      assert.deepEqual(await waitForFile(capture), ["--app-id=org.omarchy.agent", "opencode", "--session", sessionID, project]);
      assert.equal(existsSync(first), false);
    } else {
      assert.equal(existsSync(capture), false);
      assert.equal(existsSync(first), true);
      assert.equal(firstRequests, 1);
      assert.equal(secondRequests, scenario === "decline-then-handled" ? 1 : 0);
    }
  });
}

function startTuiStub(t, ipcDirectory, sessionID, navigations) {
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
  return ipc.ready;
}

async function runHelper(env, sessionID, project, ipcDirectory, expectedCode = 0) {
  const child = spawn(
    process.execPath,
    [HELPER, sessionID, project, ipcDirectory],
    { env, stdio: "ignore" },
  );
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === expectedCode ? resolve() : reject(new Error(`helper exited ${code}`)));
  });
}

test("does not launch a new TUI when focusing the handled Kitty window fails", async (t) => {
  const root = mkdtempSync(join(TEMP_ROOT, "r-"));
  const bin = join(root, "bin");
  const runtime = join(root, "runtime");
  const capture = join(root, "launcher-argv");
  const project = join(root, "project");
  const ipcDirectory = join(runtime, "opencode-omarchy-notifications");
  const launcher = join(bin, "omarchy-launch-tui");
  const kitty = join(bin, "kitty");
  const sessionID = "ses_focusFallback123";
  const navigations = [];
  t.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(bin, { recursive: true });
  writeFileSync(launcher, '#!/bin/sh\nprintf \'%s\\0\' "$@" > "$CAPTURE_FILE"\n');
  chmodSync(launcher, 0o700);
  writeFileSync(kitty, "#!/bin/sh\nexit 1\n");
  chmodSync(kitty, 0o700);

  stubKittyEnvironment(t);
  assert.equal(await startTuiStub(t, ipcDirectory, sessionID, navigations), true);

  const env = {
    ...process.env,
    XDG_RUNTIME_DIR: runtime,
    CAPTURE_FILE: capture,
    PATH: `${bin}:${process.env.PATH}`,
  };
  await runHelper(env, sessionID, project, ipcDirectory, 1);

  assert.deepEqual(navigations, [{ type: "session", sessionID }]);
  assert.equal(existsSync(capture), false);
});

test("does not launch another TUI when focusing the Kitty window succeeds", async (t) => {
  const root = mkdtempSync(join(TEMP_ROOT, "r-"));
  const bin = join(root, "bin");
  const runtime = join(root, "runtime");
  const capture = join(root, "launcher-argv");
  const kittyCapture = join(root, "kitty-argv");
  const project = join(root, "project");
  const ipcDirectory = join(runtime, "opencode-omarchy-notifications");
  const launcher = join(bin, "omarchy-launch-tui");
  const kitty = join(bin, "kitty");
  const sessionID = "ses_focusSuccess123";
  const navigations = [];
  t.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(bin, { recursive: true });
  writeFileSync(launcher, '#!/bin/sh\nprintf \'%s\\0\' "$@" > "$CAPTURE_FILE"\n');
  chmodSync(launcher, 0o700);
  writeFileSync(kitty, '#!/bin/sh\nprintf \'%s\\0\' "$@" > "$KITTY_CAPTURE_FILE"\n');
  chmodSync(kitty, 0o700);

  stubKittyEnvironment(t);
  assert.equal(await startTuiStub(t, ipcDirectory, sessionID, navigations), true);

  const env = {
    ...process.env,
    XDG_RUNTIME_DIR: runtime,
    CAPTURE_FILE: capture,
    KITTY_CAPTURE_FILE: kittyCapture,
    PATH: `${bin}:${process.env.PATH}`,
  };
  await runHelper(env, sessionID, project, ipcDirectory);

  assert.deepEqual(navigations, [{ type: "session", sessionID }]);
  assert.deepEqual(await waitForFile(kittyCapture), [
    "@",
    "--to",
    "unix:/tmp/kitty-test-stub",
    "focus-window",
    "--match",
    "id:42",
  ]);
  assert.throws(() => readFileSync(capture), { code: "ENOENT" });
});
