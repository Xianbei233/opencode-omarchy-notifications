const REPLY_DEDUPE_WINDOW_MS = 60_000;

export function createPermissionNotifier({ getPendingPermissions, notify, onError = console.error, delayMs = 500 }) {
  const timers = new Map();
  const notified = new Set();
  const recentlyReplied = new Map();
  let disposed = false;

  function pruneReplies(now = Date.now()) {
    for (const [requestID, repliedAt] of recentlyReplied) {
      if (now - repliedAt > REPLY_DEDUPE_WINDOW_MS) recentlyReplied.delete(requestID);
    }
  }

  function notifyIfPending(sessionID, requestID) {
    if (disposed || recentlyReplied.has(requestID) || notified.has(requestID)) return;

    let requests;
    try {
      requests = getPendingPermissions(sessionID) || [];
    } catch (error) {
      onError(error);
      return;
    }

    if (!requests.some((request) => request.id === requestID)) return;

    try {
      notify(sessionID);
      notified.add(requestID);
    } catch (error) {
      onError(error);
    }
  }

  function asked(event) {
    const sessionID = event?.data?.sessionID;
    const requestID = event?.data?.id || event?.data?.requestID;
    if (typeof sessionID !== "string" || typeof requestID !== "string" || !requestID) return;

    pruneReplies();
    if (disposed || recentlyReplied.has(requestID) || notified.has(requestID) || timers.has(requestID)) return;

    const timer = setTimeout(() => {
      timers.delete(requestID);
      notifyIfPending(sessionID, requestID);
    }, delayMs);
    timers.set(requestID, timer);
  }

  function replied(event) {
    const requestID = event?.data?.requestID;
    if (typeof requestID !== "string" || !requestID) return;

    recentlyReplied.set(requestID, Date.now());
    const timer = timers.get(requestID);
    if (timer) clearTimeout(timer);
    timers.delete(requestID);
    notified.delete(requestID);
    pruneReplies();
  }

  function dispose() {
    disposed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    notified.clear();
    recentlyReplied.clear();
  }

  return { asked, replied, dispose };
}
