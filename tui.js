import { Plugin } from "@opencode/plugin/tui";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { IPC_DIRECTORY } from "./ipc-path.js";
import { wireFormNotifications } from "./form-notifier.js";
import { createNotificationBatcher } from "./notification-batcher.js";
import { latestAssistantReply, truncateText } from "./notification-message.js";
import { createPermissionNotifier } from "./permission-notifier.js";
import { createIdleRechecker, createSessionIdleCheck } from "./session-idle.js";
import { startSessionIpc } from "./session-ipc.js";
import { createPermissionErrorReporter, readSessionPermissions } from "./session-permissions.js";

const OPEN_SESSION_SCRIPT = fileURLToPath(new URL("./open-session.js", import.meta.url));
const SESSION_ID_PATTERN = /^ses[A-Za-z0-9_-]+$/;

export default Plugin.define({
  id: "opencode-omarchy-notifications",
  setup(context) {
    const ipc = startSessionIpc(context);

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

    const batcher = createNotificationBatcher({ send });

    // Reads the cached session messages; any failure just omits the reply line.
    function readMessages(sessionID) {
      try {
        const messages = context.data.session.message;
        return typeof messages === "function" ? messages(sessionID) : messages?.list?.(sessionID);
      } catch {
        return undefined;
      }
    }

    function notifyForSession(sessionID, status) {
      const session = context.data.session.get(sessionID);
      const agent = session?.agent?.trim() || "OpenCode";
      const sessionTitle = session?.title?.trim();
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
    }

    const reportPermissionError = createPermissionErrorReporter({
      onError: (error) => console.error("OpenCode permission notification check failed:", error),
    });
    const permissionNotifications = createPermissionNotifier({
      getPendingPermissions: (sessionID) => readSessionPermissions(context.data.session, sessionID),
      notify: (sessionID) => notifyForSession(sessionID, "等待权限批准"),
      onError: reportPermissionError,
    });

    async function getPendingForms(sessionID) {
      const forms = context.data.session.form;
      if (typeof forms?.sync !== "function" || typeof forms?.list !== "function") {
        throw new TypeError("V2 session.form sync/list accessor is unavailable");
      }
      await forms.sync(sessionID, context.location);
      return forms.list(sessionID, context.location);
    }

    const stopFormNotifications = wireFormNotifications({
      data: context.data,
      getPendingForms,
      notify: (sessionID) => notifyForSession(sessionID, "等待回答"),
      onError: () => console.error("OpenCode form notification check failed; pending state unavailable, alert suppressed"),
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
      notify: (sessionID, status) => notifyForSession(sessionID, status),
      onError: (error) => console.error("OpenCode idle recheck failed:", error),
    });

    function isRootSession(sessionID) {
      const rootID = context.data.session.root(sessionID);
      return !rootID || rootID === sessionID;
    }

    const stop = [
      context.data.on("permission.asked", permissionNotifications.asked),
      context.data.on("permission.replied", permissionNotifications.replied),
      context.data.on("session.execution.succeeded", (event) => {
        if (isRootSession(event.data.sessionID)) {
          completionRecheck.recheck(event.data.sessionID, "任务完成");
        }
      }),
      context.data.on("session.execution.failed", (event) => {
        if (isRootSession(event.data.sessionID)) {
          completionRecheck.recheck(event.data.sessionID, "执行失败");
        }
      }),
      context.data.on("session.execution.interrupted", (event) => {
        if (isRootSession(event.data.sessionID)) {
          completionRecheck.recheck(event.data.sessionID, "任务中断");
        }
      }),
    ];

    return () => {
      permissionNotifications.dispose();
      stopFormNotifications();
      completionRecheck.dispose();
      batcher.dispose();
      stop.forEach((unsubscribe) => unsubscribe());
      ipc.close();
    };
  },
});
