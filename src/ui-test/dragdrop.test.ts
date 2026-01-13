import { By, until } from "selenium-webdriver";
import { TextEditor, VSBrowser } from "vscode-extension-tester";
import {
  assertScratchContent,
  assertTreeOfShape,
  clearScratchTree,
  closeAllEditors,
  dismissOpenDialogs,
  dragDrop,
  getScratchesView,
  getTreeItem,
  getTreeItems,
  makeScratchTree,
  makeUntitledDocument,
  openTreeItem,
  submitInput,
} from "./helpers";

describe("Drag'n'drop in treeview", () => {
  beforeEach(async function () {
    this.timeout(5000);
    this.currentTest?.timeout(10000);
    await dismissOpenDialogs();
    await clearScratchTree();
  });

  it("moved scratch from root to folder", async () => {
    await makeScratchTree(["dir1/file2.txt", "file3.txt"]);

    await getScratchesView()
      .then(view => getTreeItems(view, ["file3.txt", "dir1"]))
      .then(([file3, dir1]) => dragDrop(file3, dir1));

    await assertTreeOfShape(["dir1/file3.txt", "dir1/file2.txt"]);
  });

  it("moves scratch from folder to root", async () => {
    await makeScratchTree(["dir1/file2.txt", "dir1/file3.txt"]);

    await getScratchesView().then(view =>
      getTreeItem(view, "dir1/file3.txt").then(file => dragDrop(file, view)),
    );

    await assertTreeOfShape(["dir1/file2.txt", "file3.txt"]);
  });

  it("moves scratch from folder to folder", async () => {
    await makeScratchTree(["dir1/file2.txt", "dir2/file3.txt"]);

    await getScratchesView()
      .then(view => getTreeItems(view, ["dir1/file2.txt", "dir2"]))
      .then(([file2, dir2]) => dragDrop(file2, dir2));

    await assertTreeOfShape(["dir1/", "dir2/file3.txt", "dir2/file2.txt"]);
  });

  it("moves scratch onto another file's parent", async () => {
    await makeScratchTree(["dir1/file2.txt", "file3.txt"]);

    await getScratchesView().then(view =>
      getTreeItems(view, ["dir1/file2.txt", "file3.txt"]).then(([file2, file3]) =>
        dragDrop(file2, file3),
      ),
    );

    await assertTreeOfShape(["dir1/", "file3.txt", "file2.txt"]);
  });

  it("ignores dropping onto a sibling file", async () => {
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

describe("Drag'n'drop from editor", () => {
  beforeEach(async function () {
    this.timeout(5000);
    this.currentTest?.timeout(10000);
    await closeAllEditors();
    await dismissOpenDialogs();
    await clearScratchTree();
  });

  it("receives an untitled document", async () => {
    await makeScratchTree(["file.txt"]);

    await makeUntitledDocument("Lorem ipsum dolor sit amet")
      .then(doc => doc.getTab())
      .then(tab => getScratchesView().then(view => dragDrop(tab, view)))
      .then(() => submitInput("lorem.txt"));

    await assertTreeOfShape(["file.txt", "lorem.txt"]);
    await assertScratchContent("lorem.txt", "Lorem ipsum dolor sit amet");
  });

  it("receives a saved document", async () => {
    await makeScratchTree(["file.txt"]);

    await VSBrowser.instance
      .openResources("src/ui-test/fixtures/lorem_ipsum.txt")
      .then(async () => {
        const driver = VSBrowser.instance.driver;
        await driver.wait(until.elementLocated(By.css(".monaco-editor")), 5000);
        return new TextEditor().getTab();
      })
      .then(tab => getScratchesView().then(view => dragDrop(tab, view)));

    await assertTreeOfShape(["file.txt", "lorem_ipsum.txt"]);
    await assertScratchContent("lorem_ipsum.txt", "Lorem ipsum dolor sit amet\n");
  });

  it("receives a scratch document", async () => {
    await makeScratchTree(["scratch1.txt", "scratch2.txt"]);

    await getScratchesView().then(view =>
      openTreeItem(view, "scratch1.txt").then(async editor => {
        await editor.setText("This is a scratch file.");
        await editor.save();
        return dragDrop(await editor.getTab(), view);
      }),
    );

    // Drag'n'drop to the same parent (root in this case) is a no-op
    await assertTreeOfShape(["scratch1.txt", "scratch2.txt"]);
    await assertScratchContent("scratch1.txt", "This is a scratch file.");
    await assertScratchContent("scratch2.txt", "");
  });

  it("moves a scratch when dropped onto another parent", async () => {
    await makeScratchTree(["dir1/", "scratch1.txt"]);

    await getScratchesView().then(view =>
      openTreeItem(view, "scratch1.txt").then(async editor => {
        await editor.setText("This is a scratch file.");
        await editor.save();
        const tab = await editor.getTab();
        const dir1 = await getTreeItem(view, "dir1");
        return dragDrop(tab, dir1);
      }),
    );

    await assertTreeOfShape(["dir1/scratch1.txt"]);
    await assertScratchContent("dir1/scratch1.txt", "This is a scratch file.");
  });
});
