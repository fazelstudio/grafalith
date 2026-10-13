/**
 * Full locale consistency check for the desktop host.
 *
 * Hard checks (non-zero exit when violated):
 * 1. Every locale directory mirrors the canonical English key set
 *    (no missing keys, no extra keys). Locale directories are
 *    auto-discovered, so a new locale needs no change here.
 * 2. Every registry-held locale key resolves against the canonical set.
 * 3. Every locale-like string in a translation call, every `*Key`
 *    property literal, every `ExtensionMessageKey` union member, and every
 *    locale-key string in the Tauri backend resolves against the canonical
 *    set.
 * 4. No locale source file defines the same full key path twice.
 * 5. Wiring is complete: every dictionary file is composed by its
 *    `index.ts`, every locale directory is registered in the single
 *    registry (`LOCALES`, `LOCALE_LIST`, runtime resources).
 *
 * Advisory reports (printed, never fail the run):
 * - Canonical keys with no static, registry, or known-dynamic reference.
 * - Identical English values shared by several keys.
 *
 * Run with `bun scripts/verify-locales.ts` (or `bun run i18n:verify`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { toolRegistry } from '../src/registries/tools.js';
import { panelRegistry } from '../src/registries/panels.js';
import { commandRegistry } from '../src/registries/commands.js';
import { appCommandRegistry } from '../src/registries/appCommands.js';
import { menuRegistry } from '../src/registries/menus.js';
import { activityRegistry } from '../src/registries/activity.js';
import { settingRegistry, settingSectionRegistry } from '../src/features/settings/settingsDescriptors.js';
import { projectTemplateRegistry } from '../src/features/projects/templateRegistry.js';
import { canvasPresetRegistry } from '../src/features/projects/canvasPresets.js';
import { projectKindRegistry } from '../src/features/projects/projectKinds.js';
import { routeRegistry } from '../src/app/routing/routes.js';
import { allInspectorSections } from '../src/features/editor/inspector/descriptors.js';
import { LOCALES, LOCALE_LIST } from '../src/app/i18n/resources.js';
import { HOME_VIEW_MODES } from '../src/platform/preferences/editorWorkspace.js';

type DictValue = string | { readonly [key: string]: DictValue };

const I18N_DIR = path.resolve(import.meta.dir, '../src/app/i18n');
const SRC_DIR = path.resolve(import.meta.dir, '../src');

function collectKeys(dict: DictValue, prefix = ''): string[] {
  if (typeof dict === 'string') return [prefix];
  const keys: string[] = [];
  for (const [key, value] of Object.entries(dict)) {
    const full = prefix === '' ? key : `${prefix}.${key}`;
    keys.push(...collectKeys(value as DictValue, full));
  }
  return keys.sort();
}

function collectValues(dict: DictValue, prefix = ''): Array<[string, string]> {
  if (typeof dict === 'string') return [[prefix, dict]];
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(dict)) {
    const full = prefix === '' ? key : `${prefix}.${key}`;
    out.push(...collectValues(value as DictValue, full));
  }
  return out;
}

function discoverLocales(): string[] {
  return fs
    .readdirSync(I18N_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(I18N_DIR, name, 'index.ts')))
    .sort();
}

async function loadDict(code: string): Promise<DictValue> {
  const module = await import(pathToFileURL(path.join(I18N_DIR, code, 'index.ts')).href);
  return module.default as DictValue;
}

function stripStringsAndComments(source: string): string {
  const withoutComments = source
    .replace(/\/\/[^\n]*/g, (match) => ' '.repeat(match.length))
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
  return withoutComments.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (match) =>
    match[0] + ' '.repeat(Math.max(0, match.length - 2)) + (match.length > 1 ? match[match.length - 1] : ''),
  );
}

function findDuplicatePaths(category: string, source: string): string[] {
  const stripped = stripStringsAndComments(source);
  const token = /([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)?|[{}]/g;
  const stack: string[] = [category];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  let lastKey: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = token.exec(stripped)) !== null) {
    const text = match[0];
    if (text === '{') {
      if (lastKey !== null) stack.push(lastKey);
      lastKey = null;
    } else if (text === '}') {
      if (stack.length > 1) stack.pop();
      lastKey = null;
    } else if (match[2] !== undefined) {
      const key = match[1];
      const full = [...stack, key].join('.');
      if (seen.has(full)) duplicates.push(full);
      else seen.add(full);
      lastKey = key;
    } else {
      lastKey = null;
    }
  }
  return duplicates.sort();
}

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'i18n') continue;
      out.push(...walkSource(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
      out.push(full);
    }
  }
  return out;
}

const codes = discoverLocales();
if (!codes.includes('en')) {
  console.log('Locale verification failed: canonical "en" directory is missing.');
  process.exit(1);
}

