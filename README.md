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

Each plugin-registered TUI exposes a private, per-user Unix socket for notification clicks. A click contacts one socket at a time (sorted by name), never broadcasts navigation. Only an explicit decline or a confirmed dead endpoint permits trying another socket. A timeout, disconnect, malformed response, or other uncertain failure stops the action: navigation may already have happened, so it neither tries another TUI nor launches one. After a handled response it attempts to focus the Kitty window; a focus failure is reported without launching another TUI. Missing Kitty metadata means navigation succeeds without an explicit focus attempt.

Only no registered sockets, or exclusively confirmed dead endpoints, launches `opencode --session <id>` once in the session's absolute project directory. A live TUI declining the session prevents fallback launch even if all other endpoints are dead. Cleanup is limited to `ECONNREFUSED`/`ENOENT` and a socket inode still matching the one examined before the request; timeouts and declines never remove sockets. Legacy notification action arguments remain supported. This discovers only plugin-registered TUIs: processes without registered IPC cannot be reliably identified, so it cannot guarantee that no other OpenCode process exists. It intentionally does not use fuzzy process-name matching. Separate simultaneous clicks are not globally serialized.

Omarchy merges identical simultaneous notifications from multiple TUI processes. Notifications are sent regardless of whether the OpenCode/Kitty window is focused; sending does not query Kitty focus state. Permission alerts are sent only after confirming that the specific request is still pending, using the documented V2 `session.permission.list(sessionID)` accessor (with compatibility for a callable accessor). An unknown or unreadable permission cache suppresses both permission alerts and completion claims. Permission notification and idle checks share a redacted error reporter: at most one diagnostic per 60 seconds per plugin instance, using constant memory and never including permission/reply content or the original error details. Recovery to readable data immediately permits normal notifications, even within the diagnostic cooldown. See the [official V2 CLI plugin contract](https://opencode.ai/v2/docs/build/plugins/cli). Question forms use the V2 `form.created` payload’s top-level `id` and `sessionID`, then refresh and read pending forms through `context.data.session.form.sync(sessionID, location)` and `.list(sessionID, location)`. Top-level IDs in `form.replied` and `form.cancelled` suppress delayed alerts. Missing or malformed pending state fails closed and emits a content-free diagnostic; session existence alone is not proof of a pending form. Natural-language questions without structured form events are deliberately not inferred from punctuation or text. Bursts within a two-second window per session are merged into a single notification. `session.execution.*` events mark the end of one agent round rather than the whole task, so completion, failure, and interruption alerts are deferred by ~800ms and only sent when the session status reads idle/waiting and no permission request or form is still open; repeated round events for a session coalesce into at most one notification. The notification body also carries the assistant's latest reply text (truncated) when available.

## Development check

```sh
node --check tui.js
node --check open-session.js
npm test
```
