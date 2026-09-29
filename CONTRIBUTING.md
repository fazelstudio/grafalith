# Contributing to Fazelidraw

Thank you for your interest in contributing!

## Development Setup

```bash
# Clone the repo
git clone https://github.com/fazelstudio/fazelidraw.git
cd fazelidraw

# Install dependencies
bun install

# Run the demo
bun run dev

# Run tests
bun test --filter @fazelstudio/fazelidraw

# Type check all packages
bun run typecheck

# Build all packages
bun run build
```

## Project Structure

- `packages/core/` — The engine library (`@fazelstudio/fazelidraw`)
- `packages/react/` — React bindings (`@fazelstudio/react`)
- `apps/demo/` — Demo app for testing
- `apps/demo-headless/` — Headless mode demo (vanilla TS, no React)
- `docs/` — Architecture and phase documentation

## Rules

1. Core package must remain framework-agnostic (no React/Vue dependencies)
2. All mutations go through `Scene.upsertElement()` or `Editor` API
3. Run `bun run typecheck` and `bun test` before submitting PRs
4. Follow existing code conventions (data-oriented, no classes with behavior)

## Publishing

Scoped packages (`@fazelstudio/*`) require public access:

```bash
# Ensure you're logged in to npm
npm login

# Publish core
bun run publish:core

# Publish react
bun run publish:react
```

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
