import { strict as assert } from "assert";
import { describe, it } from "mocha";
import { ScratchTreeProvider, SortOrder, SortOrderLength } from "../../providers/tree";
import { MockFS } from "../mock/fs";

describe("ScratchTreeProvider", () => {
  it("sorts by most recent mtime", async () => {
    const files = {
      "a.txt": { mtime: 100 },
      "b.txt": { mtime: 300 },
      "c.txt": { mtime: 200 },
      ".pinstore": { mtime: 0, content: "" },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));

    // Wait for pin store to load
    await new Promise(resolve => setTimeout(resolve, 10));

    const children = await provider.getChildren();
    const names = children.map(s => s.uri.path);
    assert.deepEqual(names, ["/b.txt", "/c.txt", "/a.txt"]);
  });

  it("sorts alphabetically when set", async () => {
    const files = {
      "b.txt": { mtime: 300 },
      "a.txt": { mtime: 100 },
      "c.txt": { mtime: 200 },
      ".pinstore": { mtime: 0, content: "" },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));
    await new Promise(resolve => setTimeout(resolve, 10));

    provider.setSortOrder(SortOrder.Alphabetical);
    const children = await provider.getChildren();
    const names = children.map(s => s.uri.path);
    assert.deepEqual(names, ["/a.txt", "/b.txt", "/c.txt"]);
  });

  it("ignores .DS_Store, .pinstore and unknown files", async () => {
    const files = {
      "a.txt": { mtime: 100 },
      ".DS_Store": { mtime: 999 },
      "b.txt": { mtime: 200 },
      ".pinstore": { mtime: 0, content: "" },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));
    await new Promise(resolve => setTimeout(resolve, 10));

    const children = await provider.getChildren();
    const names = children.map(s => s.uri.path);
    assert.deepEqual(names, ["/b.txt", "/a.txt"]);
  });

  it("cycles sort order with toggle", async () => {
    const files = {
      "a.txt": { mtime: 1 },
      "b.txt": { mtime: 2 },
      ".pinstore": { mtime: 0, content: "" },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));
    await new Promise(resolve => setTimeout(resolve, 10));

    // Initial: MostRecent
    let children = await provider.getChildren();
    assert.deepEqual(
      children.map(s => s.uri.path),
      ["/b.txt", "/a.txt"],
    );
    // Toggle to Alphabetical
    provider.setSortOrder((provider.sortOrder + 1) % SortOrderLength);
    children = await provider.getChildren();
    assert.deepEqual(
      children.map(s => s.uri.path),
      ["/a.txt", "/b.txt"],
    );
    // Toggle back to MostRecent
    provider.setSortOrder((provider.sortOrder + 1) % SortOrderLength);
    children = await provider.getChildren();
    assert.deepEqual(
      children.map(s => s.uri.path),
      ["/b.txt", "/a.txt"],
    );
  });

  it("pins items and shows them first", async () => {
    const files = {
      "a.txt": { mtime: 100 },
      "b.txt": { mtime: 300 },
      "c.txt": { mtime: 200 },
      ".pinstore": { mtime: 0, content: "scratch:/a.txt\n" },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));
    await new Promise(resolve => setTimeout(resolve, 10));

    const children = await provider.getChildren();
    const names = children.map(s => s.uri.path);
    // Pinned items should appear first regardless of mtime
    assert.deepEqual(names, ["/a.txt", "/b.txt", "/c.txt"]);
    assert.strictEqual(children[0].isPinned, true);
    assert.strictEqual(children[1].isPinned, false);
  });

  it("pinScratch adds item to pinned list", async () => {
    const files = {
      "a.txt": { mtime: 100 },
      "b.txt": { mtime: 200 },
      ".pinstore": { mtime: 0, content: "" },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));
    await new Promise(resolve => setTimeout(resolve, 10));

    const children = await provider.getChildren();
    const scratch = children.find(s => s.uri.path === "/b.txt");

    provider.pinScratch(scratch);
    await new Promise(resolve => setTimeout(resolve, 10));

    const updatedChildren = await provider.getChildren();
    const pinnedItem = updatedChildren.find(s => s.uri.path === "/b.txt");
    assert.strictEqual(pinnedItem?.isPinned, true);
  });

  it("unpinScratch removes item from pinned list", async () => {
    const files = {
      "a.txt": { mtime: 100 },
      "b.txt": { mtime: 200 },
      ".pinstore": { mtime: 0, content: "scratch:/b.txt\n" },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));
    await new Promise(resolve => setTimeout(resolve, 10));

    const children = await provider.getChildren();
    const scratch = children.find(s => s.uri.path === "/b.txt");
    assert.strictEqual(scratch?.isPinned, true);

    provider.unpinScratch(scratch);
    await new Promise(resolve => setTimeout(resolve, 10));

    const updatedChildren = await provider.getChildren();
    const unpinnedItem = updatedChildren.find(s => s.uri.path === "/b.txt");
    assert.strictEqual(unpinnedItem?.isPinned, false);
  });

  it("pinned items maintain their order within pinned group by sort order", async () => {
    const files = {
      "a.txt": { mtime: 100 },
      "b.txt": { mtime: 300 },
      "c.txt": { mtime: 200 },
      ".pinstore": { mtime: 0, content: "scratch:/a.txt\nscratch:/c.txt\n" },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));
    await new Promise(resolve => setTimeout(resolve, 10));

    const children = await provider.getChildren();
    const names = children.map(s => s.uri.path);
    // Pinned items (c, a) sorted by mtime, then unpinned (b)
    assert.deepEqual(names, ["/c.txt", "/a.txt", "/b.txt"]);
  });

  it("pinned items sort alphabetically within pinned group when sort order is alphabetical", async () => {
    const files = {
      "z.txt": { mtime: 100 },
      "b.txt": { mtime: 300 },
      "m.txt": { mtime: 200 },
      ".pinstore": { mtime: 0, content: "scratch:/z.txt\nscratch:/m.txt\n" },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));
    await new Promise(resolve => setTimeout(resolve, 10));

    provider.setSortOrder(SortOrder.Alphabetical);
    const children = await provider.getChildren();
    const names = children.map(s => s.uri.path);
    // Pinned items (m, z) sorted alphabetically, then unpinned (b)
    assert.deepEqual(names, ["/m.txt", "/z.txt", "/b.txt"]);
  });

  it("getItem returns scratch with correct pinned status", async () => {
    const files = {
      "a.txt": { mtime: 100 },
      ".pinstore": { mtime: 0, content: "scratch:/a.txt\n" },
    };
    const fs = new MockFS(files);
    const provider = new ScratchTreeProvider(fs);

    // Wait for tree data change which fires when pinstore loads
    await new Promise(resolve => {
      const disposable = provider.onDidChangeTreeData(() => {
        disposable.dispose();
        resolve(undefined);
      });
    });

    // Use proper Uri.parse
    const uri = { scheme: "scratch", path: "/a.txt", toString: () => "scratch:/a.txt" } as any;
    const scratch = provider.getItem(uri);

    assert.strictEqual(scratch?.isPinned, true, "Scratch should be pinned");
    assert.strictEqual(scratch?.uri.path, "/a.txt");
  });

  it("handles undefined uri in getItem", async () => {
    const files = { ".pinstore": { mtime: 0, content: "" } };
    const provider = new ScratchTreeProvider(new MockFS(files));
    await new Promise(resolve => setTimeout(resolve, 10));

    const scratch = provider.getItem(undefined);
    assert.strictEqual(scratch, undefined);
  });
});
