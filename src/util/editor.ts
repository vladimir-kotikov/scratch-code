import * as vscode from "vscode";
import { Selection, TextEditor, Uri } from "vscode";
import { asPromise } from "./promises";

export const openDocument = (uri?: Uri) =>
  asPromise(vscode.commands.executeCommand("vscode.open", uri));

export const selectAll = (editor: TextEditor) =>
  (editor.selection = new Selection(
    0,
    0,
    editor.document.lineCount,
    editor.document.lineAt(editor.document.lineCount - 1).text.length,
  ));

export const getCurrent = () => vscode.window.activeTextEditor;

export const clear = (editor: TextEditor) =>
  editor.edit(editBuilder => {
    selectAll(editor);
    editBuilder.delete(editor.selection);
  });

export const closeCurrent = () =>
  vscode.commands.executeCommand("workbench.action.closeActiveEditor");
