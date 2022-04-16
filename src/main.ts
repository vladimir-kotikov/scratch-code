import * as vscode from "vscode";
import { ScratchExtension } from "./extension";

const scratchUriScheme = "scratch";

export function activate(context: vscode.ExtensionContext) {
  const scratchDir = vscode.Uri.joinPath(context.globalStorageUri, "scratches");
  const extension = new ScratchExtension(scratchDir);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "scratches",
      extension.treeDataProvider
    ),
    vscode.workspace.registerFileSystemProvider(
      scratchUriScheme,
      extension.fileSystemProvider
    ),
    vscode.commands.registerCommand(
      "scratches.newScratch",
      extension.newScratch
    ),
    vscode.commands.registerCommand(
      "scratches.renameScratch",
      extension.renameScratch
    ),
    vscode.commands.registerCommand(
      "scratches.deleteScratch",
      extension.deleteScratch
    ),
    extension
  );
}

export function deactivate() {}
