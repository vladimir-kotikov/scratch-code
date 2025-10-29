export const zip =
  <A, B>(as: A[]) =>
  (bs: B[]): [A, B][] =>
    as.map((a, i) => [a, bs[i]]);

export const prop =
  <K extends PropertyKey>(key: K) =>
  <T extends Record<K, unknown>>(obj: T): T[K] =>
    obj[key];

export const map =
  <T, U>(fn: (item: T) => U) =>
  (arr: T[]): U[] =>
    arr.map(fn);

export const sort =
  <T>(compareFn: (a: T, b: T) => number) =>
  (arr: T[]): T[] =>
    arr.toSorted(compareFn);

export const flat = <T>(arr: T[][]): T[] => arr.flat();
