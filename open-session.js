import { spawn } from "node:child_process";

const sessionID = process.argv[2] ?? "";
if (!/^ses[A-Za-z0-9_-]+$/.test(sessionID)) {
  console.error("Invalid OpenCode session ID");
  process.exit(2);
}

const sessionKey = sessionID.toLowerCase().replace(/[^a-z0-9]/g, "");
const appID = `org.omarchy.opencode.session-${sessionKey}`;
const child = spawn(
  "omarchy-launch-or-focus-tui",
  [`--app-id=${appID}`, "opencode", "--session", sessionID],
  {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      OPENCODE_OMARCHY_NOTIFICATION_CHILD: "1",
    },
  },
);

child.on("error", (error) => {
  console.error("Could not open the OpenCode session:", error);
  process.exitCode = 1;
});
child.unref();
