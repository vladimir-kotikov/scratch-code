import { Minimatch } from "minimatch";
import * as vscode from "vscode";
import { LanguageModelDataPart, LanguageModelTextPart, LanguageModelToolResult, Uri } from "vscode";
import { DisposableContainer } from "../util/containers";
import { map, prop, sort } from "../util/fu";
import { asPromise } from "../util/promises";
import { splitWords, strip } from "../util/text";
import { ensureUri, normalizeFilter, uriPath } from "../util/uri";
import { ScratchFileSystemProvider } from "./fs";
import { SearchIndexProvider, SearchOptions } from "./search";
import { ScratchTreeProvider } from "./tree";

const LINE_SPLIT_REGEX = /\r?\n/;

type ListScratchesOptions = {
  filter?: string;
};

type ReadScratchOptions = {
  reads: {
    uri: string | Uri;
    lineFrom?: number;
    lineTo?: number;
  }[];
};

type OutlineOptions = {
  uri: string | Uri;
  depth?: number;
};

type InsertOp = { op: "insert"; line: number; content: string };
type ReplaceOp = { op: "replace"; lineFrom: number; lineTo: number; content: string };
type AppendOp = { op: "append"; content: string };
type ScratchEditOp = InsertOp | ReplaceOp | AppendOp;

/**
 * Base interface for validated edit operations with polymorphic application.
 */
interface Edit {
  range(): [number, number];
  apply(lines: string[]): void;
}

/**
 * Validated insert operation that can be applied to a lines array.
 */
class Insert implements Edit {
  constructor(
    private readonly line: number,
    private readonly content: string,
  ) {}

  static validate(op: InsertOp, lineCount: number): string[] | Insert {
    const errors = [];
    if (op.line < 1) errors.push(`insert op: line must be ≥ 1 (got ${op.line})`);
    if (op.line > lineCount + 1) {
      errors.push(
        `insert op: line (${op.line}) exceeds file length (${lineCount} lines); use append op or line ${lineCount + 1} to add after the last line`,
      );
    }
    return errors.length > 0 ? errors : new Insert(op.line, op.content);
  }

  range(): [number, number] {
    return [this.line, this.line];
  }

  apply(lines: string[]): void {
    const at = Math.min(this.line - 1, lines.length);
    lines.splice(at, 0, ...this.content.split(LINE_SPLIT_REGEX));
  }
}

/**
 * Validated replace operation that can be applied to a lines array.
 */
class Replace implements Edit {
  constructor(
    private readonly lineFrom: number,
    private readonly lineTo: number,
    private readonly content: string,
  ) {}

  static validate(op: ReplaceOp, lineCount: number): string[] | Replace {
    const errors = [];
    if (op.lineFrom < 1) errors.push(`replace op: lineFrom must be ≥ 1 (got ${op.lineFrom})`);
    if (op.lineFrom > op.lineTo) {
      errors.push(`replace op: lineFrom (${op.lineFrom}) must be ≤ lineTo (${op.lineTo})`);
    }
    if (op.lineFrom > lineCount) {
      errors.push(`replace op: lineFrom (${op.lineFrom}) exceeds file length (${lineCount} lines)`);
    }
    if (op.lineTo > lineCount) {
      errors.push(`replace op: lineTo (${op.lineTo}) exceeds file length (${lineCount} lines)`);
    }
    return errors.length > 0 ? errors : new Replace(op.lineFrom, op.lineTo, op.content);
  }

  range(): [number, number] {
    return [this.lineFrom, this.lineTo];
  }

  apply(lines: string[]): void {
    const from = this.lineFrom - 1;
    const count = this.lineTo - this.lineFrom + 1;
    const replacement = this.content === "" ? [] : this.content.split(LINE_SPLIT_REGEX);
    lines.splice(from, count, ...replacement);
  }
}

/**
 * Validated append operation that can be applied to a lines array.
 */
class Append implements Edit {
  constructor(private readonly content: string) {}

  range(): [number, number] {
    return [Infinity, Infinity];
  }

  apply(lines: string[]): void {
    if (this.content !== "") {
      lines.push(...this.content.split(LINE_SPLIT_REGEX));
    }
  }
}

