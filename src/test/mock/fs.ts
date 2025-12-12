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

  readDirectory = async (dir: Uri): Promise<[string, FileType][]> => {
    // Only return immediate children of dir
    const dirPath = dir.path.replace(/\\/g, "/");
    const isRoot = dirPath === "" || dirPath === "/";
    const children = new Set<string>();
    for (const name of Object.keys(this.files)) {
      const parts = name.split("/");
      if (isRoot) {
        if (parts.length === 1) {
          children.add(parts[0]);
        }
      } else {
        const dirParts = dirPath.replace(/^\//, "").split("/");
        if (
          parts.length === dirParts.length + 1 &&
          parts.slice(0, dirParts.length).join("/") === dirParts.join("/")
        ) {
          children.add(parts[dirParts.length]);
        }
      }
    }
    return Array.from(children).map(child => [
      child,
      this.files[(isRoot ? "" : dirPath.replace(/^\//, "") + "/") + child]?.type ?? FileType.File,
    ]);
  };

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

  readLines = async (uri: Uri): Promise<string[]> => {
    const name = uri.path.replace(/^\//, "");
    if (!(name in this.files)) return [];
    return (this.files[name].content ?? "").split("\n");
  };

  writeLines = async (uri: Uri, lines: Iterable<string>): Promise<void> => {
    const name = uri.path.replace(/^\//, "");
    const content = Array.from(lines).join("\n") + "\n";
    if (this.files[name]) {
      this.files[name].content = content;
    } else {
      this.files[name] = { content };
    }
    this.syncBuffers();
  };

  triggerChange = (event: FileChangeEvent) => {
    this.syncBuffers();
    this._onDidChangeFileEmitter.fire([event]);
  };
}
