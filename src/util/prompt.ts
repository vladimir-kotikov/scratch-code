import * as vscode from "vscode";
import { InputBoxOptions, QuickPickItem } from "vscode";
import { DisposableContainer } from "./disposable";
import { asPromise } from "./promises";

type Result<T> = PromiseLike<T> | T;

export class UserCancelled extends Error {
  static error = new UserCancelled();
  static reject = Promise.reject(UserCancelled.error);
  static rejectIfUndefined = <T>(value: T | undefined): Promise<T> =>
    asPromise(value).then(v => (v === undefined ? UserCancelled.reject : v));

  private constructor() {
    super("User cancelled the input");
  }
}

export const isUserCancelled = (err: unknown): err is UserCancelled => err instanceof UserCancelled;

export type Separator = {
  label: string;
  kind: vscode.QuickPickItemKind.Separator;
};

export const separator = {
  label: "Scratches",
  kind: vscode.QuickPickItemKind.Separator as const,
} as Separator;

export type NoSeparator<T extends QuickPickItem> = Exclude<T, Separator>;
export type WithSeparator<T extends QuickPickItem> = T | Separator;

export const info = (message: string) =>
  vscode.window.showInformationMessage("Scratches: " + message);

export const warn = (message: string) => vscode.window.showWarningMessage("Scratches: " + message);

export const input = (
  title: string,
  value?: string,
  options?: Omit<InputBoxOptions, "title" | "value">,
) =>
  UserCancelled.rejectIfUndefined(vscode.window.showInputBox({ title, value: value, ...options }));

export const confirm = (message: string) =>
  UserCancelled.rejectIfUndefined(
    vscode.window.showInformationMessage(message, { modal: true }, "Yes"),
  );

type GetItems<T extends QuickPickItem> = () => Result<WithSeparator<T>[]>;
type SetItems<T extends QuickPickItem> = (getItems: GetItems<T>) => void;

export const pick = <T extends QuickPickItem = QuickPickItem>(
  getItems: GetItems<T>,
  {
    onDidChangeValue,
    buttons,
    matchOnDescription,
    matchOnDetail,
  }: {
    onDidChangeValue?: (
      value: string,
      items: readonly WithSeparator<T>[],
      setItems: SetItems<T>,
    ) => void;
    buttons?: Record<string, (item: NoSeparator<T>, setItems: SetItems<T>) => void>;
    matchOnDescription?: boolean;
    matchOnDetail?: boolean;
  } = {},
) => {
  const picker = vscode.window.createQuickPick<WithSeparator<T>>();
  const { promise, reject, resolve } = Promise.withResolvers<T>();

  if (matchOnDescription) {
    picker.matchOnDescription = true;
  }
  if (matchOnDetail) {
    picker.matchOnDetail = true;
  }

  const setItems = (getItems: GetItems<T>) => {
    picker.placeholder = "Loading scratches...";
    picker.busy = true;
    asPromise(getItems()).then(items => {
      picker.items = items;
      picker.placeholder = "Select a scratch to open";
      picker.busy = false;
    });
  };

  const disposable = DisposableContainer.from(
    picker,
    picker.onDidAccept(() =>
      picker.selectedItems[0] === undefined
        ? reject(UserCancelled.error)
        : resolve(picker.selectedItems[0] as NoSeparator<T>),
    ),
    picker.onDidHide(() => {
      disposable.dispose();
      reject(UserCancelled.error);
    }),
  );
  if (buttons !== undefined) {
    disposable.disposeLater(
      picker.onDidTriggerItemButton(e => {
        buttons[e.button.tooltip as string]?.(e.item as NoSeparator<T>, setItems);
      }),
    );
  }
  if (onDidChangeValue) {
    picker.onDidChangeValue(value => onDidChangeValue(value, picker.items, setItems));
  }

  picker.show();
  setItems(getItems);

  return promise;
};
