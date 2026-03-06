import * as path from "path";
import { match } from "ts-pattern";
import * as vscode from "vscode";
import { Uri } from "vscode";
import { newScratchPicker } from "./newScratch";
import { isFileExistsError, isNotEmptyDirectory, ScratchFileSystemProvider } from "./providers/fs";
import { SearchIndexProvider } from "./providers/search";
import { Scratch, ScratchFolder, ScratchTreeProvider, SortOrderLength } from "./providers/tree";
import { DisposableContainer } from "./util/containers";
import * as editor from "./util/editor";
import { map, pass } from "./util/fu";
import { debounce } from "./util/functions";
import { asPromise, whenError } from "./util/promises";
import * as prompt from "./util/prompt";
import { isUserCancelled, PickerItemButton } from "./util/prompt";
import { splitLines } from "./util/text";

const DEBUG = process.env.SCRATCHES_DEBUG === "1";

const isEmptyOrUndefined = (str: string | undefined): str is undefined | "" =>
  str === undefined || str.trim() === "";

// TODO: Check and handle corner cases:
// - delay updating the index in watcher events until the index is loaded/populated
// - check the index validity when loading from disk and prune missing entries

export class ScratchExtension extends DisposableContainer {
  private readonly treeView: vscode.TreeView<Scratch | ScratchFolder>;
  private readonly debouncedSearch: (query: string) => Promise<prompt.PickerItem[]>;

  public scratchesDragAndDropController!: vscode.TreeDragAndDropController<Scratch>;
  private readonly pinQuickPickItemButton: PickerItemButton = {
    tooltip: "Pin scratch",
    iconPath: new vscode.ThemeIcon("pin"),
    onClick: ({ item, setItems }) => {
      this.pinScratch(item.resourceUri);
      setItems(this.getQuickPickItems);
    },
  };

  private readonly unpinQuickPickItemButton: PickerItemButton = {
    tooltip: "Unpin scratch",
    iconPath: new vscode.ThemeIcon("pinned"),
    onClick: ({ item, setItems }) => {
      this.unpinScratch(item.resourceUri);
      setItems(this.getQuickPickItems);
    },
  };

  constructor(
    private readonly fileSystemProvider: ScratchFileSystemProvider,
    private readonly treeDataProvider: ScratchTreeProvider,
    private readonly searchProvider: SearchIndexProvider,
    private readonly globalState: vscode.Memento,
  ) {
    super();

    // Create debounced search with 300ms delay
    this.debouncedSearch = debounce(this.getQuickSearchItems, 300);

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
  }

  private getQuickPickItems = (): Promise<Array<prompt.PickerItem>> =>
    this.treeDataProvider.getFlatTree(this.treeDataProvider.sortOrder).then(
      map(scratch => ({
        ...scratch.toQuickPickItem(),
        buttons: scratch.isPinned ? [this.unpinQuickPickItemButton] : [this.pinQuickPickItemButton],
      })),
    );

  private getQuickSearchItems = (query: string = ""): Promise<prompt.PickerItem[]> =>
    query === ""
      ? Promise.resolve([
          {
            label: "Type to search...",
            alwaysShow: true,
            // Return undefined to prevent picker from closing
            onPick: () => undefined,
          },
        ])
      : this.searchProvider
          .search({ query, contextLines: 0 })
          .then(
            map(match => ({
              label: "",
              alwaysShow: true,
              resourceUri: Uri.parse(match.uri),
              description: `Line ${match.line}`,
              detail: match.content,
            })),
          )
          .catch(error => {
            console.error("Search failed:", error);
            return [
              {
                label: `Search error: ${error.message}`,
                alwaysShow: true,
                onPick: () => undefined,
              },
            ];
          });

  // There's only one item is allowed to be selected so
  // dragging always involves a single scratch
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private handleDrag = ([scratch, ..._]: Scratch[], dataTransfer: vscode.DataTransfer) => {
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
  private handleDrop = (
    target: Scratch | ScratchFolder | undefined,
    dataTransfer: vscode.DataTransfer,
  ) => {
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

  newScratch = (parent?: ScratchFolder | Scratch) =>
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

  newFolder = (parent?: ScratchFolder | Scratch) => {
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
      .pick(
        initialValue === "?"
          ? () => this.getQuickSearchItems(initialValue.substring(1))
          : this.getQuickPickItems,
        {
          onValueChange: ({ value, setItems }) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            value.startsWith("?")
              ? setItems(() => this.debouncedSearch(value.substring(1)))
              : value === ""
                ? setItems(this.getQuickPickItems)
                : undefined;
          },
          title: "Search scratches",
          placeholder: "Type to search scratches (prefix with ? for full-text search)",
          initialValue,
          matchOnDescription: true,
          matchOnDetail: true,
          ignoreFocusOut: DEBUG,
        },
      )
      .then(item => editor.openDocument(item.resourceUri), whenError(isUserCancelled, pass()));

  rename = async (scratch?: Scratch | Uri, to?: Uri) => {
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

  delete = (item?: Scratch | ScratchFolder | { uri: "${selectedItem}" }) => {
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

  pinScratch = async (scratch?: Scratch | Uri) =>
    this.treeDataProvider.pinScratch(
      scratch instanceof Uri ? scratch : (scratch?.uri ?? editor.getCurrentScratchUri()),
    );

  unpinScratch = async (scratch?: Scratch | Uri) =>
    this.treeDataProvider.unpinScratch(
      scratch instanceof Uri ? scratch : (scratch?.uri ?? editor.getCurrentScratchUri()),
    );
}
