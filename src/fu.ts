type Fn<Args extends unknown[] = unknown[], R = unknown> = (...args: Args) => R;

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
  <T extends Record<K, Fn<Args>>>(obj: T): ReturnType<T[K]> =>
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

export const flat = <T>(arr: T[][]): T[] => arr.flat();

const isPromiseLike = <P>(p: P | PromiseLike<P>): p is PromiseLike<P> =>
  typeof (p as PromiseLike<P>)?.then === "function";

export const asPromise = <P>(p: P | PromiseLike<P>): PromiseLike<P> =>
  isPromiseLike(p) ? p : Promise.resolve(p);

export const waitPromises = Promise.all.bind(Promise);

export const sort =
  <T>(compareFn: (a: T, b: T) => number) =>
  (arr: T[]): T[] =>
    arr.toSorted(compareFn);

sort.desc =
  <T>(fn: (a: T, b: T) => number) =>
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
