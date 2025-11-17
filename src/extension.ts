import langMap from "lang-map";
import * as path from "path";
import * as vscode from "vscode";
import { Disposable, FileSystemError, Uri } from "vscode";
import { call, map, pass } from "./fu";
import { ScratchFileSystemProvider } from "./providers/fs";
import { SearchIndexProvider } from "./providers/search";
import { Scratch, ScratchTreeProvider, SortOrder, SortOrderLength } from "./providers/tree";
import { DisposableContainer } from "./util";
export { SortOrder } from "./providers/tree";

const extOverrides: Record<string, string> = {
  makefile: "",
  ignore: "",
  plaintext: "",
};

const stripChars = (str: string, chars: string): string => {
  let start = 0;
  let end = str.length;

  const charSet = new Set(chars.split(""));

  while (start < end && charSet.has(str[start])) {
    ++start;
  }

  while (end > start && charSet.has(str[end - 1])) {
    --end;
  }

  return start > 0 || end < str.length ? str.substring(start, end) : str;
};

const getFirstChars = (n: number, doc: vscode.TextDocument): string => {
  let lineNo = 0;
  let result = "";

  while (lineNo < doc.lineCount && result.length < n) {
    const lineText = doc
      .lineAt(lineNo)
      .text.trim()
      .slice(0, n - result.length);
    result += stripChars(lineText.replace(/[^a-zA-Z0-9_]/g, "_"), "_");
    lineNo++;
  }

  return result.slice(0, n);
};

const selectAll = (editor: vscode.TextEditor): void => {
  const doc = editor?.document;
  if (!doc) {
    return;
  }

  editor.selection = new vscode.Selection(
    0,
    0,
    doc.lineCount,
    doc.lineAt(doc.lineCount - 1).text.length,
  );
};

const inferExtension = (doc: vscode.TextDocument): string =>
  doc.isUntitled
    ? (extOverrides[doc.languageId] ?? langMap.extensions(doc.languageId)[0])
    : path.extname(doc.fileName);

export const inferFilename = (doc: vscode.TextDocument): string => {
  // The heuristic to infer a filename is:
  // - if the document has a file name, use that
  // - if no filename
  //   - use the content's first lines for filename, cleaned up
  //     to be a valid filename
  //   - if content is empty, use "scratch-<current_datetime_iso>" as the base name
  if (!doc.isUntitled) {
    return path.basename(doc.fileName, path.extname(doc.fileName));
  }

  let baseName = getFirstChars(30, doc);
  if (baseName.length === 0) {
    const formattedDate = new Date()
      .toISOString()
      .replace(/:/g, "-")
      .replace("T", "_")
      .split(".")[0];
    baseName = `scratch-${formattedDate}`;
  }

  return baseName;
};

function currentScratchUri(): Uri | undefined {
  const maybeUri = vscode.window.activeTextEditor?.document.uri;
  return maybeUri?.scheme === "scratch" ? maybeUri : undefined;
}

// TODO: Check and handle corner cases:
// - delay updating the index in watcher events until the index is loaded/populated
// - check the index validity when loading from disk and prune missing entries

export class ScratchExtension extends DisposableContainer implements Disposable {
  readonly fileSystemProvider: ScratchFileSystemProvider;
  readonly treeDataProvider: ScratchTreeProvider;

  private searchWidget: vscode.QuickPick<vscode.QuickPickItem & { uri: vscode.Uri }>;
  private index: SearchIndexProvider;

  constructor(
    private readonly scratchDir: Uri,
    private readonly storageDir: vscode.Uri,
    private readonly globalState: vscode.Memento,
  ) {
    super();

    [scratchDir, storageDir].forEach(vscode.workspace.fs.createDirectory);

    this.fileSystemProvider = this.disposeLater(new ScratchFileSystemProvider(this.scratchDir));

    this.disposeLater(
      // start watcher so other components can rely on it being active
      this.fileSystemProvider.watch(ScratchFileSystemProvider.ROOT, {
        recursive: true,
      }),
    );

    this.treeDataProvider = this.disposeLater(
      new ScratchTreeProvider(
        this.fileSystemProvider,
        this.globalState.get("sortOrder", SortOrder.MostRecent),
      ),
    );

    this.index = this.disposeLater(
      new SearchIndexProvider(
        this.fileSystemProvider,
        Uri.joinPath(this.storageDir, "searchIndex.json"),
      ),
    );

    this.searchWidget = this.disposeLater(
      vscode.window.createQuickPick<vscode.QuickPickItem & { uri: vscode.Uri }>(),
    );
    this.searchWidget.placeholder = "Search scratches...";
    this.searchWidget.busy = true;
    this.searchWidget.matchOnDescription = true;
    this.searchWidget.matchOnDetail = true;

    this.index
      .load()
      .then(pass, (err) => {
        vscode.window.showWarningMessage(
          `Failed to load scratches search index: ${err}. Rebuilding the index...`,
        );
        return this.index.reset();
      })
      .then(() => {
        this.searchWidget.busy = false;
        vscode.window.showInformationMessage(
          "Scratches: search index loaded, documents: " + this.index.size(),
        );
      });
  }

