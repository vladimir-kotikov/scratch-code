# LM tools testing tasks

## Verify scratch URI scheme consistency

The scratch extension uses a custom `scratch:` URI scheme. Two serialization
forms exist:

- **`scratch:/path`** — single-slash form; this is what VSCode produces
  internally when serializing `scratch:` URIs (the scheme has no authority
  component, so VSCode omits it).
- **`scratch:///path`** — triple-slash form; conventional for filesystem-like
  URIs (mirrors `file:///`), used in all tool documentation examples. VSCode
  parses this identically to the single-slash form.

Both forms refer to the same file. Your task is to verify that the tools
handle both forms correctly, that URIs round-trip without information loss, and
that tool outputs give you enough information to construct valid URIs.

---

### Step 1 — Observe what list_scratches returns

Call `list_scratches` with no filter. Examine the output carefully:

- [ ] Do the returned paths include a `scratch:` scheme prefix, or are they
      bare relative paths (e.g. `projects/foo/notes.md`)?
- [ ] Do any paths have a leading slash?

Record at least three paths from the output for use in subsequent steps.

---

### Step 2 — Construct URIs and call read_scratch

Using the bare paths from Step 1, construct `scratch:///` URIs by prepending
`scratch:///` (e.g. `projects/foo/notes.md` → `scratch:///projects/foo/notes.md`).

For each of the three paths:

1. Call `read_scratch` with the `scratch:///` URI you constructed.
2. Call `read_scratch` again with the equivalent `scratch:/` URI (single-slash
   form, e.g. `scratch:/projects/foo/notes.md`).

**Correctness checks:**

- [ ] Do both forms return the same file content?
- [ ] Does either form return an error or an empty result?
- [ ] Do line counts match between the two calls for the same file?

---

### Step 3 — Verify filter accepts both URI forms

Choose one path whose parent directory contains at least two files
(e.g. `projects/my-app/`). Call `list_scratches` three times with different
filter representations of the same directory:

1. Bare path prefix: `{ filter: "projects/my-app" }`
2. Triple-slash URI: `{ filter: "scratch:///projects/my-app" }`
3. Single-slash URI: `{ filter: "scratch:/projects/my-app" }`

**Correctness checks:**

- [ ] Do all three calls return the same set of files?
- [ ] If the directory does not exist, does each form return an empty result
      (not an error)?

Repeat the same three-way comparison using `search_scratches` with
`{ query: ".", isRegex: true, filter: <each form> }` to verify the
`search_scratches` filter parameter also accepts both URI forms.

---

### Step 4 — Verify search_scratches output paths

Run `search_scratches` with a broad query (e.g. `{ query: "the" }`) that is
likely to return several matches.

**Correctness checks:**

- [ ] Are match paths in the output shown as bare relative paths
      (e.g. `notes.md:5`) or as raw `scratch:` URIs?
- [ ] Can you take a path from the search output and use it directly with
      `read_scratch` (after prepending `scratch:///`) to open the matched file?
      Verify by calling `read_scratch` on the matched file and confirming the
      matched line is present.

---

### Step 5 — Verify get_scratch_outline accepts both URI forms

Pick one Markdown or code file from Step 1. Call `get_scratch_outline` with:

1. The `scratch:///` URI form.
2. The `scratch:/` URI form.

**Correctness checks:**

- [ ] Do both calls return the same outline?
- [ ] Does either call return an error?

---

### Step 6 — Write your findings

Produce a short report covering:

1. What `list_scratches` actually returns (bare paths / URIs / other).
2. A table: for each tool (`read_scratch`, `list_scratches` filter,
   `search_scratches` filter, `search_scratches` output paths,
   `get_scratch_outline`) — whether `scratch:///`, `scratch:/`, and bare paths
   are accepted or produced correctly.
3. Any discrepancy you found where one form worked and the other did not.
4. An overall pass/fail verdict on URI consistency across the toolset.
