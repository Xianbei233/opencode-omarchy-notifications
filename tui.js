import { define as definePlugin } from "@opencode/plugin/tui/plugin";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { IPC_DIRECTORY } from "./ipc-path.js";
import { createPendingFormsReader, wireFormNotifications } from "./form-notifier.js";
import { createNotificationBatcher } from "./notification-batcher.js";
import { latestAssistantReply, truncateText } from "./notification-message.js";
import { createPermissionNotifier } from "./permission-notifier.js";
import { createIdleRechecker, createSessionIdleCheck } from "./session-idle.js";
import { startSessionIpc } from "./session-ipc.js";
import { createPermissionErrorReporter, readSessionPermissions } from "./session-permissions.js";
import { createRootSessionFilter } from "./root-session.js";
import { RenameRPC } from "./rename-rpc.js";

const OPEN_SESSION_SCRIPT = fileURLToPath(new URL("./open-session.js", import.meta.url));
const SESSION_ID_PATTERN = /^ses[A-Za-z0-9_-]+$/;

export async function setup(context, { send: sendOverride, completionDelayMs = 800, renameWaitMs = 245_000, raceRetryMs = 1_000, batchWindowMs = 2_000, pendingDelayMs = 500, startIpc = startSessionIpc } = {}) {
    const ipc = startIpc(context);

    function send({ title, message, sessionID, directory }) {
      const args = ["--app-name", "OpenCode", "-u", "normal", "-t", "10000", title, message];
      if (typeof sessionID === "string" && SESSION_ID_PATTERN.test(sessionID)) {
        args.push(
          "--exec",
          "node",
          OPEN_SESSION_SCRIPT,
          sessionID,
          directory || "",
          IPC_DIRECTORY,
        );
      }

      execFile(
        "omarchy-notification-send",
        args,
        (error) => {
          if (error) console.error("OpenCode notification failed:", error);
        },
      );
    }

    const batcher = createNotificationBatcher({ send: sendOverride ?? send, windowMs: batchWindowMs });
    let renameRPC;
    try { renameRPC = context.client.rpc(RenameRPC); } catch { /* older server/plugin: notify without waiting */ }
    const renameWaits = new Set();
    const retryDelays = new Set();
    let disposed = false;
    const invalidatedExecutions = new Set();
    const waitingFor = new Map();
    const pendingCompletions = new Map();
    const rememberCompletion = (sessionID, executionID) => {
      waitingFor.set(sessionID, executionID);
      pendingCompletions.set(sessionID, executionID);
      if (waitingFor.size > 256) waitingFor.delete(waitingFor.keys().next().value);
      if (pendingCompletions.size > 256) pendingCompletions.delete(pendingCompletions.keys().next().value);
    };
    const delay = (ms) => new Promise((resolve) => {
      const entry = { resolve, timer: undefined };
      entry.timer = setTimeout(() => { retryDelays.delete(entry); resolve(); }, ms);
      retryDelays.add(entry);
    });

    // Reads the cached session messages; any failure just omits the reply line.
    function readMessages(sessionID) {
      try {
        const messages = context.data.session.message;
        return typeof messages === "function" ? messages(sessionID) : messages?.list?.(sessionID);
      } catch {
        return undefined;
      }
    }

    function notifyForSession(sessionID, status, executionID, trustedTitle) {
      if (executionID && invalidatedExecutions.has(executionID)) return;
      const notify = (resolvedTitle) => {
      const session = context.data.session.get(sessionID);
      const agent = session?.agent?.trim() || "OpenCode";
      const sessionTitle = resolvedTitle || trustedTitle || session?.title?.trim();
      const task = sessionTitle && sessionTitle !== "New Session"
        ? truncateText(sessionTitle, 40)
        : `会话 ${sessionID.slice(-8)}`;
      const directory = session?.directory || session?.location?.directory || context.location?.directory;
      const reply = latestAssistantReply(readMessages(sessionID));
      const message = reply ? `任务：${task}\n回复：${reply}` : `任务：${task}`;

      batcher.notify({
        sessionID,
        agent,
        status,
        message,
        directory,
      });
      };
      if (!renameRPC || !executionID || status === "等待权限批准" || status === "等待回答") { notify(trustedTitle); return; }
      let done = false;
      let timer;
      let unsubscribe;
      let resolveWait;
      let terminalTitle = "";
      let generationState = "unknown";
      const wait = new Promise((resolve) => { resolveWait = resolve; });
      const finish = () => { if (done) return; done = true; clearTimeout(timer); unsubscribe?.(); renameWaits.delete(cancel); resolveWait(); };
      const cancel = finish;
      renameWaits.add(cancel);
      const onState = (event) => {
        const state = event.data;
        if (state.sessionID !== sessionID || state.executionID !== executionID) return;
        generationState = state.status;
        if (state.status !== "pending" && state.status !== "unknown") { terminalTitle = state.title || ""; finish(); }
      };
      try { unsubscribe = renameRPC.events.on("state", onState); } catch { finish(); }
      timer = setTimeout(finish, renameWaitMs);
      // Event subscription is established before the snapshot to close the
      // terminal-event/query race. Unknown means the server-side plugin is absent.
      Promise.resolve().then(async () => {
        try {
          const deadline = Date.now() + raceRetryMs;
          do {
            const state = await renameRPC.getState({ sessionID, executionID });
            if (state.sessionID !== sessionID || state.executionID !== executionID) { finish(); break; }
            generationState = state.status;
            if (state.status === "pending") { await wait; break; }
            if (state.status !== "unknown") { terminalTitle = state.title || ""; finish(); break; }
            if (Date.now() >= deadline) { finish(); break; }
            await delay(Math.min(25, deadline - Date.now()));
          } while (!done && !disposed);
        } catch { finish(); }
        if (done && !disposed && !invalidatedExecutions.has(executionID)) {
          try { await context.data.session.sync(sessionID); } catch { /* trusted same-execution RPC title remains a fallback */ }
          try {
            await context.data.session.permission.sync(sessionID);
            await context.data.session.form.sync(sessionID, context.location);
          } catch { return; }
          // A long wait must not bypass the ordinary busy/permission/form recheck.
          if (!completionRecheck.isIdle(sessionID)) return;
          notify(terminalTitle);
        }
      }).catch((error) => { finish(); if (!disposed) console.error("OpenCode rename notification check failed:", error); });
    }

    const reportPermissionError = createPermissionErrorReporter({
      onError: (error) => console.error("OpenCode permission notification check failed:", error),
    });
    const isRootSession = createRootSessionFilter(
      (sessionID) => context.data.session.root(sessionID),
      () => reportPermissionError(new Error("Session ancestry unavailable; notification suppressed")),
    );
    const permissionNotifications = createPermissionNotifier({
      getPendingPermissions: (sessionID) => readSessionPermissions(context.data.session, sessionID),
      notify: (sessionID) => notifyForSession(sessionID, "等待权限批准"),
      isRootSession,
      onError: reportPermissionError,
      delayMs: pendingDelayMs,
    });

    const getPendingForms = createPendingFormsReader(context.data, context.location);

    const stopFormNotifications = wireFormNotifications({
      data: context.data,
      getPendingForms,
      notify: (sessionID) => notifyForSession(sessionID, "等待回答"),
      onError: () => console.error("OpenCode form notification check failed; pending state unavailable, alert suppressed"),
      isRootSession,
      delayMs: pendingDelayMs,
    });

    // `session.execution.*` marks the end of one agent round, not the whole
    // task — a round also ends when the agent pauses for a permission reply or
    // a question form. Only notify once the recheck finds the session truly
    // idle with nothing pending; a still-running round notifies nothing.
    const isIdle = createSessionIdleCheck({
      store: context.data.session,
      onError: reportPermissionError,
      getPendingPermissions: (sessionID) => readSessionPermissions(context.data.session, sessionID),
      getPendingForms: (sessionID) => {
        const list = context.data.session.form?.list;
        if (typeof list !== "function") throw new TypeError("V2 session.form.list accessor is unavailable");
        const forms = list(sessionID, context.location);
        if (!Array.isArray(forms)) throw new TypeError("Pending form cache is unavailable");
        return forms;
      },
    });
    const completionRecheck = createIdleRechecker({
      isIdle,
      notify: (sessionID, status, executionID) => {
        if (pendingCompletions.get(sessionID) === executionID) pendingCompletions.delete(sessionID);
        if (executionID && invalidatedExecutions.has(executionID)) return;
        notifyForSession(sessionID, status, executionID);
      },
      onError: (error) => console.error("OpenCode idle recheck failed:", error),
      delayMs: completionDelayMs,
    });

    const stop = [
      context.data.on("session.execution.started", (event) => {
        const id = event.data.sessionID;
        const pending = pendingCompletions.get(id);
        if (pending) invalidatedExecutions.add(pending);
        const awaiting = waitingFor.get(id);
        if (awaiting && event.id !== awaiting) invalidatedExecutions.add(awaiting);
        if (invalidatedExecutions.size > 256) invalidatedExecutions.delete(invalidatedExecutions.values().next().value);
      }),
      context.data.on("permission.asked", permissionNotifications.asked),
      context.data.on("permission.replied", permissionNotifications.replied),
      context.data.on("session.execution.succeeded", (event) => {
        if (isRootSession(event.data.sessionID)) {
          rememberCompletion(event.data.sessionID, event.id);
          completionRecheck.recheck(event.data.sessionID, "最新回复", event.id);
        }
      }),
      context.data.on("session.execution.failed", (event) => {
        if (isRootSession(event.data.sessionID)) {
          rememberCompletion(event.data.sessionID, event.id);
          completionRecheck.recheck(event.data.sessionID, "执行失败", event.id);
        }
      }),
      context.data.on("session.execution.interrupted", (event) => {
        if (isRootSession(event.data.sessionID)) {
          rememberCompletion(event.data.sessionID, event.id);
          completionRecheck.recheck(event.data.sessionID, "任务中断", event.id);
        }
      }),
    ];

    return () => {
      disposed = true;
      permissionNotifications.dispose();
      stopFormNotifications();
      completionRecheck.dispose();
      renameWaits.forEach((cancel) => cancel());
      for (const entry of retryDelays) { clearTimeout(entry.timer); entry.resolve(); }
      retryDelays.clear();
      batcher.dispose();
      stop.forEach((unsubscribe) => unsubscribe());
      ipc.close();
    };
}

export default definePlugin({ id: "opencode-omarchy-notifications", setup });
