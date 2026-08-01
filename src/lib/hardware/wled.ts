import { fetch } from "@tauri-apps/plugin-http";
import { z } from "zod";

// WLED hub client: parse the subsets of /json/info and /json/cfg Prism needs,
// and the rig doc that persists them. A hub's identity is its MAC (DHCP may
// reassign the IP); a light's id is `{mac}:{output index}`. Prism never
// configures strips — the hub owns its light setup and only reports it.

// ── Rig doc (library/rig.json, stored as-is by the sidecar) ─────────────────

export const RigLightSchema = z.object({
  id: z.string(),
  name: z.string(),
  pixel_count: z.number().int().positive(),
});
export type RigLight = z.infer<typeof RigLightSchema>;

export const RigHubSchema = z.object({
  mac: z.string(),
  // User-chosen hub name (from the Connect new flow).
  name: z.string(),
  // Last-known address; refreshed whenever discovery resolves the hub.
  ip: z.string(),
  lights: z.array(RigLightSchema).default([]),
});
export type RigHub = z.infer<typeof RigHubSchema>;

// One bound for everything that touches the light delay: the schema, the
// setter's clamp, and the UI nudge all share it.
export const MAX_LIGHT_DELAY_MS = 500;

export const RigSchema = z.object({
  hubs: z.array(RigHubSchema).default([]),
  // Light-delay calibration: the streamer samples the show this many ms
  // behind the playhead, absorbing the constant lights-lead-audio sources
  // (centered smoothing/analysis frames, audio output latency). Absent on
  // older rigs; readers fall back to the default. An out-of-range or
  // malformed hand-edit falls back rather than failing the whole rig parse.
  latency_ms: z
    .number()
    .min(0)
    .max(MAX_LIGHT_DELAY_MS)
    .optional()
    .catch(undefined),
});
export type Rig = z.infer<typeof RigSchema>;

export function emptyRig(): Rig {
  return { hubs: [] };
}

// ── WLED payloads ───────────────────────────────────────────────────────────

// /json/info subset: identity. `mac` is lowercase hex, no separators.
const WledInfoSchema = z.object({
  mac: z.string().min(1),
  name: z.string().default("WLED"),
});

// /json/cfg subset: hw.led.ins lists the configured outputs (GPIO buses),
// each driving `len` pixels starting at `start`.
const WledCfgSchema = z.object({
  hw: z.object({
    led: z.object({
      ins: z
        .array(z.object({ start: z.number(), len: z.number() }))
        .default([]),
    }),
  }),
});

// A connected hub as read from the device: rig-shaped, with default light
// names ready for the user to rename.
export function parseHub(ip: string, info: unknown, cfg: unknown): RigHub {
  const parsedInfo = WledInfoSchema.parse(info);
  const mac = parsedInfo.mac.toLowerCase();
  const outputs = WledCfgSchema.parse(cfg).hw.led.ins.filter((o) => o.len > 0);
  return {
    mac,
    name: parsedInfo.name,
    ip,
    lights: outputs.map((o, i) => ({
      id: `${mac}:${i}`,
      name: outputs.length === 1 ? parsedInfo.name : `Output ${i + 1}`,
      pixel_count: o.len,
    })),
  };
}

// Set a hub's power state over its JSON API. Off keeps WLED from falling
// back to its own saved look when the stream stops; on restores output for
// the next stream. Network failures propagate — callers decide whether an
// unreachable hub matters.
export async function setHubPower(ip: string, on: boolean): Promise<void> {
  const res = await fetch(`http://${ip}/json/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ on }),
    connectTimeout: 4000,
  });
  if (!res.ok) throw new Error(`/json/state: HTTP ${res.status}`);
}

// Read a hub's identity and light config over its JSON API. Throws on network
// failure or an unparseable payload; callers treat that as "not a hub".
export async function fetchHub(ip: string): Promise<RigHub> {
  const get = async (path: string): Promise<unknown> => {
    const res = await fetch(`http://${ip}${path}`, {
      method: "GET",
      connectTimeout: 4000,
    });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  };
  const [info, cfg] = await Promise.all([get("/json/info"), get("/json/cfg")]);
  return parseHub(ip, info, cfg);
}