const dictionaries = new Map<string, DictValue>();
for (const code of codes) {
  dictionaries.set(code, await loadDict(code));
}

const canonical = collectKeys(dictionaries.get('en')!);
const canonicalSet = new Set(canonical);
let failed = false;

// 1. Parity per locale.
for (const code of codes) {
  const keys = collectKeys(dictionaries.get(code)!);
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

// 2. Registry-held keys resolve against the canonical set.
const registryKeys: Array<[string, string]> = [];
for (const tool of toolRegistry.all()) {
  registryKeys.push([`tool:${tool.id}`, tool.labelKey]);
  if (tool.descriptionKey) registryKeys.push([`tool:${tool.id}`, tool.descriptionKey]);
}
for (const panel of panelRegistry.all()) {
  registryKeys.push([`panel:${panel.id}`, panel.labelKey]);
  registryKeys.push([`panel:${panel.id}`, panel.toggleKey]);
}
for (const command of commandRegistry.all()) {
  registryKeys.push([`command:${command.id}`, command.labelKey]);
  if (command.descriptionKey) registryKeys.push([`command:${command.id}`, command.descriptionKey]);
}
for (const command of appCommandRegistry.all()) {
  registryKeys.push([`appCommand:${command.id}`, command.labelKey]);
  if (command.descriptionKey) registryKeys.push([`appCommand:${command.id}`, command.descriptionKey]);
}
for (const row of menuRegistry.all()) {
  registryKeys.push([`menu:${row.id}`, row.labelKey]);
}
for (const activity of activityRegistry.all()) {
  registryKeys.push([`activity:${activity.id}`, activity.labelKey]);
}
for (const setting of settingRegistry.all()) {
  registryKeys.push([`setting:${setting.id}`, setting.labelKey]);
  if (setting.descriptionKey) registryKeys.push([`setting:${setting.id}`, setting.descriptionKey]);
}
for (const section of settingSectionRegistry.all()) {
  registryKeys.push([`settingSection:${section.id}`, section.labelKey]);
}
for (const template of projectTemplateRegistry.all()) {
  registryKeys.push([`template:${template.id}`, template.labelKey]);
  registryKeys.push([`template:${template.id}`, template.descriptionKey]);
}
for (const preset of canvasPresetRegistry.all()) {
  registryKeys.push([`canvasPreset:${preset.id}`, preset.labelKey]);
}
for (const kind of projectKindRegistry.all()) {
  registryKeys.push([`kind:${kind.id}`, kind.labelKey]);
  registryKeys.push([`kind:${kind.id}`, kind.hintKey]);
}
for (const route of routeRegistry.all()) {
  registryKeys.push([`route:${route.id}`, route.titleKey]);
  registryKeys.push([`route:${route.id}`, route.navigationKey]);
}
for (const section of allInspectorSections()) {
  registryKeys.push([`inspectorSection:${section.id}`, section.titleKey]);
  for (const field of section.fields) {
    registryKeys.push([`inspectorField:${section.id}.${field.id}`, field.labelKey]);
    if (field.placeholderKey) {
      registryKeys.push([`inspectorField:${section.id}.${field.id}`, field.placeholderKey]);
    }
    for (const option of field.options ?? []) {
      registryKeys.push([`inspectorOption:${section.id}.${field.id}.${option.value}`, option.labelKey]);
    }
  }
}
for (const [owner, key] of registryKeys) {
  if (!canonicalSet.has(key)) {
    failed = true;
    console.log(`  unregistered registry key: ${key} (owner ${owner})`);
  }
}

// 3. Every locale-like string literal in a translation call (`t(...)`,
// `formatExtensionMessage(...)`, including ternaries), every `*Key: '...'`
// property literal, and every locale-key string literal in the Tauri backend
// resolves against the canonical set. Backend envelopes carry `messageKey`
// values the host translates, so an unknown key there surfaces as raw text.
const keyPropPattern =
  /(?:labelKey|descriptionKey|toggleKey|titleKey|navigationKey|hintKey|messageKey|nameKey|placeholderKey)\s*:\s*['"]([A-Za-z][A-Za-z0-9_.]*)['"]/g;
const rustLiteralPattern = /"([A-Za-z][A-Za-z0-9_.]*)"/g;

// Quoted locale-like strings inside one call's parentheses, so ternaries
// such as `t(flag ? 'a.b' : 'c.d')` are covered without sweeping up
// unrelated dotted ids (menu locations, command ids).
function callInnerLiterals(text: string, call: string): string[] {
  const found: string[] = [];
  const head = new RegExp(`\\b${call}\\s*\\(`, 'g');
  let match: RegExpExecArray | null;
  while ((match = head.exec(text)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    let quote: string | null = null;
    let current = '';
    const literals: string[] = [];
    for (; i < text.length && depth > 0; i++) {
      const char = text[i];
      if (quote !== null) {
        if (char === '\\') {
          i++;
        } else if (char === quote) {
          literals.push(current);
          current = '';
          quote = null;
        } else {
          current += char;
        }
      } else if (char === "'" || char === '"' || char === '`') {
        quote = char;
        current = '';
      } else if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
      }
    }
    for (const literal of literals) {
      if (/^[A-Za-z][A-Za-z0-9_.]*$/.test(literal)) found.push(literal);
    }
    head.lastIndex = i;
  }
  return found;
}
const knownRoots = new Set([
  'common',
  'navigation',
  'home',
  'projects',
  'editor',
  'settings',
  'dialogs',
  'notifications',
  'errors',
  'extensions',
]);
const referenced = new Map<string, number>();
function noteReference(key: string): void {
  if (!key.includes('.')) return;
  if (!knownRoots.has(key.split('.')[0])) return;
  referenced.set(key, (referenced.get(key) ?? 0) + 1);
}
for (const file of walkSource(SRC_DIR)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const literal of callInnerLiterals(text, 't')) noteReference(literal);
  // Ref-held translators (`tRef.current('...')`) keep pointer-loop callbacks
  // on the fresh locale without re-subscribing; they carry locale keys like
  // plain `t(...)` calls, so their literals count as references too.
  for (const literal of callInnerLiterals(text, '\\w*Ref\\.current')) noteReference(literal);
  for (const literal of callInnerLiterals(text, 'formatExtensionMessage')) noteReference(literal);
  keyPropPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = keyPropPattern.exec(text)) !== null) noteReference(match[1]);
}
const TAURI_SRC_DIR = path.resolve(import.meta.dir, '../src-tauri/src');
if (fs.existsSync(TAURI_SRC_DIR)) {
  const rustFiles: string[] = [];
  const walkRust = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkRust(full);
      else if (entry.name.endsWith('.rs')) rustFiles.push(full);
    }
  };
  walkRust(TAURI_SRC_DIR);
  for (const file of rustFiles) {
    const text = fs.readFileSync(file, 'utf8');
    rustLiteralPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rustLiteralPattern.exec(text)) !== null) noteReference(match[1]);
  }
}
for (const key of [...referenced.keys()].sort()) {
  if (!canonicalSet.has(key)) {
    failed = true;
    console.log(`  unknown literal key: ${key} (used ${referenced.get(key)}x)`);
  }
}