type EditScratchOptions = {
  edits: {
    uri: string | Uri;
    edits: ScratchEditOp[];
  }[];
};

type WriteScratchOptions = {
  writes: {
    uri: string | Uri;
    content: string;
  }[];
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
  const symbols = await vscode.commands.executeCommand<
    (vscode.DocumentSymbol | vscode.SymbolInformation)[]
  >("vscode.executeDocumentSymbolProvider", uri);
  return Array.isArray(symbols) ? symbols : undefined;
};

/**
 * Retries a promise-returning function if the result is empty, up to the specified
 * number of retries with a delay between attempts.
 */
const retryOnEmpty = async <T>(
  fn: () => Promise<T[] | undefined>,
  delayMs: number,
  retries: number = 1,
): Promise<T[]> => {
  const result = await fn();
  if (result && result.length > 0) return result;
  if (retries === 0) return [];
  await new Promise<void>(resolve => setTimeout(resolve, delayMs));
  return retryOnEmpty(fn, delayMs, retries - 1);
};

const formatRange = (lineFrom: number | undefined, lineTo: number | undefined) =>
  lineFrom !== undefined && lineTo !== undefined
    ? lineFrom === lineTo
      ? `line ${lineFrom}`
      : `lines ${lineFrom}-${lineTo}`
    : lineFrom !== undefined
      ? `from line ${lineFrom}`
      : lineTo !== undefined
        ? `lines 1-${lineTo}`
        : "";

/**
 * Formats a vscode.Range as "line X" for single-line ranges or "lines X-Y" for
 * multi-line ranges. Line numbers are 1-based to match typical editor
 * conventions and the output of get_scratch_outline.
 */
const formatCodeRange = (range: vscode.Range): string =>
  formatRange(range.start.line + 1, range.end.line + 1);

/**
 * Recursively formats a tree of DocumentSymbols up to the specified max depth.
 * Each symbol is formatted as "name (kind, line range)". Children are indented
 * by two spaces per level. Symbols beyond the max depth are omitted.
 */
const formatDocumentSymbols = (
  symbols: vscode.DocumentSymbol[],
  maxDepth: number,
  currentDepth = 0,
): string[] =>
  currentDepth >= maxDepth
    ? []
    : symbols.flatMap(({ kind, name, range, children }) => {
        const indent = "  ".repeat(currentDepth);
        const line = `${indent}${name} (${vscode.SymbolKind[kind]}, ${formatCodeRange(range)})`;
        return [line, ...formatDocumentSymbols(children ?? [], maxDepth, currentDepth + 1)];
      });

/**
 * Filters a flat list of SymbolInformation to those within the specified max
 * depth, determined by containerName chains and formats into a flat list of
 * "name (kind, line range)" up to the specified max depth.
 * Symbols without a containerName are depth 0, their direct children are depth
 * 1, and so on. This allows us to apply a depth limit to SymbolInformation
 * results, which don't have an inherent hierarchy like DocumentSymbols do.
 *
 * Uses composite keys (containerName::name::location) to handle duplicate symbol
 * names correctly. Computes depths in a single pass using an iterative BFS-like
 * approach for O(N) performance.
 */
const formatSymbolInfos = (symbols: vscode.SymbolInformation[], maxDepth: number): string[] => {
  // Create composite key to handle symbols with duplicate names
  const makeKey = (s: vscode.SymbolInformation) =>
    `${s.containerName ?? ""}::${s.name}::${s.location.uri.toString()}:${s.location.range.start.line}`;

  // Build depth map using iterative approach (O(N) instead of O(N×D))
  const depthMap = new Map<string, number>();

  // Initialize root symbols (no container) at depth 0
  for (const s of symbols) {
    if (!s.containerName) {
      depthMap.set(makeKey(s), 0);
    }
  }

  // Iteratively assign depths level by level until no new symbols are added
  let currentDepth = 0;
  let hasChanges = true;
  while (hasChanges) {
    hasChanges = false;
    for (const s of symbols) {
      const key = makeKey(s);
      if (!depthMap.has(key) && s.containerName) {
        // Check if parent container is at currentDepth
        const parentKey = symbols
          .filter(p => p.name === s.containerName)
          .map(makeKey)
          .find(pk => depthMap.get(pk) === currentDepth);

        if (parentKey) {
          depthMap.set(key, currentDepth + 1);
          hasChanges = true;
        }
      }
    }
    currentDepth++;
  }

  return symbols
    .filter(s => (depthMap.get(makeKey(s)) ?? 0) < maxDepth)
    .map(s => `${s.name} (${vscode.SymbolKind[s.kind]}, ${formatCodeRange(s.location.range)})`);
};

