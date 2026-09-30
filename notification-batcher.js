const DEFAULT_WINDOW_MS = 2_000;

// Coalesces session-scoped notifications emitted within a short window into a
// single desktop notification, so a burst like "task done" + "waiting for
// input" arrives as one alert instead of two.
export function createNotificationBatcher({ send, windowMs = DEFAULT_WINDOW_MS }) {
  const pending = new Map();
  let disposed = false;

  function merge(entries) {
    const first = entries[0];
    const sameAgent = entries.every((entry) => entry.agent === first.agent);
    const titles = [...new Set(entries.map((entry) => `${entry.agent} · ${entry.status}`))];
    const statuses = [...new Set(entries.map((entry) => entry.status))];
    return {
      title: sameAgent ? `${first.agent} · ${statuses.join(" + ")}` : titles.join(" + "),
      message: first.message,
      sessionID: first.sessionID,
      directory: first.directory,
    };
  }

  function flush(key) {
    const batch = pending.get(key);
    if (!batch) return;
    pending.delete(key);
    clearTimeout(batch.timer);
    send(merge(batch.entries));
  }

  function notify({ sessionID, agent, status, message, directory }) {
    if (disposed) return;

    const key = typeof sessionID === "string" && sessionID ? sessionID : Symbol("notification");
    let batch = pending.get(key);
    if (!batch) {
      batch = { entries: [], timer: setTimeout(() => flush(key), windowMs) };
      pending.set(key, batch);
    }
    batch.entries.push({ sessionID, agent, status, message, directory });
  }

  function dispose() {
    // Flush queued notifications before tearing down so the last pending
    // event of a session is not lost; nothing new is accepted afterwards.
    for (const key of [...pending.keys()]) flush(key);
    disposed = true;
  }

  return { notify, dispose };
}
