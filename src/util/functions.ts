export const batch = <T>(
  fn: (items: T[]) => void,
  delay: number,
): ((input: T[]) => void) & { cancel: () => void } => {
  let timeoutId: NodeJS.Timeout | undefined;
  let items: T[] = [];

  const batched = (input: T[]) => {
    items.push(...input);

    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      timeoutId = undefined;
      if (items.length > 0) {
        const batch = items;
        items = [];
        fn(batch);
      }
    }, delay);
  };

  batched.cancel = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    items = [];
  };

  return batched;
};

export const debounce = <Args extends unknown[], R>(
  fn: (...args: Args) => R,
  delay: number,
): ((...args: Args) => Promise<Awaited<R>>) & { cancel: () => void } => {
  let timeoutId: NodeJS.Timeout | undefined;

  const debounced = (...args: Args): Promise<Awaited<R>> => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    // Create promise that resolves when debounce completes
    return new Promise<Awaited<R>>(resolve => {
      timeoutId = setTimeout(() => {
        timeoutId = undefined;
        const fnResult = fn(...args);
        resolve(fnResult as Awaited<R>);
      }, delay);
    });
  };

  debounced.cancel = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };

  return debounced;
};
