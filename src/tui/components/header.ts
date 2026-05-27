import { visibleWidth } from "@earendil-works/pi-tui";
import { BOX, theme, fit, connectionIndicator, pad } from "../theme.js";
import type { RenderState } from "../../types.js";

/**
 * Header — single bordered row with app name, connection status, and account.
 *
 *   ╭─ WeChat TUI ──────────────────── ● Online ─ liao ─╮
 *   ╰───────────────────────────────────────────────────╯
 *
 * Minimal: 2 lines total. Uses rounded corners for modern feel.
 */
export class Header {
  render(state: RenderState, subtitle: string, width: number): string[] {
    const title = theme.accentBold("WeChat TUI");
    const titleWidth = visibleWidth("WeChat TUI");

    const status = connectionIndicator(state.connectionState);
    const statusWidth = visibleWidth(status.replace(/\x1b\[[0-9;]*m/g, ""));

    const account = state.accountName ? theme.dim(state.accountName) : "";
    const accountWidth = state.accountName ? visibleWidth(state.accountName) : 0;

    // Top line: ╭─ Title ──...── status ─ account ─╮
    const fixedWidth = 4 + titleWidth + 3 + statusWidth + (accountWidth > 0 ? 3 + accountWidth : 0) + 3;
    const fillCount = Math.max(0, width - fixedWidth);
    const fill = theme.border(BOX.h.repeat(fillCount));

    const accountPart = accountWidth > 0
      ? ` ${theme.border(BOX.h)} ${account} `
      : " ";

    const topLine = `${theme.border(`${BOX.tl}${BOX.h}`)} ${title} ${fill} ${status}${accountPart}${theme.border(`${BOX.h}${BOX.tr}`)}`;

    // Subtitle line (only if non-empty)
    const subtitleLine = subtitle
      ? `  ${theme.bold(subtitle)}`
      : "";

    if (subtitle) {
      return [fit(topLine, width), fit(subtitleLine, width)];
    }
    return [fit(topLine, width)];
  }
}
