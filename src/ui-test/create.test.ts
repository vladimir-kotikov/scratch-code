import { it } from "mocha";
import { Workbench } from "vscode-extension-tester";

import {
  assertDefined,
  assertTreeOfShape,
  clearScratchTree,
  dismissOpenDialogs,
  getScratchesView,
  getTreeItem,
  invalidateViewCache,
  makeScratchTree,
  submitInput,
} from "./helpers";

describe("Create scratches and directories", () => {
  beforeEach(async function () {
    this.timeout(5000);
    this.currentTest?.timeout(5000);
    await dismissOpenDialogs();
    invalidateViewCache();
    await clearScratchTree();
  });

  it("creates scratch from welcome content", async () => {
    await getScratchesView()
      .then(view => view.findWelcomeContent())
      .then(welcome =>
        assertDefined(welcome, "Welcome content not found").getButton("Create a new one"),
      )
      .then(button => assertDefined(button, "Create button not found").click());

    await submitInput("file1.txt");

    await assertTreeOfShape(["file1.txt"]);
  });

  it("creates scratch from treeview action", async () => {
    await getScratchesView()
      .then(view => view.getAction("New Scratch..."))
      .then(action => assertDefined(action, "New Scratch action not found").click());

    await submitInput("file2.txt");

    await assertTreeOfShape(["file2.txt"]);
  });

  it("creates scratch from command palette action", async () => {
    await new Workbench().executeCommand("Scratches: New Scratch...");

    await submitInput("file3.txt");

    await assertTreeOfShape(["file3.txt"]);
  });

  it("creates scratch from treeview context menu", async () => {
    await makeScratchTree(["file1.txt"]);

    await getScratchesView()
      .then(view => getTreeItem(view, "file1.txt"))
      .then(file => file.openContextMenu())
      .then(menu => menu.select("New Scratch..."));

    await submitInput("file4.txt");

    await assertTreeOfShape(["file4.txt", "file1.txt"]);
  });

  it("creates directory from command palette action", async () => {
    await new Workbench().executeCommand("Scratches: New Folder...");

    await submitInput("directory1");

    await assertTreeOfShape(["directory1/"]);
  });

  it("creates directory from treeview context menu", async () => {
    await makeScratchTree(["file1.txt"]);

    await getScratchesView()
      .then(view => getTreeItem(view, "file1.txt"))
      .then(file => file.openContextMenu())
      .then(menu => menu.select("New Folder..."));

    await submitInput("directory2");

    await assertTreeOfShape(["directory2/", "file1.txt"]);
  });
});
