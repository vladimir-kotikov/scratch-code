import {
  ActivityBar,
  InputBox,
  ModalDialog,
  TreeItem,
  ViewSection,
} from "@redhat-developer/page-objects";
import assert from "assert";
import fs from "fs";
import path from "path";
import { VSBrowser } from "vscode-extension-tester";
import { map, reduce } from "../util/fu";

export const SCRATCHES_DIR =
  ".uitest-temp/settings/User/globalStorage/vlkoti.scratch-code/scratches";

// Cache for Scratches view to avoid re-fetching in assertions
let _scratchesView: ViewSection | undefined;

/**
 * Invalidates the cached Scratches view. Should be called in beforeEach
 * to ensure each test starts with a fresh view reference.
 */
export const invalidateViewCache = () => {
  _scratchesView = undefined;
};

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
        return [newPrefix + "/", ...children];
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
      const actual = await getView().then(v =>
        getTreeSnapshot(() => v.getVisibleItems() as Promise<TreeItem[]>),
      );
      assert.deepStrictEqual(actual, expected);
      return;
    } catch {
      await VSBrowser.instance.driver.sleep(interval);
    }
  }
  await dismissOpenDialogs();
  const final = await getView().then(v =>
    getTreeSnapshot(() => v.getVisibleItems() as Promise<TreeItem[]>),
  );
  assert.deepStrictEqual(final, expected, "Scratch tree items do not match expected files");
};

export const assertTreeOfShape = async (expected: string[], timeout: number = 3000) =>
  waitForTreeShape(expected, timeout, 100);

export const assertDefined = <T>(value: T | undefined, message?: string): T => {
  if (value === undefined) {
    throw new Error(message ?? "Expected value to be defined, but received undefined");
  }
  return value;
};

export const getScratchesView = async () => {
  if (_scratchesView) {
    return _scratchesView;
  }
  const scratches = await new ActivityBar()
    .getViewControl("Explorer")
    .then(control => assertDefined(control).openView())
    .then(explorer => explorer.getContent().getSection("Scratches"))
    .then(async scratches => {
      await scratches.expand();
      await VSBrowser.instance.driver.wait(
        scratches.isExpanded.bind(scratches),
        300,
        "Scratches section did not expand in time",
      );
      return scratches;
    });
  _scratchesView = scratches;
  return scratches;
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
      : treeView
          .openItem(...pathPart.split("/"))
          .then(async children =>
            children.find(async child => (await (child as TreeItem).getLabel()) === itemLabel),
          );

  return getItem.then(item =>
    assertDefined(item, `Scratch tree item with label "${label}" not found`),
  );
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
