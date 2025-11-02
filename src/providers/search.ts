import MiniSearch from "minisearch";
import * as vscode from "vscode";
import { FileSystemProvider, Uri } from "vscode";
import { asPromise, map } from "../fu";
import { readTree } from "../util";

const waitAll = Promise.all.bind(Promise);

const searchConfig = { fields: ["content"], idField: "uri" };
type SearchDoc = {
  uri: Uri;
  content: string;
};

export class ScratchSearchProvider {
  searchIndex: MiniSearch<SearchDoc> = new MiniSearch<SearchDoc>({
    fields: ["content"],
    idField: "uri",
  });

  constructor(
    private readonly fs: FileSystemProvider,
    private readonly docRoot: Uri,
    private readonly indexFile: Uri,
  ) {
    this.searchIndex = new MiniSearch<SearchDoc>({ fields: ["content"], idField: "uri" });
  }

  private setIndex = (index: MiniSearch<SearchDoc>) => {
    this.searchIndex = index;
  };

  private populateIndex = () =>
    readTree(this.fs, this.docRoot).then(map(this.addFile)).then(waitAll);

  search = (query: string, limit: number = 10) => this.searchIndex.search(query).slice(0, limit);

  loadIndex = () =>
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Loading search index..." },
      () =>
        vscode.workspace.fs
          .readFile(this.indexFile)
          .then((data) => MiniSearch.loadJSONAsync(data.toString(), searchConfig))
          .then(this.setIndex, this.populateIndex),
    );

  saveIndex = () =>
    vscode.workspace.fs.writeFile(
      this.indexFile,
      Buffer.from(JSON.stringify(this.searchIndex), "utf8"),
    );

  addFile = (uri: Uri) =>
    asPromise(this.fs.readFile(uri)).then((data) =>
      this.searchIndex.add({ uri, content: data.toString() }),
    );

  replaceFile = (uri: Uri) =>
    asPromise(this.fs.readFile(uri)).then((data) =>
      this.searchIndex.replace({ uri, content: data.toString() }),
    );

  discardFile = (uri: Uri) => this.searchIndex.discard(uri);
}
