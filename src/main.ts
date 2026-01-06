import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ScratchExtension } from "./extension";
import { ScratchFileSystemProvider } from "./providers/fs";
import { registerTool, ScratchLmToolkit } from "./providers/lm";
import { ScratchTreeProvider, SortOrder } from "./providers/tree";
import { strip } from "./util/text";
import { uriPath } from "./util/uri";

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

  const fileSystemProvider = new ScratchFileSystemProvider(scratchDir);
  const treeDataProvider = new ScratchTreeProvider(
    fileSystemProvider,
    context.globalState.get("sortOrder", SortOrder.MostRecent),
  );

  const extension = new ScratchExtension(
    fileSystemProvider,
    treeDataProvider,
    context.globalStorageUri,
    context.globalState,
  );

  const lmToolset = new ScratchLmToolkit(fileSystemProvider, treeDataProvider);

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(scratchUriScheme, fileSystemProvider),
    vscode.commands.registerCommand("scratches.newScratch", extension.newScratch),
    vscode.commands.registerCommand("scratches.newFolder", extension.newFolder),
    vscode.commands.registerCommand("scratches.delete", extension.delete),
    vscode.commands.registerCommand("scratches.quickOpen", extension.quickPick),
    vscode.commands.registerCommand("scratches.search.quickSearch", () => extension.quickPick("?")),
    vscode.commands.registerCommand("scratches.search.resetIndex", extension.resetIndex),
    vscode.commands.registerCommand("scratches.renameScratch", extension.rename),
    vscode.commands.registerCommand("scratches.openDirectory", extension.openDirectory),
    vscode.commands.registerCommand("scratches.toggleSort", extension.toggleSortOrder),
    vscode.commands.registerCommand("scratches.pin", extension.pinScratch),
    vscode.commands.registerCommand("scratches.unpin", extension.unpinScratch),
    registerTool("list_scratches", lmToolset.listScratches, {
      invocationMessage: options =>
        `Reading list of scratches${options?.filter ? ` matching "${options.filter}"` : ""}.`,
    }),
    registerTool("read_scratch", lmToolset.readScratch, {
      invocationMessage: ({ uri }) => `Reading ${uri}`,
      confirmationMessage: ({ uri }) => ({
        title: "Read scratch?",
        message: uri.toString(),
      }),
    }),
    registerTool("write_scratch", lmToolset.writeScratch, {
      invocationMessage: ({ uri }) => `Writing ${uri}`,
      confirmationMessage: ({ uri }) => ({
        title: "Write scratch?",
        message: uri.toString(),
      }),
    }),
    registerTool("rename_scratch", lmToolset.renameScratch, {
      invocationMessage: ({ oldUri, newUri }) =>
        `Moving ${oldUri} to ${strip(uriPath(newUri), ["/"])}`,
      confirmationMessage: ({ oldUri, newUri }) => ({
        title: "Move/rename scratch?",
        message: `Move/rename ${oldUri} -> ${strip(uriPath(newUri), ["/"])}.`,
      }),
    }),
    extension,
    treeDataProvider,
  );
}

export function deactivate() {}
