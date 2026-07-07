import { describe, expect, it } from "vitest";
import { parseNpy } from "./npy";

// Build a valid .npy buffer for the subset the app writes, so tests exercise the
// real header/version branches. Mirrors numpy's own layout (magic, version,
// header-length field, padded ASCII dict, then raw little-endian float32).
function buildNpy(
  shape: number[],
  values: number[],
  opts: { major?: number; descr?: string; fortranOrder?: boolean } = {},
): ArrayBuffer {
  const major = opts.major ?? 1;
  const descr = opts.descr ?? "<f4";
  const fortran = opts.fortranOrder ? "True" : "False";
  const shapeStr =
    shape.length === 0
      ? "()"
      : shape.length === 1
        ? `(${shape[0]},)`
        : `(${shape.join(", ")})`;
  const dict = `{'descr': '${descr}', 'fortran_order': ${fortran}, 'shape': ${shapeStr}, }`;
  const preHeader = major >= 2 ? 12 : 10; // magic+version+len-field
  // Pad the dict with spaces + a trailing newline so the header ends 64-aligned.
  const unpadded = preHeader + dict.length + 1;
  const pad = (64 - (unpadded % 64)) % 64;
  const header = dict + " ".repeat(pad) + "\n";
  const headerLen = header.length;

  const buf = new ArrayBuffer(preHeader + headerLen + values.length * 4);
  const bytes = new Uint8Array(buf);
  bytes[0] = 0x93;
  bytes.set(
    [..."NUMPY"].map((c) => c.charCodeAt(0)),
    1,
  );
  bytes[6] = major;
  bytes[7] = 0;
  const view = new DataView(buf);
  if (major >= 2) view.setUint32(8, headerLen, true);
  else view.setUint16(8, headerLen, true);
  for (let i = 0; i < headerLen; i++)
    bytes[preHeader + i] = header.charCodeAt(i);
  new Float32Array(buf, preHeader + headerLen, values.length).set(values);
  return buf;
}

describe("parseNpy", () => {
  it("parses a 2-D v1 matrix and round-trips its values", () => {
    const values = [1, 2, 3, 4, 5, 6];
    const { shape, data } = parseNpy(buildNpy([2, 3], values));
    expect(shape).toEqual([2, 3]);
    expect(Array.from(data)).toEqual(values);
  });

  it("parses a 1-D vector (trailing-comma tuple)", () => {
    const { shape, data } = parseNpy(buildNpy([4], [0.5, 1.5, 2.5, 3.5]));
    expect(shape).toEqual([4]);
    expect(data.length).toBe(4);
  });

  it("reads the v2 uint32 header-length field", () => {
    const { shape, data } = parseNpy(
      buildNpy([2, 2], [1, 2, 3, 4], { major: 2 }),
    );
    expect(shape).toEqual([2, 2]);
    expect(Array.from(data)).toEqual([1, 2, 3, 4]);
  });

  it("rejects a non-.npy buffer", () => {
    const buf = new ArrayBuffer(16);
    expect(() => parseNpy(buf)).toThrow(/not a \.npy/);
  });

  it("rejects an unsupported dtype", () => {
    expect(() => parseNpy(buildNpy([2], [1, 2], { descr: "<f8" }))).toThrow(
      /unsupported \.npy dtype/,
    );
  });

  it("rejects fortran-order data", () => {
    expect(() =>
      parseNpy(buildNpy([2, 2], [1, 2, 3, 4], { fortranOrder: true })),
    ).toThrow(/fortran-order/);
  });

  it("rejects a scalar (empty shape)", () => {
    expect(() => parseNpy(buildNpy([], []))).toThrow(/empty shape/);
  });

  it("throws a contextual error on a truncated buffer", () => {
    const full = buildNpy([2, 3], [1, 2, 3, 4, 5, 6]);
    const truncated = full.slice(0, full.byteLength - 8); // drop two floats
    expect(() => parseNpy(truncated)).toThrow(
      /truncated \.npy: shape \(2, 3\)/,
    );
  });
});
