// Session-idle recheck for execution events.
//
// `session.execution.succeeded` fires at the end of *one* execution round in
// OpenCode V2 — including rounds that stop because the agent is now waiting on
// a permission reply or a question form — not only when the whole task is
// done. Notifying "task complete" on that event alone is a false positive.
// The delayed recheck mirrors the permission/form notifiers: after the event
// settles (~800ms) the session is only reported finished when its status is a
// recognised idle/waiting state AND no permission request or form is pending.
// Unknown or unreadable status is treated as "not idle" so a busy round can
// never produce a premature completion alert.

const IDLE_STATUS_TYPES = new Set([
  "idle",
  "waiting",
  "awaiting_input",
  "completed",
  "done",
  "stopped",
  "ready",
]);

// Normalise the many possible status shapes ({type}, {status}, a bare string,
// or boolean flags on a record) into a lower-case type string, or undefined
// when nothing recognisable is present.
function statusType(raw) {
  if (typeof raw === "string") return raw.toLowerCase();
  if (raw && typeof raw === "object") {
    if (typeof raw.type === "string") return raw.type.toLowerCase();
    if (typeof raw.status === "string") return statusType(raw.status);
    if (typeof raw.state === "string") return statusType(raw.state);
    if (raw.idle === true) return "idle";
    if (raw.busy === true || raw.running === true || raw.working === true) return "busy";
  }
  return undefined;
}

function callAccessor(store, accessor, sessionID) {
  if (typeof accessor !== "function") return undefined;
  return accessor.call(store, sessionID);
}

// True only when the session reports a recognisable idle/waiting status.
// Missing accessors and session records resolve to not-idle (suppressed).
export function isSessionIdle(store, sessionID) {
  if (!store || typeof sessionID !== "string" || !sessionID) return false;

  let type;
  try {
    type = statusType(callAccessor(store, store.status, sessionID));
  } catch {
    return false;
  }

  if (type === undefined) {
    let session;
    try {
      session = callAccessor(store, store.get, sessionID);
    } catch {
      return false;
    }
    type = statusType(session?.status) ?? statusType(session?.state) ?? statusType(session);
  }

  return type !== undefined && IDLE_STATUS_TYPES.has(type);
}

// True when the accessor reports pending work; an accessor that throws means
// we cannot verify the session is clear, so it counts as pending (suppress).
function hasPending(read, sessionID, onError) {
  if (typeof read !== "function") return false;
  let items;
  try {
    items = read(sessionID);
  } catch (error) {
    try {
      onError?.(error);
    } catch {
      // Diagnostics must not weaken fail-closed pending checks.
    }
    return true;
  }
  return Array.isArray(items) ? items.length > 0 : Boolean(items);
}

// Builds the isIdle(sessionID) predicate used by the rechecker. A session is
// only "truly idle" when its status says idle and neither a permission
// request nor a question form is still open.
export function createSessionIdleCheck({ store, getPendingPermissions, getPendingForms, onError }) {
  return (sessionID) => {
    if (!isSessionIdle(store, sessionID)) return false;
    if (hasPending(getPendingPermissions, sessionID, onError)) return false;
    if (hasPending(getPendingForms, sessionID)) return false;
    return true;
  };
}

// Delayed rechecker: every execution event is re-validated after delayMs and
// only notified when the session is truly idle by then. Repeated events for
// the same session coalesce onto the first pending check so a burst of round
// completions emits at most one notification.
export function createIdleRechecker({ isIdle, notify, onError = console.error, delayMs = 800 }) {
  const timers = new Map();
  let disposed = false;

  function recheck(sessionID, status, executionID) {
    if (disposed || typeof sessionID !== "string" || !sessionID) return;
    if (timers.has(sessionID)) {
      const pending = timers.get(sessionID);
      pending.status = status;
      pending.executionID = executionID;
      return;
    }

    const pending = { status, executionID, timer: undefined };
    pending.timer = setTimeout(() => {
      timers.delete(sessionID);
      if (disposed) return;

      let idle = false;
      try {
        idle = isIdle(sessionID) === true;
      } catch (error) {
        onError(error);
        return;
      }
      if (!idle) return;

      try {
        notify(sessionID, pending.status, pending.executionID);
      } catch (error) {
        onError(error);
      }
    }, delayMs);
    pending.timer.unref?.();
    timers.set(sessionID, pending);
  }

  function dispose() {
    disposed = true;
    for (const pending of timers.values()) clearTimeout(pending.timer);
    timers.clear();
  }

  return { recheck, dispose, isIdle };
}
