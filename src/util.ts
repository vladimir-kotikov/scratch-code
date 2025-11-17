import { Disposable, FileSystemProvider, FileType, Uri } from "vscode";
import { asPromise, call, flat, map } from "./fu";

/**
 * Given the filesystem provider and a directory uri, returns all nested files uris
 * @param uri Directory to return files from
 * @returns array of nested files uris
 */
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
