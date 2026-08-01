import { describe, expect, it } from "vitest";

import { RigSchema } from "./wled";

describe("rig latency round-trip", () => {
  it("a saved latency_ms survives the parse", () => {
    const parsed = RigSchema.parse({ hubs: [], latency_ms: 110 });
    expect(parsed.latency_ms).toBe(110);
  });

  it("out-of-range or malformed values fall back without failing the rig", () => {
    expect(RigSchema.parse({ hubs: [], latency_ms: 9000 }).latency_ms).toBe(
      undefined,
    );
    expect(RigSchema.parse({ hubs: [], latency_ms: "x" }).latency_ms).toBe(
      undefined,
    );
    expect(RigSchema.parse({ hubs: [] }).latency_ms).toBe(undefined);
  });
});
