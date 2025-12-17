import { strict as assert } from "assert";
import { describe, it } from "mocha";
import { Uri } from "vscode";
import { PinStore } from "../providers/pinStore";
import { MockFS } from "./mock/fs";

describe("PinStore", () => {
  it("initializes with empty store", async () => {
    const fs = new MockFS({ ".pinstore": { mtime: 0, content: "" } });
    const store = new PinStore(Uri.parse("scratch:/.pinstore"), fs);

    // Wait for load to complete
    await new Promise(resolve => store.onDidLoad(() => resolve(undefined)));

    const uri = Uri.parse("scratch:/test.txt");
    assert.strictEqual(store.isPinned(uri), false);
    assert.deepEqual(store.pinned, []);
  });

  it("loads existing pinned items from file", async () => {
    const pinned = ["scratch:/a.txt", "scratch:/b.txt"];
    const fs = new MockFS({
      ".pinstore": { mtime: 0, content: pinned.join("\n") + "\n" },
    });
    const store = new PinStore(Uri.parse("scratch:/.pinstore"), fs);

    await new Promise(resolve => store.onDidLoad(() => resolve(undefined)));

    assert.strictEqual(store.isPinned(Uri.parse("scratch:/a.txt")), true);
    assert.strictEqual(store.isPinned(Uri.parse("scratch:/b.txt")), true);
    assert.strictEqual(store.isPinned(Uri.parse("scratch:/c.txt")), false);
    assert.deepEqual(store.pinned.sort(), pinned.sort());
  });

  it("pins a new item", async () => {
    const fs = new MockFS({ ".pinstore": { mtime: 0, content: "" } });
    const store = new PinStore(Uri.parse("scratch:/.pinstore"), fs);

    await new Promise(resolve => store.onDidLoad(() => resolve(undefined)));

    const uri = Uri.parse("scratch:/test.txt");
    store.pin(uri);

    assert.strictEqual(store.isPinned(uri), true);
    assert.deepEqual(store.pinned, [uri.toString()]);
  });

  it("unpins an existing item", async () => {
    const uri = Uri.parse("scratch:/test.txt");
    const fs = new MockFS({
      ".pinstore": { mtime: 0, content: uri.toString() + "\n" },
    });
    const store = new PinStore(Uri.parse("scratch:/.pinstore"), fs);

    await new Promise(resolve => store.onDidLoad(() => resolve(undefined)));

    assert.strictEqual(store.isPinned(uri), true);

    store.unpin(uri);

    assert.strictEqual(store.isPinned(uri), false);
    assert.deepEqual(store.pinned, []);
  });

  it("handles multiple pin/unpin operations", async () => {
    const fs = new MockFS({ ".pinstore": { mtime: 0, content: "" } });
    const store = new PinStore(Uri.parse("scratch:/.pinstore"), fs);

    await new Promise(resolve => store.onDidLoad(() => resolve(undefined)));

    const uri1 = Uri.parse("scratch:/file1.txt");
    const uri2 = Uri.parse("scratch:/file2.txt");
    const uri3 = Uri.parse("scratch:/file3.txt");

    store.pin(uri1);
    store.pin(uri2);
    store.pin(uri3);

    assert.strictEqual(store.pinned.length, 3);

    store.unpin(uri2);

    assert.strictEqual(store.pinned.length, 2);
    assert.strictEqual(store.isPinned(uri1), true);
    assert.strictEqual(store.isPinned(uri2), false);
    assert.strictEqual(store.isPinned(uri3), true);
  });

  it("ignores empty lines when loading", async () => {
    const fs = new MockFS({
      ".pinstore": { mtime: 0, content: "scratch:/a.txt\n\n\nscratch:/b.txt\n" },
    });
    const store = new PinStore(Uri.parse("scratch:/.pinstore"), fs);

    await new Promise(resolve => store.onDidLoad(() => resolve(undefined)));

    assert.strictEqual(store.pinned.length, 2);
  });

  it("handles pinning the same item multiple times", async () => {
    const fs = new MockFS({ ".pinstore": { mtime: 0, content: "" } });
    const store = new PinStore(Uri.parse("scratch:/.pinstore"), fs);

    await new Promise(resolve => store.onDidLoad(() => resolve(undefined)));

    const uri = Uri.parse("scratch:/test.txt");
    store.pin(uri);
    store.pin(uri);

    assert.strictEqual(store.pinned.length, 1);
    assert.strictEqual(store.isPinned(uri), true);
  });

  it("handles unpinning non-existent item", async () => {
    const fs = new MockFS({ ".pinstore": { mtime: 0, content: "" } });
    const store = new PinStore(Uri.parse("scratch:/.pinstore"), fs);

    await new Promise(resolve => store.onDidLoad(() => resolve(undefined)));

    const uri = Uri.parse("scratch:/test.txt");
    store.unpin(uri); // Should not throw

    assert.strictEqual(store.isPinned(uri), false);
  });

  it("fires onDidLoad event when loading completes", async () => {
    const fs = new MockFS({
      ".pinstore": { mtime: 0, content: "scratch:/test.txt\n" },
    });
    const store = new PinStore(Uri.parse("scratch:/.pinstore"), fs);

    let eventFired = false;
    store.onDidLoad(() => {
      eventFired = true;
    });

    await new Promise(resolve => store.onDidLoad(() => resolve(undefined)));

    assert.strictEqual(eventFired, true);
  });

  it("handles loading when file does not exist initially", async () => {
    const fs = new MockFS({});
    // Override readLines to simulate file not existing
    fs.readLines = async () => {
      return []; // Empty array simulates empty file
    };

    const store = new PinStore(Uri.parse("scratch:/.pinstore"), fs);

    await new Promise(resolve => store.onDidLoad(() => resolve(undefined)));

    assert.deepEqual(store.pinned, []);
  });
});
