import { strict as assert } from "assert";
import { describe, it } from "mocha";
import { Uri } from "vscode";
import { normalizeFilter, SCHEME, toScratchUri } from "../util/uri";

describe("toScratchUri", () => {
  const root = Uri.file("/scratch");

  [
    { label: "file at root level", input: "/scratch/file.txt", expected: "/file.txt" },
    { label: "nested path", input: "/scratch/notes/a.md", expected: "/notes/a.md" },
    { label: "deeply nested path", input: "/scratch/a/b/c/d.txt", expected: "/a/b/c/d.txt" },
  ].forEach(({ label, input, expected }) => {
    it(`converts ${label} to scratch:// URI`, () => {
      const uri = toScratchUri(root, Uri.file(input));
      assert.strictEqual(uri.scheme, SCHEME);
      assert.strictEqual(uri.path, expected);
    });
  });

  [
    { label: "path outside the scratch root", input: "/other/file.txt" },
    { label: "path traversing above root via ..", input: "/scratch/../etc/passwd" },
  ].forEach(({ label, input }) => {
    it(`throws for ${label}`, () => {
      assert.throws(
        () => toScratchUri(root, Uri.file(input)),
        /URI is outside of scratch directory/,
      );
    });
  });
});

describe("normalizeFilter", () => {
  [
    // already well-formed — must pass through unchanged
    { input: "**/*.md", expected: "**/*.md" },
    { input: "**/projects/**", expected: "**/projects/**" },
    { input: "**/marketing-event-service/**", expected: "**/marketing-event-service/**" },
    // bare directory glob — must receive **/ prefix
    { input: "projects/**", expected: "**/projects/**" },
    { input: "projects/**/*.md", expected: "**/projects/**/*.md" },
    // leading slash stripped, then **/ prepended
    { input: "/projects/**", expected: "**/projects/**" },
    { input: "//projects/**", expected: "**/projects/**" },
    // extension-only glob — must receive **/ prefix
    { input: "*.md", expected: "**/*.md" },
    // scratch:/// URI scheme — stripped before normalization
    { input: "scratch:///projects/**", expected: "**/projects/**" },
    { input: "scratch:///projects/foo/**", expected: "**/projects/foo/**" },
    { input: "scratch:///**/*.md", expected: "**/*.md" },
    // bare basename (no /, no glob chars) — prepend **/ for recursive matching
    { input: "README.md", expected: "**/README.md" },
    { input: "testing", expected: "**/testing" },
    { input: "scratch:///README.md", expected: "**/README.md" },
    // slash-separated path prefix (no glob chars) — pass through unchanged
    { input: "scratch:///projects/foo", expected: "projects/foo" },
    { input: "projects/foo", expected: "projects/foo" },
  ].forEach(({ input, expected }) => {
    it(`normalizes ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      assert.strictEqual(normalizeFilter(input), expected);
    });
  });
});
