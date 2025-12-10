import * as vscode from "vscode";
import { InputBoxOptions, QuickInputButton, QuickPickItem } from "vscode";
import { DisposableContainer } from "./disposable";
import { identity } from "./fu";
import { asPromise } from "./promises";

const isEmpty = (str: string) => str.trim().length === 0;

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
export type Separator = vscode.QuickPickItem & { kind: vscode.QuickPickItemKind.Separator };

export const info = (message: string) =>
  vscode.window.showInformationMessage("Scratches: " + message);

export const warn = (message: string) => vscode.window.showWarningMessage("Scratches: " + message);

export const input = (
  title: string,
  value?: string,
  options?: Omit<InputBoxOptions, "title" | "value">,
) =>
  UserCancelled.rejectIfUndefined(vscode.window.showInputBox({ title, value: value, ...options }));

export const filename = (title: string, value?: string) =>
  input(title, value, {
    validateInput: (filename: string) =>
      isEmpty(filename)
        ? "Filename cannot be empty"
        : !/^[^\\/:*?"<>|]+$/.test(filename)
          ? "Filename cannot contain special characters"
          : null,
  });

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

export type PickerItem<T extends Record<string, unknown> = Record<string, unknown>> = Omit<
  QuickPickItem,
  "buttons"
> &
  T & {
    onPick?: (e: { item: PickerItem<T>; value: string }) => unknown;
    buttons?: PickerItemButton<PickerItem<T>>[];
  };

export type PickerItemButton<Item extends QuickPickItem> = QuickInputButton & {
  onClick: (e: {
    item: Item;
    setItems: (items: () => (Item | Separator)[] | PromiseLike<(Item | Separator)[]>) => void;
  }) => void;
};

export type PickerButton<T extends QuickPickItem> = QuickInputButton & {
  onClick: (e: {
    items: readonly (T | Separator)[];
    value: string;
    setItems: (
      items: () => readonly (T | Separator)[] | PromiseLike<readonly (T | Separator)[]>,
    ) => unknown;
    setValue: (value: string) => void;
  }) => void;
};

export const pick = <T extends QuickPickItem>(
  getItems: () => (T | Separator)[] | PromiseLike<(T | Separator)[]>,
  {
    onValueChange,
    onPick,
    buttons,
    matchOnDescription,
    matchOnDetail,
    title,
    placeholder,
    initialValue,
  }: {
    onValueChange?: (e: {
      value: string;
      items: readonly (T | Separator)[];
      setItems: (
        items: () => readonly (T | Separator)[] | PromiseLike<readonly (T | Separator)[]>,
      ) => void;
    }) => void;
    onPick?: (e: { item: T; value: string }) => unknown;
    buttons?: PickerButton<T>[];
    matchOnDescription?: boolean;
    matchOnDetail?: boolean;
    title?: string;
    placeholder?: string;
    initialValue?: string;
  } = {},
) => {
  const picker = vscode.window.createQuickPick<T | Separator>();
  picker.buttons = buttons ?? [];
  picker.placeholder = placeholder;
  picker.matchOnDescription = matchOnDescription ?? false;
  picker.matchOnDetail = matchOnDetail ?? false;
  picker.value = initialValue ?? "";
  picker.title = title;

  const setItems = (
    itemsFn: () => readonly (T | Separator)[] | PromiseLike<readonly (T | Separator)[]>,
  ) => {
    picker.busy = true;
    asPromise(itemsFn()).then(items => {
      picker.items = items;
      picker.busy = false;
    });
  };

  const { promise, reject, resolve } = Promise.withResolvers<T>();
  const disposable = DisposableContainer.from(
    picker,
    picker.onDidAccept(() => {
      // Separators cannot be selected, so we cast to T
      const selected = picker.selectedItems[0] as T | undefined;
      const callback =
        (
          selected as T & {
            onPick?: (e: { item: T; value: string }) => unknown;
          }
        )?.onPick ??
        onPick ??
        identity;
      picker.hide();
      return selected
        ? asPromise(callback({ item: selected, value: picker.value }))
            .then(() => resolve(selected))
            .catch(reject)
        : reject(UserCancelled.error);
    }),
    picker.onDidTriggerButton(button =>
      (button as PickerButton<T>).onClick({
        items: picker.items,
        value: picker.value,
        setValue: v => {
          picker.value = v;
        },
        setItems,
      }),
    ),
    picker.onDidHide(() => {
      disposable.dispose();
      reject(UserCancelled.error);
    }),
  );

  if (onValueChange) {
    disposable.disposeLater(
      picker.onDidChangeValue(value => onValueChange({ value, items: picker.items, setItems })),
    );
  }

  picker.show();
  setItems(getItems);

  return promise;
};
