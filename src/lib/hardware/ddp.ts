import type { PixelMatrix } from "$lib/mapping/evaluate";

// DDP packet assembly (spec: http://www.3waylabs.com/ddp/). Pure byte-packing
// so it stays vitest-coverable; the Rust shell's ddp_send does the UDP.

// WLED listens for DDP on this port.
export const DDP_PORT = 4048;

// Version 1 in the top two bits; PUSH tells the receiver to display the
// buffered frame (set on a frame's final packet only).
const FLAG_VER1 = 0x40;
const FLAG_PUSH = 0x01;
// Data type byte: TTT=001 (RGB), SSS=011 (8 bits per element).
const TYPE_RGB8 = 0x0b;
// Destination ID 1 = the device's default output.
const ID_DEFAULT = 0x01;

const HEADER_BYTES = 10;
// Spec ceiling per packet; frames for longer strips split across packets,
// addressed by the header's data offset.
const MAX_DATA_BYTES = 1440;

// One DDP packet: 10-byte header + RGB payload starting at byte offset
// `offset` in the receiver's frame buffer.
function packet(
  payload: Uint8ClampedArray,
  offset: number,
  push: boolean,
): Uint8Array {
  const out = new Uint8Array(HEADER_BYTES + payload.length);
  out[0] = FLAG_VER1 | (push ? FLAG_PUSH : 0);
  out[1] = 0; // sequence unused (0 = sender does not sequence)
  out[2] = TYPE_RGB8;
  out[3] = ID_DEFAULT;
  out[4] = (offset >>> 24) & 0xff;
  out[5] = (offset >>> 16) & 0xff;
  out[6] = (offset >>> 8) & 0xff;
  out[7] = offset & 0xff;
  out[8] = (payload.length >>> 8) & 0xff;
  out[9] = payload.length & 0xff;
  out.set(payload, HEADER_BYTES);
  return out;
}

// The packets for one frame of an evaluated pixel matrix (frame-major RGB,
// see PixelMatrix). Usually one packet; strips past 480 pixels split, with
// PUSH only on the last so the strip updates once, atomically. `baseOffset`
// positions the frame inside the receiver's buffer — WLED's DDP buffer spans
// every output concatenated, so a light on a multi-output hub lands at its
// bus's `start * 3`.
export function ddpFramePackets(
  matrix: PixelMatrix,
  frameIndex: number,
  baseOffset = 0,
): Uint8Array[] {
  const bytesPerFrame = matrix.pixelCount * 3;
  const start = frameIndex * bytesPerFrame;
  const frame = matrix.rgb.subarray(start, start + bytesPerFrame);
  const packets: Uint8Array[] = [];
  for (let off = 0; off < frame.length; off += MAX_DATA_BYTES) {
    const chunk = frame.subarray(off, off + MAX_DATA_BYTES);
    const last = off + MAX_DATA_BYTES >= frame.length;
    packets.push(packet(chunk, baseOffset + off, last));
  }
  return packets;
}

// An all-zeros frame at a strip's pixel count: sent on stop/pause so the
// strip goes dark instead of holding the last streamed frame.
export function ddpBlackoutPackets(
  pixelCount: number,
  baseOffset = 0,
): Uint8Array[] {
  return ddpFramePackets(
    { pixelCount, rgb: new Uint8ClampedArray(pixelCount * 3) },
    0,
    baseOffset,
  );
}
