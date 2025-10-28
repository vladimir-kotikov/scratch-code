import langMap from "lang-map";
import open from "opener";
import * as path from "path";
import * as vscode from "vscode";
import { Disposable, FileSystemError, RelativePattern, Uri } from "vscode";
import { ScratchFileSystemProvider } from "./providers/fs";
import { Scratch, ScratchTreeProvider } from "./providers/tree";

const CUSTOM_EXTENSIONS_MAP: { [langId: string]: string } = {
  makefile: "",
  ignore: "",
};

function guessExtension(languageId: string): string {
  let ext = CUSTOM_EXTENSIONS_MAP[languageId] ?? langMap.extensions(languageId)[0];
  if (!ext.startsWith(".") && ext !== "") {
    ext = `.${ext}`;
  }

  return ext;
}

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
      new RelativePattern(this.scratchDir, "**/*"),
    );
    this.watcher.onDidChange(() => this.treeDataProvider.reload());
    this.watcher.onDidCreate(() => this.treeDataProvider.reload());
    this.watcher.onDidDelete(() => this.treeDataProvider.reload());
  }

  dispose() {
    this.watcher.dispose();
  }

  newScratch = async (content?: string, languageId?: string) => {
    const suggestedFilename = `scratch${new Date().getTime()}`;
    const suggestedExtension = languageId ? guessExtension(languageId) : ".txt";

    const filename = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      title: "File name for the new scratch",
      value: `${suggestedFilename}${suggestedExtension}`,
      valueSelection: [0, suggestedFilename.length],
    });

    if (!filename) {
      return;
    }

    const uri = Uri.parse(`scratch:/${filename}`);

    let exists = true;
    try {
      await this.fileSystemProvider.stat(uri);
    } catch (e) {
      if (e instanceof FileSystemError && e.code === "FileNotFound") {
        exists = false;
      } else {
        throw e;
      }
    }

    if (exists) {
      const choice = await vscode.window.showInformationMessage(
        `File ${filename} already exists, overwrite?`,
        { modal: true },
        "Yes",
      );

      if (choice !== "Yes") {
        return;
      }
    }

    await this.fileSystemProvider.writeFile(uri, content, { create: true, overwrite: true });
    await vscode.commands.executeCommand("vscode.open", uri);
  };

  newScratchFromBuffer = async () => {
    const currentDocument = vscode.window.activeTextEditor?.document;
    if (!currentDocument) {
      vscode.window.setStatusBarMessage("No document is open", 10 * 1000);
      return;
    }

    return await this.newScratch(currentDocument.getText(), currentDocument.languageId);
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
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await vscode.commands.executeCommand("vscode.open", newUri);
    }
  };

  deleteScratch = async (scratch?: Scratch) => {
    const uri = scratch?.uri ?? currentScratchUri();
    if (!uri) {
      return;
    }

    try {
      await this.fileSystemProvider.delete(uri);
      if (!scratch) {
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      }
    } catch (e) {
      console.warn(`Error while removing ${uri}`, e);
    }
  };

  openDirectory = () => {
    open(this.scratchDir.fsPath);
  };
}
