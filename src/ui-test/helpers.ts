import {
  ActivityBar,
  EditorView,
  ILocation,
  InputBox,
  ModalDialog,
  TextEditor,
  TreeItem,
  ViewSection,
  WebElement,
  Workbench,
} from "@redhat-developer/page-objects";
import assert from "assert";
import fs from "fs";
import path from "path";
import { By, until } from "selenium-webdriver";
import { VSBrowser } from "vscode-extension-tester";
import { map, reduce } from "../util/fu";

export const SCRATCHES_DIR =
  ".uitest-temp/settings/User/globalStorage/vlkoti.scratch-code/scratches";

/**
 * Dismisses any open modal dialogs that might be blocking UI interaction.
 */
export const dismissOpenDialogs = async () => {
  try {
    const driver = VSBrowser.instance.driver;
    // Try to find and close any open modal dialogs
    const dialogs = await driver.findElements({ css: ".monaco-dialog-modal-block" });
    if (dialogs.length > 0) {
      // Press Escape to dismiss
      await driver.actions().sendKeys("\uE00C").perform();
      await driver.sleep(200);
    }
  } catch {
    // Ignore if no dialogs found
  }
};

const rsplit = (str: string, sep: string): [string, string] => {
  const idx = str.lastIndexOf(sep);
  if (idx === -1) return ["", str];
  return [str.slice(0, idx), str.slice(idx + sep.length)];
};

/**
 * Collapses all expanded items in a view section to ensure we start with a clean state.
 */
const collapseAll = async (view: ViewSection) => {
  const items = (await view.getVisibleItems()) as TreeItem[];
  for (const item of items) {
    try {
      if (await item.isExpanded()) {
        await item.collapse();
      }
    } catch {
      // Ignore errors - item might not be expandable
    }
  }
};

const getTreeSnapshot = async (
  getItems: () => Promise<TreeItem[]>,
  prefix: string = "",
): Promise<string[]> =>
  getItems()
    .then(
      map(async item => {
        const label = await item.getLabel();
        const isDir = await item.isExpandable();
        if (!isDir) {
          return prefix === "" ? label : path.join(prefix, label);
        }
        const newPrefix = prefix === "" ? label : path.join(prefix, label);
        const children = await getTreeSnapshot(
          () => item.expand().then(() => item.getChildren()),
          newPrefix,
        );
        // Only include the directory entry if it's empty
        return children.length === 0 ? [newPrefix + "/"] : children;
      }),
    )
    .then(promises => Promise.all(promises))
    .then(reduce<string | string[], string[]>((acc, val) => acc.concat(val), []));

export const waitForTreeShape = async (
  expected: string[],
  timeout: number = 5000,
  interval: number = 100,
  view?: ViewSection,
) => {
  const getView = view ? () => Promise.resolve(view) : getScratchesView;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await dismissOpenDialogs();
    try {
      const v = await getView();
      // Collapse all items before getting snapshot to avoid counting expanded children twice
      await collapseAll(v);
      const actual = await getTreeSnapshot(() => v.getVisibleItems() as Promise<TreeItem[]>);
      assert.deepStrictEqual(actual.sort(), expected.sort());
      return;
    } catch {
      await VSBrowser.instance.driver.sleep(interval);
    }
  }
  await dismissOpenDialogs();
  const v = await getView();
  await collapseAll(v);
  const final = await getTreeSnapshot(() => v.getVisibleItems() as Promise<TreeItem[]>);
  assert.deepStrictEqual(
    final.sort(),
    expected.sort(),
    "Scratch tree items do not match expected files",
  );
};

export const assertTreeOfShape = async (expected: string[], timeout: number = 3000) =>
  waitForTreeShape(expected, timeout, 100);

export const assertDefined = <T>(value: T | undefined, message?: string): T => {
  if (value === undefined) {
    throw new Error(message ?? "Expected value to be defined, but received undefined");
  }
  return value;
};

export const assertScratchContent = async (filename: string, expectedContent: string) => {
  const filePath = path.resolve(SCRATCHES_DIR, filename);
  const actualContent = await fs.promises.readFile(filePath, "utf-8");
  assert.strictEqual(
    actualContent,
    expectedContent,
    `Content of scratch file "${filename}" does not match expected`,
  );
};

export const getScratchesView = async () => {
  // Ensure sidebar is visible (some runs hide it after new editor opens)
  await new Workbench().executeCommand("workbench.view.explorer");

  const activityBar = new ActivityBar();
  const scratches = await activityBar
    .getViewControl("Scratches")
    .then(control => assertDefined(control).openView())
    .then(view => view.getContent().getSection("Scratches"))
    .catch(() =>
      // If Scratches view is not found in Explorer, try opening it directly
      activityBar
        .getViewControl("Explorer")
        .then(control => assertDefined(control).openView())
        .then(view => view.getContent().getSection("Scratches")),
    )
    .then(async scratches => {
      await scratches.expand();
      await VSBrowser.instance.driver.wait(
        scratches.isExpanded.bind(scratches),
        500,
        "Scratches section did not expand in time",
      );
      // Brief delay to ensure actions are rendered
      await VSBrowser.instance.driver.sleep(300);
      return scratches;
    });
  return scratches;
};

