import * as path from "path";
import {
  FileChangeType,
  FileSystemError,
  FileChangeEvent,
  Uri,
  FileSystemProvider,
  EventEmitter,
  Event,
  Disposable,
  FileStat,
  FileType,
} from "vscode";
import * as vscode from "vscode";

const parentUriChanged = (uri: Uri): FileChangeEvent => {
  const parentUri = uri.with({ path: path.posix.dirname(uri.path) });
  return { type: FileChangeType.Changed, uri: parentUri };
};

const isFile = (fileType: FileType) =>
  fileType === FileType.File || fileType === (FileType.SymbolicLink | FileType.File);

const isDirectory = (fileType: FileType) =>
  fileType === FileType.Directory || fileType === (FileType.SymbolicLink | FileType.Directory);

export class ScratchFileSystemProvider implements FileSystemProvider {
  private _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
  onDidChangeFile: Event<FileChangeEvent[]> = this._onDidChangeFile.event;

  constructor(private readonly scratchDir: Uri) {}

  private translateUri(uri: Uri): Uri {
    return Uri.joinPath(this.scratchDir, uri.path);
  }

  watch(
    _uri: Uri,
    _options: {
      readonly recursive: boolean;
      readonly excludes: readonly string[];
    }
  ): Disposable {
    return new Disposable(() => {});
  }

  stat(uri: Uri): Thenable<FileStat> {
    return vscode.workspace.fs.stat(this.translateUri(uri));
  }

  readDirectory(uri: Uri): Thenable<[string, FileType][]> {
    return vscode.workspace.fs.readDirectory(this.translateUri(uri));
  }

  /**
   * Just like `readDirectory` but traverses the whole directory subtree
   * and returns nested files with their full paths as uris
   * @param uri Directory to return files from
   * @returns array of nested files uris
   */
  async readDirectoryRecursively(uri: Uri): Promise<Uri[]> {
    const entries = await this.readDirectory(uri);

    const readDirPromises = entries.map(([fileName, fileType]) => {
      if (isFile(fileType)) {
        return Promise.resolve([Uri.joinPath(uri, fileName)]);
      }

      if (isDirectory(fileType)) {
        return this.readDirectoryRecursively(Uri.joinPath(uri, fileName));
      }

      return Promise.resolve([]);
    });

    return Promise.all(readDirPromises).then((allFiles) => allFiles.flat());
  }

  async createDirectory(uri: Uri): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.translateUri(uri));
    this._onDidChangeFile.fire([parentUriChanged(uri), { type: FileChangeType.Created, uri }]);
  }

  readFile(uri: Uri): Thenable<Uint8Array> {
    return vscode.workspace.fs.readFile(this.translateUri(uri));
  }

  async writeFile(
    uri: Uri,
    content?: Uint8Array | string,
    _options?: { readonly create: boolean; readonly overwrite: boolean }
  ): Promise<void> {
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
