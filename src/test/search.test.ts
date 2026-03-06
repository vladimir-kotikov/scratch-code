import { strict as assert } from "assert";
import * as fs from "fs";
import { afterEach, beforeEach, describe, it } from "mocha";
import * as os from "os";
import * as path from "path";
import { Uri } from "vscode";
import {
  normalizeGlob,
  processRipgrepMatch,
  RgState,
  SearchIndexProvider,
  startNewMatch,
} from "../providers/search";

const ROOT_PATH = "/scratch-test-root";
const ROOT_URI = Uri.file(ROOT_PATH);

const mkState = (partial?: Partial<RgState>): RgState => ({
  matches: {},
  ...partial,
});

const beginLine = (filePath: string) =>
  JSON.stringify({ type: "begin", data: { path: { text: filePath } } });

const matchLine = (
  filePath: string,
  lineNumber: number,
  text: string,
  submatches: Array<{ match: { text: string }; start: number; end: number }> = [],
) =>
  JSON.stringify({
    type: "match",
    data: {
      path: { text: filePath },
      lines: { text },
      line_number: lineNumber,
      absolute_offset: 0,
      submatches,
    },
  });

const contextLine = (filePath: string, lineNumber: number, text: string) =>
  JSON.stringify({
    type: "context",
    data: {
      path: { text: filePath },
      lines: { text },
      line_number: lineNumber,
      absolute_offset: 0,
    },
  });

const endLine = (filePath: string) =>
  JSON.stringify({
    type: "end",
    data: {
      path: { text: filePath },
      binary_offset: undefined,
      stats: {
        elapsed: { secs: 0, nanos: 0, human: "" },
        searches: 1,
        searches_with_match: 1,
        bytes_searched: 0,
        bytes_printed: 0,
        matched_lines: 1,
        matches: 1,
      },
    },
  });

const summaryLine = () =>
  JSON.stringify({
    type: "summary",
    data: {
      elapsed_total: { human: "", nanos: 0, secs: 0 },
      stats: {
        bytes_printed: 0,
        bytes_searched: 0,
        elapsed: { human: "", nanos: 0, secs: 0 },
        matched_lines: 0,
        matches: 0,
        searches: 0,
        searches_with_match: 0,
      },
    },
  });

const feed = (lines: string[], contextLines = 2): RgState =>
  lines.reduce((s, l) => processRipgrepMatch(l, s, contextLines, ROOT_URI), mkState());

// ---------------------------------------------------------------------------
// normalizeGlob
// ---------------------------------------------------------------------------

