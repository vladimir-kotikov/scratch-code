import { Disposable, FileStat, FileSystemProvider, FileType, Uri } from "vscode";
import { asPromise, call, flat, map, unzip, zip } from "./fu";

export const isFile = (type: FileType): boolean =>
  type === FileType.File || type === (FileType.File | FileType.SymbolicLink);

export const readDirWithStats = (
  provider: FileSystemProvider,
  uri: Uri,
): PromiseLike<[Uri, FileStat][]> =>
  asPromise(provider.readDirectory(uri))
    .then(unzip)
    .then(([fnames]) => fnames.map(fname => Uri.joinPath(uri, fname)))
    .then(uris => Promise.all(uris.map(provider.stat)).then(zip(uris)));

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

export class DisposableContainer implements Disposable {
  private readonly disposables: Disposable[] = [];

  static from = (...disposables: Disposable[]): DisposableContainer => {
    const container = new DisposableContainer();
    disposables.forEach(container.disposeLater);
    return container;
  };

  disposeLater = <D extends Disposable>(d: D): D => {
    this.disposables.push(d);
    return d;
  };

  dispose() {
    this.disposables.forEach(call("dispose"));
  }
}
