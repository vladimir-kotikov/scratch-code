import * as path from "path";
import { match } from "ts-pattern";
import * as vscode from "vscode";
import { Uri } from "vscode";
import { newScratchPicker } from "./newScratch";
import { isFileExistsError, isNotEmptyDirectory, ScratchFileSystemProvider } from "./providers/fs";
import { PinStore } from "./providers/pinStore";
import { SearchIndexProvider } from "./providers/search";
import {
  ScratchFile,
  ScratchFolder,
  ScratchNode,
  ScratchTreeProvider,
  SortOrderLength,
} from "./providers/tree";
import { DisposableContainer } from "./util/containers";
import * as editor from "./util/editor";
import { map, pass } from "./util/fu";
import { asPromise, whenError } from "./util/promises";
import * as prompt from "./util/prompt";
import { isUserCancelled, PickerItemButton } from "./util/prompt";
import { splitLines } from "./util/text";

const DEBUG = process.env.SCRATCHES_DEBUG === "1";

const toQuickPickItem = (scratch: ScratchFile): prompt.PickerItem<{ uri: Uri }> => ({
  label: path.basename(scratch.uri.path),
  description: scratch.isPinned ? "pinned" : undefined,
  iconPath: vscode.ThemeIcon.File,
  uri: scratch.uri,
});

const isEmptyOrUndefined = (str: string | undefined): str is undefined | "" =>
  str === undefined || str.trim() === "";

// TODO: Check and handle corner cases:
// - delay updating the index in watcher events until the index is loaded/populated
// - check the index validity when loading from disk and prune missing entries

enum IndexStatus {
  Unknown = "Unknown",
  Loading = "Loading...",
  Ready = "Ready",
  Error = "Error",
}

class IndexStatusBar {
  private statusItem: vscode.StatusBarItem;
  private status: IndexStatus = IndexStatus.Unknown;
  private error?: string;
  private size?: number;

  constructor(private indexPath: string) {
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    this.update();
    this.statusItem.show();
  }

  setStatus = (status: IndexStatus.Loading | IndexStatus.Ready | IndexStatus.Unknown) => {
    this.status = status;
    this.error = undefined;
    return this.update();
  };

  setError = (error: string) => {
    this.status = IndexStatus.Error;
    this.error = error;
    return this.update();
  };

  setSize = (size: number) => {
    this.size = size;
    return this.update();
  };

  private update = () => {
    const indexSize = this.size !== undefined ? (this.size / 1024).toFixed(1) + " Kb" : "-";
    this.statusItem.tooltip = `Location: ${this.indexPath}${this.error ? "\nError: " + this.error : ""}`;
    this.statusItem.text = `Index: ${this.status}, Size: ${indexSize}`;
    return this;
  };
}

export class ScratchExtension extends DisposableContainer {
  private readonly index: SearchIndexProvider;
  private readonly treeView: vscode.TreeView<ScratchNode>;

  public scratchesDragAndDropController!: vscode.TreeDragAndDropController<ScratchFile>;

  private readonly pinQuickPickItemButton: PickerItemButton<{ uri: Uri }> = {
    tooltip: "Pin scratch",
    iconPath: new vscode.ThemeIcon("pin"),
    onClick: ({ item, setItems }) => {
      this.pinScratch(item.uri);
      setItems(this.getQuickPickItems);
    },
  };

  private readonly unpinQuickPickItemButton: PickerItemButton<{ uri: Uri }> = {
    tooltip: "Unpin scratch",
    iconPath: new vscode.ThemeIcon("pinned"),
    onClick: ({ item, setItems }) => {
      this.unpinScratch(item.uri);
      setItems(this.getQuickPickItems);
    },
  };
  private indexStatusBar: IndexStatusBar;

