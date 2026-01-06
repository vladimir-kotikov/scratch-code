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
  return Uri.parse(`${SCHEME}:/${relativePath}`);
};
