import { describe, expect, it } from "vitest";

import { ddpBlackoutPackets, ddpFramePackets } from "./ddp";
import type { PixelMatrix } from "$lib/mapping/evaluate";

// A 3-frame, 4-pixel matrix where byte values encode (frame, pixel, channel)
// so frame extraction mistakes are visible in the payload.
function matrix(frames = 3, pixels = 4): PixelMatrix {
  const rgb = new Uint8ClampedArray(frames * pixels * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = i % 251;
  return { pixelCount: pixels, rgb };
}

describe("ddpFramePackets", () => {
  it("writes the DDP header per spec", () => {
    const [pkt] = ddpFramePackets(matrix(), 0);
    // Flags: version 1 + PUSH on the frame's final packet.
    expect(pkt[0]).toBe(0x41);
    expect(pkt[1]).toBe(0); // sequencing unused
    expect(pkt[2]).toBe(0x0b); // RGB, 8 bits per element
    expect(pkt[3]).toBe(0x01); // default output device
    // Offset 0, length 12 (4 px × 3), both big-endian.
    expect([...pkt.slice(4, 8)]).toEqual([0, 0, 0, 0]);
    expect([...pkt.slice(8, 10)]).toEqual([0, 12]);
    expect(pkt.length).toBe(10 + 12);
  });

  it("extracts the requested frame's bytes", () => {
    const m = matrix();
    const [pkt] = ddpFramePackets(m, 1);
    const expected = [...m.rgb.slice(1 * 4 * 3, 2 * 4 * 3)];
    expect([...pkt.slice(10)]).toEqual(expected);
  });

  it("splits frames past 480 pixels, PUSH only on the last packet", () => {
    const pixels = 600; // 1800 bytes: one full 1440 packet + one 360 remainder
    const m: PixelMatrix = {
      pixelCount: pixels,
      rgb: new Uint8ClampedArray(2 * pixels * 3).fill(7),
    };
    const packets = ddpFramePackets(m, 1);
    expect(packets.length).toBe(2);
    expect(packets[0][0]).toBe(0x40); // no PUSH mid-frame
    expect(packets[1][0]).toBe(0x41);
    // Second packet resumes at byte offset 1440.
    expect([...packets[1].slice(4, 8)]).toEqual([0, 0, 0x05, 0xa0]);
    expect([...packets[0].slice(8, 10)]).toEqual([0x05, 0xa0]);
    expect([...packets[1].slice(8, 10)]).toEqual([0x01, 0x68]);
    expect(packets[0].length + packets[1].length).toBe(20 + 1800);
  });

  it("blackout packets carry only zero bytes at the strip's length", () => {
    const packets = ddpBlackoutPackets(300);
    expect(packets.length).toBe(1);
    const [pkt] = packets;
    expect(pkt.length).toBe(10 + 900);
    expect(pkt.slice(10).every((b) => b === 0)).toBe(true);
  });
});
