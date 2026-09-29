# OpenCode Omarchy Notifications

A local OpenCode V2 CLI/TUI plugin that sends Omarchy desktop notifications for session activity.

## What it reports

- Which agent acted (for example, `build`) and the session title.
- Task completion, failure, and interruption for root sessions.
- Permission requests and questions that need an answer.

Notifications contain the agent name and session title, not the prompt or response text.

## Requirements

- OpenCode V2 with CLI plugin support.
- Omarchy's `omarchy-notification-send` command available in `PATH`.

## Install

Clone this repository locally, then add its absolute path to the `plugins` array in your global `cli.json` (`~/.config/opencode/cli.json`, or `$XDG_CONFIG_HOME/opencode/cli.json`):

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

## Development check

```sh
node --check tui.js
```
