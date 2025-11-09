import langMap from "lang-map";
import * as path from "path";
import { match, P } from "ts-pattern";
import * as vscode from "vscode";
import { Disposable, FileChangeType, FileSystemError, Uri } from "vscode";
import { map, pass, prop, sort, waitPromises, zip } from "./fu";
import { PinStore, PIN_STORE_FILENAME } from "./pins";
import { ScratchFileSystemProvider } from "./providers/fs";
import { PinnedScratchTreeProvider, ScratchItem } from "./providers/pinnedTree";
import { ScratchSearchProvider } from "./providers/search";
import { DisposableContainer, readTree } from "./util";

const extOverrides: Record<string, string> = {
  makefile: "",
  ignore: "",
  plaintext: "",
  shellscript: "sh",
};

type QuickPickScratchItem = (vscode.QuickPickItem & { uri: vscode.Uri }) | vscode.QuickPickItem;
const isScratchEntry = (
  i: QuickPickScratchItem,
): i is vscode.QuickPickItem & { uri: vscode.Uri } => {
  const candidate = i as { uri?: unknown };
  return !!candidate.uri && candidate.uri instanceof Uri;
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
  readonly treeDataProvider: PinnedScratchTreeProvider;
  readonly pins: PinStore;

  private searchWidget: vscode.QuickPick<QuickPickScratchItem>;
  private index: ScratchSearchProvider;
  private searchIndexTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly scratchDir: Uri,
    private readonly storageDir: vscode.Uri,
  ) {
    super();

    [scratchDir, storageDir].forEach(vscode.workspace.fs.createDirectory);

    this.fileSystemProvider = this.disposeLater(new ScratchFileSystemProvider(this.scratchDir));
    this.pins = this.disposeLater(new PinStore(this.scratchDir));
    this.pins.init();
    this.treeDataProvider = new PinnedScratchTreeProvider(this.fileSystemProvider, this.pins);
    this.index = new ScratchSearchProvider(
      this.fileSystemProvider,
      Uri.joinPath(this.storageDir, "searchIndex.json"),
    );

    this.searchWidget = this.disposeLater(vscode.window.createQuickPick<QuickPickScratchItem>());
    this.searchWidget.placeholder = "Search scratches...";
    this.searchWidget.busy = true;
    this.searchWidget.matchOnDescription = true;
    this.searchWidget.matchOnDetail = true;

    this.index
      .loadIndex()
      .then(pass, err => {
        vscode.window.showWarningMessage(
          `Failed to load scratches search index: ${err}. Rebuilding the index...`,
        );
        return this.buildIndex();
      })
      .then(() => {
        this.searchWidget.busy = false;
        this.searchIndexTimer = setInterval(this.index.saveIndex, 15 * 60 * 1000);
        vscode.window.showInformationMessage(
          "Scratches: search index loaded, documents: " + this.index.size(),
        );
      });

    this.disposeLater(
      this.fileSystemProvider.watch(ScratchFileSystemProvider.ROOT, {
        recursive: true,
      }),
    );

    this.disposeLater(this.fileSystemProvider.onDidChangeFile(map(this.updateIndexOnFileChange)));
  }

  dispose() {
    this.index.saveIndex();
    clearInterval(this.searchIndexTimer);
    super.dispose();
  }

  private updateIndexOnFileChange = (change: vscode.FileChangeEvent) =>
    match(change)
      .with({ type: FileChangeType.Deleted, uri: P.select() }, uri => {
        if (uri.path.substring(1) !== PIN_STORE_FILENAME) this.index.removeFile(uri);
      })
      .with({ type: FileChangeType.Created, uri: P.select() }, uri => {
        if (uri.path.substring(1) !== PIN_STORE_FILENAME) this.index.addFile(uri);
      })
      .with({ type: FileChangeType.Changed, uri: P.select() }, uri => {
        if (uri.path.substring(1) !== PIN_STORE_FILENAME) this.index.updateFile(uri);
      })
      .otherwise(c => console.error("Unhandled file change event", c));

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
        .edit(editBuilder => {
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

  private decorateQuickPickItems = (items: QuickPickScratchItem[]): QuickPickScratchItem[] => {
    const pinnedSet = new Set(this.pins.list());
    const pinnedItems: (vscode.QuickPickItem & { uri: vscode.Uri })[] = items
      .filter(isScratchEntry)
      .filter(i => pinnedSet.has(i.uri.path.substring(1)))
      .map(i => ({
        ...i,
        iconPath: new vscode.ThemeIcon("pin"),
        description: "Pinned",
      }));
    const otherItems: (vscode.QuickPickItem & { uri: vscode.Uri })[] = items
      .filter(isScratchEntry)
      .filter(i => !pinnedSet.has(i.uri.path.substring(1)));
    if (pinnedItems.length === 0) {
      return otherItems;
    }
    const result: QuickPickScratchItem[] = [
      { label: "Pinned", kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem,
      ...pinnedItems,
      { label: "Others", kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem,
      ...otherItems,
    ];
    return result;
  };

  quickOpen = async () => {
    const allScratchesPromise = readTree(this.fileSystemProvider, ScratchFileSystemProvider.ROOT)
      .then(entries => entries.filter(uri => uri.path.substring(1) !== PIN_STORE_FILENAME))
      .then(entries =>
        Promise.all(entries.map(this.fileSystemProvider.stat))
          .then(map(prop("mtime")))
          .then(zip(entries))
          .then(sort<[vscode.Uri, number]>((a, b) => b[1] - a[1]))
          .then(map(prop(0))),
      )
      .then(
        map(uri => ({
          label: uri.path.substring(1),
          description: uri.toString(),
          iconPath: vscode.ThemeIcon.File,
          uri: uri,
        })),
      );

    const itemsPromise = allScratchesPromise.then(items =>
      this.decorateQuickPickItems(
        items.map(i => ({
          ...i,
          buttons: [
            {
              iconPath: new vscode.ThemeIcon("pin"),
              tooltip: this.pins.isPinned(i.uri) ? "Unpin" : "Pin",
            } as vscode.QuickInputButton,
          ],
        })),
      ),
    );
    const qp = vscode.window.createQuickPick<QuickPickScratchItem>();
    qp.placeholder = "Search scratches...";
    qp.matchOnDescription = true;
    qp.onDidTriggerItemButton(async e => {
      if (!isScratchEntry(e.item)) return;
      if (e.button.tooltip === "Pin") await this.pins.pin(e.item.uri);
      if (e.button.tooltip === "Unpin") await this.pins.unpin(e.item.uri);
      // Rebuild items with updated pin state
      const raw = qp.items.filter(isScratchEntry).map(it => ({
        ...it,
        buttons: [
          {
            iconPath: new vscode.ThemeIcon("pin"),
            tooltip: this.pins.isPinned(it.uri) ? "Unpin" : "Pin",
          },
        ],
      }));
      qp.items = this.decorateQuickPickItems(raw);
    });
    qp.onDidAccept(() => {
      const picked = qp.selectedItems.find(isScratchEntry);
      if (picked) {
        vscode.commands.executeCommand("vscode.open", picked.uri);
      }
      qp.hide();
    });
    itemsPromise.then(items => (qp.items = items));
    qp.show();
  };

  quickSearch = async () => {
    const searchChangedSubscription = this.searchWidget.onDidChangeValue(value => {
      const raw: (vscode.QuickPickItem & { uri: vscode.Uri })[] = this.index
        .search(value)
        .filter(r => r.path !== PIN_STORE_FILENAME)
        .map(result => ({
          label: result.path,
          detail: result.textMatch,
          iconPath: vscode.ThemeIcon.File,
          uri: Uri.joinPath(ScratchFileSystemProvider.ROOT, result.path),
          buttons: [
            {
              iconPath: new vscode.ThemeIcon("pin"),
              tooltip: this.pins.isPinned(Uri.joinPath(ScratchFileSystemProvider.ROOT, result.path))
                ? "Unpin"
                : "Pin",
            },
          ],
        }));
      this.searchWidget.items = this.decorateQuickPickItems(raw);
    });

    this.searchWidget.onDidTriggerItemButton(async e => {
      if (!isScratchEntry(e.item)) return;
      if (e.button.tooltip === "Pin") await this.pins.pin(e.item.uri);
      if (e.button.tooltip === "Unpin") await this.pins.unpin(e.item.uri);
      // Force refresh of current results retaining query
      const currentRaw = this.searchWidget.items.filter(isScratchEntry).map(it => ({
        ...it,
        buttons: [
          {
            iconPath: new vscode.ThemeIcon("pin"),
            tooltip: this.pins.isPinned(it.uri) ? "Unpin" : "Pin",
          },
        ],
      }));
      this.searchWidget.items = this.decorateQuickPickItems(currentRaw);
    });

    this.searchWidget.onDidAccept(async () => {
      searchChangedSubscription.dispose();
      const picked = this.searchWidget.selectedItems.find(isScratchEntry);
      if (picked) vscode.commands.executeCommand("vscode.open", picked.uri);
    });

    this.searchWidget.show();
  };

  buildIndex = async () =>
    vscode.window.withProgress(
      {
        title: "Scratches: building search index...",
        location: vscode.ProgressLocation.Notification,
        cancellable: false,
      },
      async progress =>
        readTree(this.fileSystemProvider, ScratchFileSystemProvider.ROOT)
          .then(uris => uris.filter(u => u.path.substring(1) !== PIN_STORE_FILENAME))
          .then(uris =>
            uris.map(uri =>
              this.index.addFile(uri).then(uri =>
                progress.report({
                  message: `Indexed ${uri.path.substring(1)}`,
                  increment: 100 / uris.length,
                }),
              ),
            ),
          )
          .then(waitPromises)
          .then(() => this.index.saveIndex()),
    );

  resetIndex = async () => {
    this.index.removeAll();
    return this.buildIndex().then(() =>
      vscode.window.showInformationMessage(
        "Scratches: search index rebuilt, documents: " + this.index.size(),
      ),
    );
  };

  renameScratch = async (scratch?: ScratchItem) => {
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
    await this.pins.rename(uri, newUri);

    // If there was no scratch then we just renamed a scratch opened in the
    // current editor so close it and reopen with the new name
    if (!scratch) {
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await vscode.commands.executeCommand("vscode.open", newUri);
    }
  };

  deleteScratch = async (scratch?: ScratchItem) => {
    const uri = scratch?.uri ?? currentScratchUri();
    if (!uri) {
      return;
    }

    try {
      await this.fileSystemProvider.delete(uri);
      await this.pins.remove(uri);
      if (!scratch) {
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      }
    } catch (e) {
      console.warn(`Error while removing ${uri}`, e);
    }
  };

  openDirectory = () => vscode.commands.executeCommand("revealFileInOS", this.scratchDir);

  pinScratch = async (scratch?: ScratchItem) => {
    const uri = scratch?.uri ?? currentScratchUri();
    if (!uri) return;
    await this.pins.pin(uri);
  };

  unpinScratch = async (scratch?: ScratchItem) => {
    const uri = scratch?.uri ?? currentScratchUri();
    if (!uri) return;
    await this.pins.unpin(uri);
  };

  changeSortOrder = () => this.treeDataProvider.cycleSortOrder();
}
