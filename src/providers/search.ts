import * as child_process from "child_process";
import MiniSearch, { Options as SearchOptions, SearchResult } from "minisearch";
import { basename, dirname, resolve as resolvePath } from "node:path";
import { match, P } from "ts-pattern";
import * as vscode from "vscode";
import { FileChangeType, FileSystemProvider, FileType, QuickPickItemKind, Uri } from "vscode";
import { DisposableContainer } from "../util/containers";
import { flat, map, pass } from "../util/fu";
import { asPromise, waitPromises, whenError } from "../util/promises";
import { MaybeAsync, PickerItem } from "../util/prompt";
import { splitLines } from "../util/text";
import { isaDirectoryError, ScratchFileSystemProvider, toScratchUri } from "./fs";

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const searchOptions: SearchOptions = {
  fields: ["path", "content"],
  storeFields: ["path", "content"],
};

export type RgMatchStartEvent = { type: "begin"; data: { path: { text: string } } };
export type RgMatchEvent = {
  type: "match";
  data: {
    path: { text: string };
    lines: { text: string };
    line_number: number;
    absolute_offset: number;
    submatches: { match: { text: string }; start: number; end: number }[];
  };
};
type RgMatchEndEvent = {
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

type RgEvent = RgMatchStartEvent | RgMatchEvent | RgMatchEndEvent | RgSummaryEvent;

export type SearchDoc = {
  id: string;
  path: string;
  content: string;
};

export const readTree = (provider: FileSystemProvider, uri: Uri): PromiseLike<Uri[]> =>
  asPromise(provider.readDirectory(uri))
    .then(
      map(([fileName, fileType]) => {
        return fileType === FileType.Unknown
          ? []
          : fileType === FileType.Directory
            ? readTree(provider, Uri.joinPath(uri, fileName))
            : [Uri.joinPath(uri, fileName)];
      }),
    )
    .then(items => Promise.all(items))
    .then(flat);

const getFirstMatch = (result: SearchResult & SearchDoc) => {
  const [term] =
    Object.entries(result.match).find(([, fields]) => fields.includes("content")) ?? [];

  if (term) {
    const regexp = new RegExp(`(${term})`, "gi");
    const i = result.content.search(regexp);
    return result.content.slice(i, i + 100).split("\n")[0];
  }

  return;
};

export class SearchIndexProvider extends DisposableContainer {
  private index: MiniSearch<SearchDoc> = new MiniSearch<SearchDoc>(searchOptions);

  private _onDidLoad = this.disposeLater(new vscode.EventEmitter<void>());
  private _onLoadError = this.disposeLater(new vscode.EventEmitter<Error>());

  readonly onDidLoad = this._onDidLoad.event;
  readonly onLoadError = this._onLoadError.event;

  constructor(
    private readonly fs: FileSystemProvider,
    private readonly indexFile: Uri,
    private readonly rootPath: string,
  ) {
    super();
    this.load();
    this.disposeLater(this.fs.onDidChangeFile(map(this.updateIndexOnFileChange)));
  }

  dispose(): void {
    super.dispose();
    this.save();
  }

  private readDocument = (uri: Uri) =>
    asPromise(this.fs.readFile(uri)).then(
      data => ({
        id: uri.path.substring(1),
        path: uri.path.substring(1),
        content: decoder.decode(data),
      }),
      whenError(isaDirectoryError, () => undefined),
    );

  private updateFile = (uri: Uri) =>
    this.readDocument(uri).then(data => {
      if (!data) return;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      this.index.has(data.id) ? this.index.replace(data) : this.index.add(data);
      return this.save();
    });

  private removeFile = (uri: Uri) => {
    const docId = uri.path.substring(1);
    if (!this.index.has(docId)) return;
    this.index.discard(docId);
    return this.save();
  };

  private updateIndexOnFileChange = (change: vscode.FileChangeEvent) =>
    match(change)
      .with({ type: FileChangeType.Deleted, uri: P.select() }, this.removeFile)
      .with({ type: FileChangeType.Created, uri: P.select() }, this.updateFile)
      .with({ type: FileChangeType.Changed, uri: P.select() }, this.updateFile)
      .otherwise(c => console.error("Unhandled file change event", c));

  search = (query: string): (SearchResult & SearchDoc & { textMatch?: string })[] =>
    this.index
      .search(query === "" ? MiniSearch.wildcard : query, {
        fuzzy: 0.2,
        prefix: true,
        combineWith: "AND",
      })
      .map(result => ({
        ...(result as SearchDoc & SearchResult),
        textMatch: getFirstMatch(result as SearchDoc & SearchResult),
      }));

  load = () =>
    asPromise(vscode.workspace.fs.readFile(this.indexFile))
      .then(data => MiniSearch.loadJSON(data.toString(), searchOptions))
      .then(index => {
        this.index = index;
        this._onDidLoad.fire();
      })
      .catch(err => this._onLoadError.fire(err));

  save = () =>
    vscode.workspace.fs.writeFile(
      this.indexFile,
      Buffer.from(JSON.stringify(this.index.toJSON()), "utf8"),
    );

  reset = () => {
    this.index.removeAll();
    return readTree(this.fs, ScratchFileSystemProvider.ROOT)
      .then(map(this.updateFile))
      .then(waitPromises)
      .then(this.save);
  };

  size = () => this.index.documentCount;

  rgsearch = (query: string): MaybeAsync<Array<PickerItem<{ uri: Uri }>>> => {
    const rgPath = resolvePath(
      __dirname,
      `../node_modules/@vscode/ripgrep/bin/rg${process.platform === "win32" ? ".exe" : ""}`,
    );
    const args = [
      "-i", // case insensitive
      "-F", // fixed strings (not regex)
      "--crlf", // handle CRLF line endings
      "--json",
      query,
      this.rootPath,
    ];
    const { promise, resolve, reject } = Promise.withResolvers<Array<PickerItem<{ uri: Uri }>>>();

    child_process.execFile(rgPath, args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
      if (error) {
        return reject(error);
      }

      resolve(
        splitLines(stdout)
          .map(line => {
            try {
              const event = JSON.parse(line) as RgEvent;
              return match(event)
                .returnType<PickerItem<{ uri: Uri }>>()
                .with({ type: "begin", data: P.select() }, ({ path }) => {
                  const uri = toScratchUri(Uri.file(path.text), Uri.file(this.rootPath));
                  return {
                    label: basename(uri.path),
                    description: dirname(uri.path),
                    alwaysShow: true,
                    uri,
                  };
                })
                .with({ type: "match", data: P.select() }, ({ lines, path, line_number }) => {
                  const uri = toScratchUri(Uri.file(path.text), Uri.file(this.rootPath));
                  return {
                    label: lines.text.trim(),
                    description: `Line ${line_number}`,
                    alwaysShow: true,
                    uri,
                  };
                })
                .with({ type: "end" }, () => ({
                  label: "",
                  uri: Uri.parse(""),
                  kind: QuickPickItemKind.Separator as const,
                  alwaysShow: true,
                }))
                .with({ type: "summary" }, pass())
                .exhaustive();
            } catch {
              return;
            }
          })
          .filter(item => item !== undefined),
      );
    });

    return promise;
  };
}
