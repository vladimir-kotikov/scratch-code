import { strict as assert } from "assert";
import { describe, it } from "mocha";
import { inferExtension } from "../../newScratch";

import type { TextDocument } from "vscode";

describe("inferExtension()", () => {
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
