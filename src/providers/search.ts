import MiniSearch, { Options as SearchOptions, SearchResult } from "minisearch";
import * as vscode from "vscode";
import { FileSystemProvider, Uri } from "vscode";
import { asPromise, pass } from "../fu";

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

export class ScratchSearchProvider {
  searchIndex: MiniSearch<SearchDoc> = new MiniSearch<SearchDoc>(searchOptions);

  constructor(
    private readonly fs: FileSystemProvider,
    private readonly indexFile: Uri,
  ) {}

  private readDocument = (uri: Uri) =>
    asPromise(this.fs.readFile(uri)).then((data) => ({
      id: uri.path.substring(1),
      path: uri.path.substring(1),
      content: decoder.decode(data),
    }));

  search = (query: string): (SearchResult & SearchDoc & { textMatch?: string })[] =>
    this.searchIndex
      .search(query === "" ? MiniSearch.wildcard : query, {
        fuzzy: 0.2,
        prefix: true,
        combineWith: "AND",
      })
      .map((result) => ({
        ...(result as SearchDoc & SearchResult),
        textMatch: getFirstMatch(result as SearchDoc & SearchResult),
      }));

  loadIndex = () =>
    asPromise(vscode.workspace.fs.readFile(this.indexFile))
      .then((data) => MiniSearch.loadJSON(data.toString(), searchOptions))
      .then((index) => (this.searchIndex = index));

  saveIndex = () =>
    vscode.workspace.fs.writeFile(
      this.indexFile,
      Buffer.from(JSON.stringify(this.searchIndex.toJSON()), "utf8"),
    );

  addFile = (uri: Uri) =>
    this.readDocument(uri)
      .then((data) => this.searchIndex.add(data))
      .then(pass(uri));

  updateFile = (uri: Uri) =>
    this.readDocument(uri)
      .then((data) => this.searchIndex.replace(data))
      .then(pass(uri));

  removeFile = (uri: Uri) => this.searchIndex.discard(uri.path.substring(1));

  removeAll = () => this.searchIndex.removeAll();

  size = () => this.searchIndex.documentCount;
}
