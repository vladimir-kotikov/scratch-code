import { EventEmitter, Uri } from "vscode";
import { filter, pipe, reduce } from "../util/fu";
import { ScratchFileSystemProvider } from "./fs";

export type PinStateChangeEvent = {
  uri: Uri;
  isPinned: boolean;
};

export class PinStore {
  private store: Set<string> = new Set();
  private loaded: PromiseLike<void>;
  private readonly storeUri: Uri;

  private _onDidLoad = new EventEmitter<void>();
  private _onDidChangeState = new EventEmitter<readonly PinStateChangeEvent[]>();
  onDidLoad = this._onDidLoad.event;
  onDidChangeState = this._onDidChangeState.event;

  constructor(
    private fs: ScratchFileSystemProvider,
    storeName: string = ".pinstore",
  ) {
    this.storeUri = Uri.joinPath(ScratchFileSystemProvider.ROOT, storeName);
    this.loaded = this.load();
  }

  isPinned = (uri: Uri): boolean => this.store.has(uri.toString());

  get pinned() {
    return Array.from(this.store.values());
  }

  pin = (uri: Uri): void => {
    this.store.add(uri.toString());
    this._onDidChangeState.fire([{ uri, isPinned: true }]);
    this.save();
  };

  unpin = (uri: Uri): void => {
    this.store.delete(uri.toString());
    this._onDidChangeState.fire([{ uri, isPinned: false }]);
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
      )
      .then(() => {
        this._onDidChangeState.fire(
          Array.from(this.store.values()).map(uriString => ({
            uri: Uri.parse(uriString),
            isPinned: true,
          })),
        );
        this._onDidLoad.fire();
      });

  private save = () =>
    this.loaded.then(() => this.fs.writeLines(this.storeUri, this.store.values()));
}
