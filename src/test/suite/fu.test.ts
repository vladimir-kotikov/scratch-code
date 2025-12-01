import { strict as assert } from "assert";
import { pipe, reduce, sort, tap } from "../../util/fu";

describe("fu utilities", () => {
  describe("pipe", () => {
    it("chains single function", () => {
      const add5 = (x: number) => x + 5;
      const fn = pipe(add5);
      assert.strictEqual(fn(10), 15);
    });

    it("chains multiple functions", () => {
      const add5 = (x: number) => x + 5;
      const multiply2 = (x: number) => x * 2;
      const subtract3 = (x: number) => x - 3;
      const fn = pipe(add5, multiply2, subtract3);
      assert.strictEqual(fn(10), 27); // (10 + 5) * 2 - 3 = 27
    });

    it("chains functions with different types", () => {
      const double = (x: number) => x * 2;
      const toString = (x: number) => x.toString();
      const addExclamation = (s: string) => s + "!";
      const fn = pipe(double, toString, addExclamation);
      assert.strictEqual(fn(5), "10!");
    });
  });

  describe("tap", () => {
    it("executes side effect and returns value", () => {
      let sideEffect = 0;
      const tapFn = tap<number>(x => {
        sideEffect = x * 2;
      });
      const result = tapFn(5);
      assert.strictEqual(result, 5);
      assert.strictEqual(sideEffect, 10);
    });

    it("can be used in pipe", () => {
      const values: number[] = [];
      const fn = pipe(
        (x: number) => x + 1,
        tap<number>(x => values.push(x)),
        (x: number) => x * 2,
        tap<number>(x => values.push(x)),
      );
      const result = fn(5);
      assert.strictEqual(result, 12); // (5 + 1) * 2 = 12
      assert.deepEqual(values, [6, 12]);
    });
  });

  describe("reduce", () => {
    it("reduces array to sum", () => {
      const sum = (acc: number, x: number) => acc + x;
      const reduceFn = reduce(sum, 0);
      assert.strictEqual(reduceFn([1, 2, 3, 4]), 10);
    });

    it("reduces array to object", () => {
      const toObj = (acc: Record<string, number>, x: string) => {
        acc[x] = x.length;
        return acc;
      };
      const reduceFn = reduce(toObj, {});
      const result = reduceFn(["a", "bb", "ccc"]);
      assert.deepEqual(result, { a: 1, bb: 2, ccc: 3 });
    });

    it("works with empty array", () => {
      const sum = (acc: number, x: number) => acc + x;
      const reduceFn = reduce(sum, 42);
      assert.strictEqual(reduceFn([]), 42);
    });
  });

  describe("sort", () => {
    describe("byBoolValue", () => {
      it("sorts false before true", () => {
        type Item = { name: string; active: boolean };
        const items: Item[] = [
          { name: "a", active: true },
          { name: "b", active: false },
          { name: "c", active: true },
          { name: "d", active: false },
        ];
        const sortFn = sort<Item>(sort.byBoolValue(x => x.active));
        const sorted = sortFn(items);
        assert.deepEqual(
          sorted.map(x => x.name),
          ["b", "d", "a", "c"],
        );
      });

      it("can be reversed with desc", () => {
        type Item = { name: string; active: boolean };
        const items: Item[] = [
          { name: "a", active: true },
          { name: "b", active: false },
          { name: "c", active: true },
        ];
        const sortFn = sort<Item>(sort.desc(sort.byBoolValue(x => x.active)));
        const sorted = sortFn(items);
        assert.deepEqual(
          sorted.map(x => x.name),
          ["a", "c", "b"],
        );
      });
    });

    describe("multiple comparators", () => {
      it("chains comparators with fallback", () => {
        type Item = { pinned: boolean; name: string };
        const items: Item[] = [
          { pinned: false, name: "z" },
          { pinned: true, name: "b" },
          { pinned: false, name: "a" },
          { pinned: true, name: "c" },
        ];
        const sortFn = sort<Item>(
          sort.desc(sort.byBoolValue(x => x.pinned)),
          sort.byStringValue(x => x.name),
        );
        const sorted = sortFn(items);
        assert.deepEqual(
          sorted.map(x => x.name),
          ["b", "c", "a", "z"],
        );
      });

      it("uses first comparator result when non-zero", () => {
        type Item = { age: number; name: string };
        const items: Item[] = [
          { age: 30, name: "Alice" },
          { age: 20, name: "Bob" },
          { age: 30, name: "Charlie" },
        ];
        const sortFn = sort<Item>(
          sort.byNumericValue(x => x.age),
          sort.byStringValue(x => x.name),
        );
        const sorted = sortFn(items);
        assert.deepEqual(
          sorted.map(x => x.name),
          ["Bob", "Alice", "Charlie"],
        );
      });

      it("falls back to second comparator when first is equal", () => {
        type Item = { category: string; value: number };
        const items: Item[] = [
          { category: "a", value: 3 },
          { category: "a", value: 1 },
          { category: "a", value: 2 },
        ];
        const sortFn = sort<Item>(
          sort.byStringValue(x => x.category),
          sort.byNumericValue(x => x.value),
        );
        const sorted = sortFn(items);
        assert.deepEqual(
          sorted.map(x => x.value),
          [1, 2, 3],
        );
      });
    });
  });
});
