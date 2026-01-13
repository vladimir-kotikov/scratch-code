import { strict as assert } from "assert";
import { describe, it } from "mocha";
import { isEmpty, splitLines, splitWords, strip } from "../util/text";

describe("text utilities", () => {
  describe("isEmpty", () => {
    it("returns true for empty string", () => {
      assert.strictEqual(isEmpty(""), true);
    });

    it("returns true for whitespace-only string", () => {
      assert.strictEqual(isEmpty("   "), true);
      assert.strictEqual(isEmpty("\t\n"), true);
    });

    it("returns false for non-empty string", () => {
      assert.strictEqual(isEmpty("hello"), false);
      assert.strictEqual(isEmpty(" hello "), false);
    });
  });

  describe("splitLines", () => {
    it("splits text by newlines", () => {
      const result = splitLines("line1\nline2\nline3");
      assert.deepEqual(result, ["line1", "line2", "line3"]);
    });

    it("handles CRLF line endings", () => {
      const result = splitLines("line1\r\nline2\r\nline3");
      assert.deepEqual(result, ["line1", "line2", "line3"]);
    });

    it("trims whitespace from lines", () => {
      const result = splitLines("  line1  \n  line2  \n  line3  ");
      assert.deepEqual(result, ["line1", "line2", "line3"]);
    });

    it("filters out empty lines", () => {
      const result = splitLines("line1\n\nline2\n   \nline3");
      assert.deepEqual(result, ["line1", "line2", "line3"]);
    });

    it("returns empty array for empty input", () => {
      const result = splitLines("");
      assert.deepEqual(result, []);
    });
  });

  describe("splitWords", () => {
    it("splits camelCase", () => {
      const result = splitWords("helloWorld");
      assert.deepEqual(result, ["hello", "World"]);
    });

    it("splits snake_case", () => {
      const result = splitWords("hello_world");
      assert.deepEqual(result, ["hello", "world"]);
    });

    it("splits combined camelCase and snake_case", () => {
      const result = splitWords("hello_worldFoo");
      assert.deepEqual(result, ["hello", "world", "Foo"]);
    });

    it("handles multiple underscores", () => {
      const result = splitWords("hello__world");
      assert.deepEqual(result, ["hello", "world"]);
    });

    it("handles numbers in camelCase", () => {
      const result = splitWords("hello2World3");
      assert.deepEqual(result, ["hello2", "World3"]);
    });

    it("returns single word for simple text", () => {
      const result = splitWords("hello");
      assert.deepEqual(result, ["hello"]);
    });
  });

  describe("strip", () => {
    it("strips single symbol from start", () => {
      assert.strictEqual(strip("hello", "h"), "ello");
    });

    it("strips single symbol from end", () => {
      assert.strictEqual(strip("hello", "o"), "hell");
    });

    it("strips single symbol from both start and end", () => {
      assert.strictEqual(strip("hello", "he"), "llo");
    });

    it("strips multiple different symbols from start", () => {
      assert.strictEqual(strip("...hello", "..."), "hello");
    });

    it("strips multiple different symbols from end", () => {
      assert.strictEqual(strip("hello...", "..."), "hello");
    });

    it("strips multiple different symbols from both ends", () => {
      assert.strictEqual(strip("...hello...", "..."), "hello");
    });

    it("processes each symbol independently", () => {
      assert.strictEqual(strip("\"'hello'\"", "\"'"), "hello");
    });

    it("strips all matching characters from both ends", () => {
      // Removes all 'a' and 'b' characters from start and end
      assert.strictEqual(strip("aabaa", "ab"), "");
    });

    it("does not remove symbols from middle", () => {
      assert.strictEqual(strip("ha-ha", "-"), "ha-ha");
    });

    it("returns unchanged string if no symbols match", () => {
      assert.strictEqual(strip("hello", "xyz"), "hello");
    });

    it("handles empty string", () => {
      assert.strictEqual(strip("", "abc"), "");
    });

    it("handles empty symbols string", () => {
      assert.strictEqual(strip("hello", ""), "hello");
    });

    it("handles string that is all symbols", () => {
      // All characters are in the symbol set, so everything is stripped
      assert.strictEqual(strip("aaaa", "a"), "");
    });

    it("strips whitespace characters", () => {
      // Removes all spaces from both ends, like Python's strip()
      assert.strictEqual(strip("  hello  ", " "), "hello");
    });

    it("strips tabs and newlines", () => {
      assert.strictEqual(strip("\thello\n", "\t\n"), "hello");
    });

    it("strips same symbol from start and end in one pass", () => {
      assert.strictEqual(strip("'hello'", "'"), "hello");
    });

    it("complex example: stripping quotes and slashes", () => {
      assert.strictEqual(strip('/"content"/', '/"\'"'), "content");
    });
  });
});
