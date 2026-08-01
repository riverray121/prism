import { listen } from "@tauri-apps/api/event";

import { oklchToRgb } from "$lib/color";
import {
  DDP_PORT,
  ddpBlackoutPackets,
  ddpFramePackets,
} from "$lib/hardware/ddp";
import { activePatch } from "$lib/hardware/patch";
import {
  emptyRig,
  fetchHub,
  MAX_LIGHT_DELAY_MS,
  setHubPower,
  type Rig,
  type RigHub,
} from "$lib/hardware/wled";
import { ddpSend, discoverySnapshot, getRig, updateRig } from "$lib/ipc";
import {
  channelColor,
  frameIndexAt,
  type GateSegment,
  type ProgramOutput,
} from "$lib/mapping/evaluate";
import { mapping } from "$lib/state/mapping.svelte";

// Hardware state: the persisted rig (known hubs + named lights), runtime
// discovery results, and per-hub reachability. Components render this and
// call the actions; the sidecar owns rig.json, the Rust shell owns mDNS.

export const hardware = $state<{
  rig: Rig;
  // False until the sidecar's rig event lands (renders as loading, so an
  // empty device list isn't mistaken for "no hubs saved").
  rigLoaded: boolean;
  // Hubs seen on the network but not saved in the rig, by MAC. Runtime only.
  discovered: RigHub[];
  // Hub MAC → currently reachable. Absent = never seen this session.
  online: Record<string, boolean>;
}>({ rig: emptyRig(), rigLoaded: false, discovered: [], online: {} });

// mDNS instance name → MAC, learned when a found event's config fetch lands,
// so a later lost event (which carries only the name) can be attributed.
const macByMdnsName = new Map<string, string>();

// IPs with a config fetch in flight; mDNS rebroadcasts arrive in bursts and
// each found event would otherwise start a duplicate probe.
const probing = new Set<string>();

export function applyRigEvent(rig: Rig): void {
  hardware.rig = rig;
  hardware.rigLoaded = true;
  // Discovery can resolve a hub before the saved rig arrives, parking it
  // under Connect new; once the rig shows it as known, the stale discovered
  // entry must not linger beside it.
  hardware.discovered = hardware.discovered.filter(
    (h) => !rig.hubs.some((known) => known.mac === h.mac),
  );
}

// Merge a hub whose config was just read off the device. Known hubs (by MAC)
// auto-connect: the rig's IP and light config refresh — user-given light
// names survive by light id — and persist if anything changed. Unknown hubs
// queue under Connect new.
export function applyHubSeen(hub: RigHub): void {
  const known = hardware.rig.hubs.find((h) => h.mac === hub.mac);
  if (known) {
    const lights = hub.lights.map((light) => {
      const existing = known.lights.find((l) => l.id === light.id);
      return existing ? { ...light, name: existing.name } : light;
    });
    const changed =
      known.ip !== hub.ip ||
      JSON.stringify(known.lights) !== JSON.stringify(lights);
    if (changed) {
      known.ip = hub.ip;
      known.lights = lights;
      persistRig();
    }
  } else {
    hardware.discovered = [
      ...hardware.discovered.filter((h) => h.mac !== hub.mac),
      hub,
    ];
  }
  hardware.online[hub.mac] = true;
}

export function markHubOffline(mac: string): void {
  hardware.online[mac] = false;
  hardware.discovered = hardware.discovered.filter((h) => h.mac !== mac);
}

// Connect new: save a discovered hub into the rig under a user-chosen name.
export function connectHub(mac: string, name: string): void {
  const found = hardware.discovered.find((h) => h.mac === mac);
  if (!found) return;
  hardware.discovered = hardware.discovered.filter((h) => h.mac !== mac);
  hardware.rig.hubs.push({ ...found, name: name.trim() || found.name });
  persistRig();
}

// Forget a hub: drop it from the rig. If it is still reachable it goes back
// under Connect new immediately (no wait for the next mDNS announcement).
export function forgetHub(mac: string): void {
  const known = hardware.rig.hubs.find((h) => h.mac === mac);
  if (!known) return;
  hardware.rig.hubs = hardware.rig.hubs.filter((h) => h.mac !== mac);
  persistRig();
  if (hardware.online[mac]) {
    hardware.discovered = [...hardware.discovered, $state.snapshot(known)];
  }
}

function persistRig(): void {
  // Never write before the saved rig has loaded: a persist racing the rig
  // event would replace rig.json (saved hubs, light delay) with the
  // placeholder empty rig.
  if (!hardware.rigLoaded) return;
  void updateRig($state.snapshot(hardware.rig));
}

