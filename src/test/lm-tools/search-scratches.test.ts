import { strict as assert } from "assert";
import { after, before, describe, it } from "mocha";
import { activateExtension, Fixtures, invoke } from "./helpers";

const fix = new Fixtures("search-scratches");

describe("search_scratches tool (integration)", () => {
  before(async () => {
    await activateExtension();
    // Use a token unlikely to appear anywhere else in scratch storage
    await fix.write("alpha.md", "# Alpha\n\nContains unique_tok_XYZ here.\nAnother line.");
    await fix.write("beta.md", "# Beta\n\nNo match here.\nJust regular content.");
    await fix.write("code.ts", "const unique_tok_XYZ = 'value';\nfunction hello() {}");
  });

  after(() => fix.cleanup());

  it("finds a plain-text match across files", async () => {
    const result = await invoke("search_scratches", {
      query: "unique_tok_XYZ",
      filter: fix.base,
    });
    assert.ok(result.includes("alpha.md"), result);
    assert.ok(result.includes("code.ts"), result);
    assert.ok(!result.includes("beta.md"), result);
  });

  it("finds matches using a regex pattern", async () => {
    const result = await invoke("search_scratches", {
      query: "unique_tok_X[Y]Z",
      isRegex: true,
      filter: fix.base,
    });
    assert.ok(result.includes("alpha.md"), result);
    assert.ok(result.includes("code.ts"), result);
  });

  it("limits scope to a file-extension glob", async () => {
    const result = await invoke("search_scratches", {
      query: "unique_tok_XYZ",
      filter: "**/*.ts",
    });
    assert.ok(result.includes("code.ts"), result);
    assert.ok(!result.includes("alpha.md"), result);
  });

  it("is case-insensitive by default", async () => {
    const result = await invoke("search_scratches", {
      query: "UNIQUE_TOK_xyz",
      filter: fix.base,
    });
    assert.ok(result.includes("alpha.md"), result);
  });

  it("is case-sensitive when caseSensitive is true", async () => {
    const lowerResult = await invoke("search_scratches", {
      query: "unique_tok_xyz",
      caseSensitive: true,
      filter: fix.base,
    });
    // lower-case query must NOT match the upper-case token
    assert.ok(!lowerResult.includes("alpha.md"), lowerResult);
  });

  it("returns 'No matches found.' for a non-matching query", async () => {
    const result = await invoke("search_scratches", {
      query: "THIS_WILL_NEVER_MATCH_SCRATCHES_TOKEN_777",
    });
    assert.strictEqual(result, "No matches found.");
  });

  it("respects maxResults limit", async () => {
    const result = await invoke("search_scratches", {
      query: "unique_tok_XYZ",
      filter: fix.base,
      maxResults: 1,
    });
    const matchCount = (result.match(/→/g) ?? []).length;
    assert.strictEqual(matchCount, 1, `expected 1 match, got:\n${result}`);
  });

  it("formats output with path:line and → match line", async () => {
    const result = await invoke("search_scratches", {
      query: "unique_tok_XYZ",
      filter: fix.base,
    });
    // Every match line must have "path:N" format and "→ content"
    assert.ok(/\w+\.(?:md|ts):\d+/.test(result), result);
    assert.ok(result.includes("→"), result);
  });
});
