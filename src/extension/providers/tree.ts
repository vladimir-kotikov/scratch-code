import {
  EventEmitter,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
} from "vscode";
import { ScratchFileSystemProvider } from "./fs";

export class Scratch extends TreeItem {
  constructor(public readonly uri: Uri) {
    super(uri, TreeItemCollapsibleState.None);
    this.command = {
      command: "open",
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

    const files = await this.fileSystem.readDirectory(Uri.parse("scratch:/"));
    return files.map(([filename, _]) => {
      const fileUri = Uri.joinPath(Uri.parse("scratch:/"), filename);
      return new Scratch(fileUri);
    });
  }
}
