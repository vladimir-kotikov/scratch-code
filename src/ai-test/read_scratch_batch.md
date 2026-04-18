# LM tools testing tasks

## Verify read_scratch batch read feature

The `read_scratch` tool has been upgraded to support reading **multiple files
and multiple line ranges in a single call**. Instead of a single `uri` parameter
it now takes a `reads` array, where each entry specifies a URI and an optional
`lineFrom`/`lineTo` range (both 1-based inclusive, matching line numbers
reported by `get_scratch_outline`).

Your task is to evaluate whether the batch read works correctly, returns
well-labelled output, and whether its description is comprehensive enough for
an agent to use it effectively without trial and error.

---

### Step 1 — Pick two scratches of different types

Use `list_scratches` to browse available scratches. Select **two files** that
differ in structure:

- a Markdown file with multiple sections (headings at different levels)
- a TypeScript or JavaScript file with classes or functions

Record the URI of each chosen file before proceeding.

---

### Step 2 — Get outlines and plan ranges

For each of the two files, call `get_scratch_outline` with the default depth to
learn their structure and exact line numbers.

From the outline, identify:

- For the Markdown file: the line range of one specific section (e.g. a single
  H2 section), and the line of a single-line heading.
- For the code file: the line range of one function or method, and the line
  range of a class or top-level block.

Write down the expected content for each range before making any `read_scratch`
calls.

---

### Step 3 — Test single reads

Call `read_scratch` with a single-item `reads` array to verify the baseline:

1. `{ reads: [{ uri: "<md-file>" }] }` — full Markdown file, no range.
2. `{ reads: [{ uri: "<code-file>", lineFrom: <N>, lineTo: <M> }] }` — one
   function/method range from the code file, using line numbers taken directly
   from `get_scratch_outline` output.

**Correctness checks:**

- [ ] Does the result include the header line `[scratch:///<path>]` (no range
      label for a full read)?
- [ ] Does the result include the header line
      `[scratch:///<path>, lines N-M]` for a ranged read?
- [ ] Does the content match the actual lines in the file?
- [ ] Is `lineFrom` truly inclusive — i.e. line `lineFrom` itself appears in
      the output?
- [ ] Is `lineTo` truly inclusive — i.e. line `lineTo` itself appears in the
      output?
- [ ] Are blank lines inside the range preserved in the output?
- [ ] Does line N from `get_scratch_outline` match the same physical line N
      returned by `read_scratch`?

---

### Step 4 — Test multi-file batch read

Call `read_scratch` with **two items in `reads`** in a single call:

```json
{
  "reads": [
    { "uri": "<md-file>", "lineFrom": <A>, "lineTo": <B> },
    { "uri": "<code-file>", "lineFrom": <C>, "lineTo": <D> }
  ]
}
```

**Correctness checks:**

- [ ] Are both results present in the response?
- [ ] Are the two sections separated by a blank line?
- [ ] Does each section begin with its own `[scratch:///...]` header?
- [ ] Is the content of each section correct and independent of the other?

---

### Step 5 — Test two ranges from the same file

Call `read_scratch` with **two entries pointing to the same file**, each with a
different range:

```json
{
  "reads": [
    { "uri": "<md-file>", "lineFrom": <first-section-start>, "lineTo": <first-section-end> },
    { "uri": "<md-file>", "lineFrom": <second-section-start>, "lineTo": <second-section-end> }
  ]
}
```

**Correctness checks:**

- [ ] Are both ranges present as separate labelled sections?
- [ ] Does each section contain only the lines for its range (no overlap)?

---

### Step 6 — Test edge-case range labels

Using the Markdown file, make calls to verify the range label format:

1. `lineFrom` only (no `lineTo`) — header should say `from line N`.
2. `lineTo` only (no `lineFrom`) — header should say `lines 1-N`.
3. `lineFrom === lineTo` — header should say `line N` (singular, no dash).
4. No range — header should have no range annotation at all.

- [ ] All four label formats match the above.

---

### Step 7 — Usability assessment

After running the above, answer these questions in your report:

1. **Batch value** — Did batching the two-file read reduce the number of tool
   calls compared to calling `read_scratch` twice? Was the saved round-trip
   worth the added input complexity?
2. **Label clarity** — Is the `[scratch:///path, lines N-M]` header format
   unambiguous when multiple sections appear in one response? Would you suggest
   any changes?
3. **Interaction with outline** — How naturally does the 1-based inclusive line
   numbering of `read_scratch` compose with the line numbers reported by
   `get_scratch_outline`? Did you encounter any off-by-one confusion?
4. **When to use** — When would you use a multi-item `reads` call versus
   calling `read_scratch` separately for each file?

---

### Step 8 — Description review

Re-read the tool's `modelDescription`. Assess:

**Comprehensiveness:**

- [ ] Is the `reads` array parameter (and each item's fields) described with
      types, semantics, and defaults?
- [ ] Are `lineFrom` and `lineTo` clearly documented as 1-based and inclusive?
- [ ] Does the description explicitly mention that multiple ranges from the same
      file are supported?
- [ ] Is the output format (labelled sections, blank-line separator) documented?
- [ ] Do the examples cover: full read, range, `lineFrom`-only, `lineTo`-only,
      and batch?

**Redundancy / clarity:**

- [ ] Is any information repeated unnecessarily?
- [ ] Is the description concise enough not to consume excessive token budget?

---

### Step 9 — Write your findings

Produce a short report covering:

1. The two files you chose and why.
2. Step-by-step results: for each test in Steps 3–6, state pass or fail and
   include any unexpected output.
3. Usability answers from Step 7.
4. Description quality verdict from Step 8 — call out missing information or
   suggestions for improvement.
5. An overall pass/fail verdict for the batch read feature.
