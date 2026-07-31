import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// App-health surface: a dead sidecar at runtime, and the previous session's
// unclean exit reported by the shell at startup. The shell banners render it.
export const health = $state<{
  sidecarDown: boolean;
  sidecarExitCode: number | null;
  uncleanExit: boolean;
}>({
  sidecarDown: false,
  sidecarExitCode: null,
  uncleanExit: false,
});

// The shell opens the folder itself: it knows the real log dir and needs no
// webview path-scope permission.
export function openLogs(): void {
  void invoke("open_logs").catch((e) => console.error("open logs failed", e));
}

export function dismissUncleanExit(): void {
  health.uncleanExit = false;
}

// Hides the banner only; the sidecar stays down until the app restarts.
export function dismissSidecarDown(): void {
  health.sidecarDown = false;
}

// Forward uncaught frontend errors into the shell's app.log — WebView errors
// otherwise vanish with the window.
function forwardError(message: string): void {
  void invoke("log_frontend_error", { message }).catch(() => {});
}

// Wire error forwarding, the sidecar-death listener, and the startup report.
// Returns a cleanup detaching everything (mirrors the sidecar session shape).
export function startHealthMonitor(): () => void {
  const onError = (e: ErrorEvent) =>
    forwardError(`${e.message} (${e.filename}:${e.lineno})`);
  const onRejection = (e: PromiseRejectionEvent) =>
    forwardError(`unhandled rejection: ${String(e.reason)}`);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  // Mirror console.warn/error into app.log too: the app's own guard rails
  // (schema drops, failed track loads, muted bindings) report there, and a
  // closed webview otherwise takes that evidence with it.
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  const format = (args: unknown[]) =>
    args
      .map((a) =>
        a instanceof Error
          ? `${a.message}\n${a.stack ?? ""}`
          : typeof a === "object"
            ? JSON.stringify(a)?.slice(0, 500)
            : String(a),
      )
      .join(" ");
  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    forwardError(`console.warn: ${format(args)}`);
  };
  console.error = (...args: unknown[]) => {
    origError(...args);
    forwardError(`console.error: ${format(args)}`);
  };

  let detach: (() => void) | undefined;
  let stopped = false;
  void (async () => {
    const off = await listen<number | null>("sidecar-exited", (event) => {
      health.sidecarDown = true;
      health.sidecarExitCode = event.payload;
    });
    if (stopped) {
      off();
      return;
    }
    detach = off;
    const report = await invoke<{ unclean_exit: boolean }>("startup_report");
    health.uncleanExit = report.unclean_exit;
  })();

  return () => {
    stopped = true;
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    console.warn = origWarn;
    console.error = origError;
    detach?.();
    detach = undefined;
  };
}
