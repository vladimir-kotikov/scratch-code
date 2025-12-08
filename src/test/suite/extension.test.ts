import { strict as assert } from "assert";
import { describe, it } from "mocha";
import { inferExtension } from "../../extension";

import type { TextDocument, Uri } from "vscode";

type FakeDocument = TextDocument;

const buildDoc = ({
  fileName = "untitled",
  languageId = "typescript",
  lines = [""],
}: Partial<{ fileName: string; languageId: string; lines: string[] }> = {}): FakeDocument => {
  // Minimal stub for required TextDocument properties
  return {
    uri: { fsPath: fileName } as Uri,
    fileName,
    languageId,
    isUntitled: fileName === "untitled",
    version: 1,
    isDirty: false,
    isClosed: false,
    eol: 1,
    lineCount: lines.length,
    encoding: "utf8",
    save: async () => true,
    lineAt: (i: number | { line: number }) => {
      const idx = typeof i === "number" ? i : i.line;
      return { text: lines[idx] ?? "" } as any;
    },
    getText: () => lines.join("\n"),
    getWordRangeAtPosition: () => undefined,
    validateRange: r => r,
    validatePosition: p => p,
    offsetAt: () => 0,
    positionAt: () => ({
      line: 0,
      character: 0,
      isBefore: () => false,
      isBeforeOrEqual: () => false,
      isAfter: () => false,
      isAfterOrEqual: () => false,
      compareTo: () => 0,
      translate: () => ({ line: 0, character: 0 }) as any,
      with: () => ({ line: 0, character: 0 }) as any,
      isEqual: () => true,
    }),
    // ...other required stubs
  } as FakeDocument;
};
// Remove duplicate test outside describe block

describe("inferExtension always returns dotted extension or empty string", () => {
  it("returns extension with dot for untitled typescript document", () => {
    const doc = {
      uri: { scheme: "untitled" },
      languageId: "typescript",
      isUntitled: true,
    } as TextDocument;

    const ext = inferExtension(doc);

    assert.strictEqual(ext, ".ts");
  });

  it("returns extension with dot for saved javascript file", () => {
    const doc = {
      uri: { scheme: "file" },
      languageId: "javascript",
      isUntitled: false,
      fileName: "/path/to/script.js",
    } as TextDocument;

    const ext = inferExtension(doc);

    assert.strictEqual(ext, ".js");
  });

  it("returns empty string for plaintext (override)", () => {
    const doc = {
      uri: { scheme: "untitled" },
      languageId: "plaintext",
      isUntitled: true,
    } as TextDocument;

    const ext = inferExtension(doc);

    assert.strictEqual(ext, "");
  });

  it("prevents double dots in filename concatenation", () => {
    const doc = {
      uri: { scheme: "untitled" },
      languageId: "python",
      isUntitled: true,
    } as TextDocument;

    const filename = "myfile";
    const extension = inferExtension(doc);

    const result = `${filename}${extension}`;

    assert.strictEqual(result, "myfile.py");
    assert.ok(!result.includes(".."), "Should not contain double dots");
  });

  it("contract: always returns dot-prefixed extension or empty string", () => {
    const testCases = [
      { languageId: "typescript", isUntitled: true, expected: ".ts" },
      { languageId: "javascript", isUntitled: true, expected: ".js" },
      { languageId: "python", isUntitled: true, expected: ".py" },
      { languageId: "markdown", isUntitled: true, expected: ".md" },
      { languageId: "plaintext", isUntitled: true, expected: "" },
    ];

    testCases.forEach(({ languageId, isUntitled, expected }) => {
      const doc = {
        uri: { scheme: isUntitled ? "untitled" : "file" },
        languageId,
        isUntitled,
        fileName: `/path/to/file${expected}`,
      } as TextDocument;

      const ext = inferExtension(doc);

      assert.ok(
        ext === "" || ext.startsWith("."),
        `Extension "${ext}" for ${languageId} must be empty or start with dot`,
      );
      assert.strictEqual(ext, expected);
    });
  });
});

describe("Scratches Drag-and-Drop", () => {
  it("should provide text/uri-list and text/plain for dragged scratch", async () => {
    const ext = new (require("../../extension").ScratchExtension)(
      require("vscode").Uri.parse("scratch:/"),
      require("vscode").Uri.parse("scratch-storage:/"),
      { get: () => 0, update: () => Promise.resolve() },
    );
    await ext.fileSystemProvider.writeFile(
      require("vscode").Uri.parse("scratch:/test.txt"),
      "hello world",
    );
    const scratch = new (require("../../providers/tree").Scratch)(
      require("vscode").Uri.parse("scratch:/test.txt"),
      false,
    );
    const dataTransfer = new (require("vscode").DataTransfer)();
    await ext.scratchesDragAndDropController.handleDrag([scratch], dataTransfer, {
      isCancellationRequested: false,
    });
    assert((await dataTransfer.get("text/uri-list")?.asString()) === "scratch:/test.txt");
    assert.strictEqual(await dataTransfer.get("text/plain")?.asString(), "hello world");
  });
});
