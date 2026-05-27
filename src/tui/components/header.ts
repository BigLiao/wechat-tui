import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { BOX, colors, connectionDot, connectionLabel, fit } from "../theme.js";
import type { RenderState } from "../../types.js";

/**
 * Renders a styled header box with:
 * - Top border: ╭─ Title ─────── ● Status ─╮
 * - Middle:     │  Subtitle            account │
 * - Bottom border: ╰───────────────────────────╯
 */
export class Header {
  render(state: RenderState, subtitle: string, width: number): string[] {
    const title = "WeChat TUI";
    const statusText = connectionLabel(state.connectionState);
    const dot = connectionDot(state.connectionState);
    const account = state.accountName ?? "";

    return [
      this.renderTopBorder(title, dot, statusText, width),
      this.renderMiddleLine(subtitle, account, width),
      this.renderBottomBorder(width)
    ];
  }

  private renderTopBorder(title: string, dot: string, status: string, width: number): string {
    // ╭─ Title ──...── ● Status ─╮
    const left = `${BOX.topLeft}${BOX.horizontal} `;
    const titleText = colors.primaryBold(title);
    const titleWidth = visibleWidth(title);
    const right = ` ${dot} ${colors.muted(status)} ${BOX.horizontal}${BOX.topRight}`;
    const rightWidth = 3 + visibleWidth(status) + 3; // " ● Status ─╮"
    const leftWidth = 3; // "╭─ "

    const fillCount = Math.max(0, width - leftWidth - titleWidth - rightWidth - 1);
    const fill = colors.muted(BOX.horizontal.repeat(fillCount));

    const line = `${colors.muted(left)}${titleText} ${fill}${right}`;
    return fit(line, width);
  }

  private renderMiddleLine(subtitle: string, account: string, width: number): string {
    // │  Subtitle                    account │
    const leftBorder = colors.muted(`${BOX.vertical}  `);
    const rightBorder = colors.muted(` ${BOX.vertical}`);
    const contentWidth = Math.max(1, width - 5); // "│  " + " │"

    const subtitleText = colors.bold(subtitle);
    const subtitleWidth = visibleWidth(subtitle);
    const accountText = account ? colors.muted(account) : "";
    const accountWidth = account ? visibleWidth(account) : 0;

    const gapWidth = Math.max(1, contentWidth - subtitleWidth - accountWidth);
    const gap = " ".repeat(gapWidth);

    const middle = `${subtitleText}${gap}${accountText}`;
    return fit(`${leftBorder}${truncateToWidth(middle, contentWidth, "...", true)}${rightBorder}`, width);
  }

  private renderBottomBorder(width: number): string {
    // ╰───────────────────────────╯
    const fillCount = Math.max(0, width - 2);
    return colors.muted(`${BOX.bottomLeft}${BOX.horizontal.repeat(fillCount)}${BOX.bottomRight}`);
  }
}
