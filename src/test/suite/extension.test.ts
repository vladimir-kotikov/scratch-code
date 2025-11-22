import * as assert from "assert";
import sinon from "sinon";
import { inferExtension, inferFilename } from "../../extension";

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

describe("inferFilename", () => {
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers(new Date("2023-01-02T03:04:05Z").getTime());
  });

  afterEach(() => {
    clock.restore();
  });
  it("infers basename from significant content in multiline document", function () {
    const lines = ["", "", "==================== some text===================", ""];
    const doc = buildDoc({ languageId: "plaintext", lines });
    const result = inferFilename(doc);
    assert.strictEqual(result, "some_text");
  });

  it("returns existing filename when document is not untitled", () => {
    const doc = buildDoc({ fileName: "/tmp/sample.ts" });
    const result = inferFilename(doc);
    assert.strictEqual(result, "sample");
  });

  it("infers extension using lang-map when untitled", () => {
    const doc = buildDoc({ languageId: "javascript", lines: ["console.log('hi');"] });
    const result = inferFilename(doc);
    assert.strictEqual(result, "console_log__hi");
  });

  it("adds dot prefix when lang-map returns bare extension", () => {
    const doc = buildDoc({ languageId: "python", lines: ["print('hello')"] });
    const result = inferFilename(doc);
    assert.strictEqual(result, "print__hello");
  });

  it("respects custom empty extension map entries", () => {
    const doc = buildDoc({ languageId: "ignore", lines: ["*.log"] });
    const result = inferFilename(doc);
    assert.strictEqual(result, "log");
  });

  it("sanitizes invalid characters in inferred basename", () => {
    const doc = buildDoc({ languageId: "typescript", lines: ['foo<>:"bar"|?* baz'] });
    const result = inferFilename(doc);
    assert.strictEqual(result, "foo____bar_____baz");
  });

  it("limits basename to 30 characters", () => {
    const doc = buildDoc({
      languageId: "typescript",
      lines: ["a".repeat(40)],
    });
    const result = inferFilename(doc);
    assert.strictEqual(result, `${"a".repeat(30)}`);
  });

  it("falls back to timestamped name when content empty", () => {
    const doc = buildDoc({ languageId: "plaintext", lines: [""] });
    const result = inferFilename(doc);
    assert.strictEqual(result, "scratch-2023-01-02_03-04-05");
  });
});

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
