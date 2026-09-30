# OpenCode Omarchy Notifications

A local OpenCode V2 CLI/TUI plugin that sends Omarchy desktop notifications for session activity.

## What it reports

- Which agent acted (for example, `build`) and the session title.
- Task completion, failure, and interruption for root sessions — reported only after a delayed recheck confirms the session is truly idle with no pending permission or form, so a round that pauses for input never claims the task is done.
- Permission requests and questions that need an answer.
- Clicking a notification switches the TUI that sent it to that session; it starts a TUI only when no running TUI can handle the session.

Notifications contain the agent name and session title, not the prompt or response text.

## Requirements

- OpenCode V2 with CLI plugin support.
- Omarchy's `omarchy-notification-send` command available in `PATH`.
- Omarchy's `omarchy-launch-tui` terminal launcher available in `PATH`.

## Install

Clone this repository locally:

```sh
git clone https://github.com/Xianbei233/opencode-omarchy-notifications.git
```

Then add the clone's absolute path to the `plugins` array in your global `cli.json` (`~/.config/opencode/cli.json`, or `$XDG_CONFIG_HOME/opencode/cli.json`):

```json
{
  "attention": {
    "notifications": false,
    "sound": true,
    "volume": 0.4
  },
  "plugins": [
    "/absolute/path/to/opencode-omarchy-notifications"
  ]
}
```

Keep any other plugins already in the array. The built-in OpenCode notification popup is disabled here to avoid duplicate alerts; the plugin sends the desktop notification directly through Omarchy. Sound remains independently configurable.

Restart the OpenCode TUI after changing the plugin path.

Each running TUI exposes a private, per-user Unix socket for notification clicks. The click queries every socket in parallel and removes ones left behind by dead TUIs. It routes to the first TUI that can open the session and focuses its Kitty window; when no running TUI accepts the session, or the Kitty focus fails, it launches `opencode --session <id>` in the session's project directory. Omarchy merges identical simultaneous notifications from multiple TUI processes. Permission alerts are sent only after confirming that the specific request is still pending; question forms get the same delayed check and are cancelled by `form.replied`/`form.cancelled` events. Notifications are suppressed while the Kitty window hosting the TUI is focused (checked through `kitty @ ls` when `KITTY_LISTEN_ON`/`KITTY_WINDOW_ID` are set, short-cached), and bursts within a two-second window per session are merged into a single notification. `session.execution.*` events mark the end of one agent round rather than the whole task, so completion, failure, and interruption alerts are deferred by ~800ms and only sent when the session status reads idle/waiting and no permission request or form is still open; repeated round events for a session coalesce into at most one notification. The notification body also carries the assistant's latest reply text (truncated) when available.

## Development check

```sh
node --check tui.js
node --check open-session.js
npm test
```
