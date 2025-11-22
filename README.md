# scratch-code

[![Build](https://github.com/vladimir-kotikov/scratch-code/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/vladimir-kotikov/scratch-code/actions/workflows/build.yml)
[![VS Code Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/vlkoti.scratch-code?label=VS%20Code%20%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=vlkoti.scratch-code)

Simple extension to maintain a list of scrathes similar to JetBrains IntelliJ scrathes feature. Scratches are simply a text documents, persisted across all workspaces, that are available through a dedicated view panel in explorer view.

## Features

Extension's features include:

- Dedicated scratches panel in explorer view
- Commands to create and delete scratch (look for `Scratches: ...` in `Command + P` menu)

## Extension Settings

The extension doesn't have any settings yet.

## Known Issues

This is an initial release so no issues are known yet :)

## Release Notes

### 0.1.0

Initial release of the extension

### 0.1.1

- Fix extension activation on command

### 0.1.2

- Allow deleting open scratches via command palette
- Fix scratch open command

### 0.1.3

- Allow store scratches in a subfolders of scratch dir
- Fix scratch deletion from command palette

### 0.1.4

- Sort scratches alphabetically
- Move delete command into context menu
- Add rename functionality

### 0.1.5

- Use system fs watcher to detect scratches updates
- Close scratch editor on scratch deletion

### 0.1.6

- Allow setting custom scratches directory

### 0.1.7

- Ignore Mac OS junk files in scratches dir
- Ask for filename when creating new scratch
- Command to create scratch from current document
- Add command to open scratches directory in file browser

### 0.1.8

- Fix extension not starting due to missing dependency

### 0.1.9

- Better suggestions for new scratch filenames based on current document
- Scratches replace untitled buffers they are created from

### 0.2.0

- Quick pick to open scratches
- Quick search for scratches

### 0.2.1

- Hotfixes

### 0.2.2

- Extension icon added

### 0.2.3

- Changeable sort order for tree view
- Sort quick pick items by modification time

### 0.2.4

- Allow pinning scratches in the explorer view and quick pick

## Future plans and fixes

- I want to easily find some past scratchpads, ideally with fuzzy search.
  - TODO: Have a full textsearch across all scratches, ideally with fuzzy matching and ranking by recency.
  - TODO: Have an archive of old scratches, excluded from search and listing by default, but accessible when needed.

Bugs

- FIXME: No delete button in the scratchpad explorer view
