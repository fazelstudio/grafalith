// ESLint flat config (ESLint v9) — single config for the whole monorepo.
// `bun run lint` (root) must report zero errors AND zero warnings.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Global ignores: build output, dependencies, generated files.
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/pkg/**', '**/target/**'],
  },
  // Base JS recommended rules (applies to all files).
  js.configs.recommended,
  // TypeScript recommended rules WITHOUT type-checking (fast, no project
  // service needed). Covers no-unused-vars, no-explicit-any, etc.
  ...tseslint.configs.recommended,
  // Project convention (also honored by TS `noUnusedParameters`): a leading
  // underscore marks an intentionally-unused parameter/variable (e.g.
  // `_viewport` in render signatures, `_e` in callbacks).
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // Test files: bun:test globals (`describe`/`test`/`expect` are imported
  // explicitly, so no env globals needed). Relax nothing by default —
  // tests must be as clean as source.
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      // Tests intentionally use non-null assertions and broad casts.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
