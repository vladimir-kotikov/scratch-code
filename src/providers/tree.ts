import {
  EventEmitter,
  FileStat,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
} from "vscode";
import { filter, map, sort } from "../fu";
import { isFile, readDirWithStats } from "../util";
import { ScratchFileSystemProvider } from "./fs";

enum SortOrder {
  ByName,
  ByCreationDate,
}

type Comparator<T> = (a: T, b: T) => number;

const desc =
  <T>(cmp: Comparator<T>): Comparator<T> =>
  (a: T, b: T) =>
    -cmp(a, b);

const comparators: Record<SortOrder, (a: [Uri, FileStat], b: [Uri, FileStat]) => number> = {
  [SortOrder.ByCreationDate]: desc(
    (a: [Uri, FileStat], b: [Uri, FileStat]) => a[1].ctime - b[1].ctime,
  ),
  [SortOrder.ByName]: (a: [Uri, FileStat], b: [Uri, FileStat]) =>
    a[0].path.localeCompare(b[0].path),
};

export class Scratch extends TreeItem {
  constructor(public readonly uri: Uri) {
    // trim leading slash
    const label = uri.path.substring(1);
    super(label, TreeItemCollapsibleState.None);
    this.resourceUri = uri;
    this.command = {
      command: "vscode.open",
      title: "Open",
      arguments: [uri],
    };
  }

  static from = ([uri]: [Uri, FileStat]): Scratch => new Scratch(uri);
}

export class ScratchTreeProvider implements TreeDataProvider<Scratch> {
  private _onDidChangeTreeData = new EventEmitter<Scratch | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly fileSystem: ScratchFileSystemProvider,
    private _sortOrder: SortOrder = SortOrder.ByName,
  ) {
    this.fileSystem.onDidChangeFile(() => this.reload());
  }

  public get sortOrder(): SortOrder {
    return this._sortOrder;
  }

  public set sortOrder(value: SortOrder) {
    this._sortOrder = value;
    this.reload();
  }

  cycleSortOrder = () => {
    this.sortOrder = (this._sortOrder + 1) % 2;
  };

  getTreeItem(element: Scratch): TreeItem {
    return element;
  }

  reload() {
    this._onDidChangeTreeData.fire(undefined);
  }

  getChildren = (element?: Scratch): PromiseLike<Scratch[]> =>
    readDirWithStats(this.fileSystem, element?.uri ?? ScratchFileSystemProvider.ROOT)
      .then(filter(([, stat]) => isFile(stat.type)))
      .then(sort(comparators[this._sortOrder]))
      .then(map(Scratch.from));
}
