import { SelectList } from "@earendil-works/pi-tui";
import type { SelectItem, SelectListTheme, Component } from "@earendil-works/pi-tui";
import { theme } from "../theme.js";

const CONFIRM_ITEMS: SelectItem[] = [
  { value: "confirm", label: "Yes, clear data", description: "Delete messages, contacts, and logs" },
  { value: "cancel", label: "Cancel", description: "Go back" }
];

const selectListTheme: SelectListTheme = {
  selectedPrefix: (text) => theme.accent(text),
  selectedText: (text) => theme.accent(text),
  description: (text) => theme.dim(text),
  scrollInfo: (text) => theme.dim(text),
  noMatch: (text) => theme.dim(text)
};

/**
 * Confirm panel — appears when a destructive command needs user confirmation.
 * Shows Yes/No options navigable with arrow keys.
 */
export class ConfirmPanel implements Component {
  readonly focusTarget: SelectList;
  onConfirm?: () => void;
  onCancel?: () => void;

  constructor() {
    this.focusTarget = new SelectList(CONFIRM_ITEMS, CONFIRM_ITEMS.length, selectListTheme, {
      minPrimaryColumnWidth: 16,
      maxPrimaryColumnWidth: 24
    });
    this.focusTarget.onSelect = (item) => {
      if (item.value === "confirm") {
        this.onConfirm?.();
      } else {
        this.onCancel?.();
      }
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
