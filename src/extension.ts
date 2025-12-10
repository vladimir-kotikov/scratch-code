import * as path from "path";
import * as vscode from "vscode";
import { Disposable, Uri } from "vscode";
import { newScratchPicker } from "./newScratch";
import { isFileExistsError, ScratchFileSystemProvider } from "./providers/fs";
import { SearchIndexProvider } from "./providers/search";
import {
  Scratch,
  ScratchQuickPickItem,
  ScratchTreeProvider,
  SortOrder,
  SortOrderLength,
} from "./providers/tree";
import { DisposableContainer } from "./util/disposable";
import * as editor from "./util/editor";
import { map, pass } from "./util/fu";
import { asPromise, waitPromises, whenError } from "./util/promises";
import * as prompt from "./util/prompt";
import { isUserCancelled, PickerItem, Separator } from "./util/prompt";

const isEmptyOrUndefined = (str: string | undefined) => str === undefined || str.trim() === "";

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

  public scratchesDragAndDropController!: vscode.TreeDragAndDropController<Scratch>;

  private readonly pinQuickPickItemButton: prompt.PickerItemButton<
    prompt.PickerItem<{ scratch: Scratch }>
  > = {
    tooltip: "Pin scratch",
    iconPath: new vscode.ThemeIcon("pin"),
    onClick: ({ item, setItems }) => {
      this.pinScratch(item.scratch);
      setItems(this.getQuickPickItems);
    },
  };

  private readonly unpinQuickPickItemButton: prompt.PickerItemButton<
    prompt.PickerItem<{ scratch: Scratch }>
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
        this.globalState.get("sortOrder", SortOrder.MostRecent),
      ),
    );

    this.scratchesDragAndDropController = {
      dragMimeTypes: ["text/uri-list", "text/plain"],
      dropMimeTypes: ["text/uri-list", "text/plain"],
      handleDrop: this.handleDrop,
      handleDrag: this.handleDrag,
    };

    this.disposeLater(
      vscode.window.createTreeView("scratches", {
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
    this.disposables.push(
      this.index.onDidLoad(() =>
        prompt.info(`Index ready, ${this.index.size()} documents in index`),
      ),
      this.index.onLoadError(err => {
        this.index.reset();
        prompt.warn(`Index corrupted (${err}). Rebuilding...`);
      }),
    );
  }

  private getQuickPickItems = (): PromiseLike<(PickerItem<{ scratch: Scratch }> | Separator)[]> =>
    this.treeDataProvider
      .getFlatTree(this.treeDataProvider.sortOrder)
      .then(
        map(
          scratch =>
            ({
              ...scratch.toQuickPickItem(),
              buttons: [this.pinQuickPickItemButton, this.unpinQuickPickItemButton],
            }) as prompt.PickerItem<{ scratch: Scratch }> | Separator,
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
  private handleDrag = ([scratch, ..._]: Scratch[], dataTransfer: vscode.DataTransfer) =>
    this.fileSystemProvider.readFile(scratch.uri).then(content => {
      dataTransfer.set("text/uri-list", new vscode.DataTransferItem(scratch.uri.toString()));

      try {
        dataTransfer.set(
          "text/plain",
          new vscode.DataTransferItem(Buffer.from(content).toString("utf8")),
        );
      } catch {
        /* empty */
      }
    });

  // TODO: Test dropping plain text
  private handleDrop = (_target: Scratch | undefined, dataTransfer: vscode.DataTransfer) => {
    const file = dataTransfer.get("text/plain")?.asFile();
    return file
      ? file
          .data()
          .then(data => this.createScratch(file.name, data))
          .then(pass())
      : dataTransfer
          .get("text/uri-list")
          ?.asString()
          .then(uris =>
            splitLines(uris)
              .map(line => Uri.parse(line))
              .filter(uri => uri.scheme !== "scratch")
              .map(uri =>
                uri.fsPath === "/" ? this.newScratchFromEditor() : this.newScratchFromFile(uri),
              ),
          )
          .then(waitPromises)
          .then(pass());
  };

  private createScratch = async (filename?: string, content?: string | Uint8Array) => {
    const filenamePromise = isEmptyOrUndefined(filename)
      ? prompt.filename("Enter scratch filename")
      : asPromise(filename);

    return filenamePromise.then(filename => {
      const uri = Uri.parse(`scratch:/${filename}`);
      return this.fileSystemProvider
        .writeFile(uri, content, { create: true, overwrite: false })
        .catch(
          whenError(isFileExistsError, () =>
            prompt
              .confirm(`File ${filename} already exists, overwrite?`)
              .then(() => this.fileSystemProvider.writeFile(uri, content)),
          ),
        )
        .then(() => uri);
    });
  };

  // TODO: Drop now unnecessary functionality
  private newScratchFromEditor = async () =>
    editor.getCurrentDocument()
      ? this.createScratch(
          path.basename(editor.getCurrentDocument()!.fileName),
          editor.getCurrentContent(),
        )
      : undefined;

  private newScratchFromFile = async (uri: Uri) =>
    vscode.workspace.fs
      .readFile(uri)
      .then(content => this.createScratch(path.basename(uri.path), content));

  newScratch = () => newScratchPicker(this.createScratch);

  quickOpen = () =>
    prompt
      .pick<ScratchQuickPickItem>(this.getQuickPickItems)
      .then(item => editor.openDocument(item.scratch.uri), whenError(isUserCancelled, pass()));

  quickSearch = () =>
    prompt
      .pick<vscode.QuickPickItem & { uri: vscode.Uri }>(this.getQuickSearchItems, {
        onValueChange: ({ value, setItems }) => setItems(() => this.getQuickSearchItems(value)),
        matchOnDescription: true,
        matchOnDetail: true,
      })
      .then(item => editor.openDocument(item.uri), whenError(isUserCancelled, pass()));

  resetIndex = async () =>
    this.index
      .reset()
      .then(() => prompt.info("Scratches: search index rebuilt, documents: " + this.index.size()));

  renameScratch = async (scratch?: Scratch) => {
    const uri = scratch?.uri ?? currentScratchUri();
    if (!uri) {
      return;
    }

    const fileName = path.basename(uri.path);
    const newName = await prompt.filename("Enter New Scratch Filename", fileName);

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
      await editor.closeCurrent();
      await editor.openDocument(newUri);
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
        await editor.closeCurrent();
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

  pinScratch = async (scratch?: Scratch) =>
    this.treeDataProvider.pinScratch(scratch ?? this.treeDataProvider.getItem(currentScratchUri()));

  unpinScratch = async (scratch?: Scratch) =>
    this.treeDataProvider.unpinScratch(
      scratch ?? this.treeDataProvider.getItem(currentScratchUri()),
    );
}
