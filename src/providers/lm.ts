import { Minimatch } from "minimatch";
import * as vscode from "vscode";
import { LanguageModelDataPart, LanguageModelTextPart, LanguageModelToolResult, Uri } from "vscode";
import { DisposableContainer } from "../util/containers";
import { map, prop } from "../util/fu";
import { asPromise } from "../util/promises";
import { splitLines, splitWords, strip } from "../util/text";
import { ensureUri, uriPath } from "../util/uri";
import { ScratchFileSystemProvider } from "./fs";
import { ScratchTreeProvider } from "./tree";

type ListScratchesOptions = {
  filter?: string;
};

type ReadScratchOptions = {
  uri: string | Uri;
  lineFrom?: number;
  lineTo?: number;
};

type WriteScratchOptions = {
  uri: string | Uri;
  content: string;
};

export type RenameScratchOptions = {
  oldUri: string | Uri;
  newUri: string | Uri;
};

type MaybeArray<T> = T | T[];
type MaybePromiseLike<T> = T | PromiseLike<T>;
type LmResponsePart = LanguageModelTextPart | LanguageModelDataPart;

export class ScratchLmToolkit extends DisposableContainer {
  constructor(
    private readonly fs: ScratchFileSystemProvider,
    private readonly treeProvider: ScratchTreeProvider,
  ) {
    super();
  }

  listScratches = (options?: ListScratchesOptions) => {
    const pattern = options?.filter ? new Minimatch(options.filter) : null;
    return this.treeProvider
      .getFlatTree()
      .then(map(prop("uri")))
      .then(uris => {
        uris = pattern ? uris.filter(u => pattern.match(u.path)) : uris;
        return uris.map(u => strip(uriPath(u), ["/"])).join("\n");
      });
  };

  readScratch = ({ uri, lineFrom, lineTo }: ReadScratchOptions) =>
    this.fs
      .readFile(ensureUri(uri))
      .then(bytes => new TextDecoder().decode(bytes))
      .then(content => {
        if (lineFrom !== undefined || lineTo !== undefined) {
          return splitLines(content).slice(lineFrom, lineTo).join("\n");
        }
        return content;
      });

  writeScratch = ({ uri, content }: WriteScratchOptions) =>
    this.fs.writeFile(ensureUri(uri), content, {
        create: true,
        overwrite: true,
    });

  renameScratch = ({ oldUri, newUri }: RenameScratchOptions) =>
    this.fs.rename(ensureUri(oldUri), ensureUri(newUri), { overwrite: true });
}

const maybeCall = <T, U>(val: T | ((arg: U) => T), arg: U): T => {
  return typeof val === "function" ? (val as (arg: U) => T)(arg) : val;
};

const toToolResult = (res: MaybeArray<LmResponsePart | string | void>) => {
  if (!Array.isArray(res)) {
    res = [res] as Array<LmResponsePart | string | void>;
  }
  res = res
    .map(res => (typeof res === "string" ? new LanguageModelTextPart(res) : res))
    .filter(res => res !== undefined);

  return new LanguageModelToolResult(res as LmResponsePart[]);
};

export const registerTool = <
  P,
  R extends MaybePromiseLike<MaybeArray<LmResponsePart | string | void>>,
>(
  name: string,
  impl: (params: P) => R,
  params?: {
    invocationMessage?: string | ((params: P) => string);
    confirmationMessage?:
      | { title: string; message: string }
      | ((params: P) => { title: string; message: string });
  },
) =>
  vscode.lm.registerTool<P>(name, {
    invoke: ({ input }) =>
      asPromise(impl(input)).then(toToolResult, err => {
        throw `Failed to ${splitWords(name)
          .map(name => name.toLowerCase())
          .join(" ")}: ${err}`;
      }),
    prepareInvocation: ({ input }) => ({
      confirmationMessages: maybeCall(params?.confirmationMessage, input),
      invocationMessage: maybeCall(params?.invocationMessage, input),
    }),
  });
