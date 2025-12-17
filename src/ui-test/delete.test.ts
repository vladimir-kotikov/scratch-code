import {
  assertTreeOfShape,
  clearScratchTree,
  dismissOpenDialogs,
  getDialogWithText,
  getScratchesView,
  getTreeItem,
  invalidateViewCache,
  makeScratchTree,
} from "./helpers";

const DELETE_NONEMPTY = /Folder is not empty. Delete all of its' contents\?/;

describe("Delete scratches and directories", () => {
  beforeEach(async function () {
    this.timeout(5000);
    this.currentTest?.timeout(5000);
    await dismissOpenDialogs();
    invalidateViewCache();
    await clearScratchTree();
  });

  it("deletes a scratch file", async () => {
    await makeScratchTree(["file1.txt", "file2.txt"]);

    await getScratchesView()
      .then(view => getTreeItem(view, "file1.txt"))
      .then(file => file.openContextMenu())
      .then(menu => menu.select("Delete"));

    await assertTreeOfShape(["file2.txt"]);
  });

  it("deletes a scratch directory", async () => {
    await makeScratchTree(["dir1/file1.txt", "dir1/file2.txt", "file3.txt"]);

    await getScratchesView()
      .then(view => getTreeItem(view, "dir1"))
      .then(dir => dir.openContextMenu())
      .then(menu => menu.select("Delete"));

    await getDialogWithText(DELETE_NONEMPTY).then(dialog => dialog.pushButton("Yes"));

    await assertTreeOfShape(["file3.txt"]);
  });

  it("deletes a nested file", async () => {
    await makeScratchTree(["dir1/file2.txt", "file3.txt"]);

    await getScratchesView()
      .then(view => getTreeItem(view, "dir1/file2.txt"))
      .then(file => file.openContextMenu())
      .then(menu => menu.select("Delete"));

    await assertTreeOfShape(["dir1/", "file3.txt"]);
  });

  it("deletes a nonempty scratch directory", async () => {
    await makeScratchTree(["dir1/subdir1/file1.txt", "dir1/file2.txt", "file3.txt"]);

    await getScratchesView()
      .then(view => getTreeItem(view, "dir1"))
      .then(dir => dir.openContextMenu())
      .then(menu => menu.select("Delete"));

    await getDialogWithText(DELETE_NONEMPTY).then(dialog => dialog.pushButton("Yes"));

    await assertTreeOfShape(["file3.txt"]);
  });
});
