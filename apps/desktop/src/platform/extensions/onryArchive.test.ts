import { describe, expect, test } from 'bun:test';
import {
  buildStoredZip,
  crc32,
  extractOnryFiles,
  extractOnryManifest,
  listZipEntries,
} from './onryArchive';
import { ONRY_MANIFEST_FILENAME } from './extensionManifest';

function extensionZip(): Uint8Array {
  return buildStoredZip({
    [ONRY_MANIFEST_FILENAME]: JSON.stringify({
      formatVersion: 1,
      id: 'sticker',
      publisher: 'acme',
      name: 'Sticker Pack',
      version: '1.0.0',
      engines: { opennary: '^0.1.0' },
      main: 'index.js',
    }),
    'index.js': 'export async function activate() {}',
  });
}

describe('onry archive', () => {
  test('crc32 matches the known vector', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
  });

  test('stored zip round-trips manifest and files', async () => {
    const bytes = extensionZip();
    const names = listZipEntries(bytes).map((entry) => entry.name);
    expect(names).toEqual([ONRY_MANIFEST_FILENAME, 'index.js']);
    const manifest = (await extractOnryManifest(bytes)) as { id: string };
    expect(manifest.id).toBe('sticker');
    const files = await extractOnryFiles(bytes);
    expect(files.get('index.js')).toBe('export async function activate() {}');
  });

  test('non-zip input and missing manifests fail clearly', async () => {
    await expect(extractOnryManifest(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a zip archive/);
    const bare = buildStoredZip({ 'index.js': '' });
    await expect(extractOnryManifest(bare)).rejects.toThrow(/misses opennary.extension.json/);
  });
});
