import { strict as assert } from "assert";
import { afterEach, describe, it } from "mocha";
import { debounce } from "../util/functions";

describe("debounce", () => {
  const delay = 50;

  afterEach(() => {
    // Allow any pending timers to settle between tests
  });

  [
    { input: 5, expected: 10 },
    { input: 0, expected: 0 },
    { input: -3, expected: -6 },
  ].forEach(({ input, expected }) => {
    it(`resolves with ${expected} when called with ${input} (sync fn)`, async () => {
      const fn = (x: number) => x * 2;
      const debounced = debounce(fn, delay);
      const result = await debounced(input);
      assert.strictEqual(result, expected);
    });
  });

  [
    { input: 7, expected: 107 },
    { input: 0, expected: 100 },
    { input: -50, expected: 50 },
  ].forEach(({ input, expected }) => {
    it(`resolves with ${expected} when called with ${input} (async fn)`, async () => {
      const fn = async (x: number) => {
        await new Promise(r => setTimeout(r, 5));
        return x + 100;
      };
      const debounced = debounce(fn, delay);
      const result = await debounced(input);
      assert.strictEqual(result, expected);
    });
  });

  it("collapses multiple rapid calls into a single execution using the last arguments", async () => {
    let callCount = 0;
    const fn = (x: number) => {
      callCount++;
      return x;
    };
    const debounced = debounce(fn, delay);

    debounced(1);
    debounced(2);
    const result = await debounced(3);

    assert.strictEqual(result, 3, "should resolve with the last argument");
    // Allow the delay to pass and confirm only one execution happened
    await new Promise(r => setTimeout(r, delay * 2));
    assert.strictEqual(callCount, 1, "underlying function should only be called once");
  });

  it("cancel() prevents the pending function from executing", async () => {
    let called = false;
    const fn = () => {
      called = true;
      return 0;
    };
    const debounced = debounce(fn, delay);

    debounced();
    debounced.cancel();

    await new Promise(r => setTimeout(r, delay * 2));
    assert.strictEqual(called, false, "function should not be called after cancel");
  });

  it("cancel() is a no-op when no call is pending", () => {
    const debounced = debounce(() => 0, delay);
    assert.doesNotThrow(() => debounced.cancel());
  });

  it("resets the timer on each call so the delay is measured from the last call", async () => {
    const times: number[] = [];
    const fn = () => {
      times.push(Date.now());
      return 0;
    };
    const debounced = debounce(fn, delay);

    const t0 = Date.now();
    debounced();
    // Fire a second call after half the delay
    await new Promise(r => setTimeout(r, delay / 2));
    await debounced();

    // The function should have fired roughly `delay` ms after the second call,
    // i.e., at least `delay * 1.5` ms after the first call.
    assert.strictEqual(times.length, 1, "should only fire once");
    assert.ok(
      times[0] - t0 >= delay,
      `function should fire at least ${delay}ms after the first call`,
    );
  });
});
