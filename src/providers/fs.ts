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
import { DisposableContainer } from "../util/disposable";
import { call } from "../util/fu";
import { asPromise, whenError } from "../util/promises";

const bytesToString = (buffer: Uint8Array): string => Buffer.from(buffer).toString("utf8");

const isFileSystemError = (err: unknown): err is FileSystemError => err instanceof FileSystemError;

const isNotFoundError = (err: unknown): boolean =>
  isFileSystemError(err) && err.code === "FileNotFound";

export const isFileExistsError = (err: unknown): boolean =>
  isFileSystemError(err) && err.code === "FileExists";

export const isNotEmptyDirectory = (err: unknown): boolean =>
  // TODO: check if this is the correct code
  isFileSystemError(err) && err.code === "DirectoryNotEmpty";

const isFile = (stat: FileStat): boolean =>
  stat.type === FileType.File || stat.type === (FileType.File | FileType.SymbolicLink);

const whenFile = (uri: Uri): Promise<Uri> =>
  new Promise((resolve, reject) => {
    vscode.workspace.fs
      .stat(uri)
      .then(
        stat =>
          stat.type === FileType.File || stat.type === (FileType.File | FileType.SymbolicLink)
            ? resolve(uri)
            : reject(),
        reject,
      );
  });

export class ScratchFileSystemProvider implements FileSystemProvider, Disposable {
  static readonly SCHEME = "scratch";
  static readonly ROOT = Uri.parse(`${ScratchFileSystemProvider.SCHEME}:/`);

  private _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
  private fireChangeEvents = this._onDidChangeFile.fire.bind(this._onDidChangeFile);
  onDidChangeFile: Event<FileChangeEvent[]> = this._onDidChangeFile.event;

  constructor(private readonly scratchDir: Uri) {}

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

  private createFileCreatedEvent = (uri: vscode.Uri): vscode.FileChangeEvent[] => [
    { type: FileChangeType.Created, uri: this.toScratchUri(uri) },
  ];

  private createFileChangedEvent = (uri: vscode.Uri): vscode.FileChangeEvent[] => [
    { type: FileChangeType.Changed, uri: this.toScratchUri(uri) },
  ];

  private createFileDeletedEvent = (uri: vscode.Uri): vscode.FileChangeEvent[] => [
    {
      type: FileChangeType.Deleted,
      uri: this.toScratchUri(uri),
    },
  ];

  watch = (
    uri?: Uri,
    options: {
      readonly recursive?: boolean;
      readonly excludes?: readonly string[];
    } = {},
  ): Disposable => {
    let fsPath = this.toFilesystemUri(uri ?? ScratchFileSystemProvider.ROOT).fsPath;
    if (options.recursive) {
      // FIXME: handle excludes and folders properly
      fsPath += "/**/*";
    }

    const watcher = vscode.workspace.createFileSystemWatcher(fsPath);
    return DisposableContainer.from(
      watcher.onDidChange(changedUri =>
        whenFile(changedUri).then(this.createFileChangedEvent).then(this.fireChangeEvents),
      ),
      watcher.onDidCreate(createdUri =>
        whenFile(createdUri).then(this.createFileCreatedEvent).then(this.fireChangeEvents),
      ),
      // The file is already deleted, so we can't check its type
      watcher.onDidDelete(deletedUri =>
        this.fireChangeEvents(this.createFileDeletedEvent(deletedUri)),
      ),
      watcher,
    );
  };

  stat = (uri: Uri): Thenable<FileStat> => vscode.workspace.fs.stat(this.toFilesystemUri(uri));

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
    asPromise(vscode.workspace.fs.delete(this.toFilesystemUri(uri), options)).then(() => {
      this._onDidChangeFile.fire([{ type: FileChangeType.Deleted, uri }]);
    });

  async rename(oldUri: Uri, newUri: Uri, options?: { readonly overwrite: boolean }): Promise<void> {
    await vscode.workspace.fs.rename(
      this.toFilesystemUri(oldUri),
      this.toFilesystemUri(newUri),
      options,
    );
    this._onDidChangeFile.fire([
      { type: FileChangeType.Deleted, uri: oldUri },
      { type: FileChangeType.Created, uri: newUri },
    ]);
  }
}
