import { strict as assert } from "assert";
import { before, describe, it } from "mocha";
import { FileType } from "vscode";
import { ScratchLmToolkit } from "../providers/lm";
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
});
