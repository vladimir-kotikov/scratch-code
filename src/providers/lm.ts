import { Minimatch } from "minimatch";
import * as vscode from "vscode";
import { LanguageModelDataPart, LanguageModelTextPart, LanguageModelToolResult, Uri } from "vscode";
import { DisposableContainer } from "../util/containers";
import { map, prop, zip } from "../util/fu";
import { asPromise } from "../util/promises";
import { splitLines, splitWords, strip } from "../util/text";
import { ensureUri, normalizeFilter, uriPath } from "../util/uri";
import { ScratchFileSystemProvider } from "./fs";
import { SearchIndexProvider, SearchOptions } from "./search";
import { ScratchTreeProvider } from "./tree";

type ListScratchesOptions = {
  filter?: string;
};

type ReadScratchOptions = {
  uri: string | Uri;
  lineFrom?: number;
  lineTo?: number;
};

type OutlineOptions = {
  uri: string | Uri;
  depth?: number;
};

export type RenameScratchOptions = {
  oldUri: string | Uri;
  newUri: string | Uri;
};

type MaybeArray<T> = T | T[];
type MaybePromiseLike<T> = T | PromiseLike<T>;
type LmResponsePart = LanguageModelTextPart | LanguageModelDataPart;
type SymbolProvider = (
  uri: Uri,
) => Thenable<(vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined>;

const defaultSymbolProvider: SymbolProvider = async uri => {
  await vscode.workspace.openTextDocument(uri);
  return vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
    "vscode.executeDocumentSymbolProvider",
    uri,
  );
};

const formatLineRange = (startLine: number, endLine: number): string =>
  startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`;

function formatDocumentSymbols(
  symbols: vscode.DocumentSymbol[],
  maxDepth: number,
  currentDepth: number,
): string {
  if (currentDepth >= maxDepth) {
    return "";
  }
  const lines: string[] = [];
  for (const symbol of symbols) {
    const indent = "  ".repeat(currentDepth);
    const kind = vscode.SymbolKind[symbol.kind];
    const startLine = symbol.range.start.line + 1;
    const endLine = symbol.range.end.line + 1;
    lines.push(`${indent}${symbol.name} (${kind}, ${formatLineRange(startLine, endLine)})`);
    const children: vscode.DocumentSymbol[] = symbol.children ?? [];
    if (children.length > 0) {
      const childOutput = formatDocumentSymbols(children, maxDepth, currentDepth + 1);
      if (childOutput) {
        lines.push(childOutput);
      }
    }
  }
  return lines.join("\n");
}

function filterSymbolInfoByDepth(
  symbols: vscode.SymbolInformation[],
  maxDepth: number,
): vscode.SymbolInformation[] {
  // Assign depths using containerName chains. Symbols without a containerName are depth 0.
  const depthMap = new Map<string, number>();
  for (const s of symbols) {
    if (!s.containerName) {
      depthMap.set(s.name, 0);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of symbols) {
      if (depthMap.has(s.name)) {
        continue;
      }
      const parentDepth = depthMap.get(s.containerName);
      if (parentDepth !== undefined) {
        depthMap.set(s.name, parentDepth + 1);
        changed = true;
      }
    }
  }
  return symbols.filter(s => (depthMap.get(s.name) ?? 0) < maxDepth);
}

export class ScratchLmToolkit extends DisposableContainer {
  constructor(
    private readonly fs: ScratchFileSystemProvider,
    private readonly treeProvider: ScratchTreeProvider,
    private readonly searchProvider: SearchIndexProvider,
    private readonly symbolProvider: SymbolProvider = defaultSymbolProvider,
    private readonly retryDelayMs: number = 500,
  ) {
    super();
  }

  listScratches = (options?: ListScratchesOptions) => {
    const filter = options?.filter !== undefined ? normalizeFilter(options.filter) : undefined;
    const pattern = filter?.startsWith("**/") ? new Minimatch(filter) : undefined;
    const prefix = pattern ? undefined : filter?.replace(/\/$/, "");
    return this.treeProvider
      .getFlatTree()
      .then(map(prop("uri")))
      .then(uris =>
        uris
          .map(uri => strip(uriPath(uri), ["/"]))
          .filter(uri => pattern?.match(uri) ?? true)
          .filter(uri => (prefix ? uri.startsWith(prefix) : true))
          .join("\n"),
      );
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

  getScratchOutline = async ({ uri, depth = 2 }: OutlineOptions): Promise<string> => {
    const resolvedUri = ensureUri(uri);
    let symbols = await asPromise(this.symbolProvider(resolvedUri));
    if (!symbols || symbols.length === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, this.retryDelayMs));
      symbols = await asPromise(this.symbolProvider(resolvedUri));
    }
    if (!symbols || symbols.length === 0) {
      return "No symbols found.";
    }
    if ("children" in symbols[0]) {
      const result = formatDocumentSymbols(symbols as vscode.DocumentSymbol[], depth, 0);
      return result || "No symbols found.";
    }
    // SymbolInformation — flat list; apply depth filtering via containerName chains
    const filtered = filterSymbolInfoByDepth(symbols as vscode.SymbolInformation[], depth);
    if (filtered.length === 0) {
      return "No symbols found.";
    }
    return filtered
      .map(
        s =>
          `${s.name} (${vscode.SymbolKind[s.kind]}, ${formatLineRange(s.location.range.start.line + 1, s.location.range.end.line + 1)})`,
      )
      .join("\n");
  };

  writeScratch = (scratches: Record<string, string>) => {
    const writes = Object.entries(scratches).map(([uri, content]) =>
      this.fs.writeFile(ensureUri(uri), content, {
        create: true,
        overwrite: true,
      }),
    );
    return Promise.allSettled(writes).then(results => {
      if (results.every(result => result.status === "fulfilled")) {
        return "Scratches written successfully.";
      }
      const failures = zip(Object.keys(scratches), results)
        .filter(([, result]) => result.status === "rejected")
        .map(([uri, result]) => `  - ${uri}: ${(result as PromiseRejectedResult).reason}`);
      return `Failed to write the following scratches:\n${failures.join("\n")}`;
    });
  };

  renameScratch = ({ oldUri, newUri }: RenameScratchOptions) =>
    this.fs.rename(ensureUri(oldUri), ensureUri(newUri), { overwrite: true });

  searchScratches = (options: SearchOptions): Promise<string> =>
    this.searchProvider.search(options).then(matches => {
      if (matches.length === 0) {
        return "No matches found.";
      }

      const extractPath = (uri: string): string => strip(uriPath(uri), ["/"]);

      const formatMatch = (match: (typeof matches)[0]): string[] => [
        `${extractPath(match.uri)}:${match.line}`,
        ...match.context.map(ctx => `  ${ctx}`),
        `→ ${match.content}`,
        "",
      ];

      return [
        `Found ${matches.length} match${matches.length === 1 ? "" : "es"}:\n`,
        ...matches.flatMap(formatMatch),
      ].join("\n");
    });
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
