import { GRLT_MANIFEST_FILENAME } from './extensionManifest';

/** One zip entry resolved from the central directory. */
export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 over raw bytes (zip headers and test fixtures share this). */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function findEocd(bytes: Uint8Array): number {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  return -1;
}

const textDecoder = new TextDecoder();

/**
 * List entries from the zip central directory. Throws on truncated or
 * non-zip input so installers report one clear error instead of staging
 * half a package.
 */
export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length < 22) throw new Error('not a zip archive: too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes);
  if (eocd === -1) throw new Error('not a zip archive: end of central directory missing');
  if (readU32(view, eocd) !== EOCD_SIGNATURE) throw new Error('not a zip archive: bad end signature');
  const count = readU16(view, eocd + 10);
  const centralOffset = readU32(view, eocd + 16);
  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length) throw new Error('not a zip archive: truncated central directory');
    if (readU32(view, offset) !== CENTRAL_SIGNATURE) throw new Error('not a zip archive: bad entry signature');
    const method = readU16(view, offset + 10);
    const compressedSize = readU32(view, offset + 20);
    const uncompressedSize = readU32(view, offset + 24);
    const nameLength = readU16(view, offset + 28);
    const extraLength = readU16(view, offset + 30);
    const commentLength = readU16(view, offset + 32);
    const localHeaderOffset = readU32(view, offset + 42);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    entries.push({
      name: textDecoder.decode(nameBytes),
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Extract one entry's raw bytes. Stored entries slice straight out;
 * deflated entries inflate through the platform decoder. Only these two
  * methods ship in `.grlt` files; anything else is rejected at install.
 */
export async function extractZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const localOffset = entry.localHeaderOffset;
  if (localOffset + 30 > bytes.length) throw new Error(`zip entry truncated: ${entry.name}`);
  if (readU32(view, localOffset) !== LOCAL_SIGNATURE) {
    throw new Error(`zip entry has a bad local header: ${entry.name}`);
  }
  const nameLength = readU16(view, localOffset + 26);
  const extraLength = readU16(view, localOffset + 28);
  const dataOffset = localOffset + 30 + nameLength + extraLength;
  const data = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
  if (data.length !== entry.compressedSize) throw new Error(`zip entry truncated: ${entry.name}`);
  if (entry.method === METHOD_STORED) return data.slice();
  if (entry.method === METHOD_DEFLATED) {
    const stream = new DecompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    await writer.write(data as unknown as Uint8Array<ArrayBuffer>);
    await writer.close();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
  throw new Error(`unsupported zip method ${entry.method} for entry: ${entry.name}`);
}

/** Extract and parse the `grafalith.extension.json` manifest from an archive. */
export async function extractGrltManifest(bytes: Uint8Array): Promise<unknown> {
  const entries = listZipEntries(bytes);
  const manifest = entries.find((entry) => entry.name === GRLT_MANIFEST_FILENAME);
  if (!manifest) throw new Error(`archive misses ${GRLT_MANIFEST_FILENAME}`);
  const raw = await extractZipEntry(bytes, manifest);
  try {
    return JSON.parse(textDecoder.decode(raw));
  } catch {
    throw new Error(`archive manifest is not valid JSON: ${GRLT_MANIFEST_FILENAME}`);
  }
}

/** Extract every file entry as text (directories skipped) for module loading. */
export async function extractGrltFiles(bytes: Uint8Array): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of listZipEntries(bytes)) {
    if (entry.name.endsWith('/')) continue;
    const raw = await extractZipEntry(bytes, entry);
    files.set(entry.name, textDecoder.decode(raw));
  }
  return files;
}

const textEncoder = new TextEncoder();

/**
 * Build a minimal stored-method zip (test fixtures and exporters share
  * this). Real `.grlt` files come from any zip tool; the host reads stored
 * and deflated entries alike.
 */
export function buildStoredZip(files: Readonly<Record<string, string>>): Uint8Array {
  const names = Object.keys(files);
  const encoded = names.map((name) => ({
    name: textEncoder.encode(name),
    data: textEncoder.encode(files[name]),
  }));
  let localSize = 0;
  for (const file of encoded) localSize += 30 + file.name.length + file.data.length;
  let centralSize = 0;
  for (const file of encoded) centralSize += 46 + file.name.length;
  const total = localSize + centralSize + 22;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const writeU16 = (offset: number, value: number) => view.setUint16(offset, value, true);
  const writeU32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  let at = 0;
  const offsets: number[] = [];
  for (const file of encoded) {
    offsets.push(at);
    writeU32(at, LOCAL_SIGNATURE);
    writeU16(at + 4, 20);
    writeU16(at + 6, 0);
    writeU16(at + 8, METHOD_STORED);
    writeU16(at + 10, 0);
    writeU16(at + 12, 0);
    writeU32(at + 14, crc32(file.data));
    writeU32(at + 18, file.data.length);
    writeU32(at + 22, file.data.length);
    writeU16(at + 26, file.name.length);
    writeU16(at + 28, 0);
    out.set(file.name, at + 30);
    out.set(file.data, at + 30 + file.name.length);
    at += 30 + file.name.length + file.data.length;
  }
  const centralOffset = at;
  names.forEach((_, index) => {
    const file = encoded[index];
    writeU32(at, CENTRAL_SIGNATURE);
    writeU16(at + 4, 20);
    writeU16(at + 6, 20);
    writeU16(at + 8, 0);
    writeU16(at + 10, METHOD_STORED);
    writeU16(at + 12, 0);
    writeU16(at + 14, 0);
    writeU32(at + 16, crc32(file.data));
    writeU32(at + 20, file.data.length);
    writeU32(at + 24, file.data.length);
    writeU16(at + 28, file.name.length);
    writeU16(at + 30, 0);
    writeU16(at + 32, 0);
    writeU16(at + 34, 0);
    writeU16(at + 36, 0);
    writeU32(at + 38, 0);
    writeU32(at + 42, offsets[index]);
    out.set(file.name, at + 46);
    at += 46 + file.name.length;
  });
  writeU32(at, EOCD_SIGNATURE);
  writeU16(at + 8, names.length);
  writeU16(at + 10, names.length);
  writeU32(at + 12, centralSize);
  writeU32(at + 16, centralOffset);
  return out;
}
