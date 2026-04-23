import { strict as assert } from "assert";
import { before, describe, it } from "mocha";
import { FileType, Position, Range, SymbolInformation, SymbolKind, Uri } from "vscode";
import { ScratchLmToolkit } from "../providers/lm";
import { SearchIndexProvider, SearchMatch } from "../providers/search";
import { ScratchTreeProvider } from "../providers/tree";
import { MockFS } from "./mock/fs";

describe("ScratchLmToolkit", () => {
  describe("listScratches", () => {
    // Fixture covers: root-level file, nested dirs, mixed extensions
    const files = {
      "scratch.md": { mtime: 50 },
      projects: { type: FileType.Directory, mtime: 0 },
      "projects/foo": { type: FileType.Directory, mtime: 0 },
      "projects/foo/README.md": { mtime: 100 },
      "projects/foo/app.ts": { mtime: 150 },
      "projects/bar": { type: FileType.Directory, mtime: 0 },
      "projects/bar/notes.md": { mtime: 200 },
      ".pinstore": { mtime: 0, content: "" },
    };

    // All non-hidden files in the fixture
    const ALL = [
      "scratch.md",
      "projects/foo/README.md",
      "projects/foo/app.ts",
      "projects/bar/notes.md",
    ];

    function makeToolkit() {
      const mockFs = new MockFS(files);
      const treeProvider = new ScratchTreeProvider(mockFs);
      // SearchIndexProvider is not exercised by listScratches
      return new ScratchLmToolkit(mockFs, treeProvider, undefined as never);
    }

    type FilterCase = {
      label: string;
      filter?: string;
      included: string[];
      excluded: string[];
    };

    const cases: FilterCase[] = [
      {
        label: "no filter returns all scratches",
        filter: undefined,
        included: ALL,
        excluded: [],
      },
      {
        label: "path prefix with ** (projects/foo/**)",
        filter: "projects/foo/**",
        included: ["projects/foo/README.md", "projects/foo/app.ts"],
        excluded: ["scratch.md", "projects/bar/notes.md"],
      },
      {
        label: "** prefix pattern (**/foo/**)",
        filter: "**/foo/**",
        included: ["projects/foo/README.md", "projects/foo/app.ts"],
        excluded: ["scratch.md", "projects/bar/notes.md"],
      },
      {
        label: "all under directory (projects/**)",
        filter: "projects/**",
        included: ["projects/foo/README.md", "projects/foo/app.ts", "projects/bar/notes.md"],
        excluded: ["scratch.md"],
      },
      {
        label: "single star extension (*.md) matches all .md files recursively",
        filter: "*.md",
        included: ["scratch.md", "projects/foo/README.md", "projects/bar/notes.md"],
        excluded: ["projects/foo/app.ts"],
      },
      {
        label: "recursive extension (**/*.md)",
        filter: "**/*.md",
        included: ["scratch.md", "projects/foo/README.md", "projects/bar/notes.md"],
        excluded: ["projects/foo/app.ts"],
      },
      {
        label: "recursive extension (**/*.ts)",
        filter: "**/*.ts",
        included: ["projects/foo/app.ts"],
        excluded: ["scratch.md", "projects/foo/README.md", "projects/bar/notes.md"],
      },
      {
        label: "single star in path segment (projects/*/README.md)",
        filter: "projects/*/README.md",
        included: ["projects/foo/README.md"],
        excluded: ["scratch.md", "projects/foo/app.ts", "projects/bar/notes.md"],
      },
      {
        label: "exact path match",
        filter: "projects/foo/README.md",
        included: ["projects/foo/README.md"],
        excluded: ["scratch.md", "projects/foo/app.ts", "projects/bar/notes.md"],
      },
      {
        label: "no-match pattern returns empty result",
        filter: "projects/nonexistent/**",
        included: [],
        excluded: ALL,
      },
      // Plain path prefix (no glob metacharacters)
      {
        label: "plain path prefix with trailing slash (projects/foo/)",
        filter: "projects/foo/",
        included: ["projects/foo/README.md", "projects/foo/app.ts"],
        excluded: ["scratch.md", "projects/bar/notes.md"],
      },
      {
        label: "plain path prefix without trailing slash (projects/foo)",
        filter: "projects/foo",
        included: ["projects/foo/README.md", "projects/foo/app.ts"],
        excluded: ["scratch.md", "projects/bar/notes.md"],
      },
      {
        label: "plain path prefix top-level directory (projects/)",
        filter: "projects/",
        included: ["projects/foo/README.md", "projects/foo/app.ts", "projects/bar/notes.md"],
        excluded: ["scratch.md"],
      },
      // scratch:/// URI scheme variants
      {
        label: "scratch:/// URI as plain prefix (scratch:///projects/foo)",
        filter: "scratch:///projects/foo",
        included: ["projects/foo/README.md", "projects/foo/app.ts"],
        excluded: ["scratch.md", "projects/bar/notes.md"],
      },
      {
        label: "scratch:/// URI as glob (scratch:///projects/foo/**)",
        filter: "scratch:///projects/foo/**",
        included: ["projects/foo/README.md", "projects/foo/app.ts"],
        excluded: ["scratch.md", "projects/bar/notes.md"],
      },
      {
        label: "scratch:/// URI as recursive extension glob (scratch:///**/*.md)",
        filter: "scratch:///**/*.md",
        included: ["scratch.md", "projects/foo/README.md", "projects/bar/notes.md"],
        excluded: ["projects/foo/app.ts"],
      },
    ];

    let toolkit: ScratchLmToolkit;

    before(async () => {
      toolkit = makeToolkit();
      // Wait for pin store to load
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    for (const { label, filter, included, excluded } of cases) {
      it(label, async () => {
        const result = await toolkit.listScratches(filter !== undefined ? { filter } : undefined);
        for (const path of included) {
          assert.ok(result.includes(path), `expected "${path}" to be included`);
        }
        for (const path of excluded) {
          assert.ok(!result.includes(path), `expected "${path}" to be excluded`);
        }
      });
    }
  });

  describe("readScratch", () => {
    const CONTENT = "line one\nline two\nline three\nline four\nline five";
    const SPARSE = "first\n\nsecond\n\nthird";
    const URI = "scratch:///notes.md";

    function makeReadToolkit() {
      const mockFs = new MockFS({
        "notes.md": { content: CONTENT },
        "sparse.md": { content: SPARSE },
        ".pinstore": { mtime: 0, content: "" },
      });
      const treeProvider = new ScratchTreeProvider(mockFs);
      return new ScratchLmToolkit(mockFs, treeProvider, undefined as never);
    }

    function makeMultiReadToolkit() {
      const mockFs = new MockFS({
        "notes.md": { content: CONTENT },
        "other.md": { content: "alpha\nbeta\ngamma" },
        ".pinstore": { mtime: 0, content: "" },
      });
      const treeProvider = new ScratchTreeProvider(mockFs);
      return new ScratchLmToolkit(mockFs, treeProvider, undefined as never);
    }

    it("reads the full file when no range given", async () => {
      const toolkit = makeReadToolkit();
      const result = await toolkit.readScratch({ reads: [{ uri: Uri.parse(URI) }] });
      assert.strictEqual(result, `[${URI}]\n${CONTENT}`);
    });

    it("reads from lineFrom to end (1-based inclusive)", async () => {
      const toolkit = makeReadToolkit();
      const result = await toolkit.readScratch({ reads: [{ uri: Uri.parse(URI), lineFrom: 3 }] });
      assert.strictEqual(result, `[${URI}, from line 3]\nline three\nline four\nline five`);
    });

    it("reads from start to lineTo (1-based inclusive)", async () => {
      const toolkit = makeReadToolkit();
      const result = await toolkit.readScratch({ reads: [{ uri: Uri.parse(URI), lineTo: 2 }] });
      assert.strictEqual(result, `[${URI}, lines 1-2]\nline one\nline two`);
    });

    it("reads a specific range with lineFrom and lineTo (1-based inclusive)", async () => {
      const toolkit = makeReadToolkit();
      const result = await toolkit.readScratch({
        reads: [{ uri: Uri.parse(URI), lineFrom: 2, lineTo: 4 }],
      });
      assert.strictEqual(result, `[${URI}, lines 2-4]\nline two\nline three\nline four`);
    });

    it("reads a single line when lineFrom === lineTo", async () => {
      const toolkit = makeReadToolkit();
      const result = await toolkit.readScratch({
        reads: [{ uri: Uri.parse(URI), lineFrom: 3, lineTo: 3 }],
      });
      assert.strictEqual(result, `[${URI}, line 3]\nline three`);
    });

    it("lineFrom=1 lineTo=last returns the full content", async () => {
      const toolkit = makeReadToolkit();
      const result = await toolkit.readScratch({
        reads: [{ uri: Uri.parse(URI), lineFrom: 1, lineTo: 5 }],
      });
      assert.strictEqual(result, `[${URI}, lines 1-5]\n${CONTENT}`);
    });

    it("preserves blank lines — line numbers match physical file lines", async () => {
      const toolkit = makeReadToolkit();
      // SPARSE = "first\n\nsecond\n\nthird" — 5 physical lines (2 blank)
      // line 2 is blank, line 4 is blank
      const result = await toolkit.readScratch({
        reads: [{ uri: Uri.parse("scratch:///sparse.md"), lineFrom: 2, lineTo: 4 }],
      });
      assert.strictEqual(result, "[scratch:///sparse.md, lines 2-4]\n\nsecond\n");
    });

    it("reads multiple files in one batch", async () => {
      const toolkit = makeMultiReadToolkit();
      const result = await toolkit.readScratch({
        reads: [
          { uri: Uri.parse(URI), lineFrom: 1, lineTo: 2 },
          { uri: Uri.parse("scratch:///other.md"), lineFrom: 2 },
        ],
      });
      assert.strictEqual(
        result,
        `[${URI}, lines 1-2]\nline one\nline two\n---\n[scratch:///other.md, from line 2]\nbeta\ngamma`,
      );
    });

    it("reads two ranges from the same file", async () => {
      const toolkit = makeReadToolkit();
      const result = await toolkit.readScratch({
        reads: [
          { uri: Uri.parse(URI), lineFrom: 1, lineTo: 2 },
          { uri: Uri.parse(URI), lineFrom: 4, lineTo: 5 },
        ],
      });
      assert.strictEqual(
        result,
        `[${URI}, lines 1-2]\nline one\nline two\n---\n[${URI}, lines 4-5]\nline four\nline five`,
      );
    });
  });

  describe("editScratch", () => {
    const INITIAL = "line one\nline two\nline three\nline four\nline five";
    const URI = "scratch:///notes.md";

    function makeEditToolkit(content = INITIAL) {
      const mockFs = new MockFS({
        "notes.md": { content },
        ".pinstore": { mtime: 0, content: "" },
      });
      const treeProvider = new ScratchTreeProvider(mockFs);
      const toolkit = new ScratchLmToolkit(mockFs, treeProvider, undefined as never);
      return { toolkit, mockFs };
    }

    async function readBack(mockFs: ReturnType<typeof makeEditToolkit>["mockFs"]) {
      const bytes = await mockFs.readFile(Uri.parse(URI));
      return new TextDecoder().decode(bytes);
    }

    it("appends content to the file", async () => {
      const { toolkit, mockFs } = makeEditToolkit();
      await toolkit.editScratches({
        edits: [{ uri: Uri.parse(URI), edits: [{ op: "append", content: "line six" }] }],
      });
      assert.strictEqual(
        await readBack(mockFs),
        "line one\nline two\nline three\nline four\nline five\nline six",
      );
    });

    it("inserts content before a given line (1-based)", async () => {
      const { toolkit, mockFs } = makeEditToolkit();
      await toolkit.editScratches({
        edits: [{ uri: Uri.parse(URI), edits: [{ op: "insert", line: 2, content: "inserted" }] }],
      });
      assert.strictEqual(
        await readBack(mockFs),
        "line one\ninserted\nline two\nline three\nline four\nline five",
      );
    });

    it("inserts at line length + 1 appends as the new last line", async () => {
      const { toolkit, mockFs } = makeEditToolkit();
      await toolkit.editScratches({
        edits: [{ uri: Uri.parse(URI), edits: [{ op: "insert", line: 6, content: "line six" }] }],
      });
      assert.strictEqual(
        await readBack(mockFs),
        "line one\nline two\nline three\nline four\nline five\nline six",
      );
    });
    it("inserts before line 1 prepends to the file", async () => {
      const { toolkit, mockFs } = makeEditToolkit();
      await toolkit.editScratches({
        edits: [{ uri: Uri.parse(URI), edits: [{ op: "insert", line: 1, content: "header" }] }],
      });
      assert.strictEqual(
        await readBack(mockFs),
        "header\nline one\nline two\nline three\nline four\nline five",
      );
    });

    it("replaces a single line", async () => {
      const { toolkit, mockFs } = makeEditToolkit();
      await toolkit.editScratches({
        edits: [
          {
            uri: Uri.parse(URI),
            edits: [{ op: "replace", lineFrom: 3, lineTo: 3, content: "replaced" }],
          },
        ],
      });
      assert.strictEqual(
        await readBack(mockFs),
        "line one\nline two\nreplaced\nline four\nline five",
      );
    });

    it("replaces a multi-line range", async () => {
      const { toolkit, mockFs } = makeEditToolkit();
      await toolkit.editScratches({
        edits: [
          {
            uri: Uri.parse(URI),
            edits: [{ op: "replace", lineFrom: 2, lineTo: 4, content: "new two\nnew three" }],
          },
        ],
      });
      assert.strictEqual(await readBack(mockFs), "line one\nnew two\nnew three\nline five");
    });

    it("deletes lines when replace content is empty", async () => {
      const { toolkit, mockFs } = makeEditToolkit();
      await toolkit.editScratches({
        edits: [
          { uri: Uri.parse(URI), edits: [{ op: "replace", lineFrom: 2, lineTo: 4, content: "" }] },
        ],
      });
      assert.strictEqual(await readBack(mockFs), "line one\nline five");
    });

    it("applies multiple ops in natural top-to-bottom order without line shift", async () => {
      const { toolkit, mockFs } = makeEditToolkit();
      await toolkit.editScratches({
        edits: [
          {
            uri: Uri.parse(URI),
            edits: [
              { op: "replace", lineFrom: 1, lineTo: 1, content: "ONE" },
              { op: "replace", lineFrom: 3, lineTo: 3, content: "THREE" },
            ],
          },
        ],
      });
      assert.strictEqual(await readBack(mockFs), "ONE\nline two\nTHREE\nline four\nline five");
    });

    it("applies append after all line ops regardless of order", async () => {
      const { toolkit, mockFs } = makeEditToolkit();
      await toolkit.editScratches({
        edits: [
          {
            uri: Uri.parse(URI),
            edits: [
              { op: "append", content: "LAST" },
              { op: "replace", lineFrom: 1, lineTo: 1, content: "FIRST" },
            ],
          },
        ],
      });
      assert.strictEqual(
        await readBack(mockFs),
        "FIRST\nline two\nline three\nline four\nline five\nLAST",
      );
    });

    it("edits two files in a single batch call", async () => {
      const mockFs = new MockFS({
        "notes.md": { content: INITIAL },
        "other.md": { content: "alpha\nbeta" },
        ".pinstore": { mtime: 0, content: "" },
      });
      const treeProvider = new ScratchTreeProvider(mockFs);
      const toolkit = new ScratchLmToolkit(mockFs, treeProvider, undefined as never);

      const result = await toolkit.editScratches({
        edits: [
          {
            uri: Uri.parse(URI),
            edits: [{ op: "replace", lineFrom: 1, lineTo: 1, content: "updated" }],
          },
          { uri: Uri.parse("scratch:///other.md"), edits: [{ op: "append", content: "gamma" }] },
        ],
      });

      assert.ok(result.includes("notes.md"), "result should mention notes.md");
      assert.ok(result.includes("other.md"), "result should mention other.md");
      const notesBytes = await mockFs.readFile(Uri.parse(URI));
      assert.strictEqual(
        new TextDecoder().decode(notesBytes),
        "updated\nline two\nline three\nline four\nline five",
      );
      const otherBytes = await mockFs.readFile(Uri.parse("scratch:///other.md"));
      assert.strictEqual(new TextDecoder().decode(otherBytes), "alpha\nbeta\ngamma");
    });

    it("returns the edited path(s) on success", async () => {
      const { toolkit } = makeEditToolkit();
      const result = await toolkit.editScratches({
        edits: [{ uri: Uri.parse(URI), edits: [{ op: "append", content: "x" }] }],
      });
      assert.strictEqual(result, "Edited: scratch:///notes.md");
    });

    it("reports error when insert line is 0", async () => {
      const { toolkit } = makeEditToolkit();
      const result = await toolkit.editScratches({
        edits: [{ uri: Uri.parse(URI), edits: [{ op: "insert", line: 0, content: "bad" }] }],
      });
      assert.ok(result.includes("line must be ≥ 1"), `unexpected result: ${result}`);
    });

    it("reports error when insert line exceeds file length + 1", async () => {
      const { toolkit } = makeEditToolkit(); // INITIAL has 5 lines
      const result = await toolkit.editScratches({
        edits: [{ uri: Uri.parse(URI), edits: [{ op: "insert", line: 7, content: "bad" }] }],
      });
      assert.ok(result.includes("exceeds file length"), `unexpected result: ${result}`);
    });

    it("inserts after the last line when line equals file length + 1", async () => {
      const { toolkit, mockFs } = makeEditToolkit(); // INITIAL has 5 lines
      await toolkit.editScratches({
        edits: [{ uri: Uri.parse(URI), edits: [{ op: "insert", line: 6, content: "appended" }] }],
      });
      assert.strictEqual(
        await readBack(mockFs),
        "line one\nline two\nline three\nline four\nline five\nappended",
      );
    });

    it("reports error when replace lineFrom is 0", async () => {
      const { toolkit } = makeEditToolkit();
      const result = await toolkit.editScratches({
        edits: [
          {
            uri: Uri.parse(URI),
            edits: [{ op: "replace", lineFrom: 0, lineTo: 1, content: "bad" }],
          },
        ],
      });
      assert.ok(result.includes("lineFrom must be ≥ 1"), `unexpected result: ${result}`);
    });

    it("reports error when replace lineFrom > lineTo", async () => {
      const { toolkit } = makeEditToolkit();
      const result = await toolkit.editScratches({
        edits: [
          {
            uri: Uri.parse(URI),
            edits: [{ op: "replace", lineFrom: 4, lineTo: 2, content: "bad" }],
          },
        ],
      });
      assert.ok(
        result.includes("lineFrom (4) must be ≤ lineTo (2)"),
        `unexpected result: ${result}`,
      );
    });

    it("reports error when replace lineFrom exceeds file length", async () => {
      const { toolkit } = makeEditToolkit();
      const result = await toolkit.editScratches({
        edits: [
          {
            uri: Uri.parse(URI),
            edits: [{ op: "replace", lineFrom: 10, lineTo: 12, content: "bad" }],
          },
        ],
      });
      assert.ok(
        result.includes("lineFrom (10) exceeds file length"),
        `unexpected result: ${result}`,
      );
    });

    it("reports error when replace lineTo exceeds file length", async () => {
      const { toolkit } = makeEditToolkit();
      const result = await toolkit.editScratches({
        edits: [
          {
            uri: Uri.parse(URI),
            edits: [{ op: "replace", lineFrom: 4, lineTo: 9, content: "bad" }],
          },
        ],
      });
      assert.ok(result.includes("lineTo (9) exceeds file length"), `unexpected result: ${result}`);
    });

    it("reports error when two ops target overlapping lines", async () => {
      const { toolkit } = makeEditToolkit();
      const result = await toolkit.editScratches({
        edits: [
          {
            uri: Uri.parse(URI),
            edits: [
              { op: "replace", lineFrom: 2, lineTo: 4, content: "A" },
              { op: "insert", line: 3, content: "B" },
            ],
          },
        ],
      });
      assert.ok(result.includes("overlapping lines"), `unexpected result: ${result}`);
    });

    it("treats append with empty content as a no-op", async () => {
      const { toolkit, mockFs } = makeEditToolkit();
      await toolkit.editScratches({
        edits: [{ uri: Uri.parse(URI), edits: [{ op: "append", content: "" }] }],
      });
      assert.strictEqual(await readBack(mockFs), INITIAL);
    });

    it("returns succeeded and failed paths when one file has invalid ops", async () => {
      const mockFs = new MockFS({
        "notes.md": { content: INITIAL },
        "other.md": { content: "alpha\nbeta" },
        ".pinstore": { mtime: 0, content: "" },
      });
      const treeProvider = new ScratchTreeProvider(mockFs);
      const toolkit = new ScratchLmToolkit(mockFs, treeProvider, undefined as never);

      const result = await toolkit.editScratches({
        edits: [
          { uri: Uri.parse(URI), edits: [{ op: "append", content: "ok" }] },
          {
            uri: Uri.parse("scratch:///other.md"),
            edits: [{ op: "insert", line: 100, content: "bad" }],
          },
        ],
      });

      assert.ok(
        result.includes("Edited:") && result.includes("scratch:///notes.md"),
        `expected success for notes.md in: ${result}`,
      );
      assert.ok(result.includes("Failed:"), `expected failure section in: ${result}`);
      assert.ok(
        result.includes("scratch:///other.md"),
        `expected other.md mentioned in: ${result}`,
      );
      assert.ok(result.includes("exceeds file length"), `expected error detail in: ${result}`);
      const notesBytes = await mockFs.readFile(Uri.parse(URI));
      assert.strictEqual(new TextDecoder().decode(notesBytes), INITIAL + "\nok");
    });
  });

  describe("searchScratches", () => {
    const makeMatch = (
      uri: string,
      line: number,
      content: string,
      context: string[] = [],
    ): SearchMatch => ({ uri, line, content, context, submatches: [] });

    const makeSearchToolkit = (matches: SearchMatch[]) => {
      const mockFs = new MockFS({ ".pinstore": { mtime: 0, content: "" } });
      const treeProvider = new ScratchTreeProvider(mockFs);
      const searchProvider = {
        search: () => Promise.resolve({ matches, truncated: false }),
      } as unknown as SearchIndexProvider;
      return new ScratchLmToolkit(mockFs, treeProvider, searchProvider);
    };

    it("returns 'No matches found.' when the search yields no results", async () => {
      const toolkit = makeSearchToolkit([]);
      const result = await toolkit.searchScratches({ query: "anything" });
      assert.strictEqual(result, "No matches found.");
    });

    it("uses singular 'match' for exactly one result", async () => {
      const toolkit = makeSearchToolkit([makeMatch("scratch:///notes.md", 3, "hello world")]);
      const result = await toolkit.searchScratches({ query: "hello" });
      assert.ok(result.includes("Found 1 match:"), `expected singular 'match', got:\n${result}`);
    });

    it("uses plural 'matches' for more than one result", async () => {
      const toolkit = makeSearchToolkit([
        makeMatch("scratch:///a.md", 1, "hello"),
        makeMatch("scratch:///b.md", 2, "hello again"),
      ]);
      const result = await toolkit.searchScratches({ query: "hello" });
      assert.ok(result.includes("Found 2 matches:"), `expected plural 'matches', got:\n${result}`);
    });

    it("formats each match with path:line prefix", async () => {
      const toolkit = makeSearchToolkit([makeMatch("scratch:///notes/a.md", 7, "hello")]);
      const result = await toolkit.searchScratches({ query: "hello" });
      assert.ok(result.includes("notes/a.md:7"), `expected 'notes/a.md:7' in:\n${result}`);
    });

    it("formats matched content with → prefix", async () => {
      const toolkit = makeSearchToolkit([makeMatch("scratch:///a.md", 1, "the matched line")]);
      const result = await toolkit.searchScratches({ query: "matched" });
      assert.ok(
        result.includes("→ the matched line"),
        `expected '→ the matched line' in:\n${result}`,
      );
    });

    it("indents context lines with two spaces", async () => {
      const toolkit = makeSearchToolkit([
        makeMatch("scratch:///a.md", 5, "hit line", ["context before\n", "context after\n"]),
      ]);
      const result = await toolkit.searchScratches({ query: "hit" });
      assert.ok(result.includes("  context before\n"), `expected indented context in:\n${result}`);
      assert.ok(result.includes("  context after\n"), `expected indented context in:\n${result}`);
    });

    it("extracts path from scratch:/// URI (triple-slash format)", async () => {
      const toolkit = makeSearchToolkit([makeMatch("scratch:///projects/ideas.md", 10, "idea")]);
      const result = await toolkit.searchScratches({ query: "idea" });
      assert.ok(result.includes("projects/ideas.md:10"), `expected extracted path in:\n${result}`);
      assert.ok(!result.includes("scratch:///"), "should not include the raw URI scheme");
    });

    it("handles single-slash scratch:/ URI form in extractPath", async () => {
      const toolkit = makeSearchToolkit([makeMatch("scratch:/short.md", 1, "content")]);
      const result = await toolkit.searchScratches({ query: "content" });
      assert.ok(result.includes("short.md:1"), `expected extracted path in:\n${result}`);
      assert.ok(!result.includes("scratch:/"), "should not include the raw URI scheme");
    });

    it("includes all matches in the output", async () => {
      const toolkit = makeSearchToolkit([
        makeMatch("scratch:///a.md", 1, "first"),
        makeMatch("scratch:///b.md", 2, "second"),
        makeMatch("scratch:///c.md", 3, "third"),
      ]);
      const result = await toolkit.searchScratches({ query: "x" });
      assert.ok(result.includes("a.md:1"), "should include first match");
      assert.ok(result.includes("b.md:2"), "should include second match");
      assert.ok(result.includes("c.md:3"), "should include third match");
    });
  });

  describe("writeScratch", () => {
    function makeWriteToolkit() {
      const mockFs = new MockFS({ ".pinstore": { mtime: 0, content: "" } });
      const treeProvider = new ScratchTreeProvider(mockFs);
      return { toolkit: new ScratchLmToolkit(mockFs, treeProvider, undefined as never), mockFs };
    }

    function makeFailingWriteToolkit(failingPaths: string[]) {
      const mockFs = new MockFS({ ".pinstore": { mtime: 0, content: "" } });
      const original = mockFs.writeFile.bind(mockFs);
      mockFs.writeFile = async (uri, content, options) => {
        const name = uri.path.replace(/^\//, "");
        if (failingPaths.includes(name)) {
          throw new Error(`disk full`);
        }
        return original(uri, content, options);
      };
      const treeProvider = new ScratchTreeProvider(mockFs);
      return { toolkit: new ScratchLmToolkit(mockFs, treeProvider, undefined as never), mockFs };
    }

    it("returns success message when writing a single scratch", async () => {
      const { toolkit } = makeWriteToolkit();
      const result = await toolkit.writeScratches({
        writes: [{ uri: "scratch:///notes.md", content: "Hello world" }],
      });
      assert.strictEqual(result, "Scratches written: scratch:///notes.md");
    });

    it("persists content for a single scratch", async () => {
      const { toolkit, mockFs } = makeWriteToolkit();
      await toolkit.writeScratches({
        writes: [{ uri: "scratch:///notes.md", content: "Hello world" }],
      });
      const bytes = await mockFs.readFile(Uri.parse("scratch:///notes.md"));
      assert.strictEqual(new TextDecoder().decode(bytes), "Hello world");
    });

    it("returns success message when writing multiple scratches", async () => {
      const { toolkit } = makeWriteToolkit();
      const result = await toolkit.writeScratches({
        writes: [
          { uri: "scratch:///a.md", content: "Content A" },
          { uri: "scratch:///b.md", content: "Content B" },
          { uri: "scratch:///c.md", content: "Content C" },
        ],
      });
      assert.strictEqual(
        result,
        "Scratches written: scratch:///a.md, scratch:///b.md, scratch:///c.md",
      );
    });

    it("persists content for all scratches in a batch", async () => {
      const { toolkit, mockFs } = makeWriteToolkit();
      await toolkit.writeScratches({
        writes: [
          { uri: "scratch:///a.md", content: "Content A" },
          { uri: "scratch:///b.md", content: "Content B" },
        ],
      });
      const aBytes = await mockFs.readFile(Uri.parse("scratch:///a.md"));
      const bBytes = await mockFs.readFile(Uri.parse("scratch:///b.md"));
      assert.strictEqual(new TextDecoder().decode(aBytes), "Content A");
      assert.strictEqual(new TextDecoder().decode(bBytes), "Content B");
    });

    it("reports failed scratch URI when all writes fail", async () => {
      const { toolkit } = makeFailingWriteToolkit(["fail.md"]);
      const result = await toolkit.writeScratches({
        writes: [{ uri: "scratch:///fail.md", content: "data" }],
      });
      assert.ok(result.startsWith("Failed:"), `unexpected result: ${result}`);
      assert.ok(result.includes("scratch:///fail.md"), `expected URI in failure report: ${result}`);
    });

    it("reports both succeeded and failed scratches when writes partially fail", async () => {
      const { toolkit, mockFs } = makeFailingWriteToolkit(["fail.md"]);
      const result = await toolkit.writeScratches({
        writes: [
          { uri: "scratch:///ok.md", content: "good" },
          { uri: "scratch:///fail.md", content: "bad" },
        ],
      });
      assert.ok(
        result.includes("Scratches written: scratch:///ok.md"),
        `should mention successful URI: ${result}`,
      );
      assert.ok(result.includes("Failed:"), `should have Failed section: ${result}`);
      assert.ok(result.includes("scratch:///fail.md"), `should mention failed URI: ${result}`);
      // Successful scratch should still have been written
      const bytes = await mockFs.readFile(Uri.parse("scratch:///ok.md"));
      assert.strictEqual(new TextDecoder().decode(bytes), "good");
    });
  });

  describe("getScratchOutline", () => {
    type DocSymbol = {
      name: string;
      detail: string;
      kind: SymbolKind;
      range: Range;
      selectionRange: Range;
      children: DocSymbol[];
    };

    function makeDocSymbol(
      name: string,
      kind: SymbolKind,
      line: number,
      children: DocSymbol[] = [],
    ): DocSymbol {
      const pos = new Position(line - 1, 0);
      const range = new Range(pos, pos);
      return { name, detail: "", kind, range, selectionRange: range, children };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function makeOutlineToolkit(symbols: any[] | undefined) {
      const mockFs = new MockFS({ ".pinstore": { mtime: 0, content: "" } });
      const treeProvider = new ScratchTreeProvider(mockFs);
      const symbolProvider = () => Promise.resolve(symbols);
      return new ScratchLmToolkit(mockFs, treeProvider, undefined as never, symbolProvider, 0);
    }

    it("returns 'No symbols found.' when provider returns empty array", async () => {
      const toolkit = makeOutlineToolkit([]);
      const result = await toolkit.getScratchOutline({ uri: "scratch:///notes.md" });
      assert.ok(result.includes("No symbols found."), `expected 'No symbols found.' in: ${result}`);
    });

    it("returns 'No symbols found.' when provider returns undefined", async () => {
      const toolkit = makeOutlineToolkit(undefined);
      const result = await toolkit.getScratchOutline({ uri: "scratch:///notes.md" });
      assert.ok(result.includes("No symbols found."), `expected 'No symbols found.' in: ${result}`);
    });

    it("includes file metadata header (line count, size, modified time)", async () => {
      const mockFs = new MockFS({
        ".pinstore": { mtime: 0, content: "" },
        "notes.md": { mtime: 1745232600000, content: "# Title\n\n## Section A\nContent here." },
      });
      const treeProvider = new ScratchTreeProvider(mockFs);
      const symbolProvider = () => Promise.resolve([makeDocSymbol("Title", SymbolKind.String, 1)]);
      const toolkit = new ScratchLmToolkit(
        mockFs,
        treeProvider,
        undefined as never,
        symbolProvider,
        0,
      );
      const result = await toolkit.getScratchOutline({ uri: "scratch:///notes.md" });
      assert.ok(result.includes("4 lines"), `expected '4 lines' in header: ${result}`);
      assert.ok(result.includes("B,"), `expected size in header: ${result}`);
      assert.ok(result.includes("modified "), `expected modification time in header: ${result}`);
      assert.ok(result.includes("UTC"), `expected UTC suffix in header: ${result}`);
      assert.ok(result.includes("\nTitle"), `expected symbol after header: ${result}`);
    });

    it("retries once when first call returns empty (cold-start)", async () => {
      let callCount = 0;
      const mockFs = new MockFS({ ".pinstore": { mtime: 0, content: "" } });
      const treeProvider = new ScratchTreeProvider(mockFs);
      const symbolProvider = () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve([]);
        }
        return Promise.resolve([makeDocSymbol("Architecture", SymbolKind.String, 1)]);
      };
      const toolkit = new ScratchLmToolkit(
        mockFs,
        treeProvider,
        undefined as never,
        symbolProvider,
        0,
      );
      const result = await toolkit.getScratchOutline({ uri: "scratch:///notes.md" });
      assert.strictEqual(callCount, 2, "should have called the provider twice");
      assert.ok(result.includes("Architecture"), `expected symbol after retry: ${result}`);
    });

    it("returns 'No symbols found.' when retry also returns empty", async () => {
      let callCount = 0;
      const mockFs = new MockFS({ ".pinstore": { mtime: 0, content: "" } });
      const treeProvider = new ScratchTreeProvider(mockFs);
      const symbolProvider = () => {
        callCount++;
        return Promise.resolve([]);
      };
      const toolkit = new ScratchLmToolkit(
        mockFs,
        treeProvider,
        undefined as never,
        symbolProvider,
        0,
      );
      const result = await toolkit.getScratchOutline({ uri: "scratch:///notes.md" });
      assert.strictEqual(callCount, 2, "should have retried exactly once");
      assert.ok(result.includes("No symbols found."), `expected 'No symbols found.' in: ${result}`);
    });

    it("formats top-level DocumentSymbol with name, kind and 1-based line number", async () => {
      const toolkit = makeOutlineToolkit([makeDocSymbol("Introduction", SymbolKind.String, 1)]);
      const result = await toolkit.getScratchOutline({ uri: "scratch:///notes.md" });
      assert.ok(result.includes("Introduction"), `expected name in: ${result}`);
      assert.ok(result.includes("String"), `expected kind in: ${result}`);
      assert.ok(result.includes("line 1"), `expected line number in: ${result}`);
    });

    it("lists multiple top-level symbols", async () => {
      const toolkit = makeOutlineToolkit([
        makeDocSymbol("ClassA", SymbolKind.Class, 1),
        makeDocSymbol("ClassB", SymbolKind.Class, 10),
      ]);
      const result = await toolkit.getScratchOutline({ uri: "scratch:///code.ts" });
      assert.ok(result.includes("ClassA"), "should include ClassA");
      assert.ok(result.includes("ClassB"), "should include ClassB");
    });

    it("indents children by two spaces per level", async () => {
      const child = makeDocSymbol("Background", SymbolKind.String, 3);
      const parent = makeDocSymbol("Introduction", SymbolKind.String, 1, [child]);
      const toolkit = makeOutlineToolkit([parent]);
      const result = await toolkit.getScratchOutline({ uri: "scratch:///notes.md" });
      assert.ok(result.includes("Introduction"), "should include parent");
      assert.ok(result.includes("  Background"), "should indent child with 2 spaces");
      assert.ok(!result.includes("    Background"), "should not over-indent child");
    });

    it("defaults to depth=2 (top-level + direct children)", async () => {
      const grandchild = makeDocSymbol("Detail", SymbolKind.String, 5);
      const child = makeDocSymbol("Background", SymbolKind.String, 3, [grandchild]);
      const parent = makeDocSymbol("Introduction", SymbolKind.String, 1, [child]);
      const toolkit = makeOutlineToolkit([parent]);
      const result = await toolkit.getScratchOutline({ uri: "scratch:///notes.md" });
      assert.ok(result.includes("Introduction"), "should include level 1");
      assert.ok(result.includes("  Background"), "should include level 2");
      assert.ok(!result.includes("    Detail"), "should NOT include level 3 with default depth=2");
    });

    it("respects depth=1 (top-level only)", async () => {
      const child = makeDocSymbol("Background", SymbolKind.String, 3);
      const parent = makeDocSymbol("Introduction", SymbolKind.String, 1, [child]);
      const toolkit = makeOutlineToolkit([parent]);
      const result = await toolkit.getScratchOutline({ uri: "scratch:///notes.md", depth: 1 });
      assert.ok(result.includes("Introduction"), "should include top-level");
      assert.ok(!result.includes("Background"), "should exclude children with depth=1");
    });

    it("respects depth=3 (three levels deep)", async () => {
      const grandchild = makeDocSymbol("Detail", SymbolKind.String, 5);
      const child = makeDocSymbol("Background", SymbolKind.String, 3, [grandchild]);
      const parent = makeDocSymbol("Introduction", SymbolKind.String, 1, [child]);
      const toolkit = makeOutlineToolkit([parent]);
      const result = await toolkit.getScratchOutline({ uri: "scratch:///notes.md", depth: 3 });
      assert.ok(result.includes("Introduction"), "should include level 1");
      assert.ok(result.includes("  Background"), "should include level 2");
      assert.ok(result.includes("    Detail"), "should include level 3 with depth=3");
    });

    it("shows 'lines N-M' for multi-line DocumentSymbol", async () => {
      const sym = {
        name: "MyFunc",
        detail: "",
        kind: SymbolKind.Function,
        range: new Range(new Position(4, 0), new Position(9, 0)),
        selectionRange: new Range(new Position(4, 0), new Position(4, 0)),
        children: [],
      };
      const toolkit = makeOutlineToolkit([sym]);
      const result = await toolkit.getScratchOutline({ uri: "scratch:///code.ts" });
      assert.ok(result.includes("lines 5-10"), `expected line range in: ${result}`);
    });

    it("does not crash when DocumentSymbol children is undefined", async () => {
      // Simulate a language server returning a DocumentSymbol without a children array
      const badSymbol = {
        name: "Orphan",
        detail: "",
        kind: SymbolKind.Function,
        range: new Range(new Position(0, 0), new Position(0, 0)),
        selectionRange: new Range(new Position(0, 0), new Position(0, 0)),
        children: undefined as unknown as [],
      };
      const toolkit = makeOutlineToolkit([badSymbol]);
      const result = await toolkit.getScratchOutline({ uri: "scratch:///code.ts" });
      assert.ok(result.includes("Orphan"), `should still output symbol name: ${result}`);
    });

    it("handles SymbolInformation (flat list) without crashing", async () => {
      const symInfo = {
        name: "MyClass",
        kind: SymbolKind.Class,
        location: { uri: Uri.parse("scratch:///code.ts"), range: new Range(4, 0, 4, 0) },
        containerName: "",
      };
      const toolkit = makeOutlineToolkit([symInfo]);
      const result = await toolkit.getScratchOutline({ uri: "scratch:///code.ts" });
      assert.ok(result.includes("MyClass"), `expected name in: ${result}`);
      assert.ok(result.includes("Class"), `expected kind in: ${result}`);
      assert.ok(result.includes("line 5"), `expected 1-based line in: ${result}`);
    });

    it("filters SymbolInformation by depth=1 (top-level only via containerName)", async () => {
      const h1: SymbolInformation = {
        name: "Architecture",
        kind: SymbolKind.String,
        containerName: "",
        location: { uri: Uri.parse("scratch:///notes.md"), range: new Range(0, 0, 0, 0) },
        tags: [],
      };
      const h2: SymbolInformation = {
        name: "Overview",
        kind: SymbolKind.String,
        containerName: "Architecture",
        location: { uri: Uri.parse("scratch:///notes.md"), range: new Range(2, 0, 2, 0) },
        tags: [],
      };
      const toolkit = makeOutlineToolkit([h1, h2]);
      const result = await toolkit.getScratchOutline({ uri: "scratch:///notes.md", depth: 1 });
      assert.ok(result.includes("Architecture"), "should include top-level symbol");
      assert.ok(!result.includes("Overview"), "should exclude child symbol with depth=1");
    });

    it("includes SymbolInformation children at depth=2 (default)", async () => {
      const h1: SymbolInformation = {
        name: "Architecture",
        kind: SymbolKind.String,
        containerName: "",
        location: { uri: Uri.parse("scratch:///notes.md"), range: new Range(0, 0, 0, 0) },
        tags: [],
      };
      const h2: SymbolInformation = {
        name: "Overview",
        kind: SymbolKind.String,
        containerName: "Architecture",
        location: { uri: Uri.parse("scratch:///notes.md"), range: new Range(2, 0, 2, 0) },
        tags: [],
      };
      const toolkit = makeOutlineToolkit([h1, h2]);
      const result = await toolkit.getScratchOutline({ uri: "scratch:///notes.md" });
      assert.ok(result.includes("Architecture"), "should include top-level symbol");
      assert.ok(result.includes("Overview"), "should include child symbol at default depth=2");
    });
  });
});
