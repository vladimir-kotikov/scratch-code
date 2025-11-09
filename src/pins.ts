import * as path from "path";
import * as vscode from "vscode";

/** Persist and manage list of pinned scratches shared across VS Code instances using same scratch directory. */
export class PinStore {
  private readonly pinsFile: vscode.Uri;
  private pins = new Set<string>();
  private _onDidChangePins = new vscode.EventEmitter<void>();
  readonly onDidChangePins = this._onDidChangePins.event;
  private watcher: vscode.FileSystemWatcher | undefined;

  constructor(private readonly scratchDir: vscode.Uri) {
    this.pinsFile = vscode.Uri.file(path.join(scratchDir.fsPath, PIN_STORE_FILENAME));
  }

  async init() {
    await this.load();
    // Watch for external edits (another window updating pins)
    this.watcher = vscode.workspace.createFileSystemWatcher(this.pinsFile.fsPath);
    this.watcher.onDidChange(() => this.load());
    this.watcher.onDidCreate(() => this.load());
    this.watcher.onDidDelete(() => this.load());
  }

  dispose() {
    this._onDidChangePins.dispose();
    this.watcher?.dispose();
  }

  private key(uri: vscode.Uri): string {
    return uri.path.startsWith("/") ? uri.path.substring(1) : uri.path;
  }

  isPinned = (uri: vscode.Uri): boolean => this.pins.has(this.key(uri));

  list(): string[] {
    return [...this.pins];
  }

  async pin(uri: vscode.Uri) {
    this.pins.add(this.key(uri));
    await this.save();
  }

  async unpin(uri: vscode.Uri) {
    this.pins.delete(this.key(uri));
    await this.save();
  }

  async rename(oldUri: vscode.Uri, newUri: vscode.Uri) {
    const oldKey = this.key(oldUri);
    if (this.pins.delete(oldKey)) {
      this.pins.add(this.key(newUri));
      await this.save();
    }
  }

  async remove(uri: vscode.Uri) {
    if (this.pins.delete(this.key(uri))) {
      await this.save();
    }
  }

  private async load() {
    try {
      const data = await vscode.workspace.fs.readFile(this.pinsFile);
      const arr: unknown = JSON.parse(Buffer.from(data).toString("utf8"));
      if (Array.isArray(arr)) {
        this.pins = new Set(arr.filter(x => typeof x === "string"));
      }
    } catch {
      // ignore if file missing or invalid
    }
    this._onDidChangePins.fire();
  }

  private async save() {
    const json = JSON.stringify([...this.pins], null, 2);
    await vscode.workspace.fs.writeFile(this.pinsFile, Buffer.from(json, "utf8"));
    this._onDidChangePins.fire();
  }
}

export const PIN_STORE_FILENAME = ".scratch-pins.json";
