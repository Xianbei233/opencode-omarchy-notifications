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
