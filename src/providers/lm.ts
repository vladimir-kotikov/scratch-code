import { Minimatch } from "minimatch";
import * as vscode from "vscode";
import { LanguageModelDataPart, LanguageModelTextPart, LanguageModelToolResult, Uri } from "vscode";
import { DisposableContainer } from "../util/containers";
import { map, prop, zip } from "../util/fu";
import { asPromise } from "../util/promises";
import { splitWords, strip } from "../util/text";
import { ensureUri, normalizeFilter, uriPath } from "../util/uri";
import { ScratchFileSystemProvider } from "./fs";
import { SearchIndexProvider, SearchOptions } from "./search";
import { ScratchTreeProvider } from "./tree";

type ListScratchesOptions = {
  filter?: string;
};

type ReadScratchRequest = {
  uri: string | Uri;
  lineFrom?: number;
  lineTo?: number;
};

type ReadScratchOptions = {
  reads: ReadScratchRequest[];
};

type OutlineOptions = {
  uri: string | Uri;
  depth?: number;
};

type InsertOp = { op: "insert"; line: number; content: string };
type ReplaceOp = { op: "replace"; lineFrom: number; lineTo: number; content: string };
type AppendOp = { op: "append"; content: string };
type ScratchEditOp = InsertOp | ReplaceOp | AppendOp;

type FileEdits = {
  uri: string | Uri;
  edits: ScratchEditOp[];
};

