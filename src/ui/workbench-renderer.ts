import process from "node:process";
import {
  Key,
  ProcessTerminal,
  TUI,
  decodeKittyPrintable,
  matchesKey,
  parseKey
} from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import type { RenderState, UiEvent, UiKey, WorkbenchRenderer } from "../types.js";
import { WechatApp } from "../tui/wechat-app.js";

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

export class WorkbenchTerminalRenderer implements WorkbenchRenderer {
  private tui?: TUI;
  private app?: WechatApp;
  private removeInputListener?: () => void;
  private closeHandler?: () => void;

  constructor(private readonly terminal: Terminal = new ProcessTerminal()) {}

  start(onEvent: (event: UiEvent) => void, onClose: () => void): void {
    this.tui = new TUI(this.terminal);
    this.app = new WechatApp(this.tui, onEvent);
    this.tui.addChild(this.app);
    this.removeInputListener = this.tui.addInputListener((data) => {
      // Intercept bracketed paste containing image file paths in chat view
      if (this.app?.isChatView() && data.includes(BRACKETED_PASTE_START)) {
        const transformed = this.app.transformPasteInput(data);
        if (transformed !== undefined) {
          return { data: transformed };
        }
      }

      const key = rawInputToKey(data);
      if (!key) {
        return undefined;
      }
      // Let focused components (Editor, SelectList) handle input directly
      if (this.app?.isChatView() && !isGlobalChatKey(key)) {
        return undefined;
      }
      if (this.app?.isChatsView() && !isGlobalChatsKey(key)) {
        return undefined;
      }
      onEvent({ type: "key", key });
      return { consume: true };
    });
    this.closeHandler = onClose;
    process.stdin.on("end", this.closeHandler);
    process.stdin.on("close", this.closeHandler);
    this.tui.start();
  }

  stop(): void {
    this.removeInputListener?.();
    this.removeInputListener = undefined;
    if (this.closeHandler) {
      process.stdin.off("end", this.closeHandler);
      process.stdin.off("close", this.closeHandler);
      this.closeHandler = undefined;
    }
    this.tui?.stop();
    this.tui = undefined;
    this.app = undefined;
  }

  render(state: RenderState): void {
    if (!this.tui || !this.app) {
      return;
    }
    this.app.setState(state);
    this.tui.requestRender();
  }
}

export function renderState(state: RenderState, options: { width?: number; rows?: number } = {}): string {
  const terminal = new SnapshotTerminal(options.width ?? 80, options.rows ?? 24);
  const tui = new TUI(terminal);
  const app = new WechatApp(tui, () => {});
  app.setState(state);
  return app.render(terminal.columns).join("\n");
}

function rawInputToKey(data: string): UiKey | undefined {
  if (matchesKey(data, Key.ctrl("c"))) {
    return { sequence: data, name: "c", ctrl: true };
  }
  if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
    return { sequence: data, name: "return" };
  }
  if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc)) {
    return { sequence: data, name: "escape" };
  }
  if (matchesKey(data, Key.backspace)) {
    return { sequence: data, name: "backspace" };
  }
  if (matchesKey(data, Key.delete)) {
    return { sequence: data, name: "delete" };
  }
  if (matchesKey(data, Key.up)) {
    return { sequence: data, name: "up" };
  }
  if (matchesKey(data, Key.down)) {
    return { sequence: data, name: "down" };
  }
  if (matchesKey(data, Key.left)) {
    return { sequence: data, name: "left" };
  }
  if (matchesKey(data, Key.right)) {
    return { sequence: data, name: "right" };
  }

  const parsed = parseKey(data);
  if (parsed?.startsWith("ctrl+")) {
    const name = parsed.slice("ctrl+".length);
    return { sequence: data, name, ctrl: true };
  }

  const printable = decodeKittyPrintable(data) ?? printableData(data);
  if (printable) {
    return { sequence: printable };
  }
  return undefined;
}

function printableData(data: string): string {
  if (data.startsWith("\u001b[200~") && data.endsWith("\u001b[201~")) {
    return data.slice("\u001b[200~".length, -"\u001b[201~".length);
  }
  if (data.length === 1 && data >= " " && data !== "\u007f") {
    return data;
  }
  return "";
}

function isGlobalChatKey(key: UiKey): boolean {
  return key.ctrl === true || key.name === "escape" || key.name === "up" || key.name === "down";
}

function isGlobalChatsKey(key: UiKey): boolean {
  return key.ctrl === true || key.name === "escape" || key.sequence === "q" || key.sequence === "Q";
}

class SnapshotTerminal implements Terminal {
  readonly kittyProtocolActive = false;
  private output = "";

  constructor(
    readonly columns: number,
    readonly rows: number
  ) {}

  start(): void {}
  stop(): void {}
  async drainInput(): Promise<void> {}
  write(data: string): void {
    this.output += data;
  }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
}
