# Changelog

## [0.7.0]

- Add `get_scratch_outline` LM tool for navigating document structure with line numbers
- Add `edit_scratch` LM tool for granular line-level edits (insert, replace, append) with multi-file batch support; partial failures report succeeded and failed files together rather than aborting
- Enhance `read_scratch` to support batch reading from multiple files with optional line ranges in a single call
- Enhance `write_scratch` to support batch writing to multiple files in a single call
- Adopt `scratch:///` URI scheme consistently across all LM tools

## [0.6.3]

- Hotfix to use bundled ripgrep from VSCode

## [0.6.2]

- No changes, just fixing the build and publishing issues for 0.6.1 release

## [0.6.1]

- Minor improvements for LM tools to resolve ambiguities in parameters usage for agents

## [0.6.0]

- Rewrite of the scratches search - now uses ripgrep, bundled with vscode,
  stateless and index free. All index related functionality is also removed, no
  more indexing issues, index toolbar and messages.
- Add search tool to scratches LM toolkit.

## [0.5.1]

- Scratch LM tools updates: better messages and consistent naming
- Add rename/move LM tool

## [0.5.0]

- Add LM tools for reading and creating scratches to incorporate into Copilot workflows workflows

## [0.4.4]

- Fix loading index on extension start
- Fix handling item buttons clicks in quick pick
- Tree view and quick pick UI polish

## [0.4.3]

- Polish UX further (fix sorting, improve drag and drop, fix quick open matching)

## [0.4.2]

- Minor improvements and UX polish for drag and drop and move/rename operations

## [0.4.1]

- Add proper activity bar icon

## [0.4.0]

- Support for folders

## [0.3.0]

- Complete drag and drop support
- New create scratch dialog with optional suggestions

## [0.2.5]

- Drag and drop support for tree view
- Improved scratch name inference

## [0.2.4]

- Pin scratches in explorer view and quick pick

## [0.2.3]

- Changeable sort order for tree view
- Sort quick pick items by modification time

## [0.2.2]

- Extension icon added

## [0.2.0 - 0.2.1]

- Quick pick and quick search for scratches
- Hotfixes

## [0.1.x]

- Initial release and incremental improvements
