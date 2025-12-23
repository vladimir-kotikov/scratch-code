import {
  assertTreeOfShape,
  clearScratchTree,
  dismissOpenDialogs,
  dragDrop,
  getScratchesView,
  getTreeItem,
  getTreeItems,
  makeScratchTree,
} from "./helpers";

describe("Drag'n'drop in treeview", () => {
  beforeEach(async function () {
    this.timeout(5000);
    this.currentTest?.timeout(10000);
    await dismissOpenDialogs();
    await clearScratchTree();
  });

  it("drag and drop from root to folder", async () => {
    await makeScratchTree(["dir1/file2.txt", "file3.txt"]);

    await getScratchesView()
      .then(view => getTreeItems(view, ["file3.txt", "dir1"]))
      .then(([file3, dir1]) => dragDrop(file3, dir1));

    await assertTreeOfShape(["dir1/file3.txt", "dir1/file2.txt"]);
  });

  it("drag and drop from folder to root", async () => {
    await makeScratchTree(["dir1/file2.txt", "dir1/file3.txt"]);

    await getScratchesView().then(view =>
      getTreeItem(view, "dir1/file3.txt").then(file => dragDrop(file, view)),
    );

    await assertTreeOfShape(["dir1/file2.txt", "file3.txt"]);
  });

  it("drag and drop from folder to folder", async () => {
    await makeScratchTree(["dir1/file2.txt", "dir2/file3.txt"]);

    await getScratchesView()
      .then(view => getTreeItems(view, ["dir1/file2.txt", "dir2"]))
      .then(([file2, dir2]) => dragDrop(file2, dir2));

    await assertTreeOfShape(["dir1/", "dir2/file3.txt", "dir2/file2.txt"]);
  });

  it("drag and drop onto another file moves to latter's folder", async () => {
    await makeScratchTree(["dir1/file2.txt", "file3.txt"]);

    await getScratchesView().then(view =>
      getTreeItems(view, ["dir1/file2.txt", "file3.txt"]).then(([file2, file3]) =>
        dragDrop(file2, file3),
      ),
    );

    await assertTreeOfShape(["dir1/", "file3.txt", "file2.txt"]);
  });

  it("drag and drop onto a sibling file", async () => {
    await makeScratchTree(["dir1/file2.txt", "dir1/file3.txt"]);

    await getScratchesView().then(view =>
      getTreeItems(view, ["dir1/file2.txt", "dir1/file3.txt"]).then(([file2, file3]) =>
        dragDrop(file2, file3),
      ),
    );

    await assertTreeOfShape(["dir1/file2.txt", "dir1/file3.txt"]);
  });

  // TODO: Recursive drag and drop is not yet supported
  xit("drag and drop nonempty folder", async () => {
    await makeScratchTree(["dir1/file1.txt", "dir2/file2.txt"]);

    await getScratchesView().then(view =>
      getTreeItems(view, ["dir2", "dir1"]).then(([dir2, dir1]) => dragDrop(dir2, dir1)),
    );

    await assertTreeOfShape(["dir1/file1.txt", "dir1/dir2/file2.txt"]);
  });
});
