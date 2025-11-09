import * as vscode from "vscode";
import { filter, sort } from "../fu";
import { PIN_STORE_FILENAME, PinStore } from "../pins";
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
const comparators: Record<
  SortOrder,
  (a: [vscode.Uri, vscode.FileStat], b: [vscode.Uri, vscode.FileStat]) => number
> = {
  [SortOrder.ByCreationDate]: desc((a, b) => a[1].ctime - b[1].ctime),
  [SortOrder.ByName]: (a, b) => a[0].path.localeCompare(b[0].path),
};

const SORT_ORDER_COUNT = Object.keys(comparators).length;

export class ScratchItem extends vscode.TreeItem {
  constructor(
    public readonly uri: vscode.Uri,
    pinned: boolean,
  ) {
    super(uri.path.substring(1), vscode.TreeItemCollapsibleState.None);
    this.resourceUri = uri;
    this.command = { command: "vscode.open", title: "Open", arguments: [uri] };
    this.contextValue = pinned ? "scratchPinned" : "scratchUnpinned";
    if (pinned) this.iconPath = new vscode.ThemeIcon("pin");
  }
}

class GroupNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly group: "pinned" | "others",
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "scratchGroup";
  }
}

export class PinnedScratchTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _sortOrder: SortOrder = SortOrder.ByName;

  constructor(
    private readonly fileSystem: ScratchFileSystemProvider,
    private readonly pins: PinStore,
  ) {
    this.fileSystem.onDidChangeFile(() => this.reload());
    this.pins.onDidChangePins(() => this.reload());
  }

  get sortOrder(): SortOrder {
    return this._sortOrder;
  }
  set sortOrder(value: SortOrder) {
    this._sortOrder = value;
    this.reload();
  }
  cycleSortOrder = () => (this.sortOrder = (this.sortOrder + 1) % SORT_ORDER_COUNT);

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  reload() {
    this._onDidChangeTreeData.fire(undefined);
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element instanceof GroupNode) {
      const all = await readDirWithStats(this.fileSystem, ScratchFileSystemProvider.ROOT)
        .then(filter(([, stat]) => isFile(stat.type)))
        .then(filter(([uri]) => uri.path.substring(1) !== PIN_STORE_FILENAME))
        .then(sort(comparators[this._sortOrder]));
      const pinnedSet = new Set(this.pins.list());
      const subset = all.filter(([uri]) =>
        element.group === "pinned"
          ? pinnedSet.has(uri.path.substring(1))
          : !pinnedSet.has(uri.path.substring(1)),
      );
      return subset.map(([uri]) => new ScratchItem(uri, element.group === "pinned"));
    }

    const all = await readDirWithStats(this.fileSystem, ScratchFileSystemProvider.ROOT)
      .then(filter(([, stat]) => isFile(stat.type)))
      .then(filter(([uri]) => uri.path.substring(1) !== PIN_STORE_FILENAME))
      .then(sort(comparators[this._sortOrder]));
    const pinnedSet = new Set(this.pins.list());
    const pinned = all.filter(([uri]) => pinnedSet.has(uri.path.substring(1)));

    if (pinned.length === 0) {
      return all.map(([uri]) => new ScratchItem(uri, false));
    }

    return [new GroupNode("Pinned", "pinned"), new GroupNode("Others", "others")];
  }
}
