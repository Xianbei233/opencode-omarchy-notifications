import { spawn } from "node:child_process";
import { lstatSync, unlinkSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { IPC_DIRECTORY } from "./ipc-path.js";
import { requestSessionSelection } from "./session-ipc.js";

const sessionID = process.argv[2] ?? "";
if (!/^ses[A-Za-z0-9_-]+$/.test(sessionID)) {
  console.error("Invalid OpenCode session ID");
  process.exit(2);
}

const SOCKET_NAME_PATTERN = /^t-\d+-[a-f0-9]+\.sock$/;
const SOCKET_REQUEST_TIMEOUT_MS = 1500;
const KITTY_FOCUS_TIMEOUT_MS = 3000;
const thirdArgument = process.argv[3] ?? "";
const legacyAction = Boolean(process.argv[5]) && SOCKET_NAME_PATTERN.test(basename(thirdArgument));
const directory = legacyAction ? process.argv[4] ?? "" : thirdArgument;
const ipcDirectory = legacyAction ? process.argv[5] || IPC_DIRECTORY : process.argv[4] || IPC_DIRECTORY;

async function selectInExistingTui() {
  const candidates = [];

  try {
    const names = await readdir(ipcDirectory);
    for (const name of names) {
      if (!SOCKET_NAME_PATTERN.test(name)) continue;
      const candidate = join(ipcDirectory, name);
      if (!candidates.includes(candidate)) candidates.push(candidate);
    }
  } catch (error) {
    return { outcome: error.code === "ENOENT" ? "absent" : "uncertain" };
  }

  let declined = false;
  for (const candidate of candidates.sort()) {
    let original;
    try {
      original = lstatSync(candidate);
      if (!original.isSocket()) return { outcome: "uncertain" };
    } catch (error) {
      if (error.code === "ENOENT") continue;
      return { outcome: "uncertain" };
    }
    const result = await requestSessionSelection(candidate, sessionID, SOCKET_REQUEST_TIMEOUT_MS, (socketPath) => {
      try {
        const current = lstatSync(socketPath);
        if (current.isSocket() && current.dev === original.dev && current.ino === original.ino) unlinkSync(socketPath);
      } catch {
        // Cleanup is best effort; never remove a replacement socket.
      }
    });
    if (result.outcome === "handled" || result.outcome === "uncertain") return result;
    if (result.outcome === "declined") declined = true;
  }
  return { outcome: declined ? "declined" : "absent" };
}

function focusTerminal(listenOn, windowID) {
  // Without Kitty metadata there is nothing to focus; the handled TUI
  // already navigated, so this does not need a fresh TUI.
  if (!listenOn || !/^\d+$/.test(windowID ?? "")) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (focused) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(focused);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, KITTY_FOCUS_TIMEOUT_MS);
    let child;
    try {
      child = spawn(
        "kitty",
        ["@", "--to", listenOn, "focus-window", "--match", `id:${windowID}`],
        { detached: true, stdio: "ignore" },
      );
    } catch (error) {
      console.error("Could not focus OpenCode terminal:", error);
      return finish(false);
    }
    child.on("error", (error) => {
      console.error("Could not focus OpenCode terminal:", error);
      finish(false);
    });
    child.on("exit", (code, signal) => {
      if (code !== 0) {
        console.error(`Could not focus OpenCode terminal: kitty exited ${code ?? signal}`);
        return finish(false);
      }
      finish(true);
    });
    child.unref();
  });
}

function launchSession() {
  const args = ["--app-id=org.omarchy.agent", "opencode", "--session", sessionID];
  if (directory && isAbsolute(directory)) args.push(directory);

  const child = spawn("omarchy-launch-tui", args, {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", (error) => {
    console.error("Could not open the OpenCode session:", error);
    process.exitCode = 1;
  });
  child.unref();
}

const selected = await selectInExistingTui();
if (selected.outcome === "absent") {
  launchSession();
} else if (selected.outcome === "handled") {
  if (!(await focusTerminal(selected.kittyListenOn, selected.kittyWindowID))) process.exitCode = 1;
} else {
  console.error(`OpenCode session selection ${selected.outcome}; not opening another TUI`);
  process.exitCode = 1;
}
