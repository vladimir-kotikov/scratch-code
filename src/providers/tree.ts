import assert from "node:assert";
import { basename } from "node:path";
import {
  Disposable,
  EventEmitter,
  FileChangeType,
  FileType,
  ProviderResult,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
} from "vscode";
import { concat, map, reduce, sort, zip } from "../util/fu";
import { asPromise } from "../util/promises";
import { trim } from "../util/string";
import { ExtFileChangeEvent, ScratchFileSystemProvider } from "./fs";

export enum SortOrder {
  MostRecent,
  Alphabetical,
}

export const SortOrderLength = Object.keys(SortOrder).length / 2;

abstract class ScratchBase {
  protected constructor(
    readonly uri: Uri,
    readonly parent: ScratchFolder | null,
  ) {}

  abstract isOfType(type: FileType): boolean;

  abstract toTreeItem(): TreeItem;
}

export class ScratchFile extends ScratchBase {
  isPinned: boolean = false;
  mtime: number = 0;

  isOfType = (type: FileType): this is ScratchFile => type === FileType.File;

  toTreeItem = (): TreeItem => ({
    label: basename(this.uri.path),
    resourceUri: this.uri,
    command: {
      command: "vscode.open",
      title: "Open",
      arguments: [this.uri],
    },
    collapsibleState: TreeItemCollapsibleState.None,
    iconPath: ThemeIcon.File,
    contextValue: this.isPinned ? "pinned" : "scratch",
    description: this.isPinned ? "pinned" : undefined,
  });
}

export class ScratchFolder extends ScratchBase {
  static ROOT = new ScratchFolder(Uri.parse("scratch:/"), null);

  // undefined for not-yet-loaded folders
  private _children?: Map<string, ScratchNode>;

  get children(): ScratchNode[] | undefined {
    return this._children ? Array.from(this._children.values()) : undefined;
  }

  /**
   * Adds a child node to this folder.
   * @param type The type of the child node to add.
   * @param name The name or path of the child node to add, can be a
   * /-delimited path to create, in which case the intermediate folders are
   * created as needed. The leading and trailing slashes are trimmed.
   * @returns the created node
   */
  addChild = <T extends FileType>(
    name: string,
    type: T,
  ): T extends FileType.Directory ? ScratchFolder : ScratchFile => {
    this._children = this._children ?? new Map();
    // rest is either undefined or non-empty here due to trim
    const [childName, rest] = trim(name, "/").split("/", 1);
    if (rest) {
      return this.addChild(childName, FileType.Directory).addChild(rest, type);
    }

    let child = this._children.get(childName);
    if (child && !child.isOfType(type)) {
      throw new Error(
        `Cannot add child "${name}": a node with the same name but different type already exists`,
      );
    }

    if (!child) {
      child =
        type === FileType.Directory
          ? new ScratchFolder(Uri.joinPath(this.uri, childName), this)
          : new ScratchFile(Uri.joinPath(this.uri, childName), this);

      this._children.set(childName, child);
    }

    return child as T extends FileType.Directory ? ScratchFolder : ScratchFile;
  };

  /**
   * Removes a child node.
   * @param name The name of a node to remove, or a /-delimited path to a nested node.
   * @returns The parent node of the removed node, or undefined if not found.
   */
  removeChild = (name: string): ScratchNode | undefined => {
    const [childName, rest] = trim(name, "/").split("/", 1);
    const child = this._children?.get(childName);
    if (!child) {
      return undefined;
    }

    if (!rest) {
      this._children?.delete(childName);
      return this;
    }

    if (child.isOfType(FileType.File)) {
      throw new Error(
        `Cannot remove child "${name}": path segment "${childName}" is a file, cannot continue to "${rest}"`,
      );
    }

    return (child as ScratchFolder).removeChild(rest);
  };

  isOfType = (type: FileType): boolean => type === FileType.Directory;