// ── Light-delay calibration ─────────────────────────────────────────────────
// The show is sampled this far behind the playhead so the strip lines up
// with what the ear hears. The default covers the stack of constant leads:
// the centered smoothing window (~40 ms), centered analysis frames
// (~10-25 ms), and audio output latency on built-in speakers (~10-25 ms).

const DEFAULT_LATENCY_MS = 60;

export function rigLatencyMs(): number {
  return hardware.rig.latency_ms ?? DEFAULT_LATENCY_MS;
}

export function setLatency(ms: number): void {
  hardware.rig.latency_ms = Math.max(
    0,
    Math.min(MAX_LIGHT_DELAY_MS, Math.round(ms)),
  );
  persistRig();
}

// ── Streaming ───────────────────────────────────────────────────────────────
// The Hardware tab hosts a rAF loop while the transport plays; each tick
// samples the evaluated outputs at the playhead and sends one DDP frame per
// patched light. Stopped/paused means the strip is off — the stop sequence
// sends one all-zeros frame (the strip otherwise holds the last frame), then
// powers the hub off so it never falls back to its own saved look.

// Hubs sent frames this play run: MAC → address, largest frame sent, and the
// power-on request, so the stop sequence knows where blackout and power-off
// go — and never lets a power-off overtake a still-in-flight power-on.
const streamed = new Map<
  string,
  { ip: string; pixels: number; powered: Promise<void> }
>();

// Gate strength at one instant (null gate = always lit).
function gateStrengthAt(gate: GateSegment[] | null, t: number): number {
  if (gate === null) return 1;
  let s = 0;
  for (const seg of gate)
    if (t >= seg.start && t <= seg.end && seg.strength > s) s = seg.strength;
  return s;
}

// Whole-strip frame for a program with no pixel matrix, mirroring the live
// preview's swatch math (brightness/gate/strobe scale the frame color) so
// the bench strip and the on-screen light can never disagree.
function solidFrame(
  output: ProgramOutput,
  pixelCount: number,
  t: number,
  frame: number,
): Uint8ClampedArray {
  const lit = gateStrengthAt(output.gate, t);
  const b = output.channels.brightness ? output.channels.brightness[frame] : 1;
  let s = lit > 0 ? Math.min(1, (0.12 + 1.05 * b) * lit) : 0;
  const rate = output.channels.strobe_rate
    ? output.channels.strobe_rate[frame]
    : 0;
  if (rate > 0 && (t * rate) % 1 >= 0.5) s = 0;
  const c = oklchToRgb(channelColor(output.channels, frame));
  const rgb = new Uint8ClampedArray(pixelCount * 3);
  const r = Math.round(Math.min(1, c.r * s) * 255);
  const g = Math.round(Math.min(1, c.g * s) * 255);
  const bl = Math.round(Math.min(1, c.b * s) * 255);
  for (let p = 0; p < pixelCount; p++) {
    rgb[p * 3] = r;
    rgb[p * 3 + 1] = g;
    rgb[p * 3 + 2] = bl;
  }
  return rgb;
}

// One streaming tick at playhead time `t`. Sends each live patch target its
// program's pixel frame (or the solid whole-strip color when the program has
// no pixel dimension); the first frame to a hub powers it on. Called from the
// Hardware tab's rAF loop, which reads transport.currentTime and the
// evaluated outputs in its own tick (hot-path rule: never through props).
// `outputs` arrives as an argument so this module never imports the
// evaluation store (which sits downstream of this one — no import cycles).
export function streamTick(
  t: number,
  frameRateHz: number,
  frameCount: number,
  outputs: Record<string, ProgramOutput>,
): void {
  const doc = mapping.doc;
  if (!doc || frameCount === 0) return;
  // Sample behind the playhead by the calibrated light delay, so the strip
  // matches the audio the ear hears rather than the processing clock.
  const ts = Math.max(0, t - rigLatencyMs() / 1000);
  const frame = frameIndexAt(ts, frameRateHz, frameCount);
  for (const target of activePatch(doc, hardware.rig.hubs, hardware.online)) {
    const output = outputs[target.program.id];
    if (!output) continue;
    const N = target.light.pixel_count;
    let packets;
    if (output.pixels) {
      // A mismatched matrix is a stale evaluation (patch just changed);
      // skip rather than light the wrong pixels — next tick catches up.
      if (output.pixels.pixelCount !== N) continue;
      packets = ddpFramePackets(output.pixels, frame);
    } else {
      packets = ddpFramePackets(
        { pixelCount: N, rgb: solidFrame(output, N, ts, frame) },
        0,
      );
    }
    const known = streamed.get(target.hub.mac);
    if (!known) {
      const powered = setHubPower(target.hub.ip, true).catch((e) => {
        console.warn("hub power on failed", target.hub.ip, e);
      });
      streamed.set(target.hub.mac, { ip: target.hub.ip, pixels: N, powered });
    } else if (N > known.pixels) {
      known.pixels = N;
    }
    for (const p of packets) {
      void ddpSend(target.hub.ip, DDP_PORT, Array.from(p)).catch(() => {});
    }
  }
}

