import * as vscode from "vscode";
import { Disposable, QuickPickItem } from "vscode";
import { call } from "./fu";
import { asPromise } from "./promises";

export class UserCancelled extends Error {
  static error = new UserCancelled();
  static reject = Promise.reject(UserCancelled.error);

  private constructor() {
    super("User cancelled the input");
  }
}

export const isUserCancelled = (err: unknown): err is UserCancelled => err instanceof UserCancelled;

type Separator = {
  label: string;
  kind: vscode.QuickPickItemKind.Separator;
};

export type NoSeparator<T extends QuickPickItem> = Exclude<T, Separator>;
export type WithSeparator<T extends QuickPickItem> = T | Separator;

export const info = (message: string) =>
  vscode.window.showInformationMessage("Scratches: " + message);

export const warn = (message: string) => vscode.window.showWarningMessage("Scratches: " + message);

export const input = (title: string, value?: string, placeHolder?: string): PromiseLike<string> =>
  vscode.window
    .showInputBox({ title, value: value, placeHolder, ignoreFocusOut: true })
    .then(res => (res === undefined ? UserCancelled.reject : res));

export const confirm = (message: string) =>
  asPromise(vscode.window.showInformationMessage(message, { modal: true }, "Yes")).then(
    selection => (selection === "Yes" ? void 0 : UserCancelled.reject),
  );

export const pick = <T extends QuickPickItem>(
  getItems: () => PromiseLike<T[]> | T[],
  {
    onDidSelectItem,
    onDidChangeValue,
    buttons,
    matchOnDescription,
    matchOnDetail,
  }: {
    onDidSelectItem?: (item: NoSeparator<T>) => void;
    onDidChangeValue?: (value: string) => T[] | PromiseLike<T[]>;
    buttons?: Record<string, (item: NoSeparator<T>) => void>;
    matchOnDescription?: boolean;
    matchOnDetail?: boolean;
  } = {},
) => {
  const picker = vscode.window.createQuickPick<T>();

  if (matchOnDescription) {
    picker.matchOnDescription = true;
  }
  if (matchOnDetail) {
    picker.matchOnDetail = true;
  }

  const reload = (picker: vscode.QuickPick<T>) => {
    picker.placeholder = "Loading scratches...";
    picker.busy = true;
    asPromise(getItems()).then(items => {
      picker.items = items;
      picker.placeholder = "Select a scratch to open";
      picker.busy = false;
    });
  };

  const disposables: Disposable[] = [
    picker,
    picker.onDidAccept(() => {
      onDidSelectItem?.(picker.selectedItems[0] as NoSeparator<T>);
      picker.hide();
    }),
    picker.onDidTriggerItemButton(e => {
      const handler = buttons?.[e.button.tooltip as string];
      if (handler) {
        handler(e.item as NoSeparator<T>);
        reload(picker);
      }
    }),
    picker.onDidChangeValue(value => {
      if (onDidChangeValue) {
        const items = onDidChangeValue(value);
        asPromise(items).then(resolvedItems => {
          picker.items = resolvedItems;
        });
      }
    }),
    picker.onDidHide(() => disposables.forEach(call("dispose"))),
  ];

  picker.show();
  reload(picker);
};
