// The real rig as show-algorithm lights: every rig light is a WLED strip.

import type { RigHub } from "$lib/hardware/wled";
import type { LightSpec } from "$lib/showgen/types";

export function rigLights(hubs: RigHub[]): LightSpec[] {
  return hubs.flatMap((hub) =>
    hub.lights.map((light, i) => ({
      id: light.id,
      name: light.name ?? `${hub.name} ${i + 1}`,
      kind: "strip" as const,
      pixelCount: light.pixel_count,
    })),
  );
}
