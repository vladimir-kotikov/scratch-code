import { strict as assert } from "assert";
import * as fsnode from "fs";
import * as os from "os";
import * as path from "path";
import { FileChangeType, FileSystemError, Uri } from "vscode";
import { SearchIndexProvider } from "../../providers/search";
import * as util from "../../util";

function indexFile({ create, content }: { create: boolean; content?: string } = { create: true }) {
  const filePath = path.join(os.tmpdir(), `scratch-index-${Date.now()}.json`);
  if (create && !fsnode.existsSync(filePath))
    fsnode.writeFileSync(filePath, content ?? "{}", { flag: "w" });
  return Uri.file(filePath);
}

type FsOverrides = Partial<{
  readFile: (uri: Uri) => Promise<Uint8Array>;
  writeFile: (...args: unknown[]) => Promise<void>;
  stat: (uri: Uri) => Promise<any>;
  onDidChangeFile: (listener: (e: any[]) => void) => { dispose: () => void };
}>;

function createFs(files: Record<string, string>, overrides: FsOverrides = {}) {
  let listeners: Array<(e: any[]) => void> = [];
  const fileBuffers: Record<string, Buffer> = {};
  for (const [k, v] of Object.entries(files)) fileBuffers[k] = Buffer.from(v);
  const fs = {
    readFile: async (uri: Uri) => {
      const key = uri.path.replace(/^\//, "");
      if (!(key in fileBuffers)) throw FileSystemError.FileNotFound(key);
      const buf = fileBuffers[key];
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    onDidChangeFile: (listener: (e: any[]) => void) => {
      listeners.push(listener);
      return {
        dispose: () => {
          listeners = listeners.filter((l) => l !== listener);
        },
      };
    },
    triggerChange: (event: any) => {
      listeners.forEach((cb) => cb([event]));
    },
    writeFile: async () => {},
    watch: () => ({ dispose: () => {} }),
    stat: async (uri: Uri): Promise<any> => {
      const key = uri.path.replace(/^\//, "");
      if (!(key in fileBuffers)) throw new Error("File not found");
      const buf = fileBuffers[key];
      return {
        type: 1,
        ctime: 0,
        mtime: 0,
        size: buf.length,
      };
    },
    readDirectory: async () => [],
    createDirectory: async () => {},
    delete: async () => {},
    rename: async () => {},
    ...overrides,
    fileBuffers, // expose for test mutation
  };
  return fs;
}

describe("SearchIndexProvider", () => {
  it("returns empty on search with no files", () => {
    const provider = new SearchIndexProvider(createFs({}), indexFile());
    const results = provider.search("anything");
    assert.deepEqual(results, []);
    provider.dispose();
  });

  it("handles missing index file gracefully", () => {
    const provider = new SearchIndexProvider(createFs({}), indexFile({ create: false }));
    const results = provider.search("anything");
    assert.deepEqual(results, []);
    provider.dispose();
  });

  it("handles corrupted index file gracefully", () => {
    const provider = new SearchIndexProvider(
      createFs({}),
      indexFile({ create: true, content: "some [ inval }} id json" }),
    );
    const results = provider.search("anything");
    assert.deepEqual(results, []);
    provider.dispose();
  });

  it("adds a file via watcher and makes it searchable", async () => {
    const fs = createFs({ "foo.txt": "hello world" });
    const provider = new SearchIndexProvider(fs, indexFile());
    fs.triggerChange({ type: FileChangeType.Created, uri: Uri.parse("foo.txt") });
    await new Promise((r) => setTimeout(r, 10));
    const results = provider.search("hello");
    assert.ok(results.some((r) => r.path === "foo.txt"));
    provider.dispose();
  });

  it("updates a file via watcher and reflects in search", async () => {
    const fs = createFs({ "foo.txt": "hello world" });
    const provider = new SearchIndexProvider(fs, indexFile());
    fs.triggerChange({ type: FileChangeType.Created, uri: Uri.parse("foo.txt") });
    await new Promise((r) => setTimeout(r, 10));
    fs.fileBuffers["foo.txt"] = Buffer.from("updated content");
    fs.triggerChange({ type: FileChangeType.Changed, uri: Uri.parse("foo.txt") });
    await new Promise((r) => setTimeout(r, 10));
    const results = provider.search("updated");
    assert.ok(results.some((r) => r.path === "foo.txt"));
    provider.dispose();
  });

  it("removes a file via watcher and it disappears from search", async () => {
    const fs = createFs({ "foo.txt": "hello world" });
    const provider = new SearchIndexProvider(fs, indexFile());
    fs.triggerChange({ type: FileChangeType.Created, uri: Uri.parse("foo.txt") });
    await new Promise((r) => setTimeout(r, 10));
    fs.triggerChange({ type: FileChangeType.Deleted, uri: Uri.parse("foo.txt") });
    await new Promise((r) => setTimeout(r, 10));
    const results = provider.search("hello");
    assert.deepEqual(results, []);
    provider.dispose();
  });

  it("reset clears and reloads all files", async () => {
    const fs = createFs({
      "foo.txt": "hello world",
      "bar.txt": "another test",
    });
    const provider = new SearchIndexProvider(fs, indexFile());
    const uris = [Uri.parse("foo.txt"), Uri.parse("bar.txt")];
    const origReadTree: typeof util.readTree = util.readTree;
    (util as { readTree: typeof util.readTree }).readTree = () => Promise.resolve(uris);
    await provider.reset();
    const results = provider.search("hello");
    assert.ok(results.some((r) => r.path === "foo.txt"));
    (util as { readTree: typeof util.readTree }).readTree = origReadTree;
    provider.dispose();
  });

  it("size returns document count after reset", async () => {
    const fs = createFs({
      "foo.txt": "hello world",
      "bar.txt": "another test",
    });
    const provider = new SearchIndexProvider(fs, indexFile());
    const uris = [Uri.parse("foo.txt"), Uri.parse("bar.txt")];
    const origReadTree: typeof util.readTree = util.readTree;
    (util as { readTree: typeof util.readTree }).readTree = () => Promise.resolve(uris);
    await provider.reset();
    assert.equal(provider.size(), 2);
    (util as { readTree: typeof util.readTree }).readTree = origReadTree;
    provider.dispose();
  });

  it("save does not throw if nothing changed", async () => {
    const provider = new SearchIndexProvider(createFs({}), indexFile());
    assert.doesNotThrow(() => provider.save());
    provider.dispose();
  });

  it("indexes and searches file content (from search.test.ts)", async () => {
    const fs = createFs({
      "foo.txt": "hello world",
      "bar.txt": "another test",
    });
    const provider = new SearchIndexProvider(fs, indexFile());
    fs.triggerChange({ type: FileChangeType.Created, uri: Uri.parse("foo.txt") });
    fs.triggerChange({ type: FileChangeType.Created, uri: Uri.parse("bar.txt") });
    await new Promise((r) => setTimeout(r, 10));
    const results = provider.search("hello");
    assert.ok(results.some((r) => r.path === "foo.txt"));
    assert.ok(!results.some((r) => r.path === "bar.txt"));
    provider.dispose();
  });

  // The following require public API for adding files to test getFirstMatch, etc.
  // it("getFirstMatch returns snippet for content match (untestable)", ...);
  // it("getFirstMatch returns undefined for no match (untestable)", ...);
});
