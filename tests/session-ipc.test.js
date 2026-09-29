import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
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
  assert.equal(await requestSessionSelection(ipc.socketPath, "not-a-session"), null);
  assert.equal(await requestSessionSelection(ipc.socketPath, TEST_SESSION_ID), null);
  assert.deepEqual(navigations, []);
});
