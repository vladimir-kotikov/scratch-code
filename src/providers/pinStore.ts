import { EventEmitter, Uri } from "vscode";
import { filter, pass, pipe, reduce } from "../util/fu";
import { ScratchFileSystemProvider } from "./fs";

export class PinStore {
  private store: Set<string> = new Set();
  private loaded: PromiseLike<void>;

  private _onDidLoad = new EventEmitter<void>();
  onDidLoad = this._onDidLoad.event;

  constructor(
    private storeUri: Uri,
    private fs: ScratchFileSystemProvider,
  ) {
    this.loaded = this.load();
  }

  isPinned = (uri: Uri): boolean => this.store.has(uri.toString());

  get pinned() {
    return Array.from(this.store.values());
  }

  pin = (uri: Uri): void => {
    this.store.add(uri.toString());
    this.save();
  };

  unpin = (uri: Uri): void => {
    this.store.delete(uri.toString());
    this.save();
  };

  private load = () =>
    this.fs
      .readLines(this.storeUri)
      .then(
        pipe(
          filter<string>(line => line.length > 0),
          reduce((s, uri: string) => s.add(uri), this.store),
        ),
        pass,
      )
      .then(() => this._onDidLoad.fire());

  private save = () =>
    this.loaded.then(() => this.fs.writeLines(this.storeUri, this.store.values()));
}
