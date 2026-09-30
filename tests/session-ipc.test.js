import assert from "node:assert/strict";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { requestSessionSelection, startSessionIpc } from "../session-ipc.js";

const TEST_SESSION_ID = "ses_testSession123";
const TEMP_ROOT = process.env.OPENCODE_TEST_TMPDIR || (existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir());

function temporaryDirectory() {
  return mkdtempSync(join(TEMP_ROOT, "omarchy-notifications-test-"));
}

test("routes a notification to the session in this TUI", async (t) => {
  const directory = temporaryDirectory();
  const navigations = [];
  const context = {
    data: {
      session: {
        get: (sessionID) => sessionID === TEST_SESSION_ID ? { id: sessionID } : undefined,
        sync: async () => {},
      },
    },
    ui: {
      router: {
        navigate: (destination) => navigations.push(destination),
      },
    },
  };
  const ipc = startSessionIpc(context, directory);
  t.after(() => {
    ipc.close();
    rmSync(directory, { recursive: true, force: true });
  });

  assert.equal(await ipc.ready, true);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(ipc.socketPath).mode & 0o777, 0o600);

  const result = await requestSessionSelection(ipc.socketPath, TEST_SESSION_ID);

  assert.equal(result?.handled, true);
  assert.deepEqual(navigations, [{ type: "session", sessionID: TEST_SESSION_ID }]);
});

test("does not route malformed or unavailable session IDs", async (t) => {
  const directory = temporaryDirectory();
  const navigations = [];
  const context = {
    data: {
      session: {
        get: () => undefined,
        sync: async () => {},
      },
    },
    ui: {
      router: {
        navigate: (destination) => navigations.push(destination),
      },
    },
  };
  const ipc = startSessionIpc(context, directory);
  t.after(() => {
    ipc.close();
    rmSync(directory, { recursive: true, force: true });
  });

  assert.equal(await ipc.ready, true);
  assert.equal((await requestSessionSelection(ipc.socketPath, "not-a-session")).outcome, "declined");
  assert.equal((await requestSessionSelection(ipc.socketPath, TEST_SESSION_ID)).outcome, "declined");
  assert.deepEqual(navigations, []);
});

test("removes its socket file when the IPC server closes", async (t) => {
  const directory = temporaryDirectory();
  const context = {
    data: {
      session: {
        get: () => undefined,
        sync: async () => {},
      },
    },
    ui: {
      router: {
        navigate: () => {},
      },
    },
  };
  const ipc = startSessionIpc(context, directory);
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  assert.equal(await ipc.ready, true);
  assert.equal(existsSync(ipc.socketPath), true);

  ipc.close();

  assert.equal(existsSync(ipc.socketPath), false);
});

test("reports unreachable sockets without flagging live declines", async (t) => {
  const directory = temporaryDirectory();
  const staleSocket = join(directory, "t-1-deadbeef.sock");
  const unreachable = [];
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  writeFileSync(staleSocket, "stale");
  assert.equal(
    (await requestSessionSelection(staleSocket, TEST_SESSION_ID, 1000, (path) => unreachable.push(path))).outcome,
    "dead",
  );
  assert.deepEqual(unreachable, [staleSocket]);

  const liveSocket = join(directory, "t-2-abcdef01.sock");
  const server = createServer((socket) => {
    socket.once("data", () => socket.end('{"handled":false}\n'));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(liveSocket, resolve);
  });
  t.after(() => server.close());

  unreachable.length = 0;
  assert.equal(
    (await requestSessionSelection(liveSocket, TEST_SESSION_ID, 1000, (path) => unreachable.push(path))).outcome,
    "declined",
  );
  assert.deepEqual(unreachable, []);
});

test("navigation exceptions and sync errors are uncertain, never explicit declines", async (t) => {
  const directory = temporaryDirectory();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const failure of ["sync", "navigate"]) {
    let navigations = 0;
    const ipc = startSessionIpc({
      data: { session: {
        get: () => failure === "sync" ? undefined : { id: TEST_SESSION_ID },
        sync: async () => { throw new Error("test sync failure"); },
      } },
      ui: { router: { navigate: () => { navigations++; throw new Error("test navigate failure"); } } },
    }, directory);
    try {
      assert.equal(await ipc.ready, true);
      assert.equal((await requestSessionSelection(ipc.socketPath, TEST_SESSION_ID)).outcome, "uncertain");
      assert.equal(navigations, failure === "navigate" ? 1 : 0);
    } finally { ipc.close(); }
  }
});
