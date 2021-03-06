import * as path from "path";
import * as vscode from "vscode";
import { Disposable, RelativePattern, Uri } from "vscode";
import { ScratchFileSystemProvider } from "./providers/fs";
import { Scratch, ScratchTreeProvider } from "./providers/tree";

function currentScratchUri(): Uri | undefined {
  const maybeUri = vscode.window.activeTextEditor?.document.uri;
  return maybeUri?.scheme === "scratch" ? maybeUri : undefined;
}

export class ScratchExtension implements Disposable {
  readonly fileSystemProvider: ScratchFileSystemProvider;
  readonly treeDataProvider: ScratchTreeProvider;
  private readonly watcher: vscode.FileSystemWatcher;

  constructor(private readonly scratchDir: Uri) {
    vscode.workspace.fs.createDirectory(scratchDir);

    this.fileSystemProvider = new ScratchFileSystemProvider(this.scratchDir);
    this.treeDataProvider = new ScratchTreeProvider(this.fileSystemProvider);

    this.watcher = vscode.workspace.createFileSystemWatcher(
      new RelativePattern(this.scratchDir, "**/*")
    );
    this.watcher.onDidChange(() => this.treeDataProvider.reload());
    this.watcher.onDidCreate(() => this.treeDataProvider.reload());
    this.watcher.onDidDelete(() => this.treeDataProvider.reload());
  }

  dispose() {
    this.watcher.dispose();
  }

  newScratch = async () => {
    const uri = Uri.parse(`scratch:/scratch${new Date().getTime()}`);
    await this.fileSystemProvider.writeFile(uri);
    await vscode.commands.executeCommand("vscode.open", uri);
  };

  renameScratch = async (scratch?: Scratch) => {
    const uri = scratch?.uri ?? currentScratchUri();
    if (!uri) {
      return;
    }

    const fileName = path.basename(uri.path);
    const newName = await vscode.window.showInputBox({
      prompt: "Rename scratch",
      value: fileName,
      valueSelection: [0, 0],
    });

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
      await vscode.commands.executeCommand(
        "workbench.action.closeActiveEditor"
      );
      await vscode.commands.executeCommand("vscode.open", newUri);
    }
  };

  deleteScratch = async (scratch?: Scratch) => {
    let uri = scratch?.uri ?? currentScratchUri();
    if (!uri) {
      return;
    }

    try {
      await this.fileSystemProvider.delete(uri);
      if (!scratch) {
        await vscode.commands.executeCommand(
          "workbench.action.closeActiveEditor"
        );
      }
    } catch (e) {
      console.warn(`Error while removing ${uri}`, e);
    }
  };
}
