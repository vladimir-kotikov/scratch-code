import { Disposable } from "vscode";
import { call } from "./fu";

export class DisposableContainer implements Disposable {
  protected readonly disposables: Disposable[] = [];

  static from = (...disposables: Disposable[]): DisposableContainer => {
    const container = new DisposableContainer();
    disposables.forEach(container.disposeLater);
    return container;
  };

  disposeLater = <D extends Disposable>(d: D): D => {
    this.disposables.push(d);
    return d;
  };

  dispose() {
    this.disposables.forEach(call("dispose"));
  }
}
