# OpenCode Omarchy Notifications

A local OpenCode V2 CLI/TUI plugin that sends Omarchy desktop notifications for session activity.

## What it reports

- Which agent acted (for example, `build`) and the session title.
- Task completion, failure, and interruption for root sessions.
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

Each running TUI exposes a private, per-user Unix socket for notification clicks. The click routes to a live TUI that can open the session (and focuses its Kitty window when available); only when no running TUI accepts the session does it launch `opencode --session <id>` in the session's project directory. Omarchy merges identical simultaneous notifications from multiple TUI processes. Permission alerts are sent only after confirming that the specific request is still pending.

## Development check

```sh
node --check tui.js
node --check open-session.js
npm test
```