/**
 * Gets a view action by title and clicks it using JavaScript for reliability.
 * @param view The view section to get the action from.
 * @param title The title of the action to find.
 */
export const callViewAction = async (view: ViewSection, title: string) => {
  const action = await view.getAction(title);
  if (!action) {
    throw new Error(`Action "${title}" not found`);
  }
  // Use JavaScript click for better reliability with action buttons
  await VSBrowser.instance.driver.executeScript("arguments[0].click();", action);
};

/**
 * Gets a tree item in the scratches view by its label, despite nesting
 * and expansion state.
 * @param treeView The scratches view section.
 * @param label The label of the tree item to find,
 *              with '/' as separator for nested items.
 * @returns A promise that resolves to the found tree item.
 */
export const getTreeItem = async (treeView: ViewSection, label: string) => {
  const [pathPart, itemLabel] = rsplit(label, "/");
  const getItem =
    pathPart === ""
      ? treeView.findItem(label)
      : treeView.openItem(...pathPart.split("/")).then(async children => {
          // Can't use find() with async predicate - need to resolve labels first
          for (const child of children) {
            if ((await (child as TreeItem).getLabel()) === itemLabel) {
              return child;
            }
          }
          return undefined;
        });

  return getItem.then(item =>
    assertDefined(item, `Scratch tree item with label "${label}" not found`),
  );
};

/**
 * Opens a tree item by it's label (similar to getTreeItem) in the editor
 * @returns A promise that resolves to the opened editor.
 */
export const openTreeItem = (treeView: ViewSection, label: string) =>
  getTreeItem(treeView, label)
    .then(item => item.click())
    .then(() => new EditorView().openEditor(path.basename(label)) as Promise<TextEditor>);

export const getTreeItems = async (treeView: ViewSection, labels: string[]) => {
  // Get items sequentially to avoid race conditions when expanding same parent folder
  const results: TreeItem[] = [];
  for (const label of labels) {
    results.push((await getTreeItem(treeView, label)) as TreeItem);
  }
  return results;
};

export const getDialogWithText = (match: string | RegExp) =>
  new ModalDialog().wait(500).then(dialog =>
    dialog
      .getText()
      .then(text =>
        match instanceof RegExp ? assert.match(text, match) : assert.strictEqual(text, match),
      )
      .then(() => dialog),
  );

export const closeAllEditors = async () => {
  const getDialog = () => new ModalDialog().wait(100).catch(() => null);
  const closeEditors = async () => {
    try {
      await new EditorView().closeAllEditors();
    } catch {
      await dismissOpenDialogs();
      const dialog = await getDialog();
      if (dialog) {
        await dialog.pushButton("Don't Save");
      }
    }
  };

  await dismissOpenDialogs();
  await closeEditors();

  let dialog;
  while ((dialog = await getDialog())) {
    await dialog.pushButton("Don't Save");
    await dismissOpenDialogs();
    await closeEditors();
  }
};

/**
 * Clears the scratch directory and waits for the tree to update.
 */
export const clearScratchTree = async () => {
  fs.rmSync(SCRATCHES_DIR, { recursive: true, force: true });
  fs.mkdirSync(SCRATCHES_DIR, { recursive: true });
  // Let the file watcher process events, but avoid long fixed sleeps.
  await VSBrowser.instance.driver.sleep(200);
};

export const makeScratchTree = async (files: string[]) => {
  await fs.promises.mkdir(SCRATCHES_DIR, { recursive: true });
  for (const file of files) {
    const [filepath, filename] = rsplit(file, "/");
    const destPath = path.join(SCRATCHES_DIR, filepath);
    await fs.promises.mkdir(destPath, { recursive: true });
    if (filename !== "") {
      // Skip directory-only entries
      await fs.promises.writeFile(path.join(destPath, filename), "");
    }
  }
  // Wait for file watcher to process changes
  await VSBrowser.instance.driver.sleep(300);
};

export const makeUntitledDocument = async (content: string) => {
  const driver = VSBrowser.instance.driver;
  // Use command instead of keystroke to avoid layout side effects
  await new Workbench().executeCommand("workbench.action.files.newUntitledFile");

  // Wait for an editor surface to appear, then create TextEditor
  await driver.wait(until.elementLocated(By.css(".monaco-editor")), 5000);

  // Retry creating TextEditor in case the widget is still mounting
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const editor = new TextEditor();
      await editor.setText(content);
      return editor;
    } catch {
      await driver.sleep(200 + attempt * 50);
    }
  }

  throw new Error("Failed to create TextEditor instance");
};

export const submitInput = async (
  text: string,
  { expect, append }: { expect: string; append?: boolean } = { expect: "" },
) => {
  const input = await InputBox.create(1000);
  assert.equal(await input.getText(), expect, "Input box default value does not match expected");

  // reset the selection, then type the text
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  append ? await input.sendKeys("\uE014" + text) : await input.setText(text);
  await input.confirm();
};

export const dragDrop = (from: WebElement, to: WebElement | ILocation) =>
  VSBrowser.instance.driver.actions().dragAndDrop(from, to).perform();
