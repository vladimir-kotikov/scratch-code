# LM tools testing tasks

## Verify get_scratch_outline tool

A new `get_scratch_outline` tool has been added to the scratches toolkit. It
uses VS Code's document symbol provider to return a structured, indented
outline of a scratch file — headings for Markdown, classes/methods/functions
for code, etc. — up to a configurable nesting depth (default: 2).

Your task is to evaluate whether the tool works correctly, produces usable
output, and whether its description is comprehensive and non-redundant.

---

### Step 1 — Pick three scratches of different types

Use `list_scratches` to browse the available scratches. Select **three files**
that differ in both file type and content complexity:

- a Markdown file with multiple heading levels and sections
- a TypeScript or JavaScript scratch file with classes or functions
- a JSON or YAML config file (or any other structurally interesting file)

Record the URI of each chosen file before proceeding.

---

### Step 2 — Read each file and build a mental model of its structure

For each of the three files, call `read_scratch` to retrieve its full content.
Manually identify:

- the top-level structural elements (H1 headings, top-level classes/functions,
  root keys, etc.)
- their direct children (H2 headings, class methods, nested sections, etc.)

Write down what you expect the outline to contain at depth=1 and depth=2.

---

### Step 3 — Call get_scratch_outline and compare

For each file, call `get_scratch_outline` with the default depth (omit the
`depth` parameter) and then with `depth: 1`. Compare each result against your
expectations from Step 2:

**Correctness checks:**

- [ ] Are all top-level symbols present in the output?
- [ ] Are their line numbers accurate (1-based, matching the actual file)?
- [ ] Are symbol kinds reported correctly (e.g. `String` for Markdown headings,
      `Class`/`Function`/`Method` for code)?
- [ ] Are symbol names returned verbatim as reported by the language server
      (no post-processing by the extension)?
- [ ] Are line ranges reported correctly? Single-line symbols show `line N`;
      multi-line symbols (e.g. functions, classes) show `lines N-M` where N is
      the first line and M is the last line of the symbol body.
- [ ] With default depth=2: are direct children included and grandchildren
      absent?
- [ ] With depth=1: are children absent?
- [ ] If a file has no symbol provider (e.g. plain `.txt`), does the tool
      return `"No symbols found."` gracefully rather than an error?

---

### Step 4 — Usability assessment

After running the above, answer the following questions in your report:

1. **Granularity** — Is the default depth of 2 a good balance between too
   little and too much information? Would you adjust it for any of the tested
   file types?
2. **Output format** — Is the `Name (Kind, line N)` / `Name (Kind, lines N-M)` +
   indentation format easy to parse and act on? Is anything missing?
3. **When to use** — Can you articulate, based on hands-on experience, when
   you would reach for this tool versus `read_scratch` or `search_scratches`?

---

### Step 5 — Description review

Re-read the tool's `modelDescription` (visible in the tool's metadata). Assess:

**Comprehensiveness:**

- [ ] Are all parameters (`uri`, `depth`) described with their types, defaults,
      and semantics?
- [ ] Are the examples representative of real usage patterns?
- [ ] Is the return value format documented accurately, including the
      `"No symbols found."` case?
- [ ] Are edge cases mentioned (e.g. file with no language server)?

**Redundancy:**

- [ ] Is any information repeated unnecessarily?
- [ ] Are the examples self-evident or do they add genuine value?
- [ ] Is the description appropriately concise for an LM tool (not too long to
      consume token budget)?

---

### Step 6 — Write your findings

Produce a short report covering:

1. The three files you chose and why.
2. A table or bullet list: for each file — expected symbols vs. actual outline
   output, any discrepancies found.
3. Usability answers from Step 4.
4. Description quality verdict from Step 5 — specifically call out any
   missing information or suggestions for improvement.
5. An overall pass/fail verdict for the tool.
