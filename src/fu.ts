// Using unknown somehow breaks the type inference here
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn<T = any, R = any> = (value: T) => R;
type Fns = [...Fn[], Fn];
type VarFn<Args extends unknown[] = unknown[], R = unknown> = (...args: Args) => R;

type Pipe<T extends Fns> = T extends [Fn<infer A, infer B>, ...infer Rest]
  ? Rest extends Fns
    ? Pipe<Rest> extends Fn<B, infer C>
      ? Fn<A, C>
      : never
    : Fn<A, B>
  : never;

type Cmp<T> = (a: T, b: T) => number;

export const pass =
  <T>(value: T) =>
  () =>
    value;

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

const isPromiseLike = <P>(p: P | PromiseLike<P>): p is PromiseLike<P> =>
  typeof (p as PromiseLike<P>)?.then === "function";

export const asPromise = <P>(p: P | PromiseLike<P>): PromiseLike<P> =>
  isPromiseLike(p) ? p : Promise.resolve(p);

export const waitPromises = Promise.all.bind(Promise);

const composeComparators =
  <T>(...cmps: Cmp<T>[]): Cmp<T> =>
  (a: T, b: T) =>
    cmps.reduce((result, cmp) => (result !== 0 ? result : cmp(a, b)), 0);

export const sort =
  <T>(...cmps: Cmp<T>[]) =>
  (arr: T[]): T[] =>
    arr.toSorted(composeComparators(...cmps));

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
 * Creates a comparator function that compares boolean values. The order is false < true so that falsy values come first.
 * @param fn - A function that extracts the boolean value from the items being compared.
 * @returns A comparator function that compares the boolean values.
 */
sort.byBoolValue =
  <T>(fn: (a: T) => boolean) =>
  (a: T, b: T) =>
    Number(fn(a)) - Number(fn(b));
