import { strict as assert } from "assert";
import { describe, it } from "mocha";
import { Uri } from "vscode";
import { ScratchFileSystemProvider, toScratchUri } from "../providers/fs";

describe("toScratchUri", () => {
  const root = Uri.file("/scratch");

  [
    { label: "file at root level", input: "/scratch/file.txt", expected: "/file.txt" },
    { label: "nested path", input: "/scratch/notes/a.md", expected: "/notes/a.md" },
    { label: "deeply nested path", input: "/scratch/a/b/c/d.txt", expected: "/a/b/c/d.txt" },
  ].forEach(({ label, input, expected }) => {
    it(`converts ${label} to scratch:// URI`, () => {
      const uri = toScratchUri(Uri.file(input), root);
      assert.strictEqual(uri.scheme, "scratch");
      assert.strictEqual(uri.path, expected);
    });
  });

  it("result matches ScratchFileSystemProvider ROOT scheme", () => {
    const uri = toScratchUri(Uri.file("/scratch/file.txt"), root);
    assert.strictEqual(uri.scheme, ScratchFileSystemProvider.SCHEME);
  });

  [
    { label: "path outside the scratch root", input: "/other/file.txt" },
    // On most systems /scratch/../etc/passwd resolves to /etc/passwd, which is outside /scratch
    { label: "path traversing above root via ..", input: "/scratch/../etc/passwd" },
  ].forEach(({ label, input }) => {
    it(`throws for ${label}`, () => {
      assert.throws(
        () => toScratchUri(Uri.file(input), root),
        /URI is outside of scratch directory/,
      );
    });
  });

  it("attaches fragment when provided", () => {
    const uri = toScratchUri(Uri.file("/scratch/a.md"), root, { fragment: "L10" });
    assert.strictEqual(uri.fragment, "L10");
    assert.strictEqual(uri.path, "/a.md");
    assert.strictEqual(uri.scheme, "scratch");
  });

  [
    { label: "option is omitted", options: undefined },
    { label: "option is undefined", options: { fragment: undefined } },
  ].forEach(({ label, options }) => {
    it(`does not set fragment when ${label}`, () => {
      const uri = toScratchUri(Uri.file("/scratch/a.md"), root, options);
      assert.strictEqual(uri.fragment, "");
    });
  });
});
