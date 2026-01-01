export const trim = (str: string, char: string) => {
  let start = 0;
  let end = str.length;

  while (start < end && str[start] === char) ++start;
  while (end > start && str[end - 1] === char) --end;

  return str.slice(start, end);
};
