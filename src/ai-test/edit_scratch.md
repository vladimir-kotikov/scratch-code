# LM tools testing tasks

## Verify edit_scratch tool

A new `edit_scratch` tool has been added to the scratches toolkit. It applies
granular line-level edits to existing scratch files — insert, replace, and
append — with support for multiple operations per file and multiple files per
call, all in a single round-trip.

> **Important:** All tests in this plan must be performed on **dedicated
> temporary scratch files** that you create yourself before testing begins.
> Do **not** modify any pre-existing scratches. Delete all test files once
> testing is complete.

---

### Step 1 — Create test fixtures

Use `write_scratch` to create the following two scratch files. Record their
exact URIs before proceeding.

**`scratch:///ai-test/edit-test.md`** — content:

```markdown
# Title

## Section A

First paragraph of section A.
Second paragraph of section A.

## Section B

Only line of section B.
```

**`scratch:///ai-test/edit-test.ts`** — content:

```typescript
function greet(name: string): string {
  return `Hello, ${name}!`;
}

function farewell(name: string): string {
  return `Goodbye, ${name}!`;
}
```

Verify both files exist and contain exactly the content above using
`read_scratch` before proceeding.

---

### Step 2 — Baseline: get outlines

Call `get_scratch_outline` on both files. Record the line numbers for:

- `edit-test.md`: `## Section A` (heading line), the last line of section A's
  content, `## Section B`, the last line of section B's content.
- `edit-test.ts`: the first and last line of each function.

These line numbers will anchor all subsequent test calls.

---

### Step 3 — Test: append

Call `edit_scratch` with a single `append` op on `edit-test.md`:

```json
{
  "edits": [
    {
      "uri": "scratch:///ai-test/edit-test.md",
      "edits": [{ "op": "append", "content": "\n## Section C\n\nAdded by append." }]
    }
  ]
}
```

Read the file back and verify:

- [ ] `## Section C` appears after the previous last line.
- [ ] The rest of the file is unchanged.
- [ ] The tool returned `"Edited: ai-test/edit-test.md"`.

---

### Step 4 — Test: insert before a line

Using the line number of `## Section B` from Step 2, insert a new section
before it:

```json
{ "op": "insert", "line": <section-B-line>, "content": "## Inserted Section\n\nInserted content." }
```

Read the file back and verify:

- [ ] `## Inserted Section` now appears immediately before `## Section B`.
- [ ] `## Section B` and its content are still present, shifted down by the
      number of inserted lines.
- [ ] Everything above the insertion point is unchanged.

---

### Step 5 — Test: replace a line range

Using the line numbers for section A's content lines from Step 2, replace
them with new content:

```json
{ "op": "replace", "lineFrom": <first-content-line>, "lineTo": <last-content-line>, "content": "Replaced content line." }
```

Read the file back and verify:

- [ ] The replaced range now contains exactly `"Replaced content line."`.
- [ ] `## Section A` heading is still present on the same line as before.
- [ ] Lines below the replaced range are correct (accounting for any line count
      change).

---

### Step 6 — Test: delete a range (replace with empty content)

Using the current line numbers of `## Inserted Section` and its content line
(from Step 4), delete that entire block by replacing with `""`:

```json
{ "op": "replace", "lineFrom": <inserted-heading-line>, "lineTo": <inserted-content-line>, "content": "" }
```

Read the file back and verify:

- [ ] `## Inserted Section` and its content line are gone.
- [ ] `## Section B` appears where `## Inserted Section` used to be.
- [ ] No other content was affected.

---

### Step 7 — Test: multiple ops on one file in top-to-bottom order

On `edit-test.ts`, apply two replace ops in a single call, listed in natural
top-to-bottom reading order:

```json
{
  "edits": [
    {
      "uri": "scratch:///ai-test/edit-test.ts",
      "edits": [
        { "op": "replace", "lineFrom": 2, "lineTo": 2, "content": "  return `Hi, ${name}!`;" },
        { "op": "replace", "lineFrom": 6, "lineTo": 6, "content": "  return `Bye, ${name}!`;" }
      ]
    }
  ]
}
```

Read the file back and verify:

- [ ] Line 2 contains `return \`Hi, ...`;
- [ ] Line 6 contains `return \`Bye, ...`;
- [ ] All other lines are unchanged.
- [ ] Neither edit shifted the other's target line (i.e. the implementation
      correctly applied ops bottom-to-top internally).

---

