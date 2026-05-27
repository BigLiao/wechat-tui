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

    const updateLine = state.updateInfo
      ? fit(
          `  ${theme.warning("Update available")} ${theme.dim(state.updateInfo.currentVersion)} ${theme.dim("->")} ` +
            `${theme.accent(state.updateInfo.latestVersion)} ${theme.dim(state.updateInfo.installCommand)}`,
          width
        )
      : undefined;

    // Subtitle line (only if non-empty)
    const subtitleLine = subtitle
      ? `  ${theme.bold(subtitle)}`
      : "";

    const lines = [fit(topLine, width)];
    if (updateLine) {
      lines.push(updateLine);
    }
    if (subtitle) {
      lines.push(fit(subtitleLine, width));
    }
    return lines;
  }
}
