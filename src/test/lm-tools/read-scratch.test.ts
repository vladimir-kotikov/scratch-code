import { strict as assert } from "assert";
import { after, before, describe, it } from "mocha";
import { activateExtension, Fixtures, invoke } from "./helpers";

const fix = new Fixtures("read-scratch");
const CONTENT = "line one\nline two\nline three\nline four\nline five";

describe("read_scratch tool (integration)", () => {
  before(async () => {
    await activateExtension();
    await fix.write("notes.md", CONTENT);
    await fix.write("other.md", "alpha\nbeta\ngamma");
  });

  after(() => fix.cleanup());

  it("reads the full file", async () => {
    const result = await invoke("read_scratch", { reads: [{ uri: fix.uri("notes.md") }] });
    assert.ok(result.includes("line one"), result);
    assert.ok(result.includes("line five"), result);
    assert.ok(!result.includes("lines "), result); // no range label
  });

  it("reads a specific line range (lineFrom + lineTo)", async () => {
    const result = await invoke("read_scratch", {
      reads: [{ uri: fix.uri("notes.md"), lineFrom: 2, lineTo: 4 }],
    });
    assert.ok(result.includes("lines 2-4"), result);
    assert.ok(result.includes("line two"), result);
    assert.ok(result.includes("line four"), result);
    assert.ok(!result.includes("line one"), result);
    assert.ok(!result.includes("line five"), result);
  });

  it("reads from lineFrom to end-of-file", async () => {
    const result = await invoke("read_scratch", {
      reads: [{ uri: fix.uri("notes.md"), lineFrom: 4 }],
    });
    assert.ok(result.includes("from line 4"), result);
    assert.ok(result.includes("line four"), result);
    assert.ok(result.includes("line five"), result);
    assert.ok(!result.includes("line one"), result);
  });

  it("reads from start-of-file to lineTo", async () => {
    const result = await invoke("read_scratch", {
      reads: [{ uri: fix.uri("notes.md"), lineTo: 2 }],
    });
    assert.ok(result.includes("lines 1-2"), result);
    assert.ok(result.includes("line one"), result);
    assert.ok(result.includes("line two"), result);
    assert.ok(!result.includes("line three"), result);
  });

  it("labels a single-line range as 'line N' (no dash)", async () => {
    const result = await invoke("read_scratch", {
      reads: [{ uri: fix.uri("notes.md"), lineFrom: 3, lineTo: 3 }],
    });
    assert.ok(result.includes(", line 3]"), result);
    assert.ok(result.includes("line three"), result);
  });

  it("batches reads from two files in one call", async () => {
    const result = await invoke("read_scratch", {
      reads: [
        { uri: fix.uri("notes.md"), lineFrom: 1, lineTo: 1 },
        { uri: fix.uri("other.md"), lineFrom: 2, lineTo: 2 },
      ],
    });
    assert.ok(result.includes("line one"), result);
    assert.ok(result.includes("beta"), result);
    assert.ok(result.includes("---"), result);
  });

  it("reads two ranges from the same file in one call", async () => {
    const result = await invoke("read_scratch", {
      reads: [
        { uri: fix.uri("notes.md"), lineFrom: 1, lineTo: 1 },
        { uri: fix.uri("notes.md"), lineFrom: 5, lineTo: 5 },
      ],
    });
    assert.ok(result.includes("line one"), result);
    assert.ok(result.includes("line five"), result);
    assert.ok(result.includes("---"), result);
  });
});
