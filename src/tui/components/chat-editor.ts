import process from "node:process";
import {
  CombinedAutocompleteProvider,
  Editor
} from "@earendil-works/pi-tui";
import type { Component, EditorTheme, SelectListTheme, TUI } from "@earendil-works/pi-tui";
import { colors } from "../theme.js";
import type { UiEvent } from "../../types.js";

const COMMANDS = [
  { name: "contacts", description: "Search contacts and groups" },
  { name: "chats", description: "Return to recent chats" },
  { name: "status", description: "Show connection status" },
  { name: "refresh", description: "Refresh local contacts" },
  { name: "load", description: "Load local history" },
  { name: "messages", description: "Search local messages" },
  { name: "quit", description: "Quit wechat-tui" }
];

const selectListTheme: SelectListTheme = {
  selectedPrefix: (text) => colors.primary(text),
  selectedText: (text) => colors.primary(text),
  description: (text) => colors.muted(text),
  scrollInfo: (text) => colors.muted(text),
  noMatch: (text) => colors.muted(text)
};

const editorTheme: EditorTheme = {
  borderColor: (text) => colors.muted(text),
  selectList: selectListTheme
};

/**
 * Chat editor — a minimal input area fixed at the bottom.
 * Just a thin separator and the editor. No prefix labels.
 */
export class ChatEditor implements Component {
  readonly focusTarget: Editor;
  private suppressChange = false;

  constructor(tui: TUI, private readonly onEvent: (event: UiEvent) => void) {
    this.focusTarget = new Editor(tui, editorTheme, { paddingX: 1, autocompleteMaxVisible: 6 });
    this.focusTarget.setAutocompleteProvider(new CombinedAutocompleteProvider(COMMANDS, process.cwd()));
    this.focusTarget.onChange = (text) => {
      if (!this.suppressChange) {
        this.onEvent({ type: "chat-change", text });
      }
    };
    this.focusTarget.onSubmit = (text) => {
      if (text.trim()) {
        this.focusTarget.addToHistory(text);
      }
      this.onEvent({ type: "chat-submit", text });
    };
  }

  syncText(text: string): void {
    if (this.focusTarget.getText() === text) {
      return;
    }
    this.suppressChange = true;
    try {
      this.focusTarget.setText(text);
    } finally {
      this.suppressChange = false;
    }
  }

  invalidate(): void {
    this.focusTarget.invalidate();
  }

  render(width: number): string[] {
    return this.focusTarget.render(width);
  }

  handleInput(data: string): void {
    this.focusTarget.handleInput(data);
  }
}
