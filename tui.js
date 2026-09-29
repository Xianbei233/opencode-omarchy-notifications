import { Plugin } from "@opencode/plugin/tui";
import { execFile } from "node:child_process";

export default Plugin.define({
  id: "opencode-omarchy-notifications",
  setup(context) {
    function notify(title, message) {
      execFile(
        "omarchy-notification-send",
        ["--app-name", "OpenCode", "-u", "normal", "-t", "10000", title, message],
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

      notify(`${agent} · ${status}`, `任务：${task}`);
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
