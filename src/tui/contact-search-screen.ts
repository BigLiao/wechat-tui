import { colors, fit, fillLines } from "./theme.js";
import { Header } from "./components/header.js";
import { StatusBar, contactSearchHints } from "./components/status-bar.js";
import { ContactPicker } from "./components/contact-picker.js";
import type { RenderState } from "../types.js";

export class ContactSearchScreen {
  private readonly header = new Header();
  private readonly picker = new ContactPicker();
  private readonly statusBar = new StatusBar();

  render(state: RenderState, width: number, rows: number): string[] {
    // Fixed top: header
    const headerLines = this.header.render(state, "Contact Search", width);

    // Status / error messages
    const statusLines: string[] = [];
    if (state.statusMessage) {
      statusLines.push(fit(`  ${colors.muted(state.statusMessage)}`, width));
    }
    if (state.errorMessage) {
      statusLines.push(fit(`  ${colors.error(state.errorMessage)}`, width));
    }

    // Content: contact picker
    const contentLines = this.picker.render(state, width, rows);

    // Fixed bottom: status bar
    const bottomLines = [this.statusBar.render(state, contactSearchHints(), width)];

    // Layout: header → fill → status + content → bottom (bottom-aligned)
    const fixedCount = headerLines.length + statusLines.length + contentLines.length + bottomLines.length;
    const fill = fillLines(rows, fixedCount, 0, width);

    return [...headerLines, ...fill, ...statusLines, ...contentLines, ...bottomLines];
  }
}
