# Locale Guide

How UI text is organized in the desktop application and how to extend it.

Source of truth: `apps/desktop/src/app/i18n/`.

## Layout

```text
apps/desktop/src/app/i18n/
  resources.tsx   # single registry: locale codes, selection list, dictionaries,
                  # provider, translator, key-set diagnostics — every file that
                  # needs locale imports from here
  en/             # canonical English resources, one file per category
  id/             # Indonesian resources, mirroring the English shape
apps/desktop/scripts/verify-locales.ts  # full consistency check
```

Category files: `common`, `navigation`, `home`, `projects`, `editor`,
`settings`, `dialogs`, `notifications`, `errors`, `extensions`. Each locale
directory composes them through its own `index.ts`.

## Rules

English defines the canonical key set. Every other locale carries the same
keys with translated values. Non-English files are typed against the English
shape, so a missing or misspelled key fails type checking.

Keys describe product meaning with dot namespaces such as
`editor.toolbar.select` or `settings.appearance.themeLabel`. Never use
positional keys such as `button3Text`, and never hardcode production UI text
in components.

Messages with variables use named `{placeholder}` interpolation resolved by
`t(key, params)`. Express a full sentence in one key instead of concatenating
translated fragments.

## Usage

```tsx
const { t, locale, setLocale } = useI18n();
t('editor.status.elements', { count: status.elementCount });
```

A missing key in the active locale falls back to English with a development
warning; a wholly unknown key returns the key itself with a warning. The
`<html lang>` attribute follows the active locale. The selection persists
through the preferences service.

Diagnostics for contributors:

```ts
canonicalKeys();      // key set defined by English resources
missingKeys('id');    // present in English, missing in Indonesian
extraKeys('id');      // present in Indonesian, no English counterpart
```

`bun run i18n:verify` enforces the full contract and fails on any gap:

1. Every locale directory mirrors the canonical English key set (missing
   or extra keys fail). Directories are auto-discovered, so a new locale
   needs no change to the script itself.
2. Every registry-held locale key (tools, panels, engine and host
   commands, menus, activity, settings and sections, templates, kinds,
   routes, inspector sections and fields) resolves against the canonical
   set.
3. Every locale-like string in a translation call (`t(...)`,
   `formatExtensionMessage(...)`, including ternaries), every
   `*Key: '...'` property literal, every `ExtensionMessageKey` union
   member, and every locale-key string in the Tauri backend (whose
   `messageKey` envelopes the host translates) resolves against the
   canonical set.
4. No locale source file defines the same full key path twice.
5. Wiring is complete: every dictionary file is composed by its locale
   `index.ts`, every locale directory is registered in the single
   registry (`LOCALES`, `LOCALE_LIST`, runtime resources).

Two advisory reports never fail the run: canonical keys with no static,
registry, or known-dynamic reference (candidates for cleanup, after
checking dynamic usages such as `settings.${section}.title` and
`editor.kinds.${kind}`), and English values shared by several keys
(intentional reuse across contexts, not key duplication).

## Adding a key

1. Add it to the relevant `en/` category file.
2. Add the translated value under the same key in the matching `id/` file.
3. Run `bun run i18n:verify` and `bun run typecheck`.

## Adding a locale

1. Copy the `en/` directory to the new locale code and translate the values.
2. Register the code once in `resources.tsx` (`Locale`, `LOCALES`,
   `LOCALE_LIST`, `isLocale`, the dictionary import, the resources map)
   and add its display name under `settings.general.localeNames` in every
   locale.
3. Run `bun run i18n:verify`, `bun run typecheck`, and `bun test`.

Non-React platform code (extension host, watcher, fatal dialog) resolves
messages through `translateKey` from the same registry instead of
importing dictionary files directly — never import `en/*` or `id/*`
from outside `app/i18n`.

Follow [`comment-guidelines.md`](./comment-guidelines.md) for any source-code
comments in locale files: explain why a key exists only when the reason is not
obvious from the key itself, never restate the value.
