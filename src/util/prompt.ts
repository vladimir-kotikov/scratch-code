import * as vscode from "vscode";
import { InputBoxOptions, QuickInputButton, QuickPickItem } from "vscode";
import { DisposableContainer } from "./containers";
import { asPromise } from "./promises";

export type MaybeAsync<T> = T | PromiseLike<T>;

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
  asPromise(vscode.window.showInputBox({ title, value: value, ...options })).then(v =>
    v === undefined ? UserCancelled.reject : v,
  );

export const filename = (title: string, value: string = "") =>
  input(title, value, {
    valueSelection: [value.length, value.length],
    validateInput: (filename: string) =>
      isEmpty(filename)
        ? "Filename cannot be empty"
        : !/^[^:*?"<>|]+$/.test(filename)
          ? "Filename cannot contain special characters"
          : null,
  });

export const confirm = (message: string) =>
  UserCancelled.rejectIfUndefined(
    vscode.window.showInformationMessage(message, { modal: true }, "Yes"),
  );

type ProvidePickerItemsFn<T extends Record<string, unknown> = Record<string, unknown>> =
  () => MaybeAsync<Array<PickerItem<T> | Separator>>;

export type PickerCallback<T extends Record<string, unknown> = Record<string, unknown>> = (e: {
  item: PickerItemCore<T>;
  value: string;
}) => MaybeAsync<PickerItemCore<T> | undefined>;

// Core item shape that callbacks receive (without onPick/buttons to avoid circularity)
export type PickerItemCore<T extends Record<string, unknown> = Record<string, unknown>> = Omit<
  QuickPickItem,
  "buttons"
> &
  T;

export type PickerItem<T extends Record<string, unknown> = Record<string, unknown>> =
  PickerItemCore<T> & {
    onPick?: PickerCallback;
    buttons?: PickerItemButton<T>[];
  };

export type PickerItemButton<T extends Record<string, unknown> = Record<string, unknown>> =
  QuickInputButton & {
    onClick: (e: {
      item: PickerItemCore<T>;
      setItems: (items: ProvidePickerItemsFn<T>) => void;
    }) => void;
  };

export type PickerButton<T extends Record<string, unknown> = Record<string, unknown>> =
  QuickInputButton & {
    onClick: (e: {
      value: string;
      items: readonly (PickerItem<T> | Separator)[];
      setValue: (value: string) => void;
      setItems: (items: ProvidePickerItemsFn<T>) => unknown;
    }) => void;
  };

export const pick = <T extends Record<string, unknown>>(
  getItems: ProvidePickerItemsFn<T>,
  {
    onValueChange,
    onPick,
    buttons,
    matchOnDescription,
    matchOnDetail,
    title,
    placeholder,
    initialValue,
    ignoreFocusOut,
  }: {
    onValueChange?: (e: {
      value: string;
      items: readonly (PickerItem<T> | Separator)[];
      setItems: (items: ProvidePickerItemsFn<T>) => void;
    }) => void;
    onPick?: PickerCallback<T>;
    buttons?: PickerButton<PickerItem<T>>[];
    matchOnDescription?: boolean;
    matchOnDetail?: boolean;
    title?: string;
    placeholder?: string;
    initialValue?: string;
    ignoreFocusOut?: boolean;
  } = {},
) => {
  const picker = vscode.window.createQuickPick<PickerItem<T> | Separator>();
  picker.buttons = buttons ?? [];
  picker.placeholder = placeholder;
  picker.matchOnDescription = matchOnDescription ?? false;
  picker.matchOnDetail = matchOnDetail ?? false;
  picker.value = initialValue ?? "";
  picker.title = title;
  picker.ignoreFocusOut = ignoreFocusOut ?? false;

  const setItems = (itemsFn: ProvidePickerItemsFn<T>) => {
    picker.busy = true;
    asPromise(itemsFn()).then(
      items => {
        picker.items = items;
        picker.busy = false;
      },
      err => {
        picker.items = [
          {
            label: "Error loading items",
            detail: String(err),
            iconPath: new vscode.ThemeIcon("error"),
            alwaysShow: true,
            onPick: () => undefined,
          } as PickerItem<never>,
        ];
        picker.busy = false;
      },
    );
  };

  const { promise, reject, resolve } = Promise.withResolvers<PickerItem<T>>();
  const resolveAndHide = (item: PickerItem<T>) => {
    resolve(item);
    picker.hide();
  };
  const rejectAndHide = (err: unknown) => {
    reject(err);
    picker.hide();
  };
  const disposable = DisposableContainer.from(
    picker,
    picker.onDidAccept(() => {
      // Separators cannot be selected, so we cast to PickerItem<T>
      const item = picker.selectedItems[0] as PickerItem<T> | undefined;
      const callback = item?.onPick ?? onPick ?? ((({ item }) => item) as PickerCallback<T>);

      return item
        ? asPromise(callback({ item, value: picker.value }))
            .then(result => result !== undefined && resolveAndHide(result as PickerItem<T>))
            .catch(rejectAndHide)
        : rejectAndHide(UserCancelled.error);
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
    picker.onDidTriggerItemButton(({ button, item }) =>
      (button as PickerItemButton<T>).onClick({
        item: item as PickerItemCore<T>,
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
