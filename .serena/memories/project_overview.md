# Project Overview

## Purpose

`scratch-code` is a Visual Studio Code extension that provides a JetBrains-like "Scratches" feature: ephemeral, persisted scratch text files accessible across workspaces via a dedicated explorer view and commands. It adds a custom virtual file system scheme (`scratch:`), tree view, quick open, and full‑text search (MiniSearch) over scratch files with indexing persisted to extension global storage.

## Tech Stack

- Language: TypeScript (strict mode) targeting ESNext, compiled/bundled with custom esbuild script (`.esbuild.js`).
- VS Code Extension API (activation event: `onFileSystem:scratch`).
- Dependencies: `lang-map` (language detection), `minisearch` (full‑text search indexing), `ts-pattern` (pattern matching), internal lightweight functional utilities (`./fu`).
- Tooling: TypeScript 5.x, ESLint 9 (flat config with `@eslint/js` + `typescript-eslint`), Prettier 3, Mocha + @vscode/test-electron for tests, Husky for git hooks.

## Structure (selected files)

- `src/main.ts` – extension activation entry (registers providers & commands).
- `src/extension.ts` – core `ScratchExtension` class encapsulating FS provider, tree provider, search index, and commands implementations.
- `src/providers/fs.ts` – custom file system provider for the `scratch:` scheme (not yet read, inferred from naming).
- `src/providers/tree.ts` – tree data provider exposing scratches in explorer view.
- `src/providers/search.ts` – search/index provider (MiniSearch wrapper) for quick search.
- `src/util.ts` – shared utilities (e.g., `DisposableContainer`, `readTree`).
- `src/fu.ts` – internal functional helpers (map, prop, etc.).
- `src/test/` – Mocha tests harness (`runTest.ts`, test suite).
- Build output: `dist/extension.js` for publishing; intermediate `out/` for compiled test code.

## Build & Dev Workflow

- Type checking: `npm run check-types` (tsc --noEmit)
- Bundle (dev/prod): `node .esbuild.js` (with `--production` flag for `package` script)
- Watch mode: `npm run watch` (parallel tsc --watch + esbuild --watch)
- Lint: `npm run lint` (Prettier check + ESLint)
- Format: `npm run fmt` (Prettier write + ESLint --fix)
- Tests: `npm test` (Mocha via @vscode/test-electron harness)
- Package (vsce-ready): `npm run package` (type check + production bundle)
- Prepublish hook: `vscode:prepublish` runs `npm run package` automatically before publishing with `vsce`.

## Extension Features Snapshot

Commands (category "Scratches") include create, create from buffer, quick open, quick search, reset index, rename, delete, open directory, change sort order. A tree view (`id: scratches`) is contributed plus context & title menu items.

## Configuration

Single optional setting: `scratches.scratchDirectory` (string) – overrides default global storage location; supports leading `~` expansion.

## Notable Implementation Details

- Virtual FS provider registered for scheme `scratch` enabling persisted logical documents stored in a real directory (user storage or configured path).
- Search index persisted to `searchIndex.json` under storage directory; periodic auto-save every 15 minutes; rebuild option via command.
- Filename inference for new scratch from buffer uses sanitized leading content or timestamp fallback.
- Functional utilities supply composable helpers for mapping and sorting scratch metadata by recency.

## Future Work / TODOs (from README & code comments)

- Full text fuzzy search & ranking enhancements; archival of old scratches.
- Breadcrumb root display improvement; delete button in explorer view.
- Index maintenance edge cases (delayed updates, pruning missing entries) noted as TODO in code.

## Risks / Edge Cases

- Overwriting existing scratch prompts confirmation.
- Potential stale search index if underlying files deleted externally without FS events.
- Custom directory changes require window reload (warning message issued on config change).

## Related Secondary Project

A sibling folder `fu/` seems to host generic functional utilities (not fully read yet) possibly published separately; currently `src/fu.ts` in this project re-exports or duplicates needed helpers.
