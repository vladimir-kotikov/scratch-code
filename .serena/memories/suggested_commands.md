# Suggested Commands

Common development commands for `scratch-code` extension.

## Install Dependencies

npm install

## Type Check

npm run check-types

## Build (Dev)

node .esbuild.js

## Build (Prod / Package Preparation)

npm run package

# (Runs type check + esbuild with --production)

## Watch Mode (dev inner loop)

npm run watch

# Parallel: esbuild --watch + tsc --watch

## Lint & Format Check

npm run lint

## Apply Formatting & Auto-fixes

npm run fmt

## Run Tests

npm test

## Publish Extension (after package)

# Ensure vsce installed globally or use npx

npx vsce publish

# Or specify version bump explicitly

# npx vsce publish minor

## Rebuild Search Index (inside VS Code)

Command Palette: 'Scratches: Reset Search Index'

## Open Scratch Directory in OS File Browser

Command Palette: 'Scratches: Open directory'

## Create New Scratch From Current Buffer

Command Palette: 'Scratches: New from current buffer'

## Quick Open Scratch

Command Palette: 'Scratches: Quick Open'

## Quick Search Scratches

Command Palette: 'Scratches: Quick Search'
