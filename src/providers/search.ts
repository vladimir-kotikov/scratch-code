import * as child_process from "child_process";
import path from "node:path";
import { match, P } from "ts-pattern";
import { env, Uri } from "vscode";
import { DisposableContainer } from "../util/containers";
import { normalizeFilter, toScratchUri } from "../util/uri";

const rgBinary = process.platform === "win32" ? "rg.exe" : "rg";
const rgPath = path.join(env.appRoot, "node_modules/@vscode/ripgrep/bin", rgBinary);

export type SearchOptions = {
  query: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
  filter?: string;
  contextLines?: number;
  maxResults?: number;
};

type RgFileStartEvent = { type: "begin"; data: { path: { text: string } } };
type RgContextEvent = {
  type: "context";
  data: {
    path: { text: string };
    lines: { text: string };
    line_number: number;
    absolute_offset: number;
  };
};
type RgMatchEvent = {
  type: "match";
  data: {
    path: { text: string };
    lines: { text: string };
    line_number: number;
    absolute_offset: number;
    submatches: { match: { text: string }; start: number; end: number }[];
  };
};
type RgFileEndEvent = {
  type: "end";
  data: {
    path: { text: string };
    binary_offset: null;
    stats: {
      elapsed: { secs: number; nanos: number; human: string };
      searches: number;
      searches_with_match: number;
      bytes_searched: number;
      bytes_printed: number;
      matched_lines: number;
      matches: number;
    };
  };
};
type RgSummaryEvent = {
  type: "summary";
  data: {
    elapsed_total: { human: string; nanos: number; secs: number };
    stats: {
      bytes_printed: number;
      bytes_searched: number;
      elapsed: { human: string; nanos: number; secs: number };
      matched_lines: number;
      matches: number;
      searches: number;
      searches_with_match: number;
    };
  };
};
type RgEvent = RgFileStartEvent | RgContextEvent | RgMatchEvent | RgFileEndEvent | RgSummaryEvent;

export type SearchMatch = {
  uri: string;
  line: number;
  content: string;
  context: string[];
  submatches: Array<{ start: number; end: number }>;
};

export type RgState = {
  matches: Record<string, SearchMatch>;
  currentMatch?: Partial<SearchMatch> & {
    uri: string;
    context: string[];
    submatches: Array<{ start: number; end: number }>;
  };
};

export const startNewMatch = (state: RgState, matchPath: string, rootUri: Uri): RgState => {
  // Save the current match if it has the required fields
  const matches =
    state.currentMatch?.line !== undefined && state.currentMatch?.content !== undefined
      ? {
          ...state.matches,
          [`${state.currentMatch.uri}:${state.currentMatch.line}`]:
            state.currentMatch as SearchMatch,
        }
      : state.matches;

  return {
    matches,
    currentMatch: {
      uri: toScratchUri(rootUri, Uri.file(matchPath)).toString(),
      context: [],
      submatches: [],
    },
  };
};

export const processRipgrepMatch = (
  line: string,
  state: RgState,
  contextLines: number,
  rootUri: Uri,
): RgState => {
  if (!line.trim()) return state;

  let event: RgEvent;
  try {
    event = JSON.parse(line) as RgEvent;
  } catch (error) {
    console.warn("[SearchIndexProvider] Failed to parse ripgrep output:", line, error);
    return state;
  }

  return match(event)
    .with({ type: "begin" }, ({ data }) => startNewMatch(state, data.path.text, rootUri))
    .with({ type: "context" }, ({ data }) => {
      const newState =
        (state.currentMatch?.context?.length ?? 0) >= contextLines &&
        state.currentMatch?.line !== undefined
          ? startNewMatch(state, data.path.text, rootUri)
          : state;

      if (!newState.currentMatch) {
        return startNewMatch(newState, data.path.text, rootUri);
      }

      return {
        ...newState,
        currentMatch: {
          ...newState.currentMatch,
          context: [...newState.currentMatch.context, data.lines.text],
        },
      };
    })
    .with({ type: "match" }, ({ data }) => {
      const newState =
        state.currentMatch?.line !== undefined
          ? startNewMatch(state, data.path.text, rootUri)
          : state;

      if (!newState.currentMatch) {
        return startNewMatch(newState, data.path.text, rootUri);
      }

      return {
        ...newState,
        currentMatch: {
          ...newState.currentMatch,
          line: data.line_number,
          content: data.lines.text.replace(/\n$/, ""),
          context: newState.currentMatch.context, // Preserve accumulated context
          submatches: data.submatches.map(sm => ({ start: sm.start, end: sm.end })),
        },
      };
    })
    .with({ type: P.union("end", "summary") }, () => state)
    .exhaustive();
};

