import type { SelectList } from "@earendil-works/pi-tui";
import { theme, fit, fillLines, border } from "./theme.js";
import { Header } from "./components/header.js";
import { StatusBar, HINTS_CONVERSATION } from "./components/status-bar.js";
import type { RenderState } from "../types.js";

export class ConversationScreen {
  private readonly header = new Header();
  private readonly statusBar = new StatusBar();

  render(state: RenderState, width: number, rows: number, selectList: SelectList): string[] {
    // Fixed top: header
    const headerLines = this.header.render(state, "Recent Chats", width);

    // Status / error messages
    const statusLines: string[] = [];
    if (state.statusMessage) {
      statusLines.push(fit(`  ${theme.dim(state.statusMessage)}`, width));
    }
    if (state.errorMessage) {
      statusLines.push(fit(`  ${theme.error(state.errorMessage)}`, width));
    }

    // Fixed bottom: status bar
    const unreadText = state.totalUnreadCount > 0 ? `${state.totalUnreadCount} unread` : "";
    const bottomLines = [this.statusBar.render(state, HINTS_CONVERSATION, width, unreadText)];

    // Content: SelectList render, bottom-aligned in fixed-height region
    const rawContentLines = selectList.render(width);
    const listAreaHeight = Math.max(1, rows - headerLines.length - statusLines.length - bottomLines.length);
    const contentLines =
      rawContentLines.length > listAreaHeight ? rawContentLines.slice(rawContentLines.length - listAreaHeight) : rawContentLines;
    const fill = fillLines(listAreaHeight, contentLines.length, 0, width);

    return [...headerLines, ...statusLines, ...fill, ...contentLines, ...bottomLines];
  }
}
