import { SelectList } from "@earendil-works/pi-tui";
import type { SelectItem, SelectListTheme, Component } from "@earendil-works/pi-tui";
import { theme } from "../theme.js";

const GLOBAL_COMMANDS: SelectItem[] = [
  { value: "/contacts", label: "/contacts", description: "Search contacts and groups" },
  { value: "/clear", label: "/clear", description: "Clear messages and logs" },
  { value: "/logout", label: "/logout", description: "Logout and quit" },
  { value: "/quit", label: "/quit", description: "Quit wechat-tui" }
];

const selectListTheme: SelectListTheme = {
  selectedPrefix: (text) => theme.accent(text),
  selectedText: (text) => theme.accent(text),
  description: (text) => theme.dim(text),
  scrollInfo: (text) => theme.dim(text),
  noMatch: (text) => theme.dim(text)
};

/**
 * Command panel — appears when `/` is pressed on the home (chats) screen.
 * Shows global commands navigable with arrow keys.
 */
export class CommandPanel implements Component {
  readonly focusTarget: SelectList;
  onCommand?: (command: string) => void;
  onCancel?: () => void;

  constructor() {
    this.focusTarget = new SelectList(GLOBAL_COMMANDS, GLOBAL_COMMANDS.length, selectListTheme, {
      minPrimaryColumnWidth: 12,
      maxPrimaryColumnWidth: 16
    });
    this.focusTarget.onSelect = (item) => {
      this.onCommand?.(item.value);
    };
    this.focusTarget.onCancel = () => {
      this.onCancel?.();
    };
  }

  invalidate(): void {
    this.focusTarget.invalidate();
  }

  render(width: number): string[] {
    return this.focusTarget.render(width);
  }
}
