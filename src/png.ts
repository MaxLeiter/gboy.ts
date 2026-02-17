import { deflateSync } from "node:zlib";

export function encodePNG(
  rgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const rowSize = width * 4;
  const raw = new Uint8Array(height * (1 + rowSize));
  for (let y = 0; y < height; y++) {
    const outOff = y * (1 + rowSize);
    raw[outOff] = 0;
    raw.set(rgba.subarray(y * rowSize, y * rowSize + rowSize), outOff + 1);
  }

  const compressed = deflateSync(raw);

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = createIHDR(width, height);
  const idat = createChunk("IDAT", compressed);
  const iend = createChunk("IEND", new Uint8Array(0));

  const total = signature.length + ihdr.length + idat.length + iend.length;
  const out = new Uint8Array(total);
  let off = 0;
  out.set(signature, off);
  off += signature.length;
  out.set(ihdr, off);
  off += ihdr.length;
  out.set(idat, off);
  off += idat.length;
  out.set(iend, off);

  return out;
}

function createIHDR(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  data[8] = 8;  // bit depth
  data[9] = 6;  // color type: RGBA
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return createChunk("IHDR", data);
}

function createChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);

  view.setUint32(0, data.length, false);

  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = type.charCodeAt(i);
  }

  chunk.set(data, 8);

  const crc = crc32(chunk.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc, false);

  return chunk;
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
