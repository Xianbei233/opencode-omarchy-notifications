const RESOLVE_DEDUPE_WINDOW_MS = 60_000;

// Delayed pending-form notifier mirroring the permission notifier: a form is
// only notified about when it is still open once the delay has passed, so
// instantly answered or cancelled prompts never reach the desktop.
export function createFormNotifier({
  getPendingForms,
  notify,
  onError = console.error,
  delayMs = 500,
}) {
  const timers = new Map();
  const notified = new Set();
  const checking = new Set();
  const recentlyClosed = new Map();
  let disposed = false;

  function pruneClosed(now = Date.now()) {
    for (const [formID, closedAt] of recentlyClosed) {
      if (now - closedAt > RESOLVE_DEDUPE_WINDOW_MS) recentlyClosed.delete(formID);
    }
  }

  async function notifyIfPending(sessionID, formID) {
    if (disposed || recentlyClosed.has(formID) || notified.has(formID) || checking.has(formID)) return;
    checking.add(formID);
    try {
      const forms = await getPendingForms(sessionID);
      if (!Array.isArray(forms)) {
        onError(new TypeError("Pending forms unavailable or malformed"));
        return;
      }
      if (disposed || recentlyClosed.has(formID) || notified.has(formID)) return;
      if (!forms.some((form) => form?.id === formID)) return;

      notify(sessionID);
      notified.add(formID);
    } catch (error) {
      onError(error);
    } finally {
      checking.delete(formID);
    }
  }

  function created(event) {
    const formID = event?.data?.id;
    const sessionID = event?.data?.sessionID;
    if (typeof sessionID !== "string" || typeof formID !== "string" || !formID) return;

    pruneClosed();
    if (disposed || recentlyClosed.has(formID) || notified.has(formID) || timers.has(formID)) return;

    const timer = setTimeout(() => {
      timers.delete(formID);
      void notifyIfPending(sessionID, formID);
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
    checking.clear();
    recentlyClosed.clear();
  }

  return { created, closed, dispose };
}

// Keep the V2 event names and payload routing together with the delayed
// pending-state check so event-contract tests cover the complete path.
export function wireFormNotifications({ data, getPendingForms, notify, onError, delayMs }) {
  const notifier = createFormNotifier({ getPendingForms, notify, onError, delayMs });
  const stop = [
    data.on("form.created", notifier.created),
    data.on("form.replied", notifier.closed),
    data.on("form.cancelled", notifier.closed),
  ];
  return () => {
    notifier.dispose();
    stop.forEach((unsubscribe) => unsubscribe());
  };
}
