const RESOLVE_DEDUPE_WINDOW_MS = 60_000;

// Delayed pending-form notifier mirroring the permission notifier: a form is
// only notified about when it is still open once the delay has passed, so
// instantly answered or cancelled prompts never reach the desktop.
export function createFormNotifier({
  getPendingForms,
  isSessionAlive = () => true,
  notify,
  onError = console.error,
  delayMs = 500,
}) {
  const timers = new Map();
  const notified = new Set();
  const recentlyClosed = new Map();
  let disposed = false;

  function pruneClosed(now = Date.now()) {
    for (const [formID, closedAt] of recentlyClosed) {
      if (now - closedAt > RESOLVE_DEDUPE_WINDOW_MS) recentlyClosed.delete(formID);
    }
  }

  function stillPending(sessionID, formID) {
    if (typeof getPendingForms === "function") {
      try {
        const forms = getPendingForms(sessionID);
        if (Array.isArray(forms)) {
          return forms.some((form) => (form?.id ?? form) === formID);
        }
      } catch (error) {
        onError(error);
      }
    }
    // The state API has no form listing or it failed; fall back to the
    // session still existing so a live form is never dropped.
    try {
      return isSessionAlive(sessionID) !== false;
    } catch (error) {
      onError(error);
      return false;
    }
  }

  function notifyIfPending(sessionID, formID) {
    if (disposed || recentlyClosed.has(formID) || notified.has(formID)) return;
    if (!stillPending(sessionID, formID)) return;

    try {
      notify(sessionID);
      notified.add(formID);
    } catch (error) {
      onError(error);
    }
  }

  function created(event) {
    const formID = event?.data?.form?.id;
    const sessionID = event?.data?.form?.sessionID;
    if (typeof sessionID !== "string" || typeof formID !== "string" || !formID) return;

    pruneClosed();
    if (disposed || recentlyClosed.has(formID) || notified.has(formID) || timers.has(formID)) return;

    const timer = setTimeout(() => {
      timers.delete(formID);
      notifyIfPending(sessionID, formID);
    }, delayMs);
    timers.set(formID, timer);
  }

  function closed(event) {
    const formID = event?.data?.id ?? event?.data?.form?.id;
    if (typeof formID !== "string" || !formID) return;

    recentlyClosed.set(formID, Date.now());
    const timer = timers.get(formID);
    if (timer) clearTimeout(timer);
    timers.delete(formID);
    notified.delete(formID);
    pruneClosed();
  }

  function dispose() {
    disposed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    notified.clear();
    recentlyClosed.clear();
  }

  return { created, closed, dispose };
}
