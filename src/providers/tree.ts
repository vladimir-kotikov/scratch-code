import { basename } from "node:path";
import { match } from "ts-pattern";
import {
  EventEmitter,
  FileStat,
  FileType,
  QuickPickItem,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
} from "vscode";
import { DisposableContainer } from "../util/disposable";
import { filter, flat, item, map, pipe, sort, zip } from "../util/fu";
import { asPromise } from "../util/promises";
import { ScratchFileSystemProvider } from "./fs";
import { PinStore } from "./pinStore";

type FileTuple = [Uri, FileStat];

const IGNORED_FILES = new Set([".DS_Store", ".pinstore"]);

const isFile = (type: FileType) =>
  type === FileType.File || type === (FileType.SymbolicLink | FileType.File);

export type ScratchQuickPickItem = QuickPickItem & { scratch: Scratch };

const ICON_PIN = new ThemeIcon("pinned");
const ICON_UNPIN = new ThemeIcon("pin");
export type ScratchTreeNode = Scratch | ScratchFolder;

export class ScratchFolder {
  constructor(public readonly uri: Uri) {}

  static from(uri: Uri): ScratchFolder {
    return new ScratchFolder(uri);
  }

  toTreeItem(): TreeItem {
    return {
      label: basename(this.uri.path),
      resourceUri: this.uri,
      collapsibleState: TreeItemCollapsibleState.Collapsed,
      iconPath: ThemeIcon.Folder,
      contextValue: "folder",
    };
  }
}

export class Scratch {
  constructor(
    public readonly uri: Uri,
    public isPinned?: boolean,
  ) {}

  static from = (uri: Uri, isPinned: boolean): Scratch => new Scratch(uri, isPinned);

  toTreeItem = (): TreeItem => ({
    label: basename(this.uri.path),
    resourceUri: this.uri,
    command: {
      command: "vscode.open",
      title: "Open",
      arguments: [this.uri],
    },
    description: this.isPinned ? "pinned" : undefined,
    contextValue: this.isPinned ? "pinned" : "scratch",
    collapsibleState: TreeItemCollapsibleState.None,
    iconPath: ThemeIcon.File,
  });

  toQuickPickItem = (): ScratchQuickPickItem => ({
    label: basename(this.uri.path),
    description: this.uri.path.substring(1),
    iconPath: ThemeIcon.File,
    buttons: [
      this.isPinned
        ? {
            iconPath: ICON_PIN,
            tooltip: "Unpin scratch",
          }
        : {
            iconPath: ICON_UNPIN,
            tooltip: "Pin scratch",
          },
    ],
    scratch: this,
  });
}

export enum SortOrder {
  MostRecent,
  Alphabetical,
}

export const SortOrderLength = Object.keys(SortOrder).length / 2;

export class ScratchTreeProvider
  extends DisposableContainer
  implements TreeDataProvider<ScratchTreeNode>
{
  private _onDidChangeTreeData = new EventEmitter<Scratch | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private reload = (item?: Scratch) => this._onDidChangeTreeData.fire(item);
  private pinStore: PinStore;

  constructor(
    private readonly fileSystem: ScratchFileSystemProvider,
    private _sortOrder = SortOrder.MostRecent,
  ) {
    super();
    this.pinStore = new PinStore(
      Uri.joinPath(ScratchFileSystemProvider.ROOT, ".pinstore"),
      this.fileSystem,
    );

    this.disposeLater(this.fileSystem.onDidChangeFile(() => this.reload()));
    this.disposeLater(this.pinStore.onDidLoad(() => this.reload()));
  }

  // Just like an filesystem provider's readDirectory,
  // but returns [uri, stat] rather than [name, type] results
  private readDirectory = (dir: Uri) =>
    asPromise(this.fileSystem.readDirectory(dir))
      .then(map(item(0)))
      .then(map(name => Uri.joinPath(dir, name)))
      .then(uris => Promise.all(uris.map(this.fileSystem.stat)).then(zip(uris)));

  private readTree = (parent: Uri = ScratchFileSystemProvider.ROOT): PromiseLike<FileTuple[]> =>
    this.readDirectory(parent)
      .then(
        map(([uri, stat]) =>
          match(stat.type)
            .returnType<FileTuple[] | PromiseLike<FileTuple[]>>()
            .with(FileType.Unknown, () => [])
            .with(FileType.Directory, async () => this.readTree(uri))
            .when(isFile, () => [[uri, stat]])
            .otherwise(() => []),
        ),
      )
      .then(ps => Promise.all(ps))
      .then(flat);

  private sortAndFilter = (sortOrder: SortOrder) =>
    pipe(
      filter<FileTuple>(([uri]) => !IGNORED_FILES.has(basename(uri.path))),
      sort<FileTuple>(
        // FileType is a enum with folder = 2 and file = 1, so sorting by
        // descending FileType would put folders first. Also subtract
        // SymbolicLink bit to ignore it.
        sort.desc(sort.byNumericValue(([, { type }]) => (type &= FileType.SymbolicLink))),
        sort.desc(sort.byBoolValue(([uri]) => this.pinStore.isPinned(uri))),
        sortOrder === SortOrder.MostRecent
          ? sort.desc(sort.byNumericValue(([, { mtime }]) => mtime))
          : sort.byStringValue(([uri]) => uri.path),
      ),
      map<FileTuple, ScratchTreeNode>(([uri, { type }]) =>
        type === FileType.Directory
          ? ScratchFolder.from(uri)
          : Scratch.from(uri, this.pinStore.isPinned(uri)),
      ),
    );

  getTreeItem = (element: ScratchTreeNode) => {
    return element.toTreeItem();
  };

  getChildren = (element?: ScratchTreeNode, sortOrder: SortOrder = this._sortOrder) =>
    this.readDirectory(element?.uri ?? ScratchFileSystemProvider.ROOT).then(
      this.sortAndFilter(sortOrder),
    );

  getFlatTree = (sortOrder: SortOrder = this._sortOrder) =>
    // Cast to Promise<Scratch[]> since readTree returns only FileTuples of files
    this.readTree().then(this.sortAndFilter(sortOrder)) as Promise<Scratch[]>;

  getItem = (uri?: Uri) => (uri ? new Scratch(uri, this.pinStore.isPinned(uri)) : undefined);

  get sortOrder(): SortOrder {
    return this._sortOrder;
  }

  setSortOrder = (order: SortOrder) => {
    if (order !== this._sortOrder) {
      this._sortOrder = order;
      this.reload();
    }
  };

  pinScratch = (scratch?: Scratch) => {
    if (scratch) {
      this.pinStore.pin(scratch.uri);
      this.reload();
    }
  };

  unpinScratch = (scratch?: Scratch) => {
    if (scratch) {
      this.pinStore.unpin(scratch.uri);
      this.reload();
    }
  };
}
