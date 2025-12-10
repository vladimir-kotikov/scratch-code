import path from "node:path";
import { LanguageModelChatMessage, TextDocument } from "vscode";
import * as editor from "./util/editor";
import { pass } from "./util/fu";
import { whenError } from "./util/promises";
import * as prompt from "./util/prompt";
import { isUserCancelled, PickerItem } from "./util/prompt";

import * as vscode from "vscode";

const splitLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

const insertAt = <T>(arr: readonly T[], index: number, items: T[]) => [
  ...arr.slice(0, index),
  ...items,
  ...arr.slice(index),
];

const makeFilenameSuggestion = (label: string): PickerItem<{}> => ({
  label,
  description: "AI Suggested",
  iconPath: { id: "lightbulb-sparkle" },
});

const suggestFilenames = (doc?: TextDocument) => {
  if (!doc) {
    return Promise.resolve<string[]>([]);
  }

  const ANNOTATION_PROMPT = `Suggest 5 concise and descriptive filenames for a
  snippet ${doc.languageId !== "plaintext" ? `in ${doc.languageId} language` : ""}
  below. The filenames should accurately reflect the content and purpose of
  the text and should not exceed 50 characters. Output each filename on a new
  line without any additional explanation or formatting.`;

  return vscode.lm
    .selectChatModels({
      vendor: "copilot",
      family: "gpt-4o-mini",
    })
    .then(models =>
      models[0]
        ?.sendRequest(
          [
            LanguageModelChatMessage.User(ANNOTATION_PROMPT),
            LanguageModelChatMessage.User(doc.getText().substring(0, 1000)),
          ],
          { justification: "Generate filenames for scratch file" },
        )
        .then(async resp => {
          let choices = "";
          for await (const chunk of resp.text) {
            choices += chunk;
          }
          return splitLines(choices).slice(0, 5);
        }),
    )
    .then(choices => choices ?? []);
};

const newScratchItem = (
  label: string,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  onPick: (e: { item: PickerItem<{}>; value: string }) => unknown,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
): prompt.PickerItem<{}> => ({
  iconPath: { id: "plus" },
  alwaysShow: true,
  label,
  onPick,
});

const suggestFilenamesButton = (
  insertSuggestionsAt: number = 0,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
): prompt.PickerButton<prompt.PickerItem<{}>> => ({
  tooltip: "Generate Filename Suggestions",
  iconPath: { id: "lightbulb-sparkle" },
  onClick: ({ items, setItems, setValue }) =>
    setItems(() =>
      suggestFilenames(editor.getCurrentDocument()).then(suggestions =>
        suggestions.length === 0
          ? items
          : // When suggestions are available, reset the value so they are visible
            (setValue(""),
            insertAt(items, insertSuggestionsAt, suggestions.map(makeFilenameSuggestion))),
      ),
    ),
});

type NewScratchPickerCallback = (filename?: string, content?: string | Uint8Array) => unknown;

// Multi-mode scratch creation:
// Prompt: New Scratch... (ellipsis indicates further input required)
// The entries are:
// - current file name (if not untitled)
// - ... other suggestions go here ...
// - + [create from selection] (if selection exists)
// - + [create from current file] (if file is opened and the value is non-empty)
// - + [create blank scratch]
export const newScratchPicker = (createScratch: NewScratchPickerCallback) => {
  const hasNonEmptySelection = editor.getCurrentSelection().trim().length > 0;
  const currentFilename =
    editor.getCurrentDocument()?.isUntitled === false
      ? path.basename(editor.getCurrentDocument()!.fileName)
      : undefined;

  let suggestionsIndex = 0;
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  const choices: prompt.PickerItem<{}>[] = [
    newScratchItem("Create Blank Scratch", ({ value }) => createScratch(value)),
  ];

  if (hasNonEmptySelection) {
    choices.unshift(
      newScratchItem("Create From Selection", ({ value }) =>
        createScratch(value, editor.getCurrentSelection()),
      ),
    );
  }

  if (currentFilename) {
    choices.unshift({
      label: currentFilename,
      iconPath: { id: "file" },
    });
    suggestionsIndex = 1;
  }

  const createFromDocument = newScratchItem("Create From Current File", ({ value }) =>
    createScratch(value, editor.getCurrentContent()),
  );

  prompt
    .pick(pass(choices), {
      title: "New Scratch",
      placeholder: "Select or type in a filename for the new scratch",
      buttons: [suggestFilenamesButton(suggestionsIndex)],
      onValueChange: ({ value, items, setItems }) => {
        if (!editor.getCurrentDocument()) return;
        // No text is entered, hence no filters applied so treat this as the
        // intent is to choose from suggested filenames - this is done
        // implicitly by picking that item, without dedicated entry.
        if (value.length === 0)
          return setItems(() => items.filter(item => item !== createFromDocument));

        // Otherwise add the entry to create from document with the typed in
        // file name (if not already present)
        if (!items.includes(createFromDocument))
          return setItems(() => items.toSpliced(items.length - 1, 0, createFromDocument));
      },
      onPick: ({ item: { label } }) => createScratch(label, editor.getCurrentContent()),
    })
    .catch(whenError(isUserCancelled, pass()));
};
