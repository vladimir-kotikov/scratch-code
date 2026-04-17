import path from "node:path";
import { Uri } from "vscode";

export const SCHEME = "scratch";

export const ensureUri = (uri: Uri | string): Uri => (uri instanceof Uri ? uri : Uri.parse(uri));

export const uriPath = (uri: Uri | string): string => ensureUri(uri).path;

export const toFilesystemUri = (scratchDir: Uri, uri: Uri): Uri => {
  if (uri.scheme !== SCHEME) {
    throw new Error(`Invalid URI scheme: ${uri.scheme}`);
  }
  return Uri.joinPath(scratchDir, uri.path);
};

export const toScratchUri = (scratchDir: Uri, uri: Uri): Uri => {
  const relativePath = path.relative(scratchDir.fsPath, uri.fsPath);
  if (relativePath.startsWith("..")) {
    throw new Error(`URI is outside of scratch directory: ${uri.toString()}`);
  }
  return Uri.joinPath(Uri.parse(`${SCHEME}:/`), relativePath);
};

// Normalizes a user-supplied filter string for use in both list_scratches and
// search_scratches:
//   1. Strips the scratch:// scheme if present (extracts the path component).
//   2. Strips leading slashes, yielding a root-relative path.
//   3. If the filter is a glob (contains *, ?, {, or [) and does not already
//      start with a **-prefix ("**/"), prepends it so that directory-scoped
//      patterns work correctly regardless of the underlying search engine.
//   4. If the filter is a bare basename (no "/" and no glob chars), prepends
//      "**/" so it matches at any depth (e.g. "README.md" → "**/README.md").
// Slash-separated path prefixes (e.g. "projects/foo") pass through unchanged
// and are used as directory-scope limits.
export const normalizeFilter = (filter: string): string => {
  const p = filter.startsWith(`${SCHEME}:`) ? ensureUri(filter).path : filter;
  const stripped = p.replace(/^\/+/, "");
  const isGlob = /[*?{[]/.test(stripped);
  if (isGlob && !stripped.startsWith("**/")) {
    return `**/${stripped}`;
  }
  if (!isGlob && !stripped.includes("/") && stripped.length > 0) {
    return `**/${stripped}`;
  }
  return stripped;
};