/**
 * Detects overlapping operations and returns error messages.
 */
const findOverlaps = (ops: Edit[]): string[] =>
  ops.reduce<string[]>((errors, curr, i, sorted) => {
    if (i === 0) return errors; // No previous op to compare with for the first one
    const prev = sorted[i - 1];
    const [, prevEnd] = prev.range();
    const [currStart] = curr.range();

    if (currStart <= prevEnd) {
      errors.push(
        `ops ${i} and ${i + 1} target overlapping lines (${prev.range().join("-")} and ${curr.range().join("-")})`,
      );
    }
    return errors;
  }, []);

/**
 * Applies all edit operations to the content, validating first.
 * Returns the modified lines array.
 */
const applyEdits = (lines: string[], ops: ScratchEditOp[]): string[] => {
  const validated = ops.map(op =>
    op.op === "insert"
      ? Insert.validate(op, lines.length)
      : op.op === "replace"
        ? Replace.validate(op, lines.length)
        : new Append(op.content),
  );
  const edits = validated
    .filter((v): v is Insert | Replace | Append => !Array.isArray(v))
    .toSorted(sort.byNumericValue(op => op.range()[0]));

  // Check for overlaps among line-based operations only (not appends)
  const errors = validated.filter((v): v is string[] => Array.isArray(v)).flat();
  const lineBasedOps = edits.filter(
    (op): op is Insert | Replace => op instanceof Insert || op instanceof Replace,
  );
  const overlaps = findOverlaps(lineBasedOps);
  if (errors.length > 0 || overlaps.length > 0) {
    throw new Error(`edit_scratch: ${[...errors, ...overlaps].join("; ")}`);
  }

  edits.forEach(op => op.apply(lines));
  return lines;
};

/**
 * Executes a batch of operations using Promise.allSettled and formats the results.
 * Returns a message listing succeeded and failed operations.
 */