  constructor(
    private readonly fileSystemProvider: ScratchFileSystemProvider,
    private readonly treeDataProvider: ScratchTreeProvider,
    private readonly pinStore: PinStore,
    private readonly storageDir: vscode.Uri,
    private readonly globalState: vscode.Memento,
  ) {
    super();

    [storageDir].forEach(vscode.workspace.fs.createDirectory);

    this.indexStatusBar = new IndexStatusBar(this.fileSystemProvider.scratchDir.fsPath);

    this.disposeLater(
      // start watcher so other components can rely on it being active
      this.fileSystemProvider.watch(ScratchFileSystemProvider.ROOT, {
        recursive: true,
      }),
    );

    this.scratchesDragAndDropController = {
      dragMimeTypes: ["text/uri-list", "text/plain"],
      dropMimeTypes: ["text/uri-list", "text/plain"],
      handleDrop: this.handleDrop,
      handleDrag: this.handleDrag,
    };

    this.treeView = this.disposeLater(
      vscode.window.createTreeView("scratchesView", {
        treeDataProvider: this.treeDataProvider,
        dragAndDropController: this.scratchesDragAndDropController,
      }),
    );

    this.index = this.disposeLater(
      new SearchIndexProvider(
        this.fileSystemProvider,
        Uri.joinPath(this.storageDir, "searchIndex.json"),
      ),
    );
    this.index.load();
    this.disposables.push(
      this.index.onDidLoad(() => {
        this.indexStatusBar.setStatus(IndexStatus.Ready).setSize(this.index.size());
        // Status bar update is sufficient, no need for intrusive notifications
      }),
      this.index.onLoadError(err => {
        this.index.reset();
        this.indexStatusBar.setError(err.toString());
        prompt.warn(`Index corrupted (${err}). Rebuilding...`);
      }),
    );
  }

  private getQuickPickItems = (): Promise<
    Array<prompt.PickerItem<{ uri: Uri }> | prompt.Separator>
  > =>
    this.treeDataProvider.getAll().then(
      map(scratch => ({
        ...toQuickPickItem(scratch),
        buttons: scratch.isPinned ? [this.unpinQuickPickItemButton] : [this.pinQuickPickItemButton],
      })),
    );

  private getQuickSearchItems = (value: string = ""): Array<prompt.PickerItem<{ uri: Uri }>> =>
    value === ""
      ? [
          {
            label: "Type to search...",
            alwaysShow: true,
            uri: null as unknown as Uri, // Placeholder URI
            // Return undefined to prevent picker from closing
            onPick: () => undefined,
          },
        ]
      : this.index.search(value).map(result => ({
          label: result.path,
          detail: result.textMatch,
          iconPath: vscode.ThemeIcon.File,
          alwaysShow: true,
          uri: Uri.joinPath(ScratchFileSystemProvider.ROOT, result.path),
        }));

  // There's only one item is allowed to be selected so
  // dragging always involves a single scratch
  private handleDrag = (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    [scratch, ..._]: readonly ScratchNode[],
    dataTransfer: vscode.DataTransfer,
  ) => {
    // TODO: Dragging folders is not yet supported
    if (scratch instanceof ScratchFolder) return;
    dataTransfer.set("text/uri-list", new vscode.DataTransferItem(scratch.uri.toString()));
    dataTransfer.set(
      "application/vnd.code.tree.scratchesView",
      new vscode.DataTransferItem(scratch),
    );
  };

  private handleUriDrop = (dataTransfer: vscode.DataTransfer, parent: Uri) => {
    return dataTransfer
      .get("text/uri-list")
      ?.asString()
      .then(splitLines)
      .then(map(Uri.parse))
      .then(
        map(uri => {
          return uri.scheme === ScratchFileSystemProvider.SCHEME
            ? this.rename(uri, Uri.joinPath(parent, path.basename(uri.path)))
            : uri.fsPath === "/"
              ? this.newScratchFromEditor(parent)
              : this.newScratchFromFile(uri, parent);
        }),
      )
      .then(promises => Promise.all(promises))
      .then(pass());
  };

