# Pinning Feature Architecture & UX (2025-11-09)

## Overview
Adds pin/unpin capability for scratch files with persistent state shared across windows using the same scratch directory. UI shows pinned items at the top and separates them in Quick Pick and the explorer tree.

## Components

- PinStore (`src/pins.ts`)
  - Persists pinned paths to `.scratch-pins.json` inside the scratch directory.
  - API: `init()`, `dispose()`, `list()`, `isPinned(uri)`, `pin(uri)`, `unpin(uri)`, `rename(oldUri, newUri)`, `remove(uri)`.
  - Emits `onDidChangePins` on state changes; watches the JSON file for external changes.
  - File format: JSON array of string paths (no leading slash).

- PinnedScratchTreeProvider (`src/providers/pinnedTree.ts`)
  - Groups nodes into two virtual sections: `Pinned` and `Others` when any pinned items exist, otherwise shows a flat list.
  - Filters out the metadata file `.scratch-pins.json` from listing.
  - Sort order toggle supported (by name / by creation date).
  - Tree item context values: `scratchPinned` and `scratchUnpinned`.

- ScratchExtension integration (`src/extension.ts`)
  - New members: `pins: PinStore`, `treeDataProvider: PinnedScratchTreeProvider`.
  - Excludes `.scratch-pins.json` from: quick open list, quick search results, and search index build/update.
  - Updates PinStore on rename/delete operations.
  - Commands: `scratches.pinScratch`, `scratches.unpinScratch` (also wired in `src/main.ts`).

## Quick Pick UX

- Quick Open and Quick Search:
  - Per-item inline button with a single pin icon; tooltip toggles between `Pin` and `Unpin` based on state.
  - Pinned entries visually decorated (pin icon + `description: "Pinned"`).
  - Separators `Pinned` and `Others` inserted dynamically when there are pinned items.

## Manifest (package.json)

- Added icons for all commands and menu entries; added a view icon (`media/scratches.svg`).
- Context menu contributions include inline pin/unpin in the tree view using `viewItem == scratchPinned|scratchUnpinned`.

## Notes

- Constant `PIN_STORE_FILENAME` is defined in `pins.ts`; also duplicated in `extension.ts` for convenience—can be de-duplicated later.
- `.scratch-pins.json` is intentionally not indexed nor displayed.

## Validation

- Typecheck and bundling pass; tests pass (8 passing).
- Prettier/ESLint clean after `npm run fmt`.