// The `ExtensionMessageKey` union in extensionMessages.ts is a type-level
// allowlist for non-React code; every member must exist in the canonical set.
{
  const messagesFile = path.join(SRC_DIR, 'platform/extensions/extensionMessages.ts');
  const unionText = fs.readFileSync(messagesFile, 'utf8');
  const block = unionText.match(/export type ExtensionMessageKey\s*=\s*([\s\S]*?);/);
  if (!block) {
    failed = true;
    console.log('  missing ExtensionMessageKey union in extensionMessages.ts');
  } else {
    const unionPattern = /\|\s*'([A-Za-z][A-Za-z0-9_.]*)'/g;
    const unionKeys = new Set<string>();
    let unionMatch: RegExpExecArray | null;
    unionPattern.lastIndex = 0;
    while ((unionMatch = unionPattern.exec(block[1])) !== null) {
      unionKeys.add(unionMatch[1]);
    }
    for (const key of [...unionKeys].sort()) {
      if (!canonicalSet.has(key)) {
        failed = true;
        console.log(`  unknown ExtensionMessageKey: ${key}`);
      }
      referenced.set(key, (referenced.get(key) ?? 0) + 1);
    }
  }
}

// 4. No duplicate full key paths inside any locale source file.
for (const code of codes) {
  const dir = path.join(I18N_DIR, code);
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.ts') || name === 'index.ts') continue;
    const category = name.slice(0, -'.ts'.length);
    const source = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const duplicate of findDuplicatePaths(category, source)) {
      failed = true;
      console.log(`  duplicate key path: ${duplicate} (in ${code}/${name})`);
    }
  }
}