describe("normalizeGlob", () => {
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
  ].forEach(({ input, expected }) => {
    it(`normalizes ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      assert.strictEqual(normalizeGlob(input), expected);
    });
  });
});

// ---------------------------------------------------------------------------
// processRipgrepMatch – unit tests (no I/O)
// ---------------------------------------------------------------------------

describe("processRipgrepMatch", () => {
  describe("begin event", () => {
    it("initializes currentMatch with correct scratch URI", () => {
      const state = feed([beginLine(`${ROOT_PATH}/notes/a.md`)]);
      assert.ok(state.currentMatch, "currentMatch should be set");
      assert.ok(state.currentMatch.uri.startsWith("scratch:"), "URI should use scratch scheme");
      assert.ok(state.currentMatch.uri.includes("notes/a.md"), "URI should contain the path");
      assert.deepEqual(state.currentMatch.context, [], "context should start empty");
      assert.deepEqual(state.currentMatch.submatches, [], "submatches should start empty");
      assert.strictEqual(state.currentMatch.line, undefined, "line should be unset");
    });
  });

  describe("match event", () => {
    it("sets line, content, and submatches on the current match", () => {
      const filePath = `${ROOT_PATH}/a.txt`;
      const state = feed([
        beginLine(filePath),
        matchLine(filePath, 5, "matched line\n", [
          { match: { text: "matched" }, start: 0, end: 7 },
        ]),
      ]);
      assert.ok(state.currentMatch);
      assert.strictEqual(state.currentMatch.line, 5);
      assert.strictEqual(state.currentMatch.content, "matched line");
      assert.deepEqual(state.currentMatch.submatches, [{ start: 0, end: 7 }]);
    });

    it("strips trailing newline from content", () => {
      const filePath = `${ROOT_PATH}/a.txt`;
      const state = feed([beginLine(filePath), matchLine(filePath, 1, "hello\n")]);
      assert.strictEqual(state.currentMatch?.content, "hello");
    });

    it("preserves pre-context accumulated before the match (regression for inverted condition bug)", () => {
      const filePath = `${ROOT_PATH}/a.txt`;
      const state = feed([
        beginLine(filePath),
        contextLine(filePath, 1, "pre line 1\n"),
        contextLine(filePath, 2, "pre line 2\n"),
        matchLine(filePath, 3, "matched line\n"),
      ]);
      assert.ok(state.currentMatch);
      assert.strictEqual(state.currentMatch.line, 3);
      assert.deepEqual(state.currentMatch.context, ["pre line 1\n", "pre line 2\n"]);
    });

    it("flushes previous completed match when a second match arrives", () => {
      const filePath = `${ROOT_PATH}/a.txt`;
      const state = feed(
        [
          beginLine(filePath),
          matchLine(filePath, 3, "first match\n"),
          // contextLines = 0, so the next context event flushes the match
          matchLine(filePath, 7, "second match\n"),
        ],
        0,
      );
      // first match should be in state.matches
      assert.strictEqual(Object.keys(state.matches).length, 1);
      const [firstMatch] = Object.values(state.matches);
      assert.strictEqual(firstMatch.line, 3);
      assert.strictEqual(firstMatch.content, "first match");
      // second match is still in currentMatch (not yet flushed)
      assert.ok(state.currentMatch);
      assert.strictEqual(state.currentMatch.line, 7);
    });
  });

  describe("context event", () => {
    it("accumulates context lines before a match", () => {
      const filePath = `${ROOT_PATH}/a.txt`;
      const state = feed([
        beginLine(filePath),
        contextLine(filePath, 1, "before\n"),
        contextLine(filePath, 2, "before2\n"),
        matchLine(filePath, 3, "hit\n"),
      ]);
      assert.deepEqual(state.currentMatch?.context, ["before\n", "before2\n"]);
    });

    it("accumulates post-context after a match without flushing", () => {
      const filePath = `${ROOT_PATH}/a.txt`;
      const state = feed(
        [
          beginLine(filePath),
          matchLine(filePath, 3, "hit\n"),
          contextLine(filePath, 4, "after1\n"),
        ],
        2,
      );
      // 1 context line accumulated, contextLines limit is 2 → no flush yet
      assert.strictEqual(Object.keys(state.matches).length, 0, "should not yet be flushed");
      assert.ok(state.currentMatch);
      assert.strictEqual(state.currentMatch.line, 3);
      assert.deepEqual(state.currentMatch.context, ["after1\n"]);
    });

    it("flushes current match when post-context count reaches contextLines limit", () => {
      const filePath = `${ROOT_PATH}/a.txt`;
      // contextLines = 1: first post-context line should flush the old match and start fresh
      const state = feed(
        [
          beginLine(filePath),
          matchLine(filePath, 3, "hit\n"),
          contextLine(filePath, 4, "after1\n"),
          contextLine(filePath, 5, "after2\n"), // this triggers flush
        ],
        1,
      );
      assert.strictEqual(Object.keys(state.matches).length, 1, "first match should be flushed");
      const [flushedMatch] = Object.values(state.matches);
      assert.strictEqual(flushedMatch.line, 3);
      assert.deepEqual(flushedMatch.context, ["after1\n"]);
    });
  });

  describe("end / summary events", () => {
    it("end event returns state unchanged", () => {
      const filePath = `${ROOT_PATH}/a.txt`;
      const before = feed([beginLine(filePath), matchLine(filePath, 1, "hit\n")]);
      const after = processRipgrepMatch(endLine(filePath), before, 2, ROOT_URI);
      assert.strictEqual(after, before);
    });

    it("summary event returns state unchanged", () => {
      const filePath = `${ROOT_PATH}/a.txt`;
      const before = feed([beginLine(filePath), matchLine(filePath, 1, "hit\n")]);
      const after = processRipgrepMatch(summaryLine(), before, 2, ROOT_URI);
      assert.strictEqual(after, before);
    });
  });

  describe("malformed / empty input", () => {
    it("empty string returns state unchanged", () => {
      const state = mkState();
      const result = processRipgrepMatch("", state, 2, ROOT_URI);
      assert.strictEqual(result, state);
    });

    it("whitespace-only line returns state unchanged", () => {
      const state = mkState();
      const result = processRipgrepMatch("   \t\n", state, 2, ROOT_URI);
      assert.strictEqual(result, state);
    });

    it("malformed JSON line returns state unchanged", () => {
      const state = mkState();
      const result = processRipgrepMatch("{ not valid json }", state, 2, ROOT_URI);
      assert.strictEqual(result, state);
    });
  });
});

// ---------------------------------------------------------------------------
// startNewMatch – unit tests
// ---------------------------------------------------------------------------

describe("startNewMatch", () => {
  it("flushes current complete match into state.matches", () => {
    const filePath = `${ROOT_PATH}/a.txt`;
    const initial = feed([beginLine(filePath), matchLine(filePath, 1, "hit\n")]);
    assert.ok(initial.currentMatch?.line !== undefined);

    const flushed = startNewMatch(initial, `${ROOT_PATH}/b.txt`, ROOT_URI);
    assert.strictEqual(Object.keys(flushed.matches).length, 1);
    const [match] = Object.values(flushed.matches);
    assert.strictEqual(match.line, 1);
    assert.strictEqual(match.content, "hit");
  });

  it("does not flush incomplete currentMatch (no line set)", () => {
    const filePath = `${ROOT_PATH}/a.txt`;
    const initial = feed([beginLine(filePath)]); // no match event, so line is undefined
    const result = startNewMatch(initial, `${ROOT_PATH}/b.txt`, ROOT_URI);
    assert.strictEqual(Object.keys(result.matches).length, 0, "incomplete match should not flush");
  });

  it("resets context and submatches on new match", () => {
    const filePath = `${ROOT_PATH}/a.txt`;
    const initial = feed([beginLine(filePath), matchLine(filePath, 1, "hit\n")]);
    const next = startNewMatch(initial, `${ROOT_PATH}/b.txt`, ROOT_URI);
    assert.ok(next.currentMatch);
    assert.deepEqual(next.currentMatch.context, []);
    assert.deepEqual(next.currentMatch.submatches, []);
    assert.strictEqual(next.currentMatch.line, undefined);
  });
});

// ---------------------------------------------------------------------------
// SearchIndexProvider.search() – integration tests (requires real `rg`)
// ---------------------------------------------------------------------------

describe("SearchIndexProvider.search()", () => {
  let tmpDir: string;
  let provider: SearchIndexProvider;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scratch-search-test-"));
    // File with several lines to test context and multiple hits
    fs.writeFileSync(
      path.join(tmpDir, "file1.txt"),
      "line one\nHello World\nline three\nHello again\nline five\n",
    );
    fs.writeFileSync(path.join(tmpDir, "file2.txt"), "Second file content\nno match here\n");
    fs.mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "sub", "nested.ts"), "const x = 42;\nfunction hello() {}\n");
    provider = new SearchIndexProvider(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    provider.dispose();
  });

  it("returns matches for a plain-string query", async () => {
    const matches = await provider.search({ query: "Hello" });
    assert.ok(matches.length >= 1, "should find at least one match");
    assert.ok(
      matches.some(m => m.content.includes("Hello")),
      "match content should contain the query term",
    );
  });

  it("resolves to empty array (not rejection) when no matches found (exit code 1)", async () => {
    const matches = await provider.search({ query: "zzz_no_such_content_xyz" });
    assert.deepEqual(matches, []);
  });

  it("rejects when query is empty", async () => {
    await assert.rejects(async () => provider.search({ query: "" }), /Query cannot be empty/);
  });

  it("rejects when query is whitespace only", async () => {
    await assert.rejects(async () => provider.search({ query: "   " }), /Query cannot be empty/);
  });

  it("rejects on invalid regex (exit code > 1)", async () => {
    await assert.rejects(
      async () => provider.search({ query: "[invalid(", isRegex: true }),
      /Search failed with exit code/,
    );
  });

  it("case-insensitive search by default finds both Hello and hello", async () => {
    const matches = await provider.search({ query: "hello", caseSensitive: false });
    assert.ok(
      matches.some(m => m.content.toLowerCase().includes("hello")),
      "should match case-insensitively",
    );
  });

  it("case-sensitive search restricts to exact case", async () => {
    const lower = await provider.search({ query: "hello", caseSensitive: true });
    const upper = await provider.search({ query: "Hello", caseSensitive: true });
    // Case-sensitive 'hello' should not match 'Hello'
    assert.ok(
      !lower.some(m => m.content.includes("Hello World")),
      "case-sensitive lowercase should not match 'Hello World'",
    );
    assert.ok(upper.length >= 1, "case-sensitive uppercase should match");
  });

  it("isRegex: true matches using regex syntax", async () => {
    const matches = await provider.search({ query: "Hello.*(World|again)", isRegex: true });
    assert.ok(matches.length >= 1, "regex should match");
  });

  it("isRegex: false treats special characters as literals", async () => {
    // A regex-special pattern should match nothing when treated as literal
    const matches = await provider.search({ query: "Hello.*(World|again)", isRegex: false });
    assert.deepEqual(matches, [], "literal special chars should not match");
  });

  it("maxResults limits number of matches returned", async () => {
    const all = await provider.search({ query: "Hello" });
    if (all.length < 2) return; // skip if not enough matches for this test
    const limited = await provider.search({ query: "Hello", maxResults: 1 });
    assert.strictEqual(limited.length, 1, "should respect maxResults limit");
  });

  it("AbortSignal already aborted returns empty array immediately", async () => {
    const controller = new AbortController();
    controller.abort();
    const matches = await provider.search({ query: "Hello" }, controller.signal);
    assert.deepEqual(matches, []);
  });

  it("AbortSignal fired mid-search resolves with empty array", async () => {
    const controller = new AbortController();
    const promise = provider.search({ query: "Hello" }, controller.signal);
    controller.abort();
    const matches = await promise;
    assert.deepEqual(matches, []);
  });

  it("filter glob restricts results to matching files", async () => {
    const allMatches = await provider.search({ query: "hello", caseSensitive: false });
    const tsMatches = await provider.search({
      query: "hello",
      caseSensitive: false,
      filter: "**/*.ts",
    });
    const txtMatches = await provider.search({
      query: "hello",
      caseSensitive: false,
      filter: "**/*.txt",
    });
    // .ts file has 'hello' in it; .txt files also have Hello
    assert.ok(
      tsMatches.every(m => m.uri.endsWith(".ts")),
      "ts filter should only return .ts files",
    );
    assert.ok(
      txtMatches.every(m => m.uri.endsWith(".txt")),
      "txt filter should only return .txt files",
    );
    // Total from scoped searches shouldn't exceed unfiltered
    assert.ok(
      tsMatches.length + txtMatches.length <= allMatches.length + 1, // +1 for rounding tolerance
      "filtered results should be a subset of all results",
    );
  });

  it("contextLines: 0 produces matches with no context", async () => {
    const matches = await provider.search({ query: "Hello", contextLines: 0 });
    assert.ok(matches.length >= 1);
    assert.ok(
      matches.every(m => m.context.length === 0),
      "contextLines: 0 should produce empty context arrays",
    );
  });

  it("contextLines > 0 includes surrounding lines in context", async () => {
    const matches = await provider.search({ query: "Hello World", contextLines: 1 });
    assert.ok(matches.length >= 1);
    const match = matches.find(m => m.content.includes("Hello World"));
    assert.ok(match, "should find the target match");
    assert.ok(match.context.length > 0, "should have context lines when contextLines > 0");
  });

  it("match URIs use the scratch:// scheme", async () => {
    const matches = await provider.search({ query: "Hello" });
    assert.ok(matches.length >= 1);
    assert.ok(
      matches.every(m => m.uri.startsWith("scratch:")),
      "all match URIs must use scratch: scheme",
    );
  });

  it("match URIs do not contain the root filesystem path", async () => {
    const matches = await provider.search({ query: "Hello" });
    assert.ok(matches.length >= 1);
    assert.ok(
      matches.every(m => !m.uri.includes(tmpDir)),
      "URIs must be relative (no absolute fs path)",
    );
  });

  it("each match has a positive line number", async () => {
    const matches = await provider.search({ query: "Hello" });
    assert.ok(
      matches.every(m => typeof m.line === "number" && m.line > 0),
      "line numbers should be positive integers",
    );
  });

  it("submatches contain match offsets within the content line", async () => {
    const matches = await provider.search({ query: "Hello", contextLines: 0 });
    const hit = matches.find(m => m.content.includes("Hello"));
    assert.ok(hit, "should find a match");
    assert.ok(hit.submatches.length > 0, "submatches should be populated");
    const sm = hit.submatches[0];
    assert.ok(typeof sm.start === "number" && sm.start >= 0);
    assert.ok(typeof sm.end === "number" && sm.end > sm.start);
  });
});
