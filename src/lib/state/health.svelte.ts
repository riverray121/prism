import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";

// App-health surface: a dead sidecar at runtime, and the previous session's
// unclean exit reported by the shell at startup. The shell banners render it.
export const health = $state<{
  sidecarDown: boolean;
  sidecarExitCode: number | null;
  uncleanExit: boolean;
  logDir: string | null;
}>({
  sidecarDown: false,
  sidecarExitCode: null,
  uncleanExit: false,
  logDir: null,
});

export function openLogs(): void {
  if (health.logDir) void openPath(health.logDir);
}

export function dismissUncleanExit(): void {
  health.uncleanExit = false;
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
    const report = await invoke<{ unclean_exit: boolean; log_dir: string }>(
      "startup_report",
    );
    health.uncleanExit = report.unclean_exit;
    health.logDir = report.log_dir;
  })();

  return () => {
    stopped = true;
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    detach?.();
    detach = undefined;
  };
}
