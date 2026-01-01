import MiniSearch, { Options as SearchOptions, SearchResult } from "minisearch";
import { match, P } from "ts-pattern";
import * as vscode from "vscode";
import { FileChangeType, FileSystemProvider, FileType, Uri } from "vscode";
import { DisposableContainer } from "../util/containers";
import { flat, map } from "../util/fu";
import { asPromise, waitPromises, whenError } from "../util/promises";
import { isaDirectoryError, ScratchFileSystemProvider } from "./fs";

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const searchOptions: SearchOptions = {
  fields: ["path", "content"],
  storeFields: ["path", "content"],
};

export type SearchDoc = {
  id: string;
  path: string;
  content: string;
};

export const readTree = (provider: FileSystemProvider, uri: Uri): PromiseLike<Uri[]> =>
  asPromise(provider.readDirectory(uri))
    .then(
      map(([fileName, fileType]) => {
        return fileType === FileType.Unknown
          ? []
          : fileType === FileType.Directory
            ? readTree(provider, Uri.joinPath(uri, fileName))
            : [Uri.joinPath(uri, fileName)];
      }),
    )
    .then(items => Promise.all(items))
    .then(flat);

const getFirstMatch = (result: SearchResult & SearchDoc) => {
  const [term] =
    Object.entries(result.match).find(([, fields]) => fields.includes("content")) ?? [];

  if (term) {
    const regexp = new RegExp(`(${term})`, "gi");
    const i = result.content.search(regexp);
    return result.content.slice(i, i + 100).split("\n")[0];
  }

  return;
};

export class SearchIndexProvider extends DisposableContainer {
  private index: MiniSearch<SearchDoc> = new MiniSearch<SearchDoc>(searchOptions);

  private _onDidLoad = this.disposeLater(new vscode.EventEmitter<void>());
  private _onLoadError = this.disposeLater(new vscode.EventEmitter<Error>());

  readonly onDidLoad = this._onDidLoad.event;
  readonly onLoadError = this._onLoadError.event;

  constructor(
    private readonly fs: FileSystemProvider,
    private readonly indexFile: Uri,
  ) {
    super();
    this.load();
    this.disposeLater(this.fs.onDidChangeFile(map(this.updateIndexOnFileChange)));
  }

  dispose(): void {
    super.dispose();
    this.save();
  }

  private readDocument = (uri: Uri) =>
    asPromise(this.fs.readFile(uri)).then(
      data => ({
        id: uri.path.substring(1),
        path: uri.path.substring(1),
        content: decoder.decode(data),
      }),
      whenError(isaDirectoryError, () => undefined),
    );

  private updateFile = (uri: Uri) =>
    this.readDocument(uri).then(data => {
      if (!data) return;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      this.index.has(data.id) ? this.index.replace(data) : this.index.add(data);
      return this.save();
    });

  private removeFile = (uri: Uri) => {
    const docId = uri.path.substring(1);
    if (!this.index.has(docId)) return;
    this.index.discard(docId);
    return this.save();
  };

  private updateIndexOnFileChange = (change: vscode.FileChangeEvent) =>
    match(change)
      .with({ type: FileChangeType.Deleted, uri: P.select() }, this.removeFile)
      .with({ type: FileChangeType.Created, uri: P.select() }, this.updateFile)
      .with({ type: FileChangeType.Changed, uri: P.select() }, this.updateFile)
      .otherwise(c => console.error("Unhandled file change event", c));

  search = (query: string): (SearchResult & SearchDoc & { textMatch?: string })[] =>
    this.index
      .search(query === "" ? MiniSearch.wildcard : query, {
        fuzzy: 0.2,
        prefix: true,
        combineWith: "AND",
      })
      .map(result => ({
        ...(result as SearchDoc & SearchResult),
        textMatch: getFirstMatch(result as SearchDoc & SearchResult),
      }));

  load = () =>
    asPromise(vscode.workspace.fs.readFile(this.indexFile))
      .then(data => MiniSearch.loadJSON(data.toString(), searchOptions))
      .then(index => {
        this.index = index;
        this._onDidLoad.fire();
      })
      .catch(err => this._onLoadError.fire(err));

  save = () =>
    vscode.workspace.fs.writeFile(
      this.indexFile,
      Buffer.from(JSON.stringify(this.index.toJSON()), "utf8"),
    );

  reset = () => {
    this.index.removeAll();
    return readTree(this.fs, ScratchFileSystemProvider.ROOT)
      .then(map(this.updateFile))
      .then(waitPromises)
      .then(this.save);
  };

  documentCount = () => this.index.documentCount;
  size = () => JSON.stringify(this.index).length;
}
