// Child sessions are intentionally not surfaced to the desktop. If the
// runtime cannot establish ancestry, fail closed rather than guessing.
export function createRootSessionFilter(getRoot, onUnknown = () => {}) {
  return (sessionID) => {
    if (typeof sessionID !== "string" || !sessionID) return false;
    try {
      const rootID = getRoot(sessionID);
      if (typeof rootID !== "string" || !rootID) {
        onUnknown();
        return false;
      }
      return rootID === sessionID;
    } catch {
      onUnknown();
      return false;
    }
  };
}
