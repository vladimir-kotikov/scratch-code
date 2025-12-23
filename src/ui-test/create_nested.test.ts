import { it } from "mocha";
import { Workbench } from "vscode-extension-tester";

import {
  assertTreeOfShape,
  clearScratchTree,
  dismissOpenDialogs,
  getScratchesView,
  getTreeItem,
  makeScratchTree,
  submitInput,
} from "./helpers";

describe("Create scratches and directories", () => {
  beforeEach(async function () {
    this.timeout(5000);
    this.currentTest?.timeout(5000);
    await dismissOpenDialogs();
    await clearScratchTree();
  });

  it("creates nested directory from command palette action", async () => {
    await new Workbench().executeCommand("Scratches: New Folder...");

    await submitInput("some/directory1");

    // Both the parent and nested directory should appear in the tree
    await assertTreeOfShape(["some/directory1/"]);
  });

  it("creates directory from file context menu", async () => {
    await makeScratchTree(["file1.txt"]);

    await getScratchesView()
      .then(scratches => getTreeItem(scratches, "file1.txt"))
      .then(fileItem => fileItem.openContextMenu())
      .then(menu => menu.select("New Folder..."));

    await submitInput("directory2");

    await assertTreeOfShape(["directory2/", "file1.txt"]);
  });

  it("creates directory from directory context menu", async () => {
    await makeScratchTree(["dir1/"]);

    await getScratchesView()
      .then(scratches => getTreeItem(scratches, "dir1"))
      .then(fileItem => fileItem.openContextMenu())
      .then(menu => menu.select("New Folder..."));

    await submitInput("directory2", { expect: "dir1/", append: true });

    await assertTreeOfShape(["dir1/directory2/"]);
  });
});
