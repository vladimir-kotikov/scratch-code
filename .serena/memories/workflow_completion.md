# After You Make Changes

Use this checklist before pushing or publishing the extension.

1) Keep code clean

- npm run fmt
- npm run lint

2) Typecheck & Build

- npm run check-types
- npm run watch (while iterating) or node .esbuild.js for a one-off build

3) Run tests

- npm test

4) Verify in VS Code

- Press F5 to run the Extension Development Host and test new/changed commands:
  - Scratches: New / New from current buffer / Quick Open / Quick Search / Rename / Delete / Open directory / Reset Search Index / Change Sort Order

5) Update docs & metadata

- Update CHANGELOG.md with user-facing changes
- Bump version in package.json as needed

6) Package / Publish (when ready)

- npm run package
- npx vsce publish (or specify version bump)

7) CI

- Ensure GitHub Actions build passes (build workflow badge in README)

Notes

- If you changed configuration (`scratches.scratchDirectory`), a window reload may be needed by users.
- Search index persists to global storage; test Reset Index flows when changing search logic.
