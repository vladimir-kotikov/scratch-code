# User Preferences & Lessons Learned (2025-11-09)

## User Preferences (Explicit & Inferred)

- Wants feature iterations implemented directly without excessive clarifying questions.
- Prefers per-item Quick Pick buttons instead of global buttons.
- Desires consistent iconography (same pin icon for both pin and unpin states, tooltip differentiates action).
- Expects metadata / internal files (like `.scratch-pins.json`) to be hidden from listings and search.
- Values clean diagnostics: aims to eliminate stale TypeScript and schema warnings.
- Accepts small placeholder stubs (e.g., minimal file to quell compiler) but would likely prefer eventual removal/cleanup.
- Uses watch-based dev loop; relies on quick type-check feedback (`npm run check-types`).
- Appreciates concise progress updates and final validation (tests, lint, build).

## Interaction Style

- Short "Continue" prompts expecting proactive progress.
- Comfortable with incremental polishing (icons, filtering, UX tweaks).
- Focus on tangible outcomes (functional pinning) over theoretical design discussion.

## Lessons Learned / Technical Insights

- VS Code view contributions can require an `icon` to silence schema warnings; adding a simple SVG resolves the issue.
- Stale TS diagnostics may persist in editor even after successful CLI `tsc`; reload or restart TS server to clear.
- `--noEmit` in watch scripts means test runner needs a one-off emit (`tsc -p`) before execution; ensure `out/` exists for tests.
- Quick Pick item-level buttons require constructing a `QuickPick` and handling `onDidTriggerItemButton`; separators must be inserted carefully (buttons not allowed on separators).
- Filtering must be applied consistently across tree, quick open, search, and indexing to hide internal metadata files properly.
- Pin/unpin state management benefits from a file watcher to sync across multiple VS Code windows.
- Using a single icon with tooltip swap simplifies UI consistency and avoids visual jitter.

## Potential Cleanup / Future Enhancements

- Remove or integrate the placeholder `ScratchController` file once confirmed unused.
- De-duplicate `PIN_STORE_FILENAME` constant: import from `pins.ts` everywhere.
- Add tests for PinStore (pin/unpin/rename/remove persistence & watcher reaction).
- Consider distinguishing pinned items in tree with additional decoration (e.g., badge or different color) beyond icon.
- Implement fuzzy search improvements and index pruning (noted TODO in code).

## Risks / Watchouts

- Multiple definitions of the metadata filename could diverge; centralization recommended.
- Reliance on periodic index save; ensure shutdown path always calls `index.saveIndex()`.
- If scratch directory is user-defined and moved, existing pin file might orphan entries; migration logic could be added.
