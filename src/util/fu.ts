// Using unknown somehow breaks the type inference here
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn<T = any, R = any> = (value: T) => R;
type Fns = [...Fn[], Fn];
type VarFn<Args extends unknown[] = unknown[], R = unknown> = (...args: Args) => R;

export const identity = <T>(value: T): T => value;

type Pipe<T extends Fns> = T extends [Fn<infer A, infer B>, ...infer Rest]
  ? Rest extends Fns
    ? Pipe<Rest> extends Fn<B, infer C>
      ? Fn<A, C>
      : never
    : Fn<A, B>
  : never;

type Cmp<T> = (a: T, b: T) => number;

export const pass =
  <T = undefined>(value?: T) =>
  (): T extends undefined ? undefined : T =>
    value as T extends undefined ? undefined : T;

export const zip =
  <A, B>(as: A[]) =>
  (bs: B[]): [A, B][] =>
    as.map((a, i) => [a, bs[i]]);

export const prop =
  <K extends PropertyKey>(key: K) =>
  <T extends Record<K, unknown>>(obj: T): T[K] =>
    obj[key];

export const item = prop;

export const call =
  <K extends PropertyKey, Args extends unknown[]>(key: K, ...args: Args) =>
  <T extends Record<K, VarFn<Args>>>(obj: T): ReturnType<T[K]> =>
    obj[key](...args) as ReturnType<T[K]>;

export const apply =
  <T extends unknown[], U>(fn: (...args: T) => U) =>
  (args: T): U =>
    fn(...args);

export const filter =
  <T>(fn: (item: T) => boolean) =>
  (arr: T[]): T[] =>
    arr.filter(fn);

export const map =
  <T, U>(fn: (item: T) => U) =>
  (arr: T[]): U[] =>
    arr.map(fn);

export const reduce =
  <T, U>(fn: (acc: U, item: T) => U, initial: U) =>
  (arr: T[]): U =>
    arr.reduce(fn, initial);

export const concat = <T>(...arrays: T[][]): T[] => arrays.flat();

export const flat = <T>(arr: T[][]): T[] => arr.flat();

export const split = <T>(
  predicate: (item: T, index: number) => boolean,
  items: T[],
): [T[], T[]] => {
  const ind = items.findIndex(predicate);
  return [items.slice(0, ind), items.slice(ind)];
};

export const pipe = <T extends Fns>(...fns: T): Pipe<T> =>
  (value => fns.reduce((acc, fn) => fn(acc), value)) as Pipe<T>;

export const tap =
  <T>(fn: (value: T) => unknown) =>
  (value: T): T => {
    fn(value);
    return value;
  };

/**
 * Composes multiple comparator functions into a single comparator.
 * Precedence is left-to-right: the FIRST comparator has the HIGHEST precedence.
 * Later comparators are only evaluated when all previous comparators return `0`.
 */
const composeComparators =
  <T>(...cmps: Cmp<T>[]): Cmp<T> =>
  (a: T, b: T) =>
    cmps.reduce((result, cmp) => (result !== 0 ? result : cmp(a, b)), 0);

/**
 * Stable sort by a sequence of comparators, where the LEFTMOST comparator has the
 * highest precedence. Each subsequent comparator is applied only if the previous ones
 * consider the items equal (i.e., return `0`).
 */
export const sort =
  <T>(...cmps: Cmp<T>[]) =>
  (arr: T[]): T[] =>
    arr.toSorted(composeComparators(...cmps));

/**
 * Applies sort to a group, specified by predicate so that only items falling within the same group are compared.
 * @param fn - A function that determines the group of an item.
 * @returns A comparator function that sorts items within the same group using the provided comparator.
 */
sort.group =
  <T, U extends T>(fn: (a: T) => a is U, ...cmps: Cmp<U>[]) =>
  (a: T, b: T) =>
    fn(a) && fn(b) ? composeComparators(...cmps)(a, b) : 0;

sort.desc =
  <T>(fn: Cmp<T>) =>
  (a: T, b: T) =>
    -fn(a, b);

sort.byNumericValue =
  <T>(fn: (a: T) => number) =>
  (a: T, b: T) =>
    fn(a) - fn(b);

sort.byStringValue =
  <T>(fn: (a: T) => string) =>
  (a: T, b: T) =>
    fn(a).localeCompare(fn(b));

/**
 * Creates a comparator function that compares boolean values. Default order is truthy before falsy (true < false is negative).
 * Use `sort.desc` to flip to falsy-first.
 * @param fn - A function that extracts the boolean value from the items being compared.
 * @returns A comparator function that compares the boolean values.
 */
sort.byBoolValue =
  <T>(fn: (a: T) => boolean) =>
  (a: T, b: T) =>
    Number(fn(b)) - Number(fn(a));
