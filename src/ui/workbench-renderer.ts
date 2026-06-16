import process from "node:process";
import {
  Key,
  ProcessTerminal,
  TUI,
  decodeKittyPrintable,
  isKeyRelease,
  matchesKey,
  parseKey
} from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import type { RenderState, UiEvent, UiKey, WorkbenchRenderer } from "../types.js";
import { WechatApp } from "../tui/wechat-app.js";
import type { FileRegistry } from "../util/file-hash.js";

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
const DUPLICATE_NAVIGATION_KEY_SUPPRESSION_MS = 25;
const DEDUPED_KEY_NAMES = new Set(["up", "down", "left", "right", "return", "enter", "escape"]);
const DEFAULT_TERMINAL_TITLE = "WeChat";

interface LastKeyInput {
  name: string;
  at: number;
}

export class WorkbenchTerminalRenderer implements WorkbenchRenderer {
  private tui?: TUI;
  private app?: WechatApp;
  private removeInputListener?: () => void;
  private closeHandler?: () => void;
  private fileRegistry?: FileRegistry;
  private lastKeyInput?: LastKeyInput;
  private terminalTitle?: string;

  constructor(private readonly terminal: Terminal = new ProcessTerminal()) {}

  setFileRegistry(registry: FileRegistry): void {
    this.fileRegistry = registry;
    this.app?.setFileRegistry(registry);
  }

  start(onEvent: (event: UiEvent) => void, onClose: () => void): void {
    this.tui = new TUI(this.terminal);
    this.app = new WechatApp(this.tui, onEvent);
    if (this.fileRegistry) {
      this.app.setFileRegistry(this.fileRegistry);
    }
    this.tui.addChild(this.app);
    this.removeInputListener = this.tui.addInputListener((data) => {
      // Intercept bracketed paste containing image file paths in chat view
      if (this.app?.isChatInputActive() && data.includes(BRACKETED_PASTE_START)) {
        const transformed = this.app.transformPasteInput(data);
        if (transformed !== undefined) {
          return { data: transformed };
        }
      }

      const key = rawInputToKey(data);
      if (!key) {
        return undefined;
      }
      if (this.shouldSuppressDuplicateKey(key)) {
        return { consume: true };
      }

      // Show command panel when `/` is pressed on chats view
      if (this.app?.isChatsView() && !this.app.isCommandPanelVisible() && key.sequence === "/") {
        this.app.showCommandPanel();
        return { consume: true };
      }

      // When command panel is visible, let SelectList handle all input
      if (this.app?.isChatsView() && this.app.isCommandPanelVisible()) {
        return undefined;
      }

      if (
        this.app?.isChatView() &&
        key.name === "tab" &&
        this.app.isChatInputEmpty() &&
        !this.app.isConversationSwitcherActive() &&
        !this.app.hasConversationSwitcherTargets()
      ) {
        return { consume: true };
      }

      // Let focused components (Editor, SelectList) handle input directly
      if (this.app?.isChatView() && !isGlobalChatKey(key, this.app)) {
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
    this.updateTerminalTitle(DEFAULT_TERMINAL_TITLE);
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
    this.lastKeyInput = undefined;
    this.updateTerminalTitle(DEFAULT_TERMINAL_TITLE);
  }

  render(state: RenderState): void {
    if (!this.tui || !this.app) {
      return;
    }
    this.updateTerminalTitle(terminalTitleForState(state));
    this.app.setState(state);
    this.tui.requestRender();
  }

  private updateTerminalTitle(title: string): void {
    if (this.terminalTitle === title) {
      return;
    }
    this.terminal.setTitle(title);
    this.terminalTitle = title;
  }

  private shouldSuppressDuplicateKey(key: UiKey): boolean {
    const name = key.name;
    if (!name || !DEDUPED_KEY_NAMES.has(name)) {
      this.lastKeyInput = undefined;
      return false;
    }

    const now = Date.now();
    const shouldSuppress =
      this.lastKeyInput?.name === name && now - this.lastKeyInput.at <= DUPLICATE_NAVIGATION_KEY_SUPPRESSION_MS;
    this.lastKeyInput = { name, at: now };
    return shouldSuppress;
  }
}

function terminalTitleForState(state: RenderState): string {
  return state.totalUnreadCount > 0 ? `${DEFAULT_TERMINAL_TITLE} (${state.totalUnreadCount})` : DEFAULT_TERMINAL_TITLE;
}

export function renderState(state: RenderState, options: { width?: number; rows?: number } = {}): string {
  const terminal = new SnapshotTerminal(options.width ?? 80, options.rows ?? 24);
  const tui = new TUI(terminal);
  const app = new WechatApp(tui, () => {});
  app.setState(state);
  return app.render(terminal.columns).join("\n");
}

function rawInputToKey(data: string): UiKey | undefined {
  if (isKeyRelease(data)) {
    return undefined;
  }

  if (matchesKey(data, Key.ctrl("c"))) {
    return { sequence: data, name: "c", ctrl: true };
  }
  if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
    return { sequence: data, name: "return" };
  }
  if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc)) {
    return { sequence: data, name: "escape" };
  }
  if (matchesKey(data, Key.tab)) {
    return { sequence: data, name: "tab" };
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

function isGlobalChatKey(key: UiKey, app: WechatApp): boolean {
  if (key.ctrl === true || key.name === "escape") {
    return true;
  }
  // When autocomplete is active (typing a / command), let Editor handle completion and selection.
  if ((key.name === "tab" || key.name === "up" || key.name === "down") && app.isChatAutocompleteActive()) {
    return false;
  }
  if (key.name === "tab" && app.isChatInputEmpty()) {
    return true;
  }
  if (key.name === "tab" && (app.isConversationSwitcherActive() || app.hasConversationSwitcherTargets())) {
    return true;
  }
  if (app.isConversationSwitcherActive() && (key.name === "left" || key.name === "right" || isEnterKey(key))) {
    return true;
  }
  return key.name === "up" || key.name === "down";
}

function isEnterKey(key: UiKey): boolean {
  return key.name === "return" || key.name === "enter" || key.sequence === "\r" || key.sequence === "\n";
}

function isGlobalChatsKey(key: UiKey): boolean {
  return key.ctrl === true || key.sequence === "q" || key.sequence === "Q";
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
