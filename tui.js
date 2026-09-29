import { Plugin } from "@opencode/plugin/tui";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const OPEN_SESSION_SCRIPT = fileURLToPath(new URL("./open-session.js", import.meta.url));
const SESSION_ID_PATTERN = /^ses[A-Za-z0-9_-]+$/;

export default Plugin.define({
  id: "opencode-omarchy-notifications",
  setup(context) {
    // The session-specific TUI opened by a notification should not register a
    // second global event listener and send duplicate notifications.
    if (process.env.OPENCODE_OMARCHY_NOTIFICATION_CHILD === "1") return;

    function notify(title, message, sessionID) {
      const args = ["--app-name", "OpenCode", "-u", "normal", "-t", "10000", title, message];
      if (typeof sessionID === "string" && SESSION_ID_PATTERN.test(sessionID)) {
        args.push("--exec", "node", OPEN_SESSION_SCRIPT, sessionID);
      }

      execFile(
        "omarchy-notification-send",
        args,
        (error) => {
          if (error) console.error("OpenCode notification failed:", error);
        },
      );
    }

    function notifyForSession(sessionID, status) {
      const session = context.data.session.get(sessionID);
      const agent = session?.agent?.trim() || "OpenCode";
      const sessionTitle = session?.title?.trim();
      const task = sessionTitle && sessionTitle !== "New Session"
        ? sessionTitle
        : `会话 ${sessionID.slice(-8)}`;

      notify(`${agent} · ${status}`, `任务：${task}`, sessionID);
    }

    function isRootSession(sessionID) {
      const rootID = context.data.session.root(sessionID);
      return !rootID || rootID === sessionID;
    }

    const stop = [
      context.data.on("permission.asked", (event) => {
        notifyForSession(event.data.sessionID, "等待权限批准");
      }),
      context.data.on("form.created", (event) => {
        notifyForSession(event.data.form.sessionID, "等待回答");
      }),
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

    return () => stop.forEach((unsubscribe) => unsubscribe());
  },
});
