import * as assert from "assert";
import sinon from "sinon";
import { inferFilename } from "../../extension";

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