  private handleScratchDrop = (dataTransfer: vscode.DataTransfer, parent: Uri) => {
    const scratch = dataTransfer.get("application/vnd.code.tree.scratchesView")?.value;
    return scratch
      ? this.rename(scratch, Uri.joinPath(parent, path.basename(scratch.uri.path)))
      : undefined;
  };

  private handleFileDrop = (dataTransfer: vscode.DataTransfer, parent: Uri) => {
    const file = dataTransfer.get("text/plain")?.asFile();
    return file
      ?.data()
      .then(data => this.createScratch(file.name, data, parent))
      .then(pass());
  };

  // TODO: Test dropping plain text
  private handleDrop = (target: ScratchNode | undefined, dataTransfer: vscode.DataTransfer) => {
    const parent =
      target === undefined
        ? ScratchFileSystemProvider.ROOT
        : target instanceof ScratchFolder
          ? target.uri
          : Uri.joinPath(target.uri, "../");

    return (
      this.handleScratchDrop(dataTransfer, parent) ??
      this.handleUriDrop(dataTransfer, parent) ??
      this.handleFileDrop(dataTransfer, parent)
    );
  };

  private createScratch = async (
    filename?: string,
    content?: string | Uint8Array,
    parent: Uri = ScratchFileSystemProvider.ROOT,
  ) => {
    const uriPromise = isEmptyOrUndefined(filename)
      ? prompt
          // Trim leading slash to avoid confusion with absolute paths,
          // then restore it by joining with the root URI
          .filename("Enter scratch filename", parent.path.slice(1))
          .then(filename => Uri.joinPath(ScratchFileSystemProvider.ROOT, filename))
      : asPromise(Uri.joinPath(parent, filename));

    return uriPromise.then(uri =>
      this.fileSystemProvider
        .writeFile(uri, content, { create: true, overwrite: false })
        .catch(
          whenError(isFileExistsError, () =>
            prompt
              .confirm(`File ${filename} already exists, overwrite?`)
              .then(() => this.fileSystemProvider.writeFile(uri, content)),
          ),
        )
        .then(() => uri),
    );
  };

  // TODO: Drop now unnecessary functionality
  private newScratchFromEditor = async (parent?: Uri) => {
    const doc = editor.getCurrentDocument();
    return doc
      ? this.createScratch(
          doc.isUntitled ? undefined : path.basename(doc.fileName),
          doc.getText(),
          parent,
        )
      : undefined;
  };

  private newScratchFromFile = async (uri: Uri, parent?: Uri) =>
    vscode.workspace.fs
      .readFile(uri)
      .then(content => this.createScratch(path.basename(uri.path), content, parent));

  newScratch = (parent?: ScratchNode) =>
    // TODO: Reveal the created scratch in the tree view
    parent === undefined
      ? newScratchPicker(this.createScratch)
      : // When parent is a scratch, this means the command has been invoked
        // from treeView context menu, so just create a blank scratch.
        this.createScratch(
          undefined,
          "",
          parent instanceof ScratchFolder
            ? // Append trailing slash for folders to indicate nesting
              parent.uri.with({ path: parent.uri.path + "/" })
            : Uri.joinPath(parent.uri, "../"),
        );

  newFolder = (parent?: ScratchNode) => {
    const parentUri =
      parent === undefined
        ? ScratchFileSystemProvider.ROOT
        : parent instanceof ScratchFolder
          ? parent.uri
          : Uri.joinPath(parent.uri, "../");

    return prompt
      .filename(
        "Enter folder name (slashes for nested allowed)",
        // For root do not add extra slash, expect plain folder name,
        // for nested directories show the current path with trailing slash
        parentUri.path === "/" ? "" : parentUri.path.slice(1) + "/",
      )
      .then(filename =>
        this.fileSystemProvider.createDirectory(
          Uri.joinPath(ScratchFileSystemProvider.ROOT, filename),
        ),
      );
  };

