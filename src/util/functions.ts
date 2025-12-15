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