// Advisory: canonical keys without a static, registry, or known-dynamic reference.
// Dynamic usages are derived from their registries, never hardcoded, so the
// list cannot drift: settings section titles, home view modes, theme modes,
// locale display names, and element-kind labels.
const dynamicPrefixes = ['editor.kinds.'];
const dynamicExact = new Set<string>();
for (const section of settingSectionRegistry.all()) {
  dynamicExact.add(`settings.${section.id}.title`);
  dynamicExact.add(`settings.${section.id}.description`);
}
for (const view of HOME_VIEW_MODES) dynamicExact.add(`home.view.${view}`);
for (const key of canonical) {
  if (key.startsWith('settings.appearance.themeModes.') || key.startsWith('settings.general.localeNames.')) {
    dynamicExact.add(key);
  }
}
const registryKeySet = new Set(registryKeys.map(([, key]) => key));
const unused = canonical.filter(
  (key) =>
    !referenced.has(key) &&
    !registryKeySet.has(key) &&
    !dynamicExact.has(key) &&
    !dynamicPrefixes.some((prefix) => key.startsWith(prefix)),
);
if (unused.length > 0) {
  console.log(`\nAdvisory: ${unused.length} canonical keys have no static, registry, or known-dynamic reference.`);
  for (const key of unused.slice(0, 80)) console.log(`  advisory unused: ${key}`);
  if (unused.length > 80) console.log(`  ... +${unused.length - 80} more`);
}

// Advisory: identical English values shared by several keys.
const byValue = new Map<string, string[]>();
for (const [key, value] of collectValues(dictionaries.get('en')!)) {
  const list = byValue.get(value) ?? [];
  list.push(key);
  byValue.set(value, list);
}
const shared = [...byValue.entries()]
  .filter(([, keys]) => keys.length > 1)
  .sort((a, b) => a[0].localeCompare(b[0]));
console.log(`\nAdvisory: ${shared.length} English values are shared by several keys (intentional reuse).`);
for (const [value, keys] of shared.slice(0, 40)) {
  console.log(`  "${value}" <- ${keys.join(', ')}`);
}
if (shared.length > 40) console.log(`  ... +${shared.length - 40} more`);

// 5. Wiring is complete: every dictionary file is composed by its locale
// `index.ts`, every locale directory is registered in the single registry,
// and the runtime resources wire every registered locale.
function wiredCategories(code: string): string[] {
  const indexText = fs.readFileSync(path.join(I18N_DIR, code, 'index.ts'), 'utf8');
  const wired = new Set<string>();
  const importPattern = /from '\.\/([A-Za-z]+)'/g;
  let wiredMatch: RegExpExecArray | null;
  while ((wiredMatch = importPattern.exec(indexText)) !== null) {
    wired.add(wiredMatch[1]);
  }
  return [...wired].sort();
}
const englishCategories = wiredCategories('en');
const englishFiles = fs
  .readdirSync(path.join(I18N_DIR, 'en'))
  .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
  .map((name) => name.slice(0, -'.ts'.length))
  .sort();
for (const category of englishFiles) {
  if (!englishCategories.includes(category)) {
    failed = true;
    console.log(`  unwired dictionary file: en/${category}.ts is not composed by en/index.ts`);
  }
}
for (const code of codes) {
  if (code === 'en') continue;
  const categories = wiredCategories(code);
  const missingCategories = englishCategories.filter((category) => !categories.includes(category));
  const extraCategories = categories.filter((category) => !englishCategories.includes(category));
  for (const category of missingCategories) {
    failed = true;
    console.log(`  unwired dictionary file: ${code}/index.ts does not compose ${category}.ts`);
  }
  for (const category of extraCategories) {
    failed = true;
    console.log(`  extra dictionary file: ${code}/index.ts composes ${category}.ts with no English counterpart`);
  }
}
for (const entry of LOCALE_LIST) {
  if (!canonicalSet.has(entry.nameKey)) {
    failed = true;
    console.log(`  unregistered locale name key: ${entry.nameKey} (locale ${entry.code})`);
  }
}
{
  const resourcesText = fs.readFileSync(path.join(I18N_DIR, 'resources.tsx'), 'utf8');
  const runtimeWired = new Set<string>();
  const runtimePattern = /from '\.\/([a-z]+)'/g;
  let runtimeMatch: RegExpExecArray | null;
  while ((runtimeMatch = runtimePattern.exec(resourcesText)) !== null) {
    const name = runtimeMatch[1];
    if (fs.existsSync(path.join(I18N_DIR, name, 'index.ts'))) runtimeWired.add(name);
  }
  for (const code of codes) {
    if (!LOCALES.includes(code as never)) {
      failed = true;
      console.log(`  unregistered locale: "${code}" has a resource directory but is not in LOCALES`);
    }
    if (!runtimeWired.has(code)) {
      failed = true;
      console.log(`  unwired locale: "${code}" is not imported by the runtime resources`);
    }
  }
  for (const code of LOCALES) {
    if (!codes.includes(code)) {
      failed = true;
      console.log(`  missing locale: "${code}" is registered but has no resource directory`);
    }
  }
}

if (failed) {
  console.log('\nLocale verification failed.');
  process.exit(1);
} else {
  console.log('\nAll locale checks passed.');
}
