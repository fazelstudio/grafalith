# Locale Guide

How UI text is organized in the desktop application and how to extend it.

Source of truth: `apps/desktop/src/app/i18n/`.

## Layout

```text
apps/desktop/src/app/i18n/
  locales.ts      # single registry: locale codes, default, selection list
  resources.tsx   # provider, translator, key-set diagnostics
  en/             # canonical English resources, one file per category
  id/             # Indonesian resources, mirroring the English shape
apps/desktop/scripts/verify-locales.ts  # key-set consistency check
```

Category files: `common`, `navigation`, `home`, `editor`, `settings`,
`dialogs`, `notifications`, `errors`. Each locale directory composes them
through its own `index.ts`.

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

## Adding a key

1. Add it to the relevant `en/` category file.
2. Add the translated value under the same key in the matching `id/` file.
3. Run `bun run i18n:verify` and `bun run typecheck`.

## Adding a locale

1. Copy the `en/` directory to the new locale code and translate the values.
2. Register the code in `locales.ts` (`Locale`, `LOCALES`, `LOCALE_LIST`,
   `isLocale`) and add its display name under
   `settings.appearance.localeNames` in every locale.
3. Wire the new dictionary into `resources.tsx` and `verify-locales.ts`.
4. Run `bun run i18n:verify`, `bun run typecheck`, and `bun test`.

Follow [`comment-guidelines.md`](./comment-guidelines.md) for any source-code
comments in locale files: explain why a key exists only when the reason is not
obvious from the key itself, never restate the value.
