import { visibleWidth } from "@earendil-works/pi-tui";
import { colors, fit } from "../theme.js";
import type { RenderState } from "../../types.js";

/**
 * Bottom status bar with key hints (left) and unread count (right).
 * Uses plain dim text to avoid ANSI nesting issues.
 */
export class StatusBar {
  render(state: RenderState, hints: string, width: number): string {
    const unreadCount = state.totalUnreadCount;
    const rightText = unreadCount > 0 ? `${unreadCount} unread` : "";
    const rightWidth = visibleWidth(rightText);

    const availableForHints = Math.max(1, width - rightWidth - 2);
    const hintsFormatted = fit(` ${hints}`, availableForHints, true);

    const rightFormatted = rightWidth > 0 ? `${rightText} ` : " ";

    // Build as plain text first, then apply single dim style
    const plainLine = `${hintsFormatted}${rightFormatted}`;
    return colors.muted(fit(plainLine, width, true));
  }
}

/**
 * Format status bar hints for each view.
 */
export function conversationHints(): string {
  return "↑↓ Select  ⏎ Open  / Cmd  ⎋ Quit";
}

export function chatHints(): string {
  return "⏎ Send  ⎋ Back  ↑↓ History";
}

export function contactSearchHints(): string {
  return "↑↓ Select  ⏎ Open  ⎋ Back";
}

export function loginHints(): string {
  return "Scan QR to login  q Quit";
}
