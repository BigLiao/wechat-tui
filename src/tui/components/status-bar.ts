import { visibleWidth } from "@earendil-works/pi-tui";
import { theme, fit, keyHint, SYM } from "../theme.js";
import type { RenderState } from "../../types.js";

/**
 * Status bar — bottom line with key hints and unread badge.
 * Uses dim separator dots between hints. Single dim color, no nesting.
 */
export class StatusBar {
  render(_state: RenderState, hints: string[], width: number, rightText = ""): string {
    const sep = ` ${theme.dim(SYM.bullet)} `;
    const left = " " + hints.join(sep);
    const rightWidth = rightText ? visibleWidth(rightText) + 2 : 0;
    const leftWidth = Math.max(1, width - rightWidth);
    const leftFormatted = fit(left, leftWidth, true);
    const rightFormatted = rightText ? `${rightText} ` : "";
    return theme.muted(fit(`${leftFormatted}${rightFormatted}`, width, true));
  }
}

// ─── Hint sets per view ───────────────────────────────────────────────────────

export const HINTS_CONVERSATION = ["↑↓ select", "⏎ open", "⎋ quit"];
export const HINTS_CHAT = ["⏎ send", "⎋ back", "↑↓ scroll"];
export const HINTS_SEARCH = ["↑↓ select", "⏎ open", "⎋ back"];
export const HINTS_LOGIN = ["scan QR to login", "q quit"];
