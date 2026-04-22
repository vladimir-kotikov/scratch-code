# LM tools tesing tasks

## Verify search_scratches_tool

There's a new feature has been added to scratches tools that allows you to
search the scratches database efficiently. Can you discover the tool and verify
it works and gives a predictable and usable results with the parameters you
pass to it. Explore the description and try to test as much use cases as
possible.

### Scenario: empty results with a filter

Search for a query that is very unlikely to match anything (e.g. a long random
token like `ZZZZ_NO_MATCH_TOKEN_9999`) while providing a valid filter (e.g. a
path prefix that exists but contains no such text). Verify that:

- The response explicitly mentions the filter value that was used.
- The message clearly states no matches were found rather than returning an
  empty string or generic "No matches found." without context.

### Scenario: invalid glob pattern in filter

Search with a syntactically broken glob in the `filter` parameter (e.g.
`projects/foo/[unclosed` or `**/{bad`). Verify that:

- The tool returns an error or a descriptive failure message.
- The message includes enough detail to understand what went wrong (ideally the
  bad pattern itself and/or the underlying ripgrep error), so the caller can
  correct it without guessing.
