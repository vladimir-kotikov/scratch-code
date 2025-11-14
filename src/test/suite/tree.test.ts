import { strict as assert } from "assert";
import { ScratchTreeProvider, SortOrder, SortOrderLength } from "../../providers/tree";
import { MockFS } from "../mock/fs";

describe("ScratchTreeProvider", () => {
  it("sorts by most recent mtime", async () => {
    const files = {
      "a.txt": { mtime: 100 },
      "b.txt": { mtime: 300 },
      "c.txt": { mtime: 200 },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));
    const children = await provider.getChildren();
    const names = children.map((s) => s.uri.path);
    assert.deepEqual(names, ["/b.txt", "/c.txt", "/a.txt"]);
  });

  it("sorts alphabetically when set", async () => {
    const files = {
      "b.txt": { mtime: 300 },
      "a.txt": { mtime: 100 },
      "c.txt": { mtime: 200 },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));
    provider.setSortOrder(SortOrder.Alphabetical);
    const children = await provider.getChildren();
    const names = children.map((s) => s.uri.path);
    assert.deepEqual(names, ["/a.txt", "/b.txt", "/c.txt"]);
  });

  it("ignores .DS_Store and unknown files", async () => {
    const files = {
      "a.txt": { mtime: 100 },
      ".DS_Store": { mtime: 999 },
      "b.txt": { mtime: 200 },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));
    const children = await provider.getChildren();
    const names = children.map((s) => s.uri.path);
    assert.deepEqual(names, ["/b.txt", "/a.txt"]);
  });

  it("cycles sort order with toggle", async () => {
    const files = { "a.txt": { mtime: 1 }, "b.txt": { mtime: 2 } };
    const provider = new ScratchTreeProvider(new MockFS(files));
    // Initial: MostRecent
    let children = await provider.getChildren();
    assert.deepEqual(
      children.map((s) => s.uri.path),
      ["/b.txt", "/a.txt"],
    );
    // Toggle to Alphabetical
    provider.setSortOrder((provider.sortOrder + 1) % SortOrderLength);
    children = await provider.getChildren();
    assert.deepEqual(
      children.map((s) => s.uri.path),
      ["/a.txt", "/b.txt"],
    );
    // Toggle back to MostRecent
    provider.setSortOrder((provider.sortOrder + 1) % SortOrderLength);
    children = await provider.getChildren();
    assert.deepEqual(
      children.map((s) => s.uri.path),
      ["/b.txt", "/a.txt"],
    );
  });
});
