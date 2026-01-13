import assert from "node:assert";
import { basename } from "node:path";
import {
  EventEmitter,
  FileChangeType,
  FileStat,
  FileType,
  ProviderResult,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
} from "vscode";
import { DisposableContainer } from "../util/containers";
import { concat, map, prop, reduce, sort, zip } from "../util/fu";
import { asPromise } from "../util/promises";
import { strip } from "../util/text";
import { ExtFileChangeEvent, ScratchFileSystemProvider } from "./fs";
import { PinStateChangeEvent, PinStore } from "./pinStore";

const IGNORED_FILES = new Set([".DS_Store", ".pinstore"]);

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

  readonly isFile = true;
  readonly isDirectory = false;

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

  static resetRoot = () => {
    ScratchFolder.ROOT = new ScratchFolder(Uri.parse("scratch:/"), null);
  };

  constructor(uri: Uri, parent: ScratchFolder | null) {
    super(uri, parent);
  }

  // undefined for not-yet-loaded folders
  private _children?: Map<string, ScratchNode>;

  get children(): ScratchNode[] | undefined {
    return this._children ? Array.from(this._children.values()) : undefined;
  }

  getChild = (name: string): ScratchNode | undefined => {
    const [childName, rest] = strip(name, "/").split("/", 1);
    const child = this._children?.get(childName);

    if (!rest) {
      return child;
    }

    if (!child || child.isFile) {
      return undefined;
    }

    return child.getChild(rest);
  };

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
    const [childName, rest] = strip(name, "/").split("/", 1);
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
    const [childName, rest] = strip(name, "/").split("/", 1);
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

  readonly isFile = false;
  readonly isDirectory = true;

  isOfType = (type: FileType): boolean => type === FileType.Directory;

  toTreeItem = (): TreeItem => ({
    label: strip(basename(this.uri.path), "/"),
    resourceUri: this.uri,
    collapsibleState: TreeItemCollapsibleState.Collapsed,
    iconPath: ThemeIcon.Folder,
    contextValue: "folder",
  });
}

export type ScratchNode = ScratchFolder | ScratchFile;

export enum SortOrder {
  MostRecent,
  Alphabetical,
}

export const SortOrderLength = Object.keys(SortOrder).length / 2;

export class ScratchTreeProvider
  extends DisposableContainer
  implements TreeDataProvider<ScratchNode>
{
  private _onDidChangeTreeData = new EventEmitter<ScratchNode | ScratchNode[] | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly fileSystem: ScratchFileSystemProvider,
    private readonly pinStore: PinStore,
    private _sortOrder = SortOrder.MostRecent,
  ) {
    super();
    // Reset root for each provider instance to avoid stale cache across uses/tests
    ScratchFolder.resetRoot();
    this.disposeLater(this.fileSystem.onDidChangeFile(this.handleFileChangeEvents));

    this.disposeLater(this.pinStore.onDidChangeState(this.handlePinStateChangeEvents));
  }

  private handlePinStateChangeEvents = (events: readonly PinStateChangeEvent[]) =>
    this._onDidChangeTreeData.fire(
      events.reduce<ScratchFile[]>((changed, { uri, isPinned }) => {
        const child = ScratchFolder.ROOT.getChild(uri.path);
        if (child && child.isFile && child.isPinned !== isPinned) {
          child.isPinned = isPinned;
          changed.push(child);
        }
        return changed;
      }, []),
    );

  private handleFileChangeEvents = (events: readonly ExtFileChangeEvent[]) =>
    this._onDidChangeTreeData.fire(
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

  getChildren = (
    element: ScratchNode = ScratchFolder.ROOT,
  ): ScratchNode[] | Promise<ScratchNode[]> => {
    assert.ok(element instanceof ScratchFolder, "getChildren called on a file node");

    const loadedChildren = element.children
      ? Promise.resolve(element.children)
      : asPromise(this.fileSystem.readDirectory(element.uri))
          .then(children => {
            const filtered = children.filter(([name]) => !IGNORED_FILES.has(name));
            return Promise.all(
              filtered.map(([name]) => this.fileSystem.stat(Uri.joinPath(element.uri, name))),
            ).then(stats => zip(filtered)(stats));
          })
          .then(
            map(([[name], stat]) => {
              const fileStat = stat as FileStat;
              const child = element.addChild(name, fileStat.type);
              if (child instanceof ScratchFile) {
                child.mtime = fileStat.mtime;
                child.isPinned = this.pinStore.isPinned(child.uri);
              }
              return child;
            }),
          );

    return loadedChildren.then(
      sort<ScratchFile | ScratchFolder>(
        // Order of comparators matters: LEFTMOST has highest precedence.
        // 1) Group: folders before files (mask out SymbolicLink bit)
        sort.byBoolValue(prop("isDirectory")),
        // 2) Within folders: always alphabetical, independent of tree sort order
        sort.group(
          (node): node is ScratchFolder => node.isDirectory,
          sort.byStringValue(({ uri }) => uri.path),
        ),
        // 3) Within files: pinned first, then by sort order
        sort.group(
          (node): node is ScratchFile => node.isFile,
          sort.byBoolValue(prop("isPinned")),
          this.sortOrder === SortOrder.MostRecent
            ? sort.desc(sort.byNumericValue(prop("mtime")))
            : sort.byStringValue(({ uri }) => uri.path),
        ),
      ),
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
      Promise.all(children.filter(child => child.isDirectory).map(this.getAll)).then(
        reduce(
          concat,
          children.filter(child => child.isFile),
        ),
      ),
    );

  get sortOrder(): SortOrder {
    return this._sortOrder;
  }

  setSortOrder = (order: SortOrder) => {
    if (order !== this._sortOrder) {
      this._sortOrder = order;
      this._onDidChangeTreeData.fire(undefined);
    }
  };
}
