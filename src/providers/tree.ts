import { basename } from "node:path";
import {
  EventEmitter,
  FileStat,
  FileType,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
} from "vscode";
import { asPromise, item, map, sort, zip } from "../fu";
import { DisposableContainer } from "../util";
import { ScratchFileSystemProvider } from "./fs";

const IGNORED_FILES = new Set([".DS_Store"]);

export class Scratch {
  constructor(
    public readonly uri: Uri,
    private readonly stat: FileStat,
  ) {}

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
}

export enum SortOrder {
  MostRecent,
  Alphabetical,
}

export class ScratchTreeProvider extends DisposableContainer implements TreeDataProvider<Scratch> {
  private _onDidChangeTreeData = new EventEmitter<Scratch | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private reload = (item?: Scratch) => this._onDidChangeTreeData.fire(item);

  constructor(
    private readonly fileSystem: ScratchFileSystemProvider,
    private sortOrder = SortOrder.MostRecent,
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

  getTreeItem = (element: Scratch) => element.toTreeItem();

  getChildren = async (element?: Scratch) =>
    this.readDirectory(element?.uri ?? ScratchFileSystemProvider.ROOT).then((files) =>
      files
        .filter(([uri]) => !IGNORED_FILES.has(basename(uri.path)))
        .sort(
          this.sortOrder === SortOrder.MostRecent
            ? sort.desc(sort.byNumericValue(([, { mtime }]) => mtime))
            : sort.byStringValue(([uri]) => uri.path),
        )
        .map(([uri, stat]) => new Scratch(uri, stat)),
    );

  setSortOrder = (order: SortOrder) => {
    if (order !== this.sortOrder) {
      this.sortOrder = order;
      this.reload();
    }
  };
}