  toTreeItem = (): TreeItem => ({
    label: basename(this.uri.path).substring(1),
    resourceUri: this.uri,
    collapsibleState: TreeItemCollapsibleState.Collapsed,
    iconPath: ThemeIcon.Folder,
    contextValue: "folder",
  });
}

export type ScratchNode = ScratchFolder | ScratchFile;

export class ScratchTreeProvider implements TreeDataProvider<ScratchNode>, Disposable {
  private pinStore: { isPinned: (uri: Uri | string) => boolean };
  private readonly changeTreeDataEvent = new EventEmitter<
    void | ScratchNode | ScratchNode[] | null
  >();

  readonly onDidChangeTreeData = this.changeTreeDataEvent.event;

  constructor(private fs: ScratchFileSystemProvider) {
    this.fs.onDidChangeFile(this.handleFileChangeEvents);
    // FIXME: Fake pin store to avoid falling into the rabbit hole of refactoring
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.pinStore = { isPinned: (_uri: Uri | string) => false };
  }

  private handleFileChangeEvents = (events: readonly ExtFileChangeEvent[]) =>
    this.changeTreeDataEvent.fire(
      events
        .map(({ type, uri, stat }) => {
          if (type === FileChangeType.Deleted) return ScratchFolder.ROOT.removeChild(uri.path);

          const child = ScratchFolder.ROOT.addChild(uri.path, stat!.type);
          if (child instanceof ScratchFile) {
            child.mtime = stat!.mtime;
            child.isPinned = this.pinStore.isPinned(uri);
          }

          return child;
        })
        .filter(node => !!node),
    );

  dispose = () => this.changeTreeDataEvent.dispose();

  getChildren = (
    element: ScratchNode = ScratchFolder.ROOT,
  ): ScratchNode[] | Promise<ScratchNode[]> => {
    assert.ok(element instanceof ScratchFolder, "getChildren called on a file node");

    return (
      element.children ??
      asPromise(this.fs.readDirectory(element.uri))
        .then(children =>
          Promise.all(children.map(([name]) => this.fs.stat(Uri.joinPath(element.uri, name))))
            .then(zip(children))
            .then(
              map(([[name], stat]) => {
                const child = ScratchFolder.ROOT.addChild(name, stat.type);
                if (child instanceof ScratchFile) {
                  child.mtime = stat.mtime;
                  child.isPinned = this.pinStore.isPinned(child.uri.path);
                }
                return child;
              }),
            ),
        )
        .then(
          sort(
            // TODO: proper filtering and sorting
            // TODO: sorting by pinned status is not relevant with
            // subfolders, need to find another way to display pinned items
            sort.desc(sort.byBoolValue(node => node instanceof ScratchFolder)),
            sort.desc(sort.byNumericValue(node => (node instanceof ScratchFile ? node.mtime : 0))),
          ),
        )
    );
  };

  getTreeItem = (element: ScratchNode): TreeItem | Thenable<TreeItem> => element.toTreeItem();

  getParent = (element: ScratchNode): ProviderResult<ScratchNode> => element.parent;

  // Other public methods

  /**
   * Read all ScratchFile nodes in the tree. Uses getChildren internally,
   * which caches the tree structure for performance, so subsequent calls
   * are fast.
   * @param parent The folder to read from, or the root folder by default.
   * @returns A promise that resolves to an array of all ScratchFile nodes.
   */
  getAll = (parent?: ScratchFolder): Promise<ScratchFile[]> =>
    asPromise(this.getChildren(parent ?? ScratchFolder.ROOT)).then(children =>
      Promise.all(children.filter(child => child instanceof ScratchFolder).map(this.getAll)).then(
        reduce(
          concat,
          children.filter(child => child instanceof ScratchFile),
        ),
      ),
    );

  cycleSortOrder = (): SortOrder => {
    // TODO: Placeholder implementation
    return SortOrder.Alphabetical;
  };
}
