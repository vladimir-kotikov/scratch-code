import * as vscode from "vscode";
import { map, prop } from "../util/fu";
import { ScratchTreeProvider } from "./tree";

import { Minimatch } from "minimatch";
import {
  LanguageModelDataPart,
  LanguageModelTextPart,
  LanguageModelTool,
  LanguageModelToolResult,
  PreparedToolInvocation,
  Uri,
} from "vscode";
import { DisposableContainer } from "../util/containers";
import { asPromise } from "../util/promises";
import { splitLines, splitWords } from "../util/text";
import { ScratchFileSystemProvider } from "./fs";

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
        return uris.join("\n");
      })
      .then(text => (text === "" ? "No scratches found." : text));
  };

  readScratch = ({ uri, lineFrom, lineTo }: ReadScratchOptions) =>
    this.fs
      .readFile(uri instanceof Uri ? uri : Uri.parse(uri))
      .then(bytes => new TextDecoder().decode(bytes))
      .then(content => {
        if (lineFrom !== undefined || lineTo !== undefined) {
          return splitLines(content).slice(lineFrom, lineTo).join("\n");
        }
        return content;
      });

  writeScratch = ({ uri, content }: WriteScratchOptions) =>
    this.fs
      .writeFile(uri instanceof Uri ? uri : Uri.parse(uri), content, {
        create: true,
        overwrite: true,
      })
      .then(() => "Scratch written successfully.");
}

export const registerTool = <P, R extends MaybePromiseLike<MaybeArray<LmResponsePart | string>>>(
  name: string,
  impl: (params: P) => R,
  params?: {
    invocationMessage?: string | ((params: P) => string);
    confirmationMessage?:
      | { title: string; message: string }
      | ((params: P) => { title: string; message: string });
  },
) => {
  const tool: LanguageModelTool<P> = {
    invoke: ({ input }) => {
      const result = asPromise(impl(input)).catch(
        err => `Failed to ${splitWords(name).join(" ")}: ${err}`,
      );
      const toToolResult = (res: MaybeArray<LmResponsePart | string>) => {
        if (!Array.isArray(res)) {
          res = [res] as Array<LmResponsePart | string>;
        }
        res = res.map(res => (typeof res === "string" ? new LanguageModelTextPart(res) : res));

        return new LanguageModelToolResult(res as LmResponsePart[]);
      };
      return result.then(toToolResult);
    },
  };

  if (params?.invocationMessage || params?.confirmationMessage) {
    tool.prepareInvocation = options => {
      const result: PreparedToolInvocation = {};
      if (params.confirmationMessage) {
        result["confirmationMessages"] =
          typeof params.confirmationMessage === "function"
            ? params.confirmationMessage(options.input)
            : params.confirmationMessage;
      }
      if (params.invocationMessage) {
        result["invocationMessage"] =
          typeof params.invocationMessage === "function"
            ? params.invocationMessage(options.input)
            : params.invocationMessage;
      }
      return result;
    };
  }

  return vscode.lm.registerTool(name, tool);
};
