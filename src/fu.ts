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

export const call =
  <K extends PropertyKey, Args extends unknown[]>(key: K, ...args: Args) =>
  <T extends Record<K, Fn<Args>>>(obj: T): ReturnType<T[K]> =>
    obj[key](...args) as ReturnType<T[K]>;

export const map =
  <T, U>(fn: (item: T) => U) =>
  (arr: T[]): U[] =>
    arr.map(fn);

export const sort =
  <T>(compareFn: (a: T, b: T) => number) =>
  (arr: T[]): T[] =>
    arr.toSorted(compareFn);

export const flat = <T>(arr: T[][]): T[] => arr.flat();

export const asPromise = <P>(p: P | PromiseLike<P>): Promise<P> =>
  p instanceof Promise ? p : Promise.resolve(p);

export const waitPromises = Promise.all.bind(Promise);
