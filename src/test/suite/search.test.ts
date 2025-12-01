import { strict as assert } from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FileChangeType, Uri } from "vscode";
import { SearchIndexProvider } from "../../providers/search";
import { MockFS } from "../mock/fs";

function indexFile({ create, content }: { create: boolean; content?: string } = { create: true }) {
  const filePath = path.join(os.tmpdir(), `scratch-index-${Date.now()}.json`);
  if (create && !fs.existsSync(filePath))
    fs.writeFileSync(filePath, content ?? "{}", { flag: "w" });
  return Uri.file(filePath);
}

describe("SearchIndexProvider", () => {
  it("returns empty on search with no files", () => {
    const provider = new SearchIndexProvider(new MockFS({}), indexFile());
    const results = provider.search("anything");
    assert.deepEqual(results, []);
    provider.dispose();
  });

  it("handles missing index file gracefully", () => {
    const provider = new SearchIndexProvider(new MockFS({}), indexFile({ create: false }));
    const results = provider.search("anything");
    assert.deepEqual(results, []);
    provider.dispose();
  });

  it("handles corrupted index file gracefully", () => {
    const provider = new SearchIndexProvider(
      new MockFS({}),
      indexFile({ create: true, content: "some [ inval }} id json" }),
    );
    const results = provider.search("anything");
    assert.deepEqual(results, []);
    provider.dispose();
  });

  it("adds a file via watcher and makes it searchable", async () => {
    const fs = new MockFS({ "foo.txt": { content: "hello world" } });
    const provider = new SearchIndexProvider(fs, indexFile());
    fs.triggerChange({ type: FileChangeType.Created, uri: Uri.parse("foo.txt") });
    await new Promise(r => setTimeout(r, 10));
    const results = provider.search("hello");
    assert.ok(results.some(r => r.path === "foo.txt"));
    provider.dispose();
  });

  it("updates a file via watcher and reflects in search", async () => {
    const fs = new MockFS({ "foo.txt": { content: "hello world" } });
    const provider = new SearchIndexProvider(fs, indexFile());
    fs.triggerChange({ type: FileChangeType.Created, uri: Uri.parse("foo.txt") });
    await new Promise(r => setTimeout(r, 10));
    fs.files["foo.txt"].content = "updated content";
    fs.triggerChange({ type: FileChangeType.Changed, uri: Uri.parse("foo.txt") });
    await new Promise(r => setTimeout(r, 10));
    const results = provider.search("updated");
    assert.ok(results.some(r => r.path === "foo.txt"));
    provider.dispose();
  });

  it("removes a file via watcher and it disappears from search", async () => {
    const fs = new MockFS({ "foo.txt": { content: "hello world" } });
    const provider = new SearchIndexProvider(fs, indexFile());
    fs.triggerChange({ type: FileChangeType.Created, uri: Uri.parse("foo.txt") });
    await new Promise(r => setTimeout(r, 10));
    fs.files = {}; // Remove all files
    fs.triggerChange({ type: FileChangeType.Deleted, uri: Uri.parse("foo.txt") });
    await new Promise(r => setTimeout(r, 10));
    const results = provider.search("hello");
    assert.deepEqual(results, []);
    provider.dispose();
  });

  it("reset clears and reloads all files", async () => {
    const fs = new MockFS({
      "foo.txt": { content: "hello world" },
      "bar.txt": { content: "another test" },
    });
    const provider = new SearchIndexProvider(fs, indexFile());
    await provider.reset();
    const results = provider.search("hello");
    assert.ok(results.some(r => r.path === "foo.txt"));
    provider.dispose();
  });

  it("size returns document count after reset", async () => {
    const fs = new MockFS({
      "foo.txt": { content: "hello world" },
      "bar.txt": { content: "another test" },
    });
    const provider = new SearchIndexProvider(fs, indexFile());
    await provider.reset();
    assert.equal(provider.size(), 2);
    provider.dispose();
  });

  it("save does not throw if nothing changed", async () => {
    const provider = new SearchIndexProvider(new MockFS({}), indexFile());
    assert.doesNotThrow(() => provider.save());
    provider.dispose();
  });

  it("indexes and searches file content (from search.test.ts)", async () => {
    const fs = new MockFS({
      "foo.txt": { content: "hello world" },
      "bar.txt": { content: "another test" },
    });
    const provider = new SearchIndexProvider(fs, indexFile());
    fs.triggerChange({ type: FileChangeType.Created, uri: Uri.parse("foo.txt") });
    fs.triggerChange({ type: FileChangeType.Created, uri: Uri.parse("bar.txt") });
    await new Promise(r => setTimeout(r, 10));
    const results = provider.search("hello");
    assert.ok(results.some(r => r.path === "foo.txt"));
    assert.ok(!results.some(r => r.path === "bar.txt"));
    provider.dispose();
  });

  // The following require public API for adding files to test getFirstMatch, etc.
  // it("getFirstMatch returns snippet for content match (untestable)", ...);
  // it("getFirstMatch returns undefined for no match (untestable)", ...);
});
