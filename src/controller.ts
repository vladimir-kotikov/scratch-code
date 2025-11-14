import { Uri } from "vscode";
import { map, pass } from "./fu";
import { ScratchFileSystemProvider } from "./providers/fs";
import { readTree } from "./util";

class Scratch {
  constructor(
    public readonly uri: Uri,
    public readonly isPinned: boolean,
  ) {}
}

const PIN_STORE_URI = Uri.joinPath(ScratchFileSystemProvider.ROOT, ".pins.json");

export class ScratchController {
  private pinStore: Record<string, boolean> = {};

  constructor(private fs: ScratchFileSystemProvider) {
    this.fs.readFile(PIN_STORE_URI).then(data => {
      this.pinStore = JSON.parse(Buffer.from(data).toString("utf-8"));
    }, pass);
  }

  dispose() {
    const data = Buffer.from(JSON.stringify(this.pinStore), "utf-8");
    this.fs.writeFile(PIN_STORE_URI, data, { create: true, overwrite: true });
  }

  create = async (
    filename: string,
    content: string,
    options: { overwrite: boolean } = { overwrite: false },
  ) =>
    this.fs
      .writeFile(Uri.parse(`scratch:/${filename}`), content, { create: true, ...options })
      .then(() => Uri.parse(`scratch:/${filename}`));

  getAll = () =>
    readTree(this.fs, ScratchFileSystemProvider.ROOT).then(
      map(uri => new Scratch(uri, this.pinStore[uri.path] ?? false)),
    );
}
