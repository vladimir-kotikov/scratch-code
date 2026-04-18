import { strict as assert } from "assert";
import { after, before, describe, it } from "mocha";
import { activateExtension, Fixtures, invoke } from "./helpers";

const fix = new Fixtures("edit-scratch");
const INITIAL = "line one\nline two\nline three";

// Re-creates the test file before every test so each case starts from a clean state.
async function setup(name: string, content = INITIAL): Promise<string> {
  return fix.write(name, content);
}

describe("edit_scratch tool (integration)", () => {
  before(() => activateExtension());
  after(() => fix.cleanup());

  it("appends content to the file", async () => {
    const uri = await setup("append.md");
    await invoke("edit_scratch", {
      edits: [{ uri, edits: [{ op: "append", content: "\nline four" }] }],
    });
    const content = await fix.read("append.md");
    assert.ok(content.endsWith("line four"), content);
  });

  it("inserts content before a line (1-based)", async () => {
    const uri = await setup("insert.md");
    await invoke("edit_scratch", {
      edits: [{ uri, edits: [{ op: "insert", line: 2, content: "inserted" }] }],
    });
    assert.strictEqual(await fix.read("insert.md"), "line one\ninserted\nline two\nline three");
  });

  it("replaces a line range", async () => {
    const uri = await setup("replace.md");
    await invoke("edit_scratch", {
      edits: [{ uri, edits: [{ op: "replace", lineFrom: 1, lineTo: 2, content: "replaced" }] }],
    });
    assert.strictEqual(await fix.read("replace.md"), "replaced\nline three");
  });

  it("deletes lines by replacing with empty content", async () => {
    const uri = await setup("delete.md");
    await invoke("edit_scratch", {
      edits: [{ uri, edits: [{ op: "replace", lineFrom: 2, lineTo: 2, content: "" }] }],
    });
    assert.strictEqual(await fix.read("delete.md"), "line one\nline three");
  });

  it("applies multiple ops in natural top-to-bottom order without line shift", async () => {
    const uri = await setup("multi.md");
    await invoke("edit_scratch", {
      edits: [
        {
          uri,
          edits: [
            { op: "replace", lineFrom: 1, lineTo: 1, content: "ONE" },
            { op: "replace", lineFrom: 3, lineTo: 3, content: "THREE" },
          ],
        },
      ],
    });
    assert.strictEqual(await fix.read("multi.md"), "ONE\nline two\nTHREE");
  });

  it("edits two files in a single batch call", async () => {
    const uri1 = await setup("batch-a.md", "alpha");
    const uri2 = await setup("batch-b.md", "beta");
    const result = await invoke("edit_scratch", {
      edits: [
        { uri: uri1, edits: [{ op: "append", content: "alpha2" }] },
        { uri: uri2, edits: [{ op: "append", content: "beta2" }] },
      ],
    });
    assert.ok(result.includes("batch-a.md"), result);
    assert.ok(result.includes("batch-b.md"), result);
    assert.strictEqual(await fix.read("batch-a.md"), "alpha\nalpha2");
    assert.strictEqual(await fix.read("batch-b.md"), "beta\nbeta2");
  });

  it("returns 'Edited: <path>' on success", async () => {
    const uri = await setup("success.md");
    const result = await invoke("edit_scratch", {
      edits: [{ uri, edits: [{ op: "append", content: "x" }] }],
    });
    assert.ok(result.startsWith("Edited:"), result);
    assert.ok(result.includes("success.md"), result);
  });

  it("returns a Failed section when insert line is out of range", async () => {
    const uri = await setup("err-insert.md"); // 3 lines
    const result = await invoke("edit_scratch", {
      edits: [{ uri, edits: [{ op: "insert", line: 0, content: "bad" }] }],
    });
    assert.ok(result.includes("Failed:"), result);
    assert.ok(result.includes("line must be ≥ 1"), result);
    // file must not be modified
    assert.strictEqual(await fix.read("err-insert.md"), INITIAL);
  });

  it("returns a Failed section when replace lineTo exceeds file length", async () => {
    const uri = await setup("err-replace.md"); // 3 lines
    const result = await invoke("edit_scratch", {
      edits: [{ uri, edits: [{ op: "replace", lineFrom: 2, lineTo: 99, content: "bad" }] }],
    });
    assert.ok(result.includes("Failed:"), result);
    assert.ok(result.includes("lineTo (99) exceeds file length"), result);
    assert.strictEqual(await fix.read("err-replace.md"), INITIAL);
  });

  it("succeeds on the valid file and reports failure for the invalid one", async () => {
    const ok = await setup("partial-ok.md", "ok");
    const bad = await setup("partial-bad.md", "bad"); // 1 line
    const result = await invoke("edit_scratch", {
      edits: [
        { uri: ok, edits: [{ op: "append", content: "more" }] },
        { uri: bad, edits: [{ op: "replace", lineFrom: 5, lineTo: 5, content: "x" }] },
      ],
    });
    assert.ok(result.includes("Edited:"), result);
    assert.ok(result.includes("partial-ok.md"), result);
    assert.ok(result.includes("Failed:"), result);
    assert.ok(result.includes("partial-bad.md"), result);
    assert.strictEqual(await fix.read("partial-ok.md"), "ok\nmore");
    assert.strictEqual(await fix.read("partial-bad.md"), "bad");
  });
});
