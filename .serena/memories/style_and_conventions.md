# Style and Conventions

## TypeScript Settings

- Target: ESNext; Module: CommonJS; Strict mode enabled.
- Strong compile hygiene: `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedParameters`.
- Source maps enabled; rootDir is `src`, outDir is `out` (for test harness), bundled into `dist/extension.js` for runtime.

## Linting

- ESLint 9 with flat config (`eslint.config.mjs`):
  - Base: `@eslint/js` recommended for JS
  - TypeScript: `typescript-eslint` recommended preset
  - Node globals via `globals`.

## Formatting

- Prettier 3 with overrides in package.json:
  - `printWidth: 100`
  - `arrowParens: "avoid"`
- Commands integrate Prettier + ESLint (`fmt` applies fixes; `lint` checks only).

## Naming / Patterns

- Functional helpers in `src/fu.ts` adopt small, composable primitives (`map`, `prop`, `zip`, `waitPromises`).
- VS Code extension patterns:
  - Core logic in a `ScratchExtension` class derived from `DisposableContainer` to centralize setup and disposal.
  - Register disposables in `context.subscriptions`.
  - Providers: `FileSystemProvider` for `scratch:` scheme, `TreeDataProvider` for explorer panel, `QuickPick` for search UX.
- Use `ts-pattern` for exhaustive matching of file change events; log `.otherwise` for safety.

## Testing

- Mocha via `@vscode/test-electron`; tests live in `src/test/` with `runTest.ts` harness.

## Commit Hooks

- Husky is configured via `prepare`; hook specifics not included here but expect pre-commit style checks to be added.