// End a play run: blackout then power off every hub that got frames, in that
// order (the blackout lands while realtime mode is still live). Unreachable
// hubs are skipped — nothing to darken.
export function stopStream(): void {
  for (const [mac, { ip, pixels, powered }] of streamed) {
    if (hardware.online[mac] === false) continue;
    void powered
      .then(() =>
        Promise.all(
          ddpBlackoutPackets(pixels).map((p) =>
            ddpSend(ip, DDP_PORT, Array.from(p)),
          ),
        ),
      )
      .then(() => setHubPower(ip, false))
      .catch((e) => console.warn("hub stop sequence failed", ip, e));
  }
  streamed.clear();
}

// Scan window for the Connect new UI. The shell's mDNS browse actually runs
// for the app's lifetime; this only bounds how long the UI claims to be
// scanning before offering Scan again (which re-pulls the shell's snapshot).
export const scan = $state<{ active: boolean }>({ active: false });
let scanTimer: ReturnType<typeof setTimeout> | null = null;
const SCAN_WINDOW_MS = 15_000;

export function startScan(): void {
  scan.active = true;
  if (scanTimer !== null) clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scanTimer = null;
    scan.active = false;
  }, SCAN_WINDOW_MS);
  // Hubs the shell resolved before the listener attached (usually all of
  // them — resolves beat webview startup) arrive via the snapshot.
  const gen = generation;
  void discoverySnapshot()
    .then((events) => {
      if (gen !== generation) return; // superseded by stop or a newer start
      for (const { kind, name, ip } of events) {
        if (kind === "found" && ip) void handleFound(name, ip);
      }
    })
    .catch((e) => console.warn("discovery snapshot failed", e));
}

// Manual fallback when mDNS finds nothing (router multicast isolation, the
// macOS local-network permission): probe an address directly and treat a
// working hub as a discovery. Status feeds the Connect new UI.
export const probe = $state<{
  status: "idle" | "checking" | "failed";
  ip: string;
}>({ status: "idle", ip: "" });

export async function probeAddress(ip: string): Promise<void> {
  const trimmed = ip.trim();
  if (trimmed === "" || probe.status === "checking") return;
  probe.status = "checking";
  probe.ip = trimmed;
  try {
    const hub = await fetchHub(trimmed);
    applyHubSeen(hub);
    probe.status = "idle";
  } catch (e) {
    console.warn("manual hub probe failed", trimmed, e);
    probe.status = "failed";
  }
}

// A found hub announces an IP; its identity (MAC) only comes from asking the
// device. Fetch its config, then merge. Fetch failures are logged and dropped:
// a hub that stops answering just stays/goes offline.
async function handleFound(name: string, ip: string): Promise<void> {
  if (probing.has(ip)) return;
  probing.add(ip);
  const gen = generation;
  try {
    const hub = await fetchHub(ip);
    // A fetch outliving the session (stop, or a newer start) must not write
    // into the replacement session's state or rewrite the rig.
    if (gen !== generation) return;
    macByMdnsName.set(name, hub.mac);
    applyHubSeen(hub);
  } catch (e) {
    console.warn("hub config fetch failed", ip, e);
  } finally {
    probing.delete(ip);
  }
}

interface DiscoveryPayload {
  kind: "found" | "lost";
  name: string;
  ip: string | null;
}

// Session lifecycle, mirroring startSidecarSession: attach the discovery
// listener, then request the persisted rig.
let off: (() => void) | undefined;
let generation = 0;

export function startHardwareSession(): void {
  const gen = ++generation;
  void (async () => {
    const detach = await listen<DiscoveryPayload>(
      "hardware-discovery",
      (event) => {
        const { kind, name, ip } = event.payload;
        if (kind === "found" && ip) {
          void handleFound(name, ip);
        } else if (kind === "lost") {
          const mac = macByMdnsName.get(name);
          if (mac) markHubOffline(mac);
        }
      },
    );
    if (gen !== generation) {
      detach();
      return;
    }
    off?.();
    off = detach;
    getRig();
    startScan();
  })();
}

export function stopHardwareSession(): void {
  generation++;
  off?.();
  off = undefined;
  if (scanTimer !== null) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }
  scan.active = false;
}