const formatBatchResults = <T>(
  results: PromiseSettledResult<T>[],
  paths: string[],
  formatSuccess: (successfulPaths: string[], values: T[]) => string,
): string => {
  if (results.length !== paths.length) {
    throw new Error(
      `formatBatchResults: results (${results.length}) and paths (${paths.length}) must have same length`,
    );
  }

  const succeeded = results.flatMap((r, i) =>
    r.status === "fulfilled" ? [{ path: paths[i], value: r.value }] : [],
  );

  const failed = results
    .map((r, i) => (r.status === "rejected" ? `  - ${paths[i]}: ${String(r.reason)}` : undefined))
    .filter((msg): msg is string => msg !== undefined);

  return [
    succeeded.length > 0
      ? formatSuccess(
          succeeded.map(s => s.path),
          succeeded.map(s => s.value),
        )
      : "",
    failed.length > 0 ? `Failed:\n${failed.join("\n")}` : "",
  ]
    .filter(s => s !== "")
    .join("\n");
};

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
    const rawFilter = options?.filter;
    const filter = rawFilter !== undefined ? normalizeFilter(rawFilter) : undefined;
    const pattern = filter?.startsWith("**/") ? new Minimatch(filter) : undefined;
    const prefix = pattern ? undefined : filter?.replace(/\/$/, "");
    return this.treeProvider
      .getFlatTree()
      .then(map(prop("uri")))
      .then(uris => {
        const filtered = uris
          .map(uri => strip(uriPath(uri), ["/"]))
          .filter(uri => pattern?.match(uri) ?? true)
          .filter(uri => (prefix ? uri.startsWith(prefix) : true));

        if (filtered.length > 0) return filtered.join("\n");
        if (rawFilter) return `No scratches found matching filter '${rawFilter}'.`;
        return "No scratches found.";
      });
  };

  readScratch = ({ reads }: ReadScratchOptions): Promise<string> =>
    Promise.allSettled(
      reads.map(({ uri, lineFrom, lineTo }) =>
        this.fs
          .readLines(ensureUri(uri))
          // lineFrom and lineTo are 1-based inclusive, matching get_scratch_outline output
          .then(lines => lines.slice((lineFrom ?? 1) - 1, lineTo).join("\n"))
          .then(content => {
            const path = strip(uriPath(ensureUri(uri)), ["/"]);
            const range = formatRange(lineFrom, lineTo);
            return `[scratch:///${path}${range ? `, ${range}` : ""}]\n${content}`;
          }),
      ),
    ).then(results =>
      formatBatchResults(
        results,
        reads.map(({ uri }) => `scratch:///${strip(uriPath(ensureUri(uri)), ["/"])}`),
        (_paths, contents) => contents.join("\n---\n"),
      ),
    );

  getScratchOutline = async ({ uri, depth = 2 }: OutlineOptions): Promise<string> =>
    retryOnEmpty(() => asPromise(this.symbolProvider(ensureUri(uri))), this.retryDelayMs).then(
      symbols => {
        if (symbols.length === 0) return "No symbols found.";

        const lines =
          "children" in symbols[0]
            ? formatDocumentSymbols(symbols as vscode.DocumentSymbol[], depth)
            : formatSymbolInfos(symbols as vscode.SymbolInformation[], depth);

        return lines.length > 0 ? lines.join("\n") : "No symbols found.";
      },
    );

  editScratches = ({ edits }: EditScratchOptions): Promise<string> =>
    Promise.allSettled(
      edits.map(({ uri, edits }) => {
        const resolvedUri = ensureUri(uri);
        return this.fs
          .readLines(resolvedUri)
          .then(lines => applyEdits(lines, edits))
          .then(lines =>
            this.fs.writeLines(resolvedUri, lines, { create: false, overwrite: true }),
          );
      }),
    ).then(results =>
      formatBatchResults(
        results,
        edits.map(({ uri }) => `scratch:///${strip(uriPath(ensureUri(uri)), ["/"])}`),
        paths => `Edited: ${paths.join(", ")}`,
      ),
    );

  writeScratches = ({ writes }: WriteScratchOptions): Promise<string> =>
    Promise.allSettled(
      writes.map(({ uri, content }) =>
        this.fs.writeFile(ensureUri(uri), content, {
          create: true,
          overwrite: true,
        }),
      ),
    ).then(results =>
      formatBatchResults(
        results,
        writes.map(({ uri }) => `scratch:///${strip(uriPath(ensureUri(uri)), ["/"])}`),
        paths => `Scratches written: ${paths.join(", ")}`,
      ),
    );

  renameScratch = ({ oldUri, newUri }: RenameScratchOptions) =>
    this.fs.rename(ensureUri(oldUri), ensureUri(newUri), { overwrite: true });

  searchScratches = (options: SearchOptions): Promise<string> =>
    this.searchProvider.search(options).then(({ matches, truncated }) => {
      if (matches.length === 0) {
        return options.filter
          ? `No matches found for filter '${options.filter}'.`
          : "No matches found.";
      }

      const extractPath = (uri: string): string => strip(uriPath(uri), ["/"]);

      const formatMatch = (match: (typeof matches)[0]): string[] => [
        `${extractPath(match.uri)}:${match.line}`,
        ...match.context.map(ctx => `  ${ctx}`),
        `→ ${match.content}`,
        "",
      ];

      const header = truncated
        ? `Found ${matches.length}+ matches (truncated at ${options.maxResults ?? 100}):\n`
        : `Found ${matches.length} match${matches.length === 1 ? "" : "es"}:\n`;

      return [header, ...matches.flatMap(formatMatch)].join("\n");
    });
}

const maybeCall = <T, U>(val: T | ((arg: U) => T), arg: U): T => {
  // Type guard: if val is a function, it must be (arg: U) => T since that's the only function type in the union
  if (typeof val === "function") {
    return (val as (arg: U) => T)(arg);
  }
  return val;
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
