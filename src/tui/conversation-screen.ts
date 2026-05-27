import type { SelectList } from "@earendil-works/pi-tui";
import { colors, fit, fillLines } from "./theme.js";
import { Header } from "./components/header.js";
import { StatusBar, conversationHints } from "./components/status-bar.js";
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
      statusLines.push(fit(`  ${colors.muted(state.statusMessage)}`, width));
    }
    if (state.errorMessage) {
      statusLines.push(fit(`  ${colors.error(state.errorMessage)}`, width));
    }

    // Fixed bottom: status bar
    const bottomLines = [this.statusBar.render(state, conversationHints(), width)];

    // Content: SelectList render, bottom-aligned inside a fixed-height region.
    // SelectList can add/remove a scroll indicator, so the surrounding region
    // must stay stable to avoid leaving stale rows during differential redraws.
    const rawContentLines = selectList.render(width);
    const listAreaHeight = Math.max(1, rows - headerLines.length - statusLines.length - bottomLines.length);
    const contentLines =
      rawContentLines.length > listAreaHeight ? rawContentLines.slice(rawContentLines.length - listAreaHeight) : rawContentLines;
    const fill = fillLines(listAreaHeight, contentLines.length, 0, width);

    return [...headerLines, ...statusLines, ...fill, ...contentLines, ...bottomLines];
  }
}
