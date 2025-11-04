import MiniSearch from "minisearch";
import * as vscode from "vscode";
import { FileSystemProvider, Uri } from "vscode";
import { asPromise, pass } from "../fu";

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const searchConfig = { fields: ["content", "uri"], idField: "uri", searchOptions: { fuzzy: 0.2 } };
type SearchDoc = {
  uri: string;
  content: string;
};

export class ScratchSearchProvider {
  searchIndex: MiniSearch<SearchDoc> = new MiniSearch<SearchDoc>({
    fields: ["content"],
    idField: "uri",
  });

  constructor(
    private readonly fs: FileSystemProvider,
    private readonly indexFile: Uri,
  ) {
    this.searchIndex = new MiniSearch<SearchDoc>({ fields: ["content"], idField: "uri" });
  }

  search = (query: string, limit: number = 10) => this.searchIndex.search(query).slice(0, limit);

  loadIndex = () =>
    asPromise(
      vscode.workspace.fs
        .readFile(this.indexFile)
        .then((data) => MiniSearch.loadJSONAsync(data.toString(), searchConfig))
        .then((index) => (this.searchIndex = index)),
    );

  saveIndex = () =>
    vscode.workspace.fs.writeFile(
      this.indexFile,
      Buffer.from(JSON.stringify(this.searchIndex), "utf8"),
    );

  addFile = (uri: Uri) =>
    asPromise(this.fs.readFile(uri))
      .then((data) => {
        this.searchIndex.add({ uri: uri.toString(), content: decoder.decode(data) });
      })
      .then(pass(uri));

  updateFile = (uri: Uri) =>
    asPromise(this.fs.readFile(uri))
      .then((data) =>
        this.searchIndex.replace({ uri: uri.toString(), content: decoder.decode(data) }),
      )
      .then(pass(uri));

  removeFile = (uri: Uri) => this.searchIndex.discard(uri.toString());

  removeAll = () => this.searchIndex.removeAll();
}
