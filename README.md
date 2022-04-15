# scratch-code

[![Build](https://github.com/vladimir-kotikov/scratch-code/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/vladimir-kotikov/scratch-code/actions/workflows/build.yml)

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
