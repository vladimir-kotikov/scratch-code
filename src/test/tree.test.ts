import { strict as assert } from "assert";
import { describe, it } from "mocha";
import { ScratchFolder, ScratchTreeProvider } from "../providers/tree";
import { MockFS } from "./mock/fs";

describe("ScratchTreeProvider", () => {
  // it("sorts by most recent mtime", async () => {
  //   const files = {
  //     "a.txt": { mtime: 100 },
  //     "b.txt": { mtime: 300 },
  //     "c.txt": { mtime: 200 },
  //     ".pinstore": { mtime: 0, content: "" },
  //   };
  //   const provider = new ScratchTreeProvider(new MockFS(files));

  //   // Wait for pin store to load
  //   await new Promise(resolve => setTimeout(resolve, 10));

  //   const children = await provider.getChildren();
  //   const names = children.filter(s => s instanceof ScratchFile).map(s => s.uri.path);
  //   assert.deepEqual(names, ["/b.txt", "/c.txt", "/a.txt"]);
  // });

  // it("sorts alphabetically when set", async () => {
  //   const files = {
  //     "b.txt": { mtime: 300 },
  //     "a.txt": { mtime: 100 },
  //     "c.txt": { mtime: 200 },
  //     ".pinstore": { mtime: 0, content: "" },
  //   };
  //   const provider = new ScratchTreeProvider(new MockFS(files));
  //   await new Promise(resolve => setTimeout(resolve, 10));

  //   provider.setSortOrder(SortOrder.Alphabetical);
  //   const children = await provider.getChildren();
  //   const names = children.filter(s => s instanceof ScratchFile).map(s => s.uri.path);
  //   assert.deepEqual(names, ["/a.txt", "/b.txt", "/c.txt"]);
  // });

  // it("ignores .DS_Store, .pinstore and unknown files", async () => {
  //   const files = {
  //     "a.txt": { mtime: 100 },
  //     ".DS_Store": { mtime: 999 },
  //     "b.txt": { mtime: 200 },
  //     ".pinstore": { mtime: 0, content: "" },
  //   };
  //   const provider = new ScratchTreeProvider(new MockFS(files));
  //   await new Promise(resolve => setTimeout(resolve, 10));

  //   const children = await provider.getChildren();
  //   const names = children.filter(s => s instanceof ScratchFile).map(s => s.uri.path);
  //   assert.deepEqual(names, ["/b.txt", "/a.txt"]);
  // });

  // it("cycles sort order with toggle", async () => {
  //   const files = {
  //     "a.txt": { mtime: 1 },
  //     "b.txt": { mtime: 2 },
  //     ".pinstore": { mtime: 0, content: "" },
  //   };
  //   const provider = new ScratchTreeProvider(new MockFS(files));
  //   await new Promise(resolve => setTimeout(resolve, 10));

  //   // Initial: MostRecent
  //   let children = await provider.getChildren();
  //   assert.deepEqual(
  //     children.filter(s => s instanceof ScratchFile).map(s => s.uri.path),
  //     ["/b.txt", "/a.txt"],
  //   );
  //   // Toggle to Alphabetical
  //   provider.setSortOrder((provider.sortOrder + 1) % SortOrderLength);
  //   children = await provider.getChildren();
  //   assert.deepEqual(
  //     children.filter(s => s instanceof ScratchFile).map(s => s.uri.path),
  //     ["/a.txt", "/b.txt"],
  //   );
  //   // Toggle back to MostRecent
  //   provider.setSortOrder((provider.sortOrder + 1) % SortOrderLength);
  //   children = await provider.getChildren();
  //   assert.deepEqual(
  //     children.filter(s => s instanceof ScratchFile).map(s => s.uri.path),
  //     ["/b.txt", "/a.txt"],
  //   );
  // });

  // it("pins items and shows them first", async () => {
  //   const files = {
  //     "a.txt": { mtime: 100 },
  //     "b.txt": { mtime: 300 },
  //     "c.txt": { mtime: 200 },
  //     ".pinstore": { mtime: 0, content: "scratch:/a.txt\n" },
  //   };
  //   const provider = new ScratchTreeProvider(new MockFS(files));
  //   await new Promise(resolve => setTimeout(resolve, 10));

  //   const children = await provider.getChildren();
  //   const names = children.map(s => s.uri.path);
  //   // Pinned items should appear first regardless of mtime
  //   assert.deepEqual(names, ["/a.txt", "/b.txt", "/c.txt"]);
  //   const scratchChildren = children.filter(s => s instanceof ScratchFile);
  //   assert.strictEqual(scratchChildren[0].isPinned, true);
  //   assert.strictEqual(scratchChildren[1].isPinned, false);
  // });

  // it("pinScratch adds item to pinned list", async () => {
  //   const files = {
  //     "a.txt": { mtime: 100 },
  //     "b.txt": { mtime: 200 },
  //     ".pinstore": { mtime: 0, content: "" },
  //   };
  //   const provider = new ScratchTreeProvider(new MockFS(files));
  //   await new Promise(resolve => setTimeout(resolve, 10));

  //   const children = await provider.getChildren();
  //   const scratch = children.find(s => s instanceof ScratchFile && s.uri.path === "/b.txt");
  //   if (scratch instanceof ScratchFile) {
  //     provider.pinScratch(scratch);
  //     await new Promise(resolve => setTimeout(resolve, 10));
  //     const updatedChildren = await provider.getChildren();
  //     const pinnedItem = updatedChildren.find(
  //       s => s instanceof ScratchFile && s.uri.path === "/b.txt",
  //     );
  //     assert.ok(pinnedItem instanceof ScratchFile);
  //     assert.strictEqual(pinnedItem.isPinned, true);
  //   } else {
  //     assert.fail("Scratch file not found");
  //   }
  // });

  // it("unpinScratch removes item from pinned list", async () => {
  //   const files = {
  //     "a.txt": { mtime: 100 },
  //     "b.txt": { mtime: 200 },
  //     ".pinstore": { mtime: 0, content: "scratch:/b.txt\n" },
  //   };
  //   const provider = new ScratchTreeProvider(new MockFS(files));
  //   await new Promise(resolve => setTimeout(resolve, 10));

  //   const children = await provider.getChildren();
  //   const scratch = children.find(s => s instanceof ScratchFile && s.uri.path === "/b.txt");
  //   assert.ok(scratch instanceof ScratchFile);
  //   assert.strictEqual(scratch.isPinned, true);
  //   provider.unpinScratch(scratch);
  //   await new Promise(resolve => setTimeout(resolve, 10));
  //   const updatedChildren = await provider.getChildren();
  //   const unpinnedItem = updatedChildren.find(
  //     s => s instanceof ScratchFile && s.uri.path === "/b.txt",
  //   );
  //   assert.ok(unpinnedItem instanceof ScratchFile);
  //   assert.strictEqual(unpinnedItem.isPinned, false);
  // });

  // it("pinned items maintain their order within pinned group by sort order", async () => {
  //   const files = {
  //     "a.txt": { mtime: 100 },
  //     "b.txt": { mtime: 300 },
  //     "c.txt": { mtime: 200 },
  //     ".pinstore": { mtime: 0, content: "scratch:/a.txt\nscratch:/c.txt\n" },
  //   };
  //   const provider = new ScratchTreeProvider(new MockFS(files));
  //   await new Promise(resolve => setTimeout(resolve, 10));

  //   const children = await provider.getChildren();
  //   const names = children.filter(s => s instanceof ScratchFile).map(s => s.uri.path);
  //   // Pinned items (c, a) sorted by mtime, then unpinned (b)
  //   assert.deepEqual(names, ["/c.txt", "/a.txt", "/b.txt"]);
  // });

  // it("pinned items sort alphabetically within pinned group when sort order is alphabetical", async () => {
  //   const files = {
  //     "z.txt": { mtime: 100 },
  //     "b.txt": { mtime: 300 },
  //     "m.txt": { mtime: 200 },
  //     ".pinstore": { mtime: 0, content: "scratch:/z.txt\nscratch:/m.txt\n" },
  //   };
  //   const provider = new ScratchTreeProvider(new MockFS(files));
  //   await new Promise(resolve => setTimeout(resolve, 10));

  //   provider.setSortOrder(SortOrder.Alphabetical);
  //   const children = await provider.getChildren();
  //   const names = children.filter(s => s instanceof ScratchFile).map(s => s.uri.path);
  //   // Pinned items (m, z) sorted alphabetically, then unpinned (b)
  //   assert.deepEqual(names, ["/m.txt", "/z.txt", "/b.txt"]);
  // });

  it("shows folders and scratches in tree", async () => {
    const files = {
      folderA: { mtime: 1, type: 2 }, // FileType.Directory
      "folderA/file1.txt": { mtime: 2 },
      folderB: { mtime: 3, type: 2 },
      "file2.txt": { mtime: 4 },
      ".pinstore": { mtime: 0, content: "" },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));
    await new Promise(resolve => setTimeout(resolve, 10));

    const children = await provider.getChildren();
    // Should show both folders and files at root
    const labels = children.map(n =>
      n instanceof Object && "toTreeItem" in n ? n.toTreeItem().label : undefined,
    );
    // Folders should be present
    assert(labels.includes("folderA"));
    assert(labels.includes("folderB"));
    assert(labels.includes("file2.txt"));

    // Check children of folderA
    const folderA = children.find(
      n => n instanceof Object && "toTreeItem" in n && n.toTreeItem().label === "folderA",
    );
    assert(folderA, "folderA should be present");
    const folderAChildren = await provider.getChildren(folderA);
    const folderALabels = folderAChildren.map(n =>
      n instanceof Object && "toTreeItem" in n ? n.toTreeItem().label : undefined,
    );
    assert(folderALabels.includes("file1.txt"));
  });

  it("shows empty folders", async () => {
    const files = {
      emptyFolder: { mtime: 1, type: 2 }, // FileType.Directory
      "file.txt": { mtime: 2 },
      ".pinstore": { mtime: 0, content: "" },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));
    await new Promise(resolve => setTimeout(resolve, 10));

    const children = await provider.getChildren();
    const labels = children.map(n =>
      n instanceof Object && "toTreeItem" in n ? n.toTreeItem().label : undefined,
    );
    assert(labels.includes("emptyFolder"));
    assert(labels.includes("file.txt"));

    // Empty folder should have no children
    const emptyFolder = children.find(
      n => n instanceof Object && "toTreeItem" in n && n.toTreeItem().label === "emptyFolder",
    );
    assert(emptyFolder, "emptyFolder should be present");
    const emptyChildren = await provider.getChildren(emptyFolder);
    assert(Array.isArray(emptyChildren) && emptyChildren.length === 0);
  });

  it("shows deeply nested folders and files", async () => {
    const files = {
      root: { mtime: 1, type: 2 },
      "root/level1": { mtime: 2, type: 2 },
      "root/level1/level2": { mtime: 3, type: 2 },
      "root/level1/level2/file.txt": { mtime: 4 },
      ".pinstore": { mtime: 0, content: "" },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));
    await new Promise(resolve => setTimeout(resolve, 10));

    const children = await provider.getChildren();
    const rootFolder = children.find(
      n => n instanceof Object && "toTreeItem" in n && n.toTreeItem().label === "root",
    );
    assert(rootFolder, "root folder should be present");
    const level1 = (await provider.getChildren(rootFolder)).find(
      n => n instanceof Object && "toTreeItem" in n && n.toTreeItem().label === "level1",
    );
    assert(level1, "level1 folder should be present");
    const level2 = (await provider.getChildren(level1)).find(
      n => n instanceof Object && "toTreeItem" in n && n.toTreeItem().label === "level2",
    );
    assert(level2, "level2 folder should be present");
    const level2Children = await provider.getChildren(level2);
    const level2Labels = level2Children.map(n =>
      n instanceof Object && "toTreeItem" in n ? n.toTreeItem().label : undefined,
    );
    assert(level2Labels.includes("file.txt"));
  });

  it("shows folders with only folders inside", async () => {
    const files = {
      parent: { mtime: 1, type: 2 },
      "parent/child1": { mtime: 2, type: 2 },
      "parent/child2": { mtime: 3, type: 2 },
      ".pinstore": { mtime: 0, content: "" },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));
    await new Promise(resolve => setTimeout(resolve, 10));

    const children = await provider.getChildren();
    const parent = children.find(
      n => n instanceof Object && "toTreeItem" in n && n.toTreeItem().label === "parent",
    );
    assert(parent, "parent folder should be present");
    const parentChildren = await provider.getChildren(parent);
    const labels = parentChildren.map(n =>
      n instanceof Object && "toTreeItem" in n ? n.toTreeItem().label : undefined,
    );
    assert(labels.includes("child1"));
    assert(labels.includes("child2"));
  });

  it("shows folders with mixed empty and non-empty subfolders", async () => {
    const files = {
      top: { mtime: 1, type: 2 },
      "top/empty": { mtime: 2, type: 2 },
      "top/nonempty": { mtime: 3, type: 2 },
      "top/nonempty/file.txt": { mtime: 4 },
      ".pinstore": { mtime: 0, content: "" },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));
    await new Promise(resolve => setTimeout(resolve, 10));

    const children = await provider.getChildren();
    const top = children.find(
      n => n instanceof Object && "toTreeItem" in n && n.toTreeItem().label === "top",
    );
    assert(top, "top folder should be present");
    const topChildren = await provider.getChildren(top);
    const labels = topChildren.map(n =>
      n instanceof Object && "toTreeItem" in n ? n.toTreeItem().label : undefined,
    );
    assert(labels.includes("empty"));
    assert(labels.includes("nonempty"));
    // Check empty subfolder
    const empty = topChildren.find(
      n => n instanceof Object && "toTreeItem" in n && n.toTreeItem().label === "empty",
    );
    assert(empty, "empty subfolder should be present");
    const emptyChildren = await provider.getChildren(empty);
    assert(Array.isArray(emptyChildren) && emptyChildren.length === 0);
    // Check non-empty subfolder
    const nonempty = topChildren.find(
      n => n instanceof Object && "toTreeItem" in n && n.toTreeItem().label === "nonempty",
    );
    assert(nonempty, "nonempty subfolder should be present");
    const nonemptyChildren = await provider.getChildren(nonempty);
    const nonemptyLabels = nonemptyChildren.map(n =>
      n instanceof Object && "toTreeItem" in n ? n.toTreeItem().label : undefined,
    );
    assert(nonemptyLabels.includes("file.txt"));
  });

  it("orders folders before files regardless of mtime and pin", async () => {
    const files = {
      // Folders
      folderA: { mtime: 1, type: 2 },
      folderB: { mtime: 9999, type: 2 },
      // Files with varying mtimes
      "a.txt": { mtime: 500 },
      "b.txt": { mtime: 10000 },
      // Pin b.txt to ensure pinned doesn't override folder precedence
      ".pinstore": { mtime: 0, content: "scratch:/b.txt\n" },
    };
    const provider = new ScratchTreeProvider(new MockFS(files));
    await new Promise(resolve => setTimeout(resolve, 10));

    const children = await provider.getChildren();
    // Assert that all folders come before any files
    const firstFileIndex = children.findIndex(n => n instanceof Scratch);
    const lastFolderIndex = children
      .map((n, i) => (n instanceof ScratchFolder ? i : -1))
      .reduce((a, b) => (b > a ? b : a), -1);
    assert.ok(
      firstFileIndex === -1 || lastFolderIndex < firstFileIndex,
      "Folders must precede files",
    );

    // Folders should be sorted alphabetically despite mtime
    const folderOrder = children
      .filter(n => n instanceof ScratchFolder)
      .map(n => (n as ScratchFolder).toTreeItem().label);
    assert.deepEqual(folderOrder, ["folderA", "folderB"], "Folders must be alphabetical");

    // And within files, pinned items should still come first
    const fileOrder = children.filter(n => n instanceof Scratch).map(n => (n as Scratch).uri.path);
    assert.deepEqual(fileOrder, ["/b.txt", "/a.txt"], "Pinned files should precede unpinned files");
  });
});