type EditScratchOptions = {
  edits: FileEdits[];
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

  readScratch = ({ reads }: ReadScratchOptions): Promise<string> =>
    Promise.all(
      reads.map(({ uri, lineFrom, lineTo }) => {
        const resolvedUri = ensureUri(uri);
        return this.fs
          .readFile(resolvedUri)
          .then(bytes => new TextDecoder().decode(bytes))
          .then(content => {
            // lineFrom and lineTo are 1-based inclusive, matching get_scratch_outline output
            const lines =
              lineFrom !== undefined || lineTo !== undefined
                ? content
                    .split(/\r?\n/)
                    .slice(lineFrom !== undefined ? lineFrom - 1 : 0, lineTo)
                    .join("\n")
                : content;
            const rangeLabel =
              lineFrom !== undefined && lineTo !== undefined
                ? lineFrom === lineTo
                  ? `, line ${lineFrom}`
                  : `, lines ${lineFrom}-${lineTo}`
                : lineFrom !== undefined
                  ? `, from line ${lineFrom}`
                  : lineTo !== undefined
                    ? `, lines 1-${lineTo}`
                    : "";
            return `[scratch:///${strip(uriPath(resolvedUri), ["/"])}${rangeLabel}]\n${lines}`;
          });
      }),
    ).then(results => results.join("\n---\n"));

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

  editScratch = ({ edits }: EditScratchOptions): Promise<string> =>
    Promise.allSettled(
      edits.map(({ uri, edits: ops }) => {
        const resolvedUri = ensureUri(uri);
        const path = strip(uriPath(resolvedUri), ["/"]);
        return this.fs
          .readFile(resolvedUri)
          .then(bytes => new TextDecoder().decode(bytes))
          .then(content => {
            const lines = content.split(/\r?\n/);
            const appends = ops.filter((op): op is AppendOp => op.op === "append");
            const lineOps = ops.filter((op): op is InsertOp | ReplaceOp => op.op !== "append");
            // Validate all line ops before mutating anything.
            const errors: string[] = [];
            for (const op of lineOps) {
              if (op.op === "insert") {
                if (op.line < 1) {
                  errors.push(`insert op: line must be ≥ 1 (got ${op.line})`);
                } else if (op.line > lines.length + 1) {
                  errors.push(
                    `insert op: line (${op.line}) exceeds file length (${lines.length} lines); use append op or line ${lines.length + 1} to add after the last line`,
                  );
                }
              } else {
                if (op.lineFrom < 1) {
                  errors.push(`replace op: lineFrom must be ≥ 1 (got ${op.lineFrom})`);
                } else if (op.lineFrom > op.lineTo) {
                  errors.push(
                    `replace op: lineFrom (${op.lineFrom}) must be ≤ lineTo (${op.lineTo})`,
                  );
                } else if (op.lineFrom > lines.length) {
                  errors.push(
                    `replace op: lineFrom (${op.lineFrom}) exceeds file length (${lines.length} lines)`,
                  );
                } else if (op.lineTo > lines.length) {
                  errors.push(
                    `replace op: lineTo (${op.lineTo}) exceeds file length (${lines.length} lines)`,
                  );
                }
              }
            }
            // Detect overlapping op ranges so callers get an explicit error
            // instead of silent data corruption.
            const rangeOf = (op: InsertOp | ReplaceOp): [number, number] =>
              op.op === "insert" ? [op.line, op.line] : [op.lineFrom, op.lineTo];
            for (let i = 0; i < lineOps.length; i++) {
              for (let j = i + 1; j < lineOps.length; j++) {
                const [a1, a2] = rangeOf(lineOps[i]);
                const [b1, b2] = rangeOf(lineOps[j]);
                if (a1 <= b2 && b1 <= a2) {
                  errors.push(
                    `ops ${i + 1} and ${j + 1} target overlapping lines (${a1}–${a2} and ${b1}–${b2})`,
                  );
                }
              }
            }
            if (errors.length > 0) {
              throw new Error(`edit_scratch: ${errors.join("; ")}`);
            }
            // Apply line-based ops bottom-to-top so earlier edits don't shift
            // the line numbers of later ones.
            lineOps
              .slice()
              .sort((a, b) => {
                const aLine = a.op === "insert" ? a.line : a.lineFrom;
                const bLine = b.op === "insert" ? b.line : b.lineFrom;
                return bLine - aLine;
              })
              .forEach(op => {
                if (op.op === "insert") {
                  const at = Math.min(op.line - 1, lines.length);
                  lines.splice(at, 0, ...op.content.split(/\r?\n/));
                } else {
                  const from = op.lineFrom - 1;
                  const count = op.lineTo - op.lineFrom + 1;
                  // empty content means delete the range
                  const replacement = op.content === "" ? [] : op.content.split(/\r?\n/);
                  lines.splice(from, count, ...replacement);
                }
              });
            // An empty-string append would add a spurious trailing blank line;
            // treat it as a no-op so callers don't have to guard against it.
            appends
              .filter(op => op.content !== "")
              .forEach(op => lines.push(...op.content.split(/\r?\n/)));
            return new TextEncoder().encode(lines.join("\n"));
          })
          .then(bytes => this.fs.writeFile(resolvedUri, bytes, { create: false, overwrite: true }))
          .then(
            () => ({ ok: true as const, path }),
            (err: unknown) => ({ ok: false as const, path, err }),
          );
      }),
    ).then(results => {
      const succeeded = results
        .filter(
          (r): r is PromiseFulfilledResult<{ ok: true; path: string }> =>
            r.status === "fulfilled" && r.value.ok,
        )
        .map(r => r.value.path);
      const failed = results
        .filter(
          (r): r is PromiseFulfilledResult<{ ok: false; path: string; err: unknown }> =>
            r.status === "fulfilled" && !r.value.ok,
        )
        .map(
          r =>
            `  - ${r.value.path}: ${r.value.err instanceof Error ? r.value.err.message : String(r.value.err)}`,
        );
      const lines: string[] = [];
      if (succeeded.length > 0) {
        lines.push(`Edited: ${succeeded.join(", ")}`);
      }
      if (failed.length > 0) {
        lines.push(`Failed:\n${failed.join("\n")}`);
      }
      return lines.join("\n");
    });

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
          .join(" ")}: ${err instanceof Error ? err.message : String(err)}`;
      }),
    prepareInvocation: ({ input }) => ({
      confirmationMessages: maybeCall(params?.confirmationMessage, input),
      invocationMessage: maybeCall(params?.invocationMessage, input),
    }),
  });
