const DEFAULT_CACHE_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 1_500;

// Reports whether the Kitty window hosting this TUI currently has focus.
// Any uncertainty (missing env, kitty error, unparsable output) resolves to
// "not focused" so notifications are never silently swallowed.
export function createKittyFocus({
  execFile,
  env = process.env,
  cacheMs = DEFAULT_CACHE_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = Date.now,
  onError,
}) {
  let cachedFocused = false;
  let cachedUntil = 0;
  let pending;

  function parseWindowFocused(output, windowID) {
    let roots;
    try {
      roots = JSON.parse(output);
    } catch {
      return false;
    }
    if (!Array.isArray(roots)) return false;

    const target = Number(windowID);
    for (const osWindow of roots) {
      const tabs = Array.isArray(osWindow?.tabs) ? osWindow.tabs : [];
      for (const tab of tabs) {
        const windows = Array.isArray(tab?.windows) ? tab.windows : [];
        for (const win of windows) {
          if (Number(win?.id) === target) return win.is_focused === true;
        }
      }
    }
    return false;
  }

  function focused() {
    const listenOn = env.KITTY_LISTEN_ON;
    const windowID = env.KITTY_WINDOW_ID;
    if (!listenOn || !/^\d+$/.test(windowID ?? "")) return Promise.resolve(false);
    if (typeof execFile !== "function") return Promise.resolve(false);

    const at = now();
    if (at < cachedUntil) return Promise.resolve(cachedFocused);
    if (pending) return pending;

    let done = false;
    const request = new Promise((resolve) => {
      const finish = (isFocused, error) => {
        if (error && onError) onError(error);
        done = true;
        pending = undefined;
        cachedFocused = isFocused;
        cachedUntil = now() + cacheMs;
        resolve(isFocused);
      };

      try {
        execFile(
          "kitty",
          ["@", "--to", listenOn, "ls"],
          { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 },
          (error, stdout) => {
            if (error) return finish(false, error);
            finish(parseWindowFocused(stdout, windowID));
          },
        );
      } catch (error) {
        finish(false, error);
      }
    });
    // Only track the request as in-flight when execFile did not finish
    // synchronously; otherwise the freshly resolved cache entry stands.
    if (!done) pending = request;
    return request;
  }

  return { focused };
}