export class SearchIndexProvider extends DisposableContainer {
  constructor(private readonly rootPath: string) {
    super();
  }

  dispose(): void {
    super.dispose();
  }

  private buildSearchArgs = (
    query: string,
    isRegex: boolean,
    caseSensitive: boolean,
    contextLines: number,
    filter?: string,
  ) => {
    const normalized = filter ? normalizeFilter(filter) : undefined;
    const isGlob = normalized ? /[*?{[]/.test(normalized) : false;
    const args = [
      "--json",
      "--crlf",
      caseSensitive ? "--case-sensitive" : "--ignore-case",
      ...(isRegex ? [] : ["--fixed-strings"]),
      ...(contextLines > 0 ? ["-C", contextLines.toString()] : []),
      ...(isGlob ? ["--glob", normalized!] : []),
      query,
      isGlob || !normalized ? this.rootPath : path.join(this.rootPath, normalized),
    ];

    return args;
  };

  search = (
    {
      query,
      isRegex = false,
      caseSensitive = false,
      contextLines = 2,
      maxResults = 100,
      filter,
    }: SearchOptions,
    signal?: AbortSignal,
  ): Promise<{ matches: SearchMatch[]; truncated: boolean }> => {
    if (!query || query.trim() === "") {
      throw new Error("Query cannot be empty");
    }

    if (maxResults < 1) {
      throw new Error(`maxResults must be at least 1 (got ${maxResults})`);
    }

    if (contextLines < 0) {
      throw new Error(`contextLines must be ≥ 0 (got ${contextLines})`);
    }

    if (signal?.aborted) {
      return Promise.resolve({ matches: [], truncated: false });
    }

    const args = this.buildSearchArgs(query, isRegex, caseSensitive, contextLines, filter);

    const { promise, resolve, reject } = Promise.withResolvers<{
      matches: SearchMatch[];
      truncated: boolean;
    }>();

    // Use spawn for streaming support
    const rootUri = Uri.file(this.rootPath);
    let buffer = "";
    let stderrBuffer = "";

    const childProcess = child_process.spawn(rgPath, args);

    childProcess.stderr?.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    const cleanup = () => {
      childProcess.stdout.removeAllListeners();
      childProcess.removeAllListeners();
    };

    const abortHandler = () => {
      childProcess.kill();
      cleanup();
      resolve({ matches: [], truncated: false });
    };

    signal?.addEventListener("abort", abortHandler, { once: true });

    let state: RgState = { matches: {} };

    childProcess.stdout.on("data", (chunk: Buffer) => {
      if (signal?.aborted) return;

      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      state = lines.reduce(
        (state, line) => processRipgrepMatch(line, state, contextLines, rootUri),
        state,
      );

      // Fetch one extra to detect truncation; +1 here matches the slice in close handler
      if (Object.keys(state.matches).length >= maxResults + 1) {
        childProcess.kill();
        // Don't resolve here - let close handler do it after processing buffer
      }
    });

    childProcess
      .on("close", code => {
        cleanup();
        signal?.removeEventListener("abort", abortHandler);

        if (signal?.aborted) {
          return resolve({ matches: [], truncated: false });
        }

        // Process any remaining buffer before finalizing
        if (buffer.trim()) {
          state = processRipgrepMatch(buffer, state, contextLines, rootUri);
        }

        // Add the final match if it exists
        if (state.currentMatch?.line !== undefined && state.currentMatch?.content !== undefined) {
          state.matches[`${state.currentMatch.uri}:${state.currentMatch.line}`] =
            state.currentMatch as SearchMatch;
        }

        // ripgrep exits with code 1 if no matches found
        if (code !== null && code !== 0 && code !== 1) {
          const detail = stderrBuffer.trim() ? `: ${stderrBuffer.trim()}` : ` (exit code ${code})`;
          return reject(new Error(`Search failed${detail}`));
        }

        resolve({
          matches: Object.values(state.matches).slice(0, maxResults),
          truncated: Object.keys(state.matches).length > maxResults,
        });
      })
      .on("error", err => reject(new Error(`Search failed: ${err.message}`)));

    return promise;
  };
}
