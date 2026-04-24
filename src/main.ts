import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ScratchExtension } from "./extension";
import { ScratchFileSystemProvider } from "./providers/fs";
import { registerTool, ScratchLmToolkit } from "./providers/lm";
import { SearchIndexProvider } from "./providers/search";
import { ScratchTreeProvider, SortOrder } from "./providers/tree";
import { strip } from "./util/text";
import { ensureUri, uriPath } from "./util/uri";

const scratchUriScheme = "scratch";

/**
 * Returns a trusted MarkdownString containing a clickable link that opens
 * the given scratch URI in the VS Code editor.
 */
const mdScratchLink = (uri: string | vscode.Uri): vscode.MarkdownString => {
  const scratchUri = `scratch:///${ensureUri(uri).path.replace(/^\//, "")}`;
  const md = new vscode.MarkdownString(
    `[${scratchUri}](command:vscode.open?${encodeURIComponent(JSON.stringify([scratchUri]))})`,
  );
  md.isTrusted = { enabledCommands: ["vscode.open"] };
  return md;
};

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
  vscode.workspace.fs.createDirectory(context.globalStorageUri);

  const fileSystemProvider = new ScratchFileSystemProvider(scratchDir);
  const treeDataProvider = new ScratchTreeProvider(
    fileSystemProvider,
    context.globalState.get("sortOrder", SortOrder.MostRecent),
  );
  const searchIndex = new SearchIndexProvider(scratchDir.fsPath);

  const extension = new ScratchExtension(
    fileSystemProvider,
    treeDataProvider,
    searchIndex,
    context.globalState,
  );

  const lmToolset = new ScratchLmToolkit(fileSystemProvider, treeDataProvider, searchIndex);

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(scratchUriScheme, fileSystemProvider),
    vscode.commands.registerCommand("scratches.newScratch", extension.newScratch),
    vscode.commands.registerCommand("scratches.newFolder", extension.newFolder),
    vscode.commands.registerCommand("scratches.delete", extension.delete),
    vscode.commands.registerCommand("scratches.quickOpen", extension.quickPick),
    vscode.commands.registerCommand("scratches.search.quickSearch", () => extension.quickPick("?")),
    vscode.commands.registerCommand("scratches.renameScratch", extension.rename),
    vscode.commands.registerCommand("scratches.openDirectory", extension.openDirectory),
    vscode.commands.registerCommand("scratches.toggleSort", extension.toggleSortOrder),
    vscode.commands.registerCommand("scratches.pin", extension.pinScratch),
    vscode.commands.registerCommand("scratches.unpin", extension.unpinScratch),
    registerTool("list_scratches", lmToolset.listScratches, {
      invocationMessage: options =>
        `Read list of scratches${options?.filter ? ` matching "${options.filter}"` : ""}.`,
    }),
    registerTool("read_scratch", lmToolset.readScratch, {
      invocationMessage: ({ reads }) =>
        reads.length === 1
          ? `Read ${mdScratchLink(reads[0].uri)}`
          : `Read ${reads.length} scratches`,
      confirmationMessage: ({ reads }) => ({
        title: "Allow reading scratch?",
        message:
          reads.length === 1
            ? mdScratchLink(reads[0].uri)
            : reads.map(r => String(r.uri)).join("\n"),
      }),
    }),
    registerTool("get_scratch_outline", lmToolset.getScratchOutline, {
      invocationMessage: ({ uri }) => `Read outline of ${mdScratchLink(uri)}`,
    }),
    registerTool("edit_scratch", lmToolset.editScratches, {
      invocationMessage: ({ edits }) =>
        edits.length === 1
          ? `Edited ${mdScratchLink(edits[0].uri)}`
          : `Edited ${edits.length} scratches`,
      confirmationMessage: ({ edits }) => ({
        title: `Allow editing scratch${edits.length === 1 ? "" : "es"}?`,
        message:
          edits.length === 1
            ? mdScratchLink(edits[0].uri)
            : edits.map(e => String(e.uri)).join("\n"),
      }),
    }),
    registerTool("write_scratch", lmToolset.writeScratches, {
      invocationMessage: ({ writes }) =>
        writes.length === 1
          ? `Wrote ${mdScratchLink(writes[0].uri)}`
          : `Wrote ${writes.length} scratches`,
      confirmationMessage: ({ writes }) => ({
        title: `Allow writing scratch${writes.length === 1 ? "" : "es"}?`,
        message:
          writes.length === 1
            ? mdScratchLink(writes[0].uri)
            : writes.map(w => String(w.uri)).join(", "),
      }),
    }),
    registerTool("rename_scratch", lmToolset.renameScratch, {
      invocationMessage: ({ oldUri, newUri }) =>
        `Renamed ${mdScratchLink(oldUri)} to ${mdScratchLink(newUri)}`,
      confirmationMessage: ({ oldUri, newUri }) => ({
        title: "Allow move/rename scratch?",
        message: `${String(oldUri)} -> ${strip(uriPath(newUri), ["/"])}.`,
      }),
    }),
    registerTool("search_scratches", lmToolset.searchScratches, {
      invocationMessage: ({ query, filter }) =>
        `Searched for "${query}"${filter ? ` in ${filter}` : ""}`,
    }),
    extension,
    treeDataProvider,
  );
}

export function deactivate() {}
