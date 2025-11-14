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
import { apply, asPromise, flat, item, map, sort, zip } from "../fu";
import { DisposableContainer } from "../util";
import { ScratchFileSystemProvider } from "./fs";

const IGNORED_FILES = new Set([".DS_Store"]);

const isFile = (type: FileType) =>
  type === FileType.File || type === (FileType.SymbolicLink | FileType.File);

export class Scratch {
  constructor(
    public readonly uri: Uri,
    private readonly stat: FileStat,
  ) {}

  static from = (uri: Uri, stat: FileStat): Scratch => new Scratch(uri, stat);

  toTreeItem = (): TreeItem => {
    return {
      label: this.uri.path.substring(1),
      resourceUri: this.uri,
      command: {
        command: "vscode.open",
        title: "Open",
        arguments: [this.uri],
      },
      collapsibleState:
        this.stat.type === FileType.Directory
          ? TreeItemCollapsibleState.Collapsed
          : TreeItemCollapsibleState.None,
    };
  };

  toQuickPickItem = (): QuickPickItem & { uri: Uri } => ({
    label: basename(this.uri.path),
    description: this.uri.path.substring(1),
    iconPath: ThemeIcon.File,
    uri: this.uri,
  });
}

export enum SortOrder {
  MostRecent,
  Alphabetical,
}

export const SortOrderLength = Object.keys(SortOrder).length / 2;

export class ScratchTreeProvider extends DisposableContainer implements TreeDataProvider<Scratch> {
  private _onDidChangeTreeData = new EventEmitter<Scratch | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private reload = (item?: Scratch) => this._onDidChangeTreeData.fire(item);

  constructor(
    private readonly fileSystem: ScratchFileSystemProvider,
    private _sortOrder = SortOrder.MostRecent,
  ) {
    super();
    this.disposeLater(this.fileSystem.onDidChangeFile(() => this.reload()));
  }

  // Just like an filesystem provider's readDirectory,
  // but returns [uri, stat] rather than [name, type] results
  private readDirectory = (dir: Uri) =>
    asPromise(this.fileSystem.readDirectory(dir))
      .then(map(item(0)))
      .then(map((name) => Uri.joinPath(dir, name)))
      .then((uris) => Promise.all(uris.map(this.fileSystem.stat)).then(zip(uris)));

  private readTree = async (
    parent: Uri = ScratchFileSystemProvider.ROOT,
  ): Promise<[Uri, FileStat][]> =>
    this.readDirectory(parent)
      .then(
        map(([uri, stat]) =>
          match(stat.type)
            .returnType<[Uri, FileStat][] | PromiseLike<[Uri, FileStat][]>>()
            .with(FileType.Unknown, () => [])
            .with(FileType.Directory, async () => this.readTree(uri))
            .when(isFile, () => [[uri, stat]])
            .otherwise(() => []),
        ),
      )
      .then((ps) => Promise.all(ps))
      .then(flat);

  getTreeItem = (element: Scratch) => element.toTreeItem();

  private sortAndFilter = (sortOrder: SortOrder) => (entries: [Uri, FileStat][]) =>
    entries
      .filter(([uri]) => !IGNORED_FILES.has(basename(uri.path)))
      .sort(
        sortOrder === SortOrder.MostRecent
          ? sort.desc(sort.byNumericValue(([, { mtime }]) => mtime))
          : sort.byStringValue(([uri]) => uri.path),
      )
      .map(apply(Scratch.from));

  getChildren = (element?: Scratch, sortOrder: SortOrder = this._sortOrder) =>
    this.readDirectory(element?.uri ?? ScratchFileSystemProvider.ROOT).then(
      this.sortAndFilter(sortOrder),
    );

  getFlatTree = (sortOrder: SortOrder = this._sortOrder) =>
    this.readTree().then(this.sortAndFilter(sortOrder));

  get sortOrder(): SortOrder {
    return this._sortOrder;
  }

  setSortOrder = (order: SortOrder) => {
    if (order !== this._sortOrder) {
      this._sortOrder = order;
      this.reload();
    }
  };
}
