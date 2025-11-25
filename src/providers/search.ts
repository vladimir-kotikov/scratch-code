import MiniSearch, { Options as SearchOptions, SearchResult } from "minisearch";
import { match, P } from "ts-pattern";
import * as vscode from "vscode";
import { FileChangeType, FileSystemProvider, Uri } from "vscode";
import { asPromise, map, waitPromises } from "../fu";
import { DisposableContainer, readTree } from "../util";
import { ScratchFileSystemProvider } from "./fs";

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
  private hasChanged = false;
  private saveTimer: NodeJS.Timeout;
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
    this.disposeLater(this.fs.onDidChangeFile(map(this.updateIndexOnFileChange)));
    this.saveTimer = setInterval(this.save, 15 * 60 * 1000);
  }

  dispose(): void {
    super.dispose();
    clearInterval(this.saveTimer);
    this.save();
  }

  private readDocument = (uri: Uri) =>
    asPromise(this.fs.readFile(uri)).then(data => ({
      id: uri.path.substring(1),
      path: uri.path.substring(1),
      content: decoder.decode(data),
    }));

  private addFile = (uri: Uri) =>
    this.readDocument(uri)
      .then(data => this.index.add(data))
      .then(() => (this.hasChanged = true));

  private updateFile = (uri: Uri) =>
    this.readDocument(uri)
      .then(data => this.index.replace(data))
      .then(() => (this.hasChanged = true));

  private removeFile = (uri: Uri) => {
    this.index.discard(uri.path.substring(1));
    this.hasChanged = true;
  };

  private updateIndexOnFileChange = (change: vscode.FileChangeEvent) =>
    match(change)
      .with({ type: FileChangeType.Deleted, uri: P.select() }, this.removeFile)
      .with({ type: FileChangeType.Created, uri: P.select() }, this.addFile)
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
    this.hasChanged &&
    vscode.workspace.fs
      .writeFile(this.indexFile, Buffer.from(JSON.stringify(this.index.toJSON()), "utf8"))
      .then(() => (this.hasChanged = false));

  reset = () => {
    this.index.removeAll();
    this.hasChanged = true;
    return readTree(this.fs, ScratchFileSystemProvider.ROOT)
      .then(map(this.addFile))
      .then(waitPromises)
      .then(this.save);
  };

  size = () => this.index.documentCount;
}
