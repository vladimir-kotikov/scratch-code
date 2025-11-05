import Fuse, { IFuseOptions } from "fuse.js";
import * as vscode from "vscode";
import { FileSystemProvider, Uri } from "vscode";
import { asPromise, pass } from "../fu";

type SearchDoc = {
  uri: string;
  content: string;
};

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const searchConfig: IFuseOptions<SearchDoc> = {
  keys: ["content", "uri"],
  isCaseSensitive: false,
  includeMatches: true,
  ignoreDiacritics: true,
  threshold: 0.3,
};

export class ScratchSearchProvider {
  private searchIndex = new Fuse<SearchDoc>([], searchConfig);

  constructor(
    private readonly fs: FileSystemProvider,
    private readonly indexFile: Uri,
  ) {
    console.log("ScratchSearchProvider initialized, index file:", indexFile.toString());
  }

  search = (query: string, limit: number = 10) => this.searchIndex.search(query, { limit });

  loadIndex = () =>
    asPromise(
      vscode.workspace.fs.readFile(this.indexFile).then((data) => {
        const raw = JSON.parse(decoder.decode(data));
        const fIndex = Fuse.parseIndex(raw);
        this.searchIndex = new Fuse([], searchConfig, fIndex);
      }),
    );

  saveIndex = () => {
    const rawIndex = this.searchIndex.getIndex().toJSON();
    return vscode.workspace.fs.writeFile(
      this.indexFile,
      Buffer.from(JSON.stringify(rawIndex), "utf8"),
    );
  };

  addFile = (uri: Uri) =>
    asPromise(this.fs.readFile(uri))
      .then((data) => {
        this.searchIndex.add({ uri: uri.toString(), content: decoder.decode(data) });
      })
      .then(pass(uri));

  updateFile = (uri: Uri) => this.removeFile(uri).then(() => this.addFile(uri));

  removeFile = (uri: Uri) =>
    asPromise(this.searchIndex.remove((doc) => doc.uri === uri.toString()));

  removeAll = () => this.searchIndex.setCollection([]);

  get size() {
    return this.searchIndex.getIndex().size();
  }
}