### Step 8 — Test: batch edit across two files

In a single call, append a comment to `edit-test.ts` and fix the title of
`edit-test.md` simultaneously:

```json
{
  "edits": [
    {
      "uri": "scratch:///ai-test/edit-test.md",
      "edits": [{ "op": "replace", "lineFrom": 1, "lineTo": 1, "content": "# Updated Title" }]
    },
    {
      "uri": "scratch:///ai-test/edit-test.ts",
      "edits": [{ "op": "append", "content": "\n// end of file" }]
    }
  ]
}
```

Read both files back and verify:

- [ ] `edit-test.md` line 1 is now `# Updated Title`.
- [ ] `edit-test.ts` ends with `// end of file`.
- [ ] Both edits were confirmed in the tool's return value.
- [ ] Each file is otherwise unchanged.

---

### Step 9 — Edge cases: error handling

Using `edit-test.ts` (currently 7 lines after Steps 7–8), verify that the
tool rejects bad inputs rather than silently corrupting the file. After each
call, read the file back to confirm it was **not** modified.

**9a — `insert` at line 0:**

```json
{ "op": "insert", "line": 0, "content": "bad" }
```

- [ ] Tool returns an error mentioning `line must be ≥ 1`.
- [ ] File is unchanged.

**9b — `replace` with inverted range (`lineFrom > lineTo`):**

```json
{ "op": "replace", "lineFrom": 4, "lineTo": 2, "content": "bad" }
```

- [ ] Tool returns an error mentioning `lineFrom` must be ≤ `lineTo`.
- [ ] File is unchanged.

**9c — `replace` with `lineFrom` beyond the file:**

```json
{ "op": "replace", "lineFrom": 99, "lineTo": 100, "content": "bad" }
```

- [ ] Tool returns an error mentioning `lineFrom` exceeds file length.
- [ ] File is unchanged.

**9d — `replace` with `lineTo` beyond the file:**

```json
{ "op": "replace", "lineFrom": 1, "lineTo": 99, "content": "bad" }
```

- [ ] Tool returns an error mentioning `lineTo` exceeds file length.
- [ ] File is unchanged.

**9e — overlapping ops in one call:**

```json
{
  "edits": [
    { "op": "replace", "lineFrom": 2, "lineTo": 4, "content": "A" },
    { "op": "insert", "line": 3, "content": "B" }
  ]
}
```

- [ ] Tool returns an error mentioning overlapping lines.
- [ ] File is unchanged.

**9f — `append` with empty content (no-op):**

```json
{ "op": "append", "content": "" }
```

- [ ] Tool succeeds (no error).
- [ ] File is byte-for-byte identical to before the call (no trailing blank line added).

---

### Step 10 — Cleanup

Delete both test files using the available deletion tool or by overwriting
with empty content, then confirm they no longer appear in `list_scratches`.

---

### Step 11 — Usability assessment

Answer these questions in your report:

1. **Line number confidence** — Were the line numbers from `get_scratch_outline`
   accurate enough to target edits correctly, including after earlier ops
   shifted the file? Did you need to re-read the file to recalibrate at any
   point?
2. **Multi-op ordering** — Was it natural to write ops in top-to-bottom order
   and trust the tool to reorder them? Or did you feel the urge to manually
   calculate adjusted line numbers?
3. **Delete via empty replace** — Was `content: ""` an intuitive way to delete
   a range? Would a dedicated `delete` op be clearer?
4. **Batch value** — Did the two-file batch in Step 8 feel like a genuine
   improvement over two separate calls? Were there any surprises?
5. **Error cases** — Did you encounter any errors? If so, were the messages
   actionable?

---

### Step 12 — Description review

Re-read the tool's `modelDescription`. Assess:

- [ ] Are all three ops (`insert`, `replace`, `append`) and their parameters
      described clearly?
- [ ] Is the bottom-to-top execution order (allowing natural input order)
      documented?
- [ ] Is the delete-via-empty-content pattern mentioned?
- [ ] Are the line number semantics (1-based, physical, matching
      `get_scratch_outline`) stated explicitly?
- [ ] Do the examples cover: insert, replace, delete, append, and multi-file
      batch?
- [ ] Is the "file must already exist" constraint documented?

---

### Step 13 — Write your findings

Produce a short report covering:

1. Whether all steps passed or failed, with any unexpected output.
2. Usability answers from Step 11.
3. Description quality verdict from Step 12.
4. An overall pass/fail verdict for the tool.
