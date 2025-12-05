import * as vscode from "vscode";
import { InputBoxOptions, QuickPick, QuickPickItem } from "vscode";
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

export const pickText = (
  getItems: () => string[] | PromiseLike<string[]>,
  { placeholder, customChoice }: { placeholder?: string; customChoice?: QuickPickItem } = {},
) => {
  const picker = vscode.window.createQuickPick();
  if (placeholder !== undefined) {
    picker.placeholder = placeholder;
  }

  const { promise, reject, resolve } = Promise.withResolvers<string>();
  const disposable = DisposableContainer.from(
    picker,
    picker.onDidAccept(() =>
      picker.selectedItems[0] === undefined
        ? reject(UserCancelled.error)
        : resolve(
            picker.selectedItems[0] === customChoice ? picker.value : picker.selectedItems[0].label,
          ),
    ),
    picker.onDidHide(() => {
      disposable.dispose();
      reject(UserCancelled.error);
    }),
  );

  picker.busy = true;
  picker.show();
  asPromise(getItems()).then(items => {
    const pickerItems = items.map(label => ({ label }));
    if (customChoice) {
      customChoice.alwaysShow = true;
      pickerItems.push(customChoice);
    }
    picker.items = pickerItems;
    picker.busy = false;
  });

  return promise;
};

export const pick = <T extends QuickPickItem = QuickPickItem>(
  getItems: () => Result<WithSeparator<T>[]>,
  {
    onDidChangeValue,
    buttons,
    matchOnDescription,
    matchOnDetail,
    placeholder,
  }: {
    onDidChangeValue?: (value: string, picker: QuickPick<WithSeparator<T>>) => void;
    buttons?: Record<string, (item: NoSeparator<T>, picker: QuickPick<WithSeparator<T>>) => void>;
    matchOnDescription?: boolean;
    matchOnDetail?: boolean;
    placeholder?: string;
  } = {},
) => {
  const picker = vscode.window.createQuickPick<WithSeparator<T>>();
  if (placeholder !== undefined) {
    picker.placeholder = placeholder;
  }
  if (matchOnDescription) {
    picker.matchOnDescription = true;
  }
  if (matchOnDetail) {
    picker.matchOnDetail = true;
  }

  const { promise, reject, resolve } = Promise.withResolvers<T>();
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
      picker.onDidTriggerItemButton(e =>
        buttons[e.button.tooltip as string]?.(e.item as NoSeparator<T>, picker),
      ),
    );
  }
  if (onDidChangeValue) {
    disposable.disposeLater(picker.onDidChangeValue(value => onDidChangeValue(value, picker)));
  }

  picker.busy = true;
  picker.show();
  asPromise(getItems()).then(items => {
    picker.items = items;
    picker.busy = false;
  });

  return promise;
};
