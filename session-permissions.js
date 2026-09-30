// V2 exposes permission.list(id); retain the older callable accessor.
// An unreadable cache is not proof that there are no pending permissions.
export function readSessionPermissions(store, sessionID) {
  const permission = store?.permission;
  const requests = typeof permission?.list === "function"
    ? permission.list(sessionID)
    : typeof permission === "function" ? permission.call(store, sessionID) : undefined;
  if (!Array.isArray(requests) || requests.some((request) => typeof request?.id !== "string" || !request.id)) {
    throw new Error("OpenCode pending permissions are unavailable");
  }
  return requests;
}

// One shared reporter per plugin instance: constant memory, no request content,
// and at most one diagnostic per minute across notification and idle checks.
export function createPermissionErrorReporter({ onError = console.error, now = Date.now } = {}) {
  let nextReportAt = -Infinity;
  return () => {
    const time = now();
    if (time < nextReportAt) return;
    nextReportAt = time + 60_000;
    onError(new Error("OpenCode permission notification/check failed (details redacted); unreadable permission state suppresses permission/completion notifications"));
  };
}
