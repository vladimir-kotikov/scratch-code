import { EventEmitter, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri } from "vscode";
import { ScratchFileSystemProvider } from "./fs";

const IGNORED_FILES = new Set([".DS_Store"]);

export class Scratch extends TreeItem {
  constructor(public readonly uri: Uri) {
    // trim leading slash
    const label = uri.path.substring(1);
    super(label, TreeItemCollapsibleState.None);
    this.command = {
      command: "vscode.open",
      title: "Open",
      arguments: [uri],
    };
  }
}
export class ScratchTreeProvider implements TreeDataProvider<Scratch> {
  private _onDidChangeTreeData = new EventEmitter<Scratch | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly fileSystem: ScratchFileSystemProvider) {}

  getTreeItem(element: Scratch): TreeItem {
    return element;
  }

  reload() {
    this._onDidChangeTreeData.fire(undefined);
  }

  async getChildren(element?: Scratch): Promise<Scratch[]> {
    if (element) {
      return Promise.resolve([]);
    }

    const files = await this.fileSystem.readDirectoryRecursively(Uri.parse("scratch:/"));

    return files
      .filter((uri) => !IGNORED_FILES.has(uri.path))
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((uri) => new Scratch(uri));
  }
}
