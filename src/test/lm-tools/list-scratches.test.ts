import { strict as assert } from "assert";
import { after, before, describe, it } from "mocha";
import { activateExtension, Fixtures, invoke } from "./helpers";

const fix = new Fixtures("list-scratches");

describe("list_scratches tool (integration)", () => {
  before(async () => {
    await activateExtension();
    await fix.write("alpha.md", "# Alpha");
    await fix.write("beta.ts", "const x = 1;");
    await fix.write("sub/gamma.md", "# Gamma");
  });

  after(() => fix.cleanup());

  it("lists all files when no filter is given", async () => {
    const result = await invoke("list_scratches", {});
    assert.ok(result.includes("lm-test-tmp/list-scratches/alpha.md"), result);
    assert.ok(result.includes("lm-test-tmp/list-scratches/beta.ts"), result);
    assert.ok(result.includes("lm-test-tmp/list-scratches/sub/gamma.md"), result);
  });

  it("filters by path prefix", async () => {
    const result = await invoke("list_scratches", {
      filter: "lm-test-tmp/list-scratches/sub",
    });
    assert.ok(result.includes("lm-test-tmp/list-scratches/sub/gamma.md"), result);
    assert.ok(!result.includes("lm-test-tmp/list-scratches/alpha.md"), result);
  });

  it("filters by glob extension", async () => {
    const result = await invoke("list_scratches", { filter: "**/*.md" });
    assert.ok(result.includes("lm-test-tmp/list-scratches/alpha.md"), result);
    assert.ok(result.includes("lm-test-tmp/list-scratches/sub/gamma.md"), result);
    assert.ok(!result.includes("lm-test-tmp/list-scratches/beta.ts"), result);
  });

  it("filters by scratch:/// URI prefix", async () => {
    const result = await invoke("list_scratches", {
      filter: `scratch:///${fix.base.replace("scratch:///", "")}/sub`,
    });
    assert.ok(result.includes("lm-test-tmp/list-scratches/sub/gamma.md"), result);
    assert.ok(!result.includes("lm-test-tmp/list-scratches/alpha.md"), result);
  });

  it("returns a helpful message for a non-matching pattern", async () => {
    const result = await invoke("list_scratches", { filter: "lm-test-tmp/no-such-dir/**" });
    assert.ok(result.includes("lm-test-tmp/no-such-dir/**"), result);
    assert.ok(!result.includes("alpha.md"), result);
  });
});
