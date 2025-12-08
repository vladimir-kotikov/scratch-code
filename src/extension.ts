import langMap from "lang-map";
import * as path from "path";
import * as vscode from "vscode";
import { Disposable, LanguageModelChatMessage, Uri } from "vscode";
import { isFileExistsError, ScratchFileSystemProvider } from "./providers/fs";
import { SearchIndexProvider } from "./providers/search";
import {
  Scratch,
  ScratchQuickPickItem,
  ScratchTreeProvider,
  SortOrder,
  SortOrderLength,
} from "./providers/tree";
import { DisposableContainer } from "./util/disposable";
import * as editor from "./util/editor";
import { map, pass } from "./util/fu";
import { waitPromises, whenError } from "./util/promises";
import * as prompt from "./util/prompt";
import { isUserCancelled, Separator, separator } from "./util/prompt";

const extOverrides: Record<string, string> = {
  makefile: "",
  ignore: "",
  plaintext: "",
  shellscript: "sh",
};

const splitLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

export const inferExtension = (doc: vscode.TextDocument): string => {
  if (doc.isUntitled) {
    const ext = extOverrides[doc.languageId] ?? langMap.extensions(doc.languageId)[0];
    return ext ? `.${ext}` : "";
  }
  return path.extname(doc.fileName);
};

const suggestFilenames = (doc: vscode.TextDocument) => {
  const ANNOTATION_PROMPT = `Suggest 5 concise and descriptive filenames for a snippet ${doc.languageId !== "plaintext" ? `in ${doc.languageId} language` : ""} below. The filenames should accurately reflect the content and purpose of the text and should not exceed 50 characters. Output each filename on a new line without any additional explanation or formatting.`;

  return vscode.lm
    .selectChatModels({
      vendor: "copilot",
      family: "gpt-4o-mini",
    })
    .then(models =>
      models[0]
        ?.sendRequest(
          [
            LanguageModelChatMessage.User(ANNOTATION_PROMPT),
            LanguageModelChatMessage.User(doc.getText().substring(0, 1000)),
          ],
          { justification: "Generate filenames for scratch file" },
        )
        .then(async resp => {
          let choices = "";
          for await (const chunk of resp.text) {
            choices += chunk;
          }
          return splitLines(choices).slice(0, 5);
        }),
    );
};

type Predicate<T> = (item: T, index: number, array: T[]) => boolean;

const insertBefore =
  <T>(predicate: Predicate<T>, item: T) =>
  (arr: T[]) => {
    const index = arr.findIndex(predicate);
    return index !== -1 ? arr.toSpliced(index, 0, item) : arr;
  };

function currentScratchUri(): Uri | undefined {
  const maybeUri = vscode.window.activeTextEditor?.document.uri;
  return maybeUri?.scheme === "scratch" ? maybeUri : undefined;
}

// TODO: Check and handle corner cases:
// - delay updating the index in watcher events until the index is loaded/populated
// - check the index validity when loading from disk and prune missing entries

export class ScratchExtension extends DisposableContainer implements Disposable {
  readonly fileSystemProvider: ScratchFileSystemProvider;
  readonly treeDataProvider: ScratchTreeProvider;
  private readonly index: SearchIndexProvider;

  public scratchesDragAndDropController!: vscode.TreeDragAndDropController<Scratch>;

  constructor(
    private readonly scratchDir: Uri,
    private readonly storageDir: vscode.Uri,
    private readonly globalState: vscode.Memento,
  ) {
    super();

    [scratchDir, storageDir].forEach(vscode.workspace.fs.createDirectory);

    this.fileSystemProvider = this.disposeLater(new ScratchFileSystemProvider(this.scratchDir));
    this.disposeLater(
      // start watcher so other components can rely on it being active
      this.fileSystemProvider.watch(ScratchFileSystemProvider.ROOT, {
        recursive: true,
      }),
    );

    this.treeDataProvider = this.disposeLater(
      new ScratchTreeProvider(
        this.fileSystemProvider,
        this.globalState.get("sortOrder", SortOrder.MostRecent),
      ),
    );

    // Refactored drag-and-drop controller for scratches view
    this.scratchesDragAndDropController = {
      dragMimeTypes: ["text/uri-list", "text/plain"],
      dropMimeTypes: ["text/uri-list", "text/plain"],
      handleDrop: this.handleDrop,
      handleDrag: (
        sources: Scratch[],
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken,
      ) =>
        Promise.all(
          sources
            .filter(s => s?.uri)
            .map(scratch =>
              this.fileSystemProvider.readFile(scratch.uri).then(
                content => {
                  dataTransfer.set(
                    "text/uri-list",
                    new vscode.DataTransferItem(scratch.uri.toString()),
                  );
                  dataTransfer.set(
                    "text/plain",
                    new vscode.DataTransferItem(Buffer.from(content).toString("utf8")),
                  );
                },
                () => {
                  dataTransfer.set(
                    "text/uri-list",
                    new vscode.DataTransferItem(scratch.uri.toString()),
                  );
                },
              ),
            ),
        ).then(() => void 0),
    };

    this.disposeLater(
      vscode.window.createTreeView("scratches", {
        treeDataProvider: this.treeDataProvider,
        dragAndDropController: this.scratchesDragAndDropController,
      }),
    );

    this.index = this.disposeLater(
      new SearchIndexProvider(
        this.fileSystemProvider,
        Uri.joinPath(this.storageDir, "searchIndex.json"),
      ),
    );
    this.disposables.push(
      this.index.onDidLoad(() =>
        prompt.info(`Index ready, ${this.index.size()} documents in index`),
      ),
      this.index.onLoadError(err => {
        this.index.reset();
        prompt.warn(`Index corrupted (${err}). Rebuilding...`);
      }),
    );
  }

