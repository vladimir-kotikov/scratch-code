import { strict as assert } from "assert";
import { after, before, describe, it } from "mocha";
import { activateExtension, Fixtures, invoke } from "./helpers";

const fix = new Fixtures("write-scratch");

describe("write_scratch tool (integration)", () => {
  before(() => activateExtension());
  after(() => fix.cleanup());

  it("creates a new file with the given content", async () => {
    const result = await invoke("write_scratch", {
      writes: [{ uri: fix.uri("created.md"), content: "# Created\n\nContent here." }],
    });
    assert.ok(result.toLowerCase().includes("written"), result);
    assert.strictEqual(await fix.read("created.md"), "# Created\n\nContent here.");
  });

  it("overwrites an existing file", async () => {
    await invoke("write_scratch", {
      writes: [{ uri: fix.uri("overwrite.md"), content: "original" }],
    });
    await invoke("write_scratch", {
      writes: [{ uri: fix.uri("overwrite.md"), content: "updated" }],
    });
    assert.strictEqual(await fix.read("overwrite.md"), "updated");
  });

  it("writes multiple files in a single call", async () => {
    const result = await invoke("write_scratch", {
      writes: [
        { uri: fix.uri("batch-a.md"), content: "file A" },
        { uri: fix.uri("batch-b.md"), content: "file B" },
      ],
    });
    assert.ok(result.toLowerCase().includes("written"), result);
    assert.strictEqual(await fix.read("batch-a.md"), "file A");
    assert.strictEqual(await fix.read("batch-b.md"), "file B");
  });

  it("creates files in nested subdirectories", async () => {
    await invoke("write_scratch", {
      writes: [{ uri: fix.uri("deep/nested/file.md"), content: "nested" }],
    });
    assert.strictEqual(await fix.read("deep/nested/file.md"), "nested");
  });
});
