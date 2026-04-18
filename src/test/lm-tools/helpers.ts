import * as vscode from "vscode";

const EXTENSION_ID = "vlkoti.scratch-code";
const FIXTURE_ROOT = "scratch:///lm-test-tmp";

/** Activates the extension so its tools and FS provider are registered.
 * Points the scratch directory at a repo-local gitignored folder so tests
 * never touch the user's actual scratch storage.
 */
export async function activateExtension(): Promise<void> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  if (!ext) {
    throw new Error(`Extension ${EXTENSION_ID} not found in test environment`);
  }
  if (!ext.isActive) {
    // Set the scratch directory to a repo-local path before activation so the
    // extension initialises its FS provider against that directory.  Writing to
    // ConfigurationTarget.Global targets vscode-test's temporary user-data dir,
    // not the developer's real VS Code settings.
    const localScratchDir = vscode.Uri.joinPath(ext.extensionUri, ".lm-test-scratch").fsPath;
    await vscode.workspace
      .getConfiguration("scratches")
      .update("scratchDirectory", localScratchDir, vscode.ConfigurationTarget.Global);
    await ext.activate();
  }
}

/**
 * Isolated fixture namespace per test file.
 * Each test file constructs its own instance with a unique `namespace`.
 */
export class Fixtures {
  readonly base: string;

  constructor(namespace: string) {
    this.base = `${FIXTURE_ROOT}/${namespace}`;
  }

  /** Returns the full scratch URI string for a path within this namespace. */
  uri(name: string): string {
    return `${this.base}/${name}`;
  }

  /** Writes a fixture file and returns its URI string. */
  async write(name: string, content: string): Promise<string> {
    const uri = vscode.Uri.parse(this.uri(name));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    return this.uri(name);
  }

  /** Reads back a fixture file's content. */
  async read(name: string): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(this.uri(name)));
    return new TextDecoder().decode(bytes);
  }

  /** Reads back a file by full URI string. */
  async readUri(uri: string): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(uri));
    return new TextDecoder().decode(bytes);
  }

  /** Deletes the entire namespace directory. Call in after() hooks. */
  async cleanup(): Promise<void> {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.parse(this.base), {
        recursive: true,
        useTrash: false,
      });
    } catch {
      // already gone — that's fine
    }
  }
}

/** Invokes a registered LM tool by name and returns the extracted text result. */
export async function invoke(name: string, input: object): Promise<string> {
  const cts = new vscode.CancellationTokenSource();
  try {
    const result = await vscode.lm.invokeTool(
      name,
      { input, toolInvocationToken: undefined },
      cts.token,
    );
    return result.content.map(p => (p as vscode.LanguageModelTextPart).value ?? "").join("");
  } finally {
    cts.dispose();
  }
}
