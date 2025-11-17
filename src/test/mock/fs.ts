import { EventEmitter, FileChangeEvent, FileType, Uri } from "vscode";
import { ScratchFileSystemProvider } from "../../providers/fs";

export class MockFS extends ScratchFileSystemProvider {
  public files: Record<string, { mtime?: number; type?: FileType; content?: string }>;
  public fileBuffers: Record<string, Buffer>;
  private _onDidChangeFileEmitter: EventEmitter<FileChangeEvent[]>;
  public onDidChangeFile: typeof ScratchFileSystemProvider.prototype.onDidChangeFile;

  constructor(files: Record<string, { mtime?: number; type?: FileType; content?: string }>) {
    super(Uri.parse("scratch:/"));
    this.files = files;
    this.fileBuffers = {};
    this._onDidChangeFileEmitter = new EventEmitter<FileChangeEvent[]>();
    this.syncBuffers();
    this.onDidChangeFile = this._onDidChangeFileEmitter.event;
  }

  private syncBuffers() {
    for (const [name, meta] of Object.entries(this.files)) {
      this.fileBuffers[name] = Buffer.from(meta.content ?? "");
    }
  }

  readDirectory = async (_dir: Uri): Promise<[string, FileType][]> =>
    Object.keys(this.files).map((name) => [name, this.files[name].type ?? FileType.File]);

  stat = async (
    uri: Uri,
  ): Promise<{ ctime: number; size: number; mtime: number; type: FileType }> => {
    const name = uri.path.replace(/^\//, "");
    if (!(name in this.files)) throw new Error("File not found");
    const { mtime, type, content } = this.files[name];
    return {
      ctime: 0,
      size: content ? content.length : 1,
      mtime: mtime ?? 0,
      type: type ?? FileType.File,
    };
  };

  readFile = async (uri: Uri): Promise<Uint8Array> => {
    const name = uri.path.replace(/^\//, "");
    if (!(name in this.fileBuffers)) throw new Error("File not found");
    return this.fileBuffers[name];
  };

  triggerChange = (event: FileChangeEvent) => {
    this.syncBuffers();
    this._onDidChangeFileEmitter.fire([event]);
  };
}
