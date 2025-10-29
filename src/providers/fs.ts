import * as path from "path";
import * as vscode from "vscode";
import {
  Disposable,
  Event,
  EventEmitter,
  FileChangeEvent,
  FileChangeType,
  FileStat,
  FileSystemError,
  FileSystemProvider,
  FileType,
  Uri,
} from "vscode";
import { flat, map } from "../fu";

const SCHEME = "scratch";
const ROOT = Uri.parse(`${SCHEME}:/`);

const parentUriChanged = (uri: Uri): FileChangeEvent => {
  const parentUri = uri.with({ path: path.posix.dirname(uri.path) });
  return { type: FileChangeType.Changed, uri: parentUri };
};

export class ScratchFileSystemProvider implements FileSystemProvider {
  private _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
  onDidChangeFile: Event<FileChangeEvent[]> = this._onDidChangeFile.event;

  constructor(private readonly scratchDir: Uri) {}

  private translateUri = (uri: Uri): Uri => {
    if (uri.scheme !== SCHEME) {
      throw new Error(`Invalid URI scheme: ${uri.scheme}`);
    }
    return Uri.joinPath(this.scratchDir, uri.path);
  };

  watch(): Disposable {
    return new Disposable(() => {});
  }

  stat = (uri: Uri): Thenable<FileStat> => vscode.workspace.fs.stat(this.translateUri(uri));

  readDirectory = (uri: Uri): Thenable<[string, FileType][]> =>
    vscode.workspace.fs.readDirectory(this.translateUri(uri));

  /**
   * Just like `readDirectory` but traverses the whole directory subtree
   * and returns nested files with their full paths as uris
   * @param uri Directory to return files from
   * @returns array of nested files uris
   */
  readTree = (uri: Uri = ROOT): PromiseLike<Uri[]> =>
    this.readDirectory(uri)
      .then(
        map(([fileName, fileType]) => {
          return fileType === FileType.Unknown
            ? []
            : fileType === FileType.Directory
              ? this.readTree(Uri.joinPath(uri, fileName))
              : [Uri.joinPath(uri, fileName)];
        }),
      )
      .then((items) => Promise.all(items))
      .then(flat);

  async createDirectory(uri: Uri): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.translateUri(uri));
    this._onDidChangeFile.fire([parentUriChanged(uri), { type: FileChangeType.Created, uri }]);
  }

  readFile(uri: Uri): Thenable<Uint8Array> {
    return vscode.workspace.fs.readFile(this.translateUri(uri));
  }

  async writeFile(uri: Uri, content?: Uint8Array | string): Promise<void> {
    if (content === undefined) {
      content = new Uint8Array(0);
    }

    if (typeof content === "string") {
      content = Buffer.from(content, "utf8");
    }

    const events: FileChangeEvent[] = [parentUriChanged(uri)];

    try {
      const stat = await this.stat(uri);
      const isFile =
        stat.type === FileType.File || stat.type === (FileType.File | FileType.SymbolicLink);

      if (isFile) {
        events.push({ type: FileChangeType.Changed, uri });
      }
    } catch (e) {
      if (e instanceof FileSystemError && e.code === "FileNotFound") {
        events.push({ type: FileChangeType.Created, uri });
      }
    }

    await vscode.workspace.fs.writeFile(this.translateUri(uri), content);
    this._onDidChangeFile.fire(events);
  }

  async delete(uri: Uri, options?: { readonly recursive: boolean }): Promise<void> {
    await vscode.workspace.fs.delete(this.translateUri(uri), options);
    this._onDidChangeFile.fire([parentUriChanged(uri), { type: FileChangeType.Deleted, uri }]);
  }

  async rename(oldUri: Uri, newUri: Uri, options?: { readonly overwrite: boolean }): Promise<void> {
    await vscode.workspace.fs.rename(this.translateUri(oldUri), this.translateUri(newUri), options);
    this._onDidChangeFile.fire([
      parentUriChanged(oldUri),
      { type: FileChangeType.Deleted, uri: oldUri },
      { type: FileChangeType.Created, uri: newUri },
    ]);
  }
}