  private getQuickPickItems = () =>
    this.treeDataProvider
      .getFlatTree(this.treeDataProvider.sortOrder)
      .then(map(scratch => scratch.toQuickPickItem()))
      .then(
        insertBefore<ScratchQuickPickItem | Separator>(
          (item, i) =>
            item.kind !== vscode.QuickPickItemKind.Separator && !item.scratch.isPinned && i > 0,
          separator,
        ),
      );

  private getQuickSearchItems = (value?: string) =>
    this.index.search(value ?? "").map(result => ({
      label: result.path,
      detail: result.textMatch,
      iconPath: vscode.ThemeIcon.File,
      uri: Uri.joinPath(ScratchFileSystemProvider.ROOT, result.path),
    }));

  private handleDrop = (_target: Scratch | undefined, dataTransfer: vscode.DataTransfer) => {
    const file = dataTransfer.get("text/plain")?.asFile();
    return file
      ? file
          .data()
          .then(data => this.newScratch(file.name, data))
          .then(pass())
      : dataTransfer
          .get("text/uri-list")
          ?.asString()
          .then(uris =>
            splitLines(uris)
              .map(line => Uri.parse(line))
              .filter(uri => uri.scheme !== "scratch")
              .map(uri => this.newScratchFromFile(uri)),
          )
          .then(waitPromises)
          .then(pass());
  };

  newScratch = async (filename: string, content: string | Uint8Array) => {
    const uri = Uri.parse(`scratch:/${filename}`);
    return this.fileSystemProvider
      .writeFile(uri, content, { create: true, overwrite: false })
      .catch(
        whenError(isFileExistsError, () =>
          prompt
            .confirm(`File ${filename} already exists, overwrite?`)
            .then(() => this.fileSystemProvider.writeFile(uri, content)),
        ),
      )
      .then(() => uri);
  };

  newScratchFromBuffer = async () =>
    prompt.UserCancelled.rejectIfUndefined(editor.getCurrent()).then(e => {
      // Heuristic is the following:
      // if the file is not untitled and have a name - use that
      // if the file is untitled and is not empty - infer the name from content
      //   and offer a few alternatives from the language model
      // if the file is empty - ask to input the name
      const text = e.document.getText().trim();

      const getFilename =
        text.length !== 0
          ? prompt.pickText(
              () =>
                suggestFilenames(e.document).then(filenames =>
                  !e.document.isUntitled
                    ? [path.basename(e.document.fileName), ...filenames]
                    : filenames,
                ),
              {
                placeholder: "Select a filename",
                customChoice: {
                  label: "Create",
                  iconPath: { id: "plus" },
                },
              },
            )
          : prompt.input("Enter a filename", "Scratch" + inferExtension(e.document), {
              valueSelection: [0, "Scratch".length],
            });

      return getFilename
        .then(filename =>
          this.newScratch(filename + inferExtension(e.document), text)
            .then(uri =>
              e.document.isUntitled
                ? editor.clear(e).then(editor.closeCurrent).then(pass(uri))
                : uri,
            )
            .then(editor.openDocument),
        )
        .catch(whenError(isUserCancelled, pass()));
    });

  private newScratchFromFile = async (uri: Uri) =>
    uri.fsPath === "/"
      ? this.newScratchFromBuffer()
      : vscode.workspace.fs
          .readFile(uri)
          .then(content => this.newScratch(path.basename(uri.path), content));

  quickOpen = () =>
    prompt
      .pick<ScratchQuickPickItem>(this.getQuickPickItems, {
        buttons: {
          "Pin scratch": (item, picker) => {
            this.pinScratch(item.scratch);
            this.getQuickPickItems().then(items => (picker.items = items));
          },
          "Unpin scratch": (item, picker) => {
            this.unpinScratch(item.scratch);
            this.getQuickPickItems().then(items => (picker.items = items));
          },
        },
      })
      .then(item => editor.openDocument(item.scratch.uri), whenError(isUserCancelled, pass()));

  quickSearch = () =>
    prompt
      .pick<vscode.QuickPickItem & { uri: vscode.Uri }>(this.getQuickSearchItems, {
        onDidChangeValue: (value, picker) => (picker.items = this.getQuickSearchItems(value)),
        matchOnDescription: true,
        matchOnDetail: true,
      })
      .then(item => editor.openDocument(item.uri), whenError(isUserCancelled, pass()));

  resetIndex = async () =>
    this.index
      .reset()
      .then(() =>
        vscode.window.showInformationMessage(
          "Scratches: search index rebuilt, documents: " + this.index.size(),
        ),
      );

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
      await editor.closeCurrent();
      await editor.openDocument(newUri);
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
        await editor.closeCurrent();
      }
    } catch (e) {
      console.warn(`Error while removing ${uri}`, e);
    }
  };

  toggleSortOrder = () => {
    const order = (this.treeDataProvider.sortOrder + 1) % SortOrderLength;
    this.treeDataProvider.setSortOrder(order);
    this.globalState.update("sortOrder", order);
  };

  openDirectory = () => vscode.commands.executeCommand("revealFileInOS", this.scratchDir);

  pinScratch = async (scratch?: Scratch) =>
    this.treeDataProvider.pinScratch(scratch ?? this.treeDataProvider.getItem(currentScratchUri()));

  unpinScratch = async (scratch?: Scratch) =>
    this.treeDataProvider.unpinScratch(
      scratch ?? this.treeDataProvider.getItem(currentScratchUri()),
    );
}
