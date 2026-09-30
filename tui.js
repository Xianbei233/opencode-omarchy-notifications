import { Plugin } from "@opencode/plugin/tui";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { IPC_DIRECTORY } from "./ipc-path.js";
import { createFormNotifier } from "./form-notifier.js";
import { createKittyFocus } from "./kitty-focus.js";
import { createPermissionNotifier } from "./permission-notifier.js";
import { startSessionIpc } from "./session-ipc.js";

const OPEN_SESSION_SCRIPT = fileURLToPath(new URL("./open-session.js", import.meta.url));
const SESSION_ID_PATTERN = /^ses[A-Za-z0-9_-]+$/;

export default Plugin.define({
  id: "opencode-omarchy-notifications",
  setup(context) {
    const ipc = startSessionIpc(context);

    function send(title, message, sessionID, directory) {
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

    const focus = createKittyFocus({
      execFile,
      onError: (error) => console.error("OpenCode focus check failed:", error),
    });

    // Skip the desktop notification while the Kitty window hosting this TUI
    // already has focus; anything we cannot determine counts as unfocused.
    function notify(title, message, sessionID, directory) {
      void focus.focused().then((isFocused) => {
        if (!isFocused) send(title, message, sessionID, directory);
      });
    }

    function notifyForSession(sessionID, status) {
      const session = context.data.session.get(sessionID);
      const agent = session?.agent?.trim() || "OpenCode";
      const sessionTitle = session?.title?.trim();
      const task = sessionTitle && sessionTitle !== "New Session"
        ? sessionTitle
        : `会话 ${sessionID.slice(-8)}`;
      const directory = session?.directory || session?.location?.directory || context.location?.directory;

      notify(`${agent} · ${status}`, `任务：${task}`, sessionID, directory);
    }

    const permissionNotifications = createPermissionNotifier({
      getPendingPermissions: (sessionID) => context.data.session.permission(sessionID),
      notify: (sessionID) => notifyForSession(sessionID, "等待权限批准"),
      onError: (error) => console.error("OpenCode permission notification check failed:", error),
    });

    const formNotifications = createFormNotifier({
      getPendingForms: (sessionID) => context.data.session.question?.(sessionID),
      isSessionAlive: (sessionID) => Boolean(context.data.session.get(sessionID)),
      notify: (sessionID) => notifyForSession(sessionID, "等待回答"),
      onError: (error) => console.error("OpenCode form notification check failed:", error),
    });

    function isRootSession(sessionID) {
      const rootID = context.data.session.root(sessionID);
      return !rootID || rootID === sessionID;
    }

    const stop = [
      context.data.on("permission.asked", permissionNotifications.asked),
      context.data.on("permission.replied", permissionNotifications.replied),
      context.data.on("form.created", formNotifications.created),
      context.data.on("form.replied", formNotifications.closed),
      context.data.on("form.cancelled", formNotifications.closed),
      context.data.on("session.execution.succeeded", (event) => {
        if (isRootSession(event.data.sessionID)) {
          notifyForSession(event.data.sessionID, "任务完成");
        }
      }),
      context.data.on("session.execution.failed", (event) => {
        if (isRootSession(event.data.sessionID)) {
          notifyForSession(event.data.sessionID, "执行失败");
        }
      }),
      context.data.on("session.execution.interrupted", (event) => {
        if (isRootSession(event.data.sessionID)) {
          notifyForSession(event.data.sessionID, "任务中断");
        }
      }),
    ];

    return () => {
      permissionNotifications.dispose();
      formNotifications.dispose();
      stop.forEach((unsubscribe) => unsubscribe());
      ipc.close();
    };
  },
});
