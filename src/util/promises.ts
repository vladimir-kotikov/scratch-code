const isPromiseLike = <P>(p: P | PromiseLike<P>): p is PromiseLike<P> =>
  typeof (p as PromiseLike<P>)?.then === "function";

export const asPromise = <P>(p: P | PromiseLike<P>): Promise<P> =>
  p instanceof Promise
    ? p
    : isPromiseLike(p)
      ? new Promise((resolve, reject) => p.then(resolve, reject))
      : Promise.resolve(p);

export const waitPromises = Promise.all.bind(Promise);

export const whenError =
  <T>(when: (err: unknown) => boolean, then: (err: unknown) => T) =>
  (err: unknown): T =>
    when(err)
      ? then(err)
      : (() => {
          throw err;
        })();
