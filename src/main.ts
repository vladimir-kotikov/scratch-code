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
      "codeScratches.newScratch",
      extension.newScratch
    ),
    vscode.commands.registerCommand(
      "codeScratches.reloadScratches",
      extension.reloadScratches
    ),
    vscode.commands.registerCommand(
      "codeScratches.deleteScratch",
      extension.deleteScratch
    )
  );
}

export function deactivate() {}
