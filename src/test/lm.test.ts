import { strict as assert } from "assert";
import { before, describe, it } from "mocha";
import { FileType } from "vscode";
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
        label: "single star extension at root (*.md)",
        filter: "*.md",
        included: ["scratch.md"],
        excluded: ["projects/foo/README.md", "projects/bar/notes.md", "projects/foo/app.ts"],
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
        search: () => Promise.resolve(matches),
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

    it("falls back to full URI when it does not match scratch:/// pattern", async () => {
      const toolkit = makeSearchToolkit([makeMatch("scratch:/short.md", 1, "content")]);
      const result = await toolkit.searchScratches({ query: "content" });
      assert.ok(
        result.includes("scratch:/short.md:1"),
        `expected fallback full URI in:\n${result}`,
      );
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
});
