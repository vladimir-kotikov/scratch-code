import { Uri } from "vscode";

export const ensureUri = (uri: Uri | string): Uri => (uri instanceof Uri ? uri : Uri.parse(uri));

export const uriPath = (uri: Uri | string): string => ensureUri(uri).path;
