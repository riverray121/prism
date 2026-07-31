import {
  ensureEvaluationCurrent,
  evaluation,
} from "$lib/state/evaluation.svelte";
import { stopStream, streamTick } from "$lib/state/hardware.svelte";
import { inspection } from "$lib/state/inspection.svelte";
import { transport } from "$lib/state/transport.svelte";

// App-lifetime hardware streaming, hosted by the shell route rather than any
// tab: switching to Analysis or Mapping must not stall the strip. Downstream
// of every store it reads (the state modules stay an acyclic import graph).
// Until the Rust-side sampler ships, the strip still stalls if the window is
// minimized during playback (browsers throttle rAF when hidden).

export function startStreamLoop(): () => void {
  return $effect.root(() => {
    // Keep evaluated outputs current whenever a song is open, even with no
    // Mapping or Hardware tab mounted — the streamer samples them below.
    $effect(() => {
      ensureEvaluationCurrent();
    });

    // Stream while playing; any exit — pause, stop, session teardown — runs
    // the cleanup, which blacks out and powers off every streamed hub. Every
    // tick goes through rAF so its state reads stay out of the effect's
    // tracking scope (a synchronous first call would make the effect re-run
    // per playhead tick and cycle hub power at frame rate).
    $effect(() => {
      if (!transport.playing) return;
      const loop = () => {
        const profile = inspection.profile;
        if (profile) {
          streamTick(
            transport.currentTime,
            profile.timeline.frame_rate_hz,
            profile.timeline.frame_count,
            evaluation.outputs,
          );
        }
        raf = requestAnimationFrame(loop);
      };
      let raf = requestAnimationFrame(loop);
      return () => {
        cancelAnimationFrame(raf);
        stopStream();
      };
    });
  });
}
