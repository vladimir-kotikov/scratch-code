export const isEmpty = (str: string) => str.trim().length === 0;

export const splitLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

/**
 * Splits CamelCase or snake_case into words
 * @param text text to split
 * @returns Array of words
 */
export const splitWords = (text: string): string[] => {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // Split camelCase
    .replace(/_+/g, " ") // Replace underscores with space
    .split(" ")
    .map(word => word.trim())
    .filter(word => word.length > 0);
};

export const strip = (text: string, symbols: string): string => {
  let result = text;
  // Remove all matching characters from the start
  while (result.length > 0 && symbols.includes(result[0])) {
    result = result.slice(1);
  }
  // Remove all matching characters from the end
  while (result.length > 0 && symbols.includes(result[result.length - 1])) {
    result = result.slice(0, -1);
  }
  return result;
};
