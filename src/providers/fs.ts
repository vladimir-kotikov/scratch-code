import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  Disposable,
  EventEmitter,
  FileChangeEvent,
  FileChangeType,
  FileStat,
  FileSystemError,
  FileSystemProvider,
  FileType,
  Uri,
} from "vscode";
import { call, pass } from "../util/fu";
import { batch } from "../util/functions";
import { asPromise, whenError } from "../util/promises";

const bytesToString = (buffer: Uint8Array): string => Buffer.from(buffer).toString("utf8");

const isFileSystemError = (err: unknown): err is FileSystemError => err instanceof FileSystemError;

const isNotFoundError = (err: unknown): boolean =>
  isFileSystemError(err) && err.code === "FileNotFound";

export const isFileExistsError = (err: unknown): boolean =>
  isFileSystemError(err) && err.code === "FileExists";

export const isaDirectoryError = (err: unknown): boolean =>
  isFileSystemError(err) && err.code === "FileIsADirectory";

export const isNotEmptyDirectory = (err: unknown): boolean => {
  const message = (err as { message?: string }).message;
  return (
    message?.includes("ENOTEMPTY") ||
    message?.startsWith("Unable to delete non-empty folder") ||
    false
  );
};

const isFile = (stat: FileStat): boolean =>
  stat.type === FileType.File || stat.type === (FileType.File | FileType.SymbolicLink);

export class ScratchFileSystemProvider implements FileSystemProvider, Disposable {
  static readonly SCHEME = "scratch";
  static readonly ROOT = Uri.parse(`${ScratchFileSystemProvider.SCHEME}:/`);

  private _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  constructor(readonly scratchDir: Uri) {
    fs.mkdirSync(scratchDir.fsPath, { recursive: true });
  }

  dispose = () => {
    this._onDidChangeFile.dispose();
  };

  private toFilesystemUri = (uri: Uri): Uri => {
    if (uri.scheme !== ScratchFileSystemProvider.SCHEME) {
      throw new Error(`Invalid URI scheme: ${uri.scheme}`);
    }
    return Uri.joinPath(this.scratchDir, uri.path);
  };

  private toScratchUri = (uri: Uri): Uri => {
    const relativePath = path.relative(this.scratchDir.fsPath, uri.fsPath);
    if (relativePath.startsWith("..")) {
      throw new Error(`URI is outside of scratch directory: ${uri.toString()}`);
    }
    return Uri.parse(`${ScratchFileSystemProvider.SCHEME}:/${relativePath}`);
  };

  watch = (
    uri?: Uri,
    options: {
      readonly recursive?: boolean;
      readonly excludes?: readonly string[];
    } = {},
  ): Disposable => {
    const watchUri = uri ?? ScratchFileSystemProvider.ROOT;
    const watchPath = this.toFilesystemUri(watchUri).fsPath;
    const baseDirName = fs.statSync(watchPath).isDirectory() ? path.basename(watchPath) : null;

    const fireEvents = batch((events: FileChangeEvent[]) => {
      this._onDidChangeFile.fire(events);
    }, 100);

    // Use node watcher as vscode.workspace version seem to be only
    // watching for changes within the workspace
    const watcher = fs.watch(watchPath, { recursive: options.recursive }, (event, filename) => {
      // Supposedly filename is relative to watchPath, but unsure
      // how's that's gonna work in case if watchPath is a file
      // FIXME: when the watched directory is changed, the basename of the directory is sent as filename (not empty/null/'/' as one might expect) so this needs to be checked and converted to /. However, there might be other files/directories with the same name inside the watched directory, so this can't be applied blindly.
      const realFilename = filename === null || filename === baseDirName ? "" : filename;
      const uri = Uri.joinPath(watchUri, realFilename);

      const makeChangeEvent =
        event === "change"
          ? Promise.resolve({ type: FileChangeType.Changed, uri })
          : // event === "rename"
            fs.promises
              .stat(path.resolve(watchPath, realFilename))
              .then(
                pass({ type: FileChangeType.Created, uri }),
                pass({ type: FileChangeType.Deleted, uri }),
              );

      makeChangeEvent.then(e => fireEvents([e]));
    });

    return new Disposable(() => {
      fireEvents.cancel();
      watcher.close();
    });
  };

  stat = (uri: Uri) => vscode.workspace.fs.stat(this.toFilesystemUri(uri));

  readDirectory = (uri: Uri): Thenable<[string, FileType][]> =>
    vscode.workspace.fs.readDirectory(this.toFilesystemUri(uri));

  createDirectory = (uri: Uri) => vscode.workspace.fs.createDirectory(this.toFilesystemUri(uri));

  readFile = (uri: Uri): Thenable<Uint8Array> =>
    vscode.workspace.fs.readFile(this.toFilesystemUri(uri));

  readLines = (uri: Uri) => this.readFile(uri).then(bytesToString).then(call("split", "\n"));

  writeLines = (uri: Uri, lines: Iterable<string>) =>
    this.writeFile(uri, Array.from(lines).join("\n") + "\n");

  writeFile = (
    uri: Uri,
    content?: Uint8Array | string,
    options: {
      readonly create: boolean;
      readonly overwrite: boolean;
    } = { create: true, overwrite: true },
  ) =>
    asPromise(this.stat(uri))
      .then(
        stat => {
          if (!options.overwrite) {
            throw FileSystemError.FileExists(uri);
          }
          if (!isFile(stat)) {
            throw FileSystemError.FileIsADirectory(uri);
          }
          return { type: FileChangeType.Changed, uri };
        },
        whenError(
          err => isNotFoundError(err) && options.create,
          () => ({ type: FileChangeType.Created, uri }),
        ),
      )
      .then(event =>
        asPromise(
          vscode.workspace.fs.writeFile(
            this.toFilesystemUri(uri),
            typeof content === "string"
              ? Buffer.from(content, "utf8")
              : (content ?? new Uint8Array(0)),
          ),
        )
          .then(() => this._onDidChangeFile.fire([event]))
          .catch(
            whenError(isFileSystemError, err => {
              // Make sure the real fs uri is not leaked
              (err as FileSystemError).message = this.toFilesystemUri(uri).toString();
              throw err;
            }),
          ),
      );

  delete = (uri: Uri, options?: { readonly recursive: boolean }) =>
    asPromise(vscode.workspace.fs.delete(this.toFilesystemUri(uri), options));

  async rename(oldUri: Uri, newUri: Uri, options?: { readonly overwrite: boolean }): Promise<void> {
    await vscode.workspace.fs.rename(
      this.toFilesystemUri(oldUri),
      this.toFilesystemUri(newUri),
      options,
    );
  }
}
