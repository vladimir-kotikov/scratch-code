import * as path from "path";
import { basename } from "path";
import { match } from "ts-pattern";
import * as vscode from "vscode";
import { Disposable, QuickPickItem, ThemeIcon, Uri } from "vscode";
import { newScratchPicker } from "./newScratch";
import { isFileExistsError, isNotEmptyDirectory, ScratchFileSystemProvider } from "./providers/fs";
import { PinStore } from "./providers/pinStore";
import { SearchIndexProvider } from "./providers/search";
import { ScratchFile, ScratchFolder, ScratchNode, ScratchTreeProvider } from "./providers/tree";
import { DisposableContainer } from "./util/disposable";
import * as editor from "./util/editor";
import { map, pass } from "./util/fu";
import { asPromise, whenError } from "./util/promises";
import * as prompt from "./util/prompt";
import { isUserCancelled, PickerItem, Separator } from "./util/prompt";

const DEBUG = process.env.SCRATCHES_DEBUG === "1";

const toQuickPickItem = (scratch: ScratchFile): QuickPickItem & { scratch: ScratchFile } => ({
  label: basename(scratch.uri.path),
  description: scratch.uri.path.substring(1),
  iconPath: ThemeIcon.File,
  scratch,
});

const isEmptyOrUndefined = (str: string | undefined): str is undefined | "" =>
  str === undefined || str.trim() === "";

const splitLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

const currentScratchUri = () =>
  editor.getCurrentDocument()?.uri?.scheme === "scratch"
    ? editor.getCurrentDocument()?.uri
    : undefined;

// TODO: Check and handle corner cases:
// - delay updating the index in watcher events until the index is loaded/populated
// - check the index validity when loading from disk and prune missing entries

export class ScratchExtension extends DisposableContainer implements Disposable {
  readonly fileSystemProvider: ScratchFileSystemProvider;
  readonly treeDataProvider: ScratchTreeProvider;
  private readonly index: SearchIndexProvider;
  private readonly treeView: vscode.TreeView<ScratchNode>;
  private readonly pinStore: PinStore;

  public scratchesDragAndDropController!: vscode.TreeDragAndDropController<ScratchFile>;

  private readonly pinQuickPickItemButton: prompt.PickerItemButton<
    prompt.PickerItem<{ scratch: ScratchFile }>
  > = {
    tooltip: "Pin scratch",
    iconPath: new vscode.ThemeIcon("pin"),
    onClick: ({ item, setItems }) => {
      this.pinScratch(item.scratch);
      setItems(this.getQuickPickItems);
    },
  };

  private readonly unpinQuickPickItemButton: prompt.PickerItemButton<
    prompt.PickerItem<{ scratch: ScratchFile }>
  > = {
    tooltip: "Unpin scratch",
    iconPath: new vscode.ThemeIcon("pinned"),
    onClick: ({ item, setItems }) => {
      this.unpinScratch(item.scratch);
      setItems(this.getQuickPickItems);
    },
  };

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
        // this.globalState.get("sortOrder", SortOrder.MostRecent),
      ),
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

    this.pinStore = new PinStore(
      Uri.joinPath(ScratchFileSystemProvider.ROOT, ".pinstore"),
      this.fileSystemProvider,
    );

    this.index = this.disposeLater(
      new SearchIndexProvider(
        this.fileSystemProvider,
        Uri.joinPath(this.storageDir, "searchIndex.json"),
      ),
    );

    this.disposables.push(
      this.index.onLoadError(err => {
        this.index.reset();
        prompt.warn(`Index corrupted (${err}). Rebuilding...`);
      }),
    );
  }

  private getQuickPickItems = (): PromiseLike<
    (PickerItem<{ scratch: ScratchFile }> | Separator)[]
  > =>
    this.treeDataProvider
      .getAll()
      .then(
        map(
          scratch =>
            ({
              ...toQuickPickItem(scratch),
              buttons: scratch.isPinned
                ? [this.unpinQuickPickItemButton]
                : [this.pinQuickPickItemButton],
            }) as prompt.PickerItem<{ scratch: ScratchFile }> | Separator,
        ),
      )
      .then(items => {
        const firstUnpinned = items.findIndex(
          (item, i) =>
            item.kind !== vscode.QuickPickItemKind.Separator && !item.scratch.isPinned && i > 0,
        );
        return firstUnpinned > 0
          ? items.toSpliced(firstUnpinned, 0, {
              label: "Scratches",
              kind: vscode.QuickPickItemKind.Separator,
            })
          : items;
      });

  private getQuickSearchItems = (value?: string) =>
    this.index.search(value ?? "").map(result => ({
      label: result.path,
      detail: result.textMatch,
      iconPath: vscode.ThemeIcon.File,
      uri: Uri.joinPath(ScratchFileSystemProvider.ROOT, result.path),
    }));

  // There's only one item is allowed to be selected so
  // dragging always involves a single scratch
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private handleDrag = ([scratch, ..._]: ScratchNode[], dataTransfer: vscode.DataTransfer) => {
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
  // TODO: Dropping on a folder
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

  quickOpen = () =>
    prompt
      .pick<QuickPickItem>(this.getQuickPickItems, {
        matchOnDescription: true,
        matchOnDetail: true,
      })
      .then(item => editor.openDocument(item.scratch.uri), whenError(isUserCancelled, pass()));

  quickSearch = () =>
    prompt
      .pick<vscode.QuickPickItem & { uri: vscode.Uri }>(this.getQuickSearchItems, {
        onValueChange: ({ value, setItems }) => setItems(() => this.getQuickSearchItems(value)),
        title: "Search scratches",
        buttons: [
          {
            tooltip: "Refresh index",
            iconPath: new vscode.ThemeIcon("refresh"),
            onClick: ({ value, setItems }) =>
              this.resetIndex().then(() => setItems(() => this.getQuickSearchItems(value))),
          },
        ],
        matchOnDescription: true,
        matchOnDetail: true,
        ignoreFocusOut: DEBUG,
      })
      .then(item => editor.openDocument(item.uri), whenError(isUserCancelled, pass()));

  resetIndex = async () =>
    this.index
      .reset()
      .then(() => prompt.info("Scratches: search index rebuilt, documents: " + this.index.size()));

  rename = async (scratch?: ScratchNode | Uri, to?: Uri) => {
    const from = (scratch instanceof Uri ? scratch : scratch?.uri) ?? currentScratchUri();
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
          .otherwise(err => prompt.warn(`Could not delete ${basename(uri.path)}: ${err}`)),
      );
  };

  toggleSortOrder = () => {
    this.globalState.update("sortOrder", this.treeDataProvider.cycleSortOrder());
  };

  openDirectory = () => vscode.commands.executeCommand("revealFileInOS", this.scratchDir);

  pinScratch = async (scratch?: ScratchFile) => {
    const uri = scratch?.uri ?? currentScratchUri();
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    uri && this.pinStore.pin(uri);
  };

  unpinScratch = async (scratch?: ScratchFile) => {
    const uri = scratch?.uri ?? currentScratchUri();
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    uri && this.pinStore.unpin(uri);
  };
}
