import langMap from "lang-map";
import * as path from "path";
import * as vscode from "vscode";
import { Disposable, LanguageModelChatMessage, QuickPickItem, Uri } from "vscode";
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
import { asPromise, waitPromises, whenError } from "./util/promises";
import * as prompt from "./util/prompt";
import { isUserCancelled, Separator, separator } from "./util/prompt";

const extOverrides: Record<string, string> = {
  makefile: "",
  ignore: "",
  plaintext: "",
  shellscript: "sh",
};

const once = <T>(fn: () => T): (() => T) => {
  let called = false;
  let result: T;
  return () => {
    if (!called) {
      called = true;
      result = fn();
    }
    return result;
  };
};

const splitLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

const stripChars = (str: string, chars: string): string => {
  let start = 0;
  let end = str.length;

  const charSet = new Set(chars.split(""));

  while (start < end && charSet.has(str[start])) {
    ++start;
  }

  while (end > start && charSet.has(str[end - 1])) {
    --end;
  }

  return start > 0 || end < str.length ? str.substring(start, end) : str;
};

const getFirstChars = (n: number, doc: vscode.TextDocument): string => {
  let lineNo = 0;
  let result = "";

  while (lineNo < doc.lineCount && result.length < n) {
    const lineText = doc
      .lineAt(lineNo)
      .text.trim()
      .slice(0, n - result.length);
    result += stripChars(lineText.replace(/[^a-zA-Z0-9_]/g, "_"), "_");
    lineNo++;
  }

  return result.slice(0, n);
};

export const inferExtension = (doc: vscode.TextDocument): string => {
  if (doc.isUntitled) {
    const ext = extOverrides[doc.languageId] ?? langMap.extensions(doc.languageId)[0];
    return ext ? `.${ext}` : "";
  }
  return path.extname(doc.fileName);
};

export const inferFilename = (doc: vscode.TextDocument): string => {
  // The heuristic to infer a filename is:
  // - if the document has a file name, use that
  // - if no filename
  //   - use the content's first lines for filename, cleaned up
  //     to be a valid filename
  //   - if content is empty, use "scratch-<current_datetime_iso>" as the base name
  if (!doc.isUntitled) {
    return path.basename(doc.fileName, path.extname(doc.fileName));
  }

  let baseName = getFirstChars(30, doc);
  if (baseName.length === 0) {
    const formattedDate = new Date()
      .toISOString()
      .replace(/:/g, "-")
      .replace("T", "_")
      .split(".")[0];
    baseName = `scratch-${formattedDate}`;
  }

  return baseName;
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

    this.disposeLater(
      vscode.window.createTreeView("scratches", {
        treeDataProvider: this.treeDataProvider,
        dragAndDropController: {
          dragMimeTypes: [],
          dropMimeTypes: ["text/uri-list", "text/plain"],
          handleDrop: this.handleDrop,
        },
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
      const inferFilenames = once(() => {
        const ANNOTATION_PROMPT = `Your task is to suggest up to 5 concise and descriptive filenames for a snippet ${e.document.languageId !== "plaintext" ? `in ${e.document.languageId} language` : ""} provided by the user. The filenames should accurately reflect the content and purpose of the text. Each filename length should not exceed 50 characters. Provide each filename on a new line without any additional explanation or formatting.`;

        // TODO: fallback when model is not available
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
                  LanguageModelChatMessage.User(e.document.getText().substring(0, 1000)),
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
          )
          .then(filenames =>
            filenames.map(name => ({
              label: name,
            })),
          );
      });
      const getFilename = !e.document.isUntitled
        ? asPromise(path.basename(e.document.fileName))
        : text.length !== 0
          ? prompt
              .pick<QuickPickItem>(inferFilenames, {
                onDidChangeValue: (value, _, setItems) => {
                  setItems(() =>
                    // FIXME: This causes flicker when typing fast, consider:
                    // - modifying added item by reference
                    // - debouncing
                    // - setting items synchronously
                    inferFilenames().then(items => [
                      ...items,
                      {
                        label: value,
                        iconPath: { id: "plus" },
                        description: "Create scratch: " + value,
                      },
                    ]),
                  );
                },
              })
              .then(item => item.label)
          : prompt.input("Enter scratch filename", "Scratch" + inferExtension(e.document), {
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
          "Pin scratch": (item, setItems) => {
            this.pinScratch(item.scratch);
            setItems(this.getQuickPickItems);
          },
          "Unpin scratch": (item, setItems) => {
            this.unpinScratch(item.scratch);
            setItems(this.getQuickPickItems);
          },
        },
      })
      .then(item => editor.openDocument(item.scratch.uri), whenError(isUserCancelled, pass()));

  quickSearch = () =>
    prompt
      .pick<vscode.QuickPickItem & { uri: vscode.Uri }>(this.getQuickSearchItems, {
        onDidChangeValue: (value, _, setItems) => setItems(() => this.getQuickSearchItems(value)),
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
