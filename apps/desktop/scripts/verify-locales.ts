/**
 * Verifies every locale mirrors the canonical English key set.
 *
 * Run with `bun scripts/verify-locales.ts` (or `bun run i18n:verify`).
 * Exits non-zero when any locale misses a key or carries an extra one.
 */
import en from '../src/app/i18n/en/index.js';
import id from '../src/app/i18n/id/index.js';

type DictValue = string | { readonly [key: string]: DictValue };

function collectKeys(dict: DictValue, prefix = ''): string[] {
  if (typeof dict === 'string') return [prefix];
  const keys: string[] = [];
  for (const [key, value] of Object.entries(dict)) {
    const full = prefix === '' ? key : `${prefix}.${key}`;
    keys.push(...collectKeys(value, full));
  }
  return keys.sort();
}

const locales: Record<string, DictValue> = { en: en as DictValue, id: id as DictValue };
const canonical = collectKeys(locales.en);
const canonicalSet = new Set(canonical);

let failed = false;
for (const [code, dict] of Object.entries(locales)) {
  const keys = collectKeys(dict);
  const present = new Set(keys);
  const missing = canonical.filter((key) => !present.has(key));
  const extra = keys.filter((key) => !canonicalSet.has(key));
  console.log(`${code}: ${keys.length} keys (canonical: ${canonical.length})`);
  for (const key of missing) {
    failed = true;
    console.log(`  missing: ${key}`);
  }
  for (const key of extra) {
    failed = true;
    console.log(`  extra: ${key}`);
  }
}

if (failed) {
  console.log('Locale verification failed.');
  process.exit(1);
} else {
  console.log('All locale key sets are consistent.');
}
