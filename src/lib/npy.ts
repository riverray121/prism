// Minimal parser for NumPy .npy files (heatmap sidecars). Handles the subset we
// write: uncompressed, C-order, little-endian float32. The format is a magic
// string, a version, an ASCII header dict (descr/fortran_order/shape), then the
// raw buffer; the header is padded so the data start is 64-byte aligned.

export interface Npy {
  shape: number[];
  data: Float32Array;
}

export function parseNpy(buffer: ArrayBuffer): Npy {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.slice(1, 6));
  if (magic !== "NUMPY") throw new Error("not a .npy file");

  const major = bytes[6];
  const view = new DataView(buffer);
  let headerLen: number;
  let headerStart: number;
  if (major >= 2) {
    headerLen = view.getUint32(8, true);
    headerStart = 12;
  } else {
    headerLen = view.getUint16(8, true);
    headerStart = 10;
  }

  const header = new TextDecoder("latin1").decode(
    bytes.slice(headerStart, headerStart + headerLen),
  );
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1] ?? "";
  if (descr !== "<f4") throw new Error(`unsupported .npy dtype: ${descr}`);
  if (/'fortran_order':\s*True/.test(header))
    throw new Error("fortran-order .npy not supported");

  const shapeStr = /'shape':\s*\(([^)]*)\)/.exec(header)?.[1] ?? "";
  const shape = shapeStr
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number);

  // A scalar (empty shape) is not a valid heatmap/tags matrix.
  if (shape.length === 0) throw new Error("truncated .npy: empty shape ()");

  // Validate the declared shape fits the buffer before constructing the view,
  // so a truncated sidecar fails with context instead of a bare RangeError.
  const count = shape.reduce((a, b) => a * b, 1);
  const off = headerStart + headerLen;
  if (off + count * 4 > buffer.byteLength)
    throw new Error(
      `truncated .npy: shape (${shape.join(", ")}) needs ${count * 4} bytes ` +
        `at offset ${off}, buffer has ${buffer.byteLength}`,
    );
  const data = new Float32Array(buffer, off, count);
  return { shape, data };
}