  newScratch = async (filename: string, content: string) => {
    const uri = Uri.parse(`scratch:/${filename}`);
    let exists = true;
    try {
      await this.fileSystemProvider.stat(uri);
    } catch (e) {
      if (e instanceof FileSystemError && e.code === "FileNotFound") {
        exists = false;
      } else {
        throw e;
      }
    }

    if (exists) {
      const choice = await vscode.window.showInformationMessage(
        `File ${filename} already exists, overwrite?`,
        { modal: true },
        "Yes",
      );

      if (choice !== "Yes") {
        return;
      }
    }

    await this.fileSystemProvider.writeFile(uri, content, { create: true, overwrite: true });
    return uri;
  };

  newScratchFromBuffer = async (): Promise<unknown> => {
    const editor = vscode.window.activeTextEditor;
    const doc = editor?.document;
    if (!doc) {
      vscode.window.setStatusBarMessage("No document is open", 10 * 1000);
      return;
    }

    const suggestedFilename = inferFilename(doc);
    const suggestedExtension = inferExtension(doc);
    const filename = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      title: "File name for the new scratch",
      value: `${suggestedFilename}.${suggestedExtension}`,
      valueSelection: [0, suggestedFilename.length],
    });

    if (!filename) {
      return;
    }

    const scratchUri = await this.newScratch(filename, doc.getText() ?? "");
    if (doc.isUntitled) {
      return editor
        .edit((editBuilder) => {
          selectAll(editor);
          editBuilder.delete(editor.selection);
        })
        .then(() =>
          Promise.all([
            vscode.commands.executeCommand("workbench.action.closeActiveEditor"),
            vscode.commands.executeCommand("vscode.open", scratchUri),
          ]),
        );
    }

    return vscode.commands.executeCommand("vscode.open", scratchUri);
  };

  quickOpen = async () => {
    const allScratchesPromise = this.treeDataProvider
      .getFlatTree(SortOrder.MostRecent)
      .then(map(call("toQuickPickItem")));

    return vscode.window
      .showQuickPick(allScratchesPromise, {
        placeHolder: "Search scratches...",
        matchOnDescription: true,
      })
      .then((picked) => picked && vscode.commands.executeCommand("vscode.open", picked.uri));
  };

  quickSearch = async () => {
    const searchChangedSubscription = this.searchWidget.onDidChangeValue((value) => {
      this.searchWidget.items = this.index.search(value).map((result) => ({
        label: result.path,
        detail: result.textMatch,
        iconPath: vscode.ThemeIcon.File,
        uri: Uri.joinPath(ScratchFileSystemProvider.ROOT, result.path),
      }));
    });

    this.searchWidget.onDidAccept(async () => {
      searchChangedSubscription.dispose();
      vscode.commands.executeCommand("vscode.open", this.searchWidget.selectedItems[0].uri);
    });

    this.searchWidget.show();
  };

  resetIndex = async () =>
    this.index
      .reset()
      .then(() =>
        vscode.window.showInformationMessage(
          "Scratches: search index rebuilt, documents: " + this.index.size(),
        ),
      );

  renameScratch = async (scratch?: Scratch) => {
    const uri = scratch?.uri ?? currentScratchUri();
    if (!uri) {
      return;
    }

    const fileName = path.basename(uri.path);
    const newName = await vscode.window.showInputBox({
      prompt: "Rename scratch",
      value: fileName,
      valueSelection: [0, 0],
    });

    if (!newName) {
      return;
    }

    const newUri = uri.with({
      path: path.join(path.dirname(uri.path), newName),
    });
    await this.fileSystemProvider.rename(uri, newUri);

    // If there was no scratch then we just renamed a scratch opened in the
    // current editor so close it and reopen with the new name
    if (!scratch) {
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await vscode.commands.executeCommand("vscode.open", newUri);
    }
  };

  deleteScratch = async (scratch?: Scratch) => {
    const uri = scratch?.uri ?? currentScratchUri();
    if (!uri) {
      return;
    }

    try {
      await this.fileSystemProvider.delete(uri);
      if (!scratch) {
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      }
    } catch (e) {
      console.warn(`Error while removing ${uri}`, e);
    }
  };

  toggleSortOrder = () => {
    const order = (this.treeDataProvider.sortOrder + 1) % SortOrderLength;
    this.treeDataProvider.setSortOrder(order);
    this.globalState.update("sortOrder", order);
  };

  openDirectory = () => vscode.commands.executeCommand("revealFileInOS", this.scratchDir);
}
