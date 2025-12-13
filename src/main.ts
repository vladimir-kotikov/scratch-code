import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ScratchExtension } from "./extension";

const scratchUriScheme = "scratch";

export function activate(context: vscode.ExtensionContext) {
  let scratchDirSetting: string | undefined = vscode.workspace
    .getConfiguration("scratches")
    .get("scratchDirectory");

  let scratchDir = vscode.Uri.joinPath(context.globalStorageUri, "scratches");
  if (scratchDirSetting) {
    if (scratchDirSetting.startsWith("~")) {
      scratchDirSetting = scratchDirSetting.replace("~", os.homedir());
    }
    scratchDir = vscode.Uri.parse(path.normalize(scratchDirSetting));
  }

  vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration("scratches")) {
      vscode.window.showWarningMessage(
        "Scratches extension's configuration changed, reload window to apply new configuration.",
      );
    }
  });

  const extension = new ScratchExtension(scratchDir, context.globalStorageUri, context.globalState);

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(scratchUriScheme, extension.fileSystemProvider),
    vscode.commands.registerCommand("scratches.newScratch", extension.newScratch),
    vscode.commands.registerCommand("scratches.newFolder", extension.newFolder),
    vscode.commands.registerCommand("scratches.delete", extension.delete),
    vscode.commands.registerCommand("scratches.quickOpen", extension.quickOpen),
    vscode.commands.registerCommand("scratches.search.quickSearch", extension.quickSearch),
    vscode.commands.registerCommand("scratches.search.resetIndex", extension.resetIndex),
    vscode.commands.registerCommand("scratches.renameScratch", extension.renameScratch),
    vscode.commands.registerCommand("scratches.openDirectory", extension.openDirectory),
    vscode.commands.registerCommand("scratches.toggleSort", extension.toggleSortOrder),
    vscode.commands.registerCommand("scratches.pin", extension.pinScratch),
    vscode.commands.registerCommand("scratches.unpin", extension.unpinScratch),
    extension,
  );
}

export function deactivate() {}
