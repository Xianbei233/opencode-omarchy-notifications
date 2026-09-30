import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, unlinkSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { join } from "node:path";
import { IPC_DIRECTORY } from "./ipc-path.js";

const SESSION_ID_PATTERN = /^ses[A-Za-z0-9_-]+$/;

export function startSessionIpc(context, directory = IPC_DIRECTORY) {
  let socketPath;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    socketPath = join(directory, `t-${process.pid}-${randomBytes(8).toString("hex")}.sock`);
  } catch (error) {
    console.error("Could not prepare OpenCode session IPC:", error);
    return { socketPath: "", ready: Promise.resolve(false), close() {} };
  }

  const server = createServer((socket) => {
    let input = "";
    let clientClosed = false;
    socket.setTimeout(6000, () => socket.destroy());
    socket.on("error", () => {});
    socket.on("close", () => {
      clientClosed = true;
    });
    socket.on("data", (chunk) => {
      input += chunk.toString();
      if (input.length > 4096) {
        socket.destroy();
        return;
      }

      const newline = input.indexOf("\n");
      if (newline < 0) return;
      socket.pause();

      void (async () => {
        try {
          const request = JSON.parse(input.slice(0, newline));
          const sessionID = request?.sessionID;
          if (typeof sessionID !== "string" || !SESSION_ID_PATTERN.test(sessionID)) {
            return { handled: false };
          }

          let session = context.data.session.get(sessionID);
          if (!session) {
            await context.data.session.sync(sessionID);
            session = context.data.session.get(sessionID);
          }
          if (!session || clientClosed || closed) return { handled: false };

          context.ui.router.navigate({ type: "session", sessionID });
          return {
            handled: true,
            kittyListenOn: process.env.KITTY_LISTEN_ON || "",
            kittyWindowID: process.env.KITTY_WINDOW_ID || "",
          };
        } catch (error) {
          console.error("Could not select OpenCode session from notification:", error);
          return { error: "selection failed" };
        }
      })().then((result) => {
        socket.end(`${JSON.stringify(result)}\n`);
      });
    });
  });

  let closed = false;
  const ready = new Promise((resolveReady) => {
    server.once("error", (error) => {
      console.error("OpenCode session IPC failed:", error);
      resolveReady(false);
    });
    server.listen(socketPath, () => {
      if (closed) {
        server.close();
        return resolveReady(false);
      }
      try {
        chmodSync(socketPath, 0o600);
        resolveReady(true);
      } catch (error) {
        console.error("Could not secure OpenCode session IPC socket:", error);
        resolveReady(false);
      }
    });
  });

  return {
    socketPath,
    ready,
    close() {
      closed = true;
      if (server.listening) server.close();
      try {
        unlinkSync(socketPath);
      } catch {
        // The socket may already have been removed by the runtime.
      }
    },
  };
}

export function requestSessionSelection(socketPath, sessionID, timeoutMs = 5000, onUnreachable, signal) {
  return new Promise((resolveRequest) => {
    let settled = false;
    let response = "";
    let socket;
    let connected = false;
    const timeout = setTimeout(() => finish({ outcome: "uncertain" }), timeoutMs);

    function abort() {
      finish({ outcome: "uncertain" });
    }

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      socket?.destroy();
      resolveRequest(result);
    }

    function fail(error) {
      if (settled) return;
      const dead = !connected && (error?.code === "ECONNREFUSED" || error?.code === "ENOENT");
      try {
        if (dead) onUnreachable?.(socketPath);
      } catch {
        // Reporting an unreachable socket must never break the caller.
      }
      finish({ outcome: dead ? "dead" : "uncertain" });
    }

    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });

    try {
      socket = createConnection(socketPath);
    } catch (error) {
      return fail(error);
    }

    socket.on("connect", () => {
      connected = true;
      socket.write(`${JSON.stringify({ sessionID })}\n`);
    });
    socket.on("data", (chunk) => {
      response += chunk.toString();
      if (response.length > 4096) return finish({ outcome: "uncertain" });
      const newline = response.indexOf("\n");
      if (newline < 0) return;
      try {
        const result = JSON.parse(response.slice(0, newline));
        finish(result?.handled === true ? { ...result, outcome: "handled" }
          : result?.handled === false ? { outcome: "declined" } : { outcome: "uncertain" });
      } catch {
        finish({ outcome: "uncertain" });
      }
    });
    socket.on("error", fail);
    socket.on("end", () => fail());
  });
}
