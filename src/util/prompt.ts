import * as vscode from "vscode";
import { InputBoxOptions, QuickInputButton, QuickPickItem } from "vscode";
import { DisposableContainer } from "./containers";
import { asPromise } from "./promises";
import { isEmpty } from "./text";

export type MaybeAsync<T> = T | PromiseLike<T>;

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
          : undefined,
  });

export const confirm = (message: string) =>
  UserCancelled.rejectIfUndefined(
    vscode.window.showInformationMessage(message, { modal: true }, "Yes"),
  );

type ProvidePickerItemsFn = () => MaybeAsync<Array<PickerItem>>;

export type PickerCallback = (e: {
  item: PickerItem;
  value: string;
}) => MaybeAsync<PickerItem | undefined>;

export type PickerItem = Omit<QuickPickItem, "buttons"> & {
  onPick?: PickerCallback;
  buttons?: PickerItemButton[];
};

export type PickerItemButton = QuickInputButton & {
  onClick: (e: { item: PickerItem; setItems: (items: ProvidePickerItemsFn) => void }) => void;
};

export type PickerButton = QuickInputButton & {
  onClick: (e: {
    value: string;
    items: readonly PickerItem[];
    setValue: (value: string) => void;
    setItems: (items: ProvidePickerItemsFn) => unknown;
  }) => void;
};

export const pick = (
  getItems: ProvidePickerItemsFn,
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
      items: readonly PickerItem[];
      setItems: (items: ProvidePickerItemsFn) => void;
    }) => void;
    onPick?: PickerCallback;
    buttons?: PickerButton[];
    matchOnDescription?: boolean;
    matchOnDetail?: boolean;
    title?: string;
    placeholder?: string;
    initialValue?: string;
    ignoreFocusOut?: boolean;
  } = {},
) => {
  const picker = vscode.window.createQuickPick<PickerItem>();
  picker.buttons = buttons ?? [];
  picker.placeholder = placeholder;
  picker.matchOnDescription = matchOnDescription ?? false;
  picker.matchOnDetail = matchOnDetail ?? false;
  picker.value = initialValue ?? "";
  picker.title = title;
  picker.ignoreFocusOut = ignoreFocusOut ?? false;

  const setItems = (itemsFn: ProvidePickerItemsFn) => {
    picker.busy = true;
    asPromise(itemsFn()).then(items => {
      picker.items = items;
      picker.busy = false;
    });
  };

  const { promise, reject, resolve } = Promise.withResolvers<PickerItem>();
  const resolveAndHide = (item: PickerItem) => {
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
      const item = picker.selectedItems[0] as PickerItem | undefined;
      const callback = item?.onPick ?? onPick ?? (({ item }) => item);

      return item
        ? asPromise(callback({ item, value: picker.value }))
            .then(result => result !== undefined && resolveAndHide(result))
            .catch(rejectAndHide)
        : rejectAndHide(UserCancelled.error);
    }),
    picker.onDidTriggerButton(button =>
      (button as PickerButton).onClick({
        items: picker.items,
        value: picker.value,
        setValue: v => {
          picker.value = v;
        },
        setItems,
      }),
    ),
    picker.onDidTriggerItemButton(({ button, item }) =>
      (button as PickerItemButton).onClick({ item, setItems }),
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
