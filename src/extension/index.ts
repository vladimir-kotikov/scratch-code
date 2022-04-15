import * as vscode from "vscode";
import { Scratch, ScratchTreeProvider } from "./providers/tree";
import { ScratchFileSystemProvider } from "./providers/fs";
import { FileChangeType, Uri } from "vscode";

function currentScratchUri(): Uri | undefined {
  const maybeUri = vscode.window.activeTextEditor?.document.uri;
  return maybeUri?.scheme === "scratch" ? maybeUri : undefined;
}

export class ScratchExtension {
  readonly fileSystemProvider: ScratchFileSystemProvider;
  readonly treeDataProvider: ScratchTreeProvider;

  constructor(private readonly scratchDir: Uri) {
    vscode.workspace.fs.createDirectory(scratchDir);

    this.fileSystemProvider = new ScratchFileSystemProvider(this.scratchDir);
    this.treeDataProvider = new ScratchTreeProvider(this.fileSystemProvider);

    const isScratchesRootChanged = ({
      type,
      uri,
    }: vscode.FileChangeEvent): boolean =>
      type === FileChangeType.Changed && uri.path === "/";

    this.fileSystemProvider.onDidChangeFile((events) => {
      if (events.some(isScratchesRootChanged)) {
        this.treeDataProvider.reload();
      }
    });
  }

  newScratch = async () => {
    const uri = Uri.parse(`scratch:/scratch${new Date().getTime()}`);
    await this.fileSystemProvider.writeFile(uri);
    await vscode.commands.executeCommand("vscode.open", uri);
  };

  deleteScratch = async (scratch?: Scratch) => {
    let uri = scratch?.uri ?? currentScratchUri();
    if (!uri) {
      return;
    }

    try {
      await this.fileSystemProvider.delete(uri);
    } catch (e) {
      console.warn(`Error while removing ${uri}`, e);
    }
  };
}