  quickPick = (initialValue: string = "") =>
    prompt
      .pick<{ uri: Uri }>(
        initialValue === "?"
          ? () => this.getQuickSearchItems(initialValue.substring(1))
          : this.getQuickPickItems,
        {
          onValueChange: ({ value, setItems }) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            value.startsWith("?")
              ? setItems(() => this.getQuickSearchItems(value.substring(1)))
              : value === ""
                ? setItems(this.getQuickPickItems)
                : undefined;
          },
          title: "Search scratches",
          placeholder: "Type to search scratches (prefix with ? for full-text search)",
          buttons: [
            {
              tooltip: "Refresh index",
              iconPath: new vscode.ThemeIcon("refresh"),
              onClick: ({ value, setItems }) =>
                this.resetIndex().then(() => setItems(() => this.getQuickSearchItems(value))),
            },
          ],
          initialValue,
          matchOnDescription: true,
          matchOnDetail: true,
          ignoreFocusOut: DEBUG,
        },
      )
      .then(item => editor.openDocument(item.uri), whenError(isUserCancelled, pass()));

  resetIndex = async () => {
    this.indexStatusBar.setStatus(IndexStatus.Loading).setSize(0);
    return this.index.reset().then(() => {
      this.indexStatusBar.setStatus(IndexStatus.Ready).setSize(this.index.size());
      return prompt.info(
        "Scratches: search index rebuilt, documents: " + this.index.documentCount(),
      );
    });
  };

  rename = async (scratch?: ScratchFile | Uri, to?: Uri) => {
    const from = (scratch instanceof Uri ? scratch : scratch?.uri) ?? editor.getCurrentScratchUri();
    if (from === undefined) return;

    const toPromise =
      to !== undefined
        ? Promise.resolve(to)
        : prompt
            .filename("Enter New Scratch Filename", path.basename(from.path))
            .then(filename => Uri.joinPath(ScratchFileSystemProvider.ROOT, filename));

    return toPromise
      .then(to =>
        this.fileSystemProvider
          .rename(from, to, { overwrite: false })
          .catch(
            whenError(isFileExistsError, () =>
              prompt
                .confirm(`File ${path.basename(to.path)} already exists, overwrite?`)
                .then(() => this.fileSystemProvider.rename(from, to, { overwrite: true })),
            ),
          ),
      )
      .then(pass(), whenError(isUserCancelled, pass()));
  };

  delete = (item?: ScratchNode | { uri: "${selectedItem}" }) => {
    // vscode doesn't pass the current item when invoked via keybinding,
    // so we pass a placeholder as defined in package.json and handle it here
    const uri = item?.uri === "${selectedItem}" ? this.treeView.selection[0]?.uri : item?.uri;

    if (uri === undefined) return;

    return this.fileSystemProvider
      .delete(uri, { recursive: false })
      .catch(
        whenError(isNotEmptyDirectory, () =>
          prompt
            .confirm("Folder is not empty. Delete all of its' contents?")
            .then(() => this.fileSystemProvider.delete(uri, { recursive: true })),
        ),
      )
      .catch(err =>
        match(err)
          .when(isUserCancelled, pass())
          .otherwise(err => prompt.warn(`Could not delete ${path.basename(uri.path)}: ${err}`)),
      );
  };

  toggleSortOrder = () => {
    const order = (this.treeDataProvider.sortOrder + 1) % SortOrderLength;
    this.treeDataProvider.setSortOrder(order);
    this.globalState.update("sortOrder", order);
  };

  openDirectory = () =>
    vscode.commands.executeCommand("revealFileInOS", this.fileSystemProvider.scratchDir);

  pinScratch = async (scratch?: ScratchFile | Uri) => {
    const uri = scratch instanceof Uri ? scratch : (scratch?.uri ?? editor.getCurrentScratchUri());
    return uri && this.pinStore.pin(uri);
  };

  unpinScratch = async (scratch?: ScratchFile | Uri) => {
    const uri = scratch instanceof Uri ? scratch : (scratch?.uri ?? editor.getCurrentScratchUri());
    return uri && this.pinStore.unpin(uri);
  };
}
