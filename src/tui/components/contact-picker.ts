import { CURSOR_MARKER, truncateToWidth } from "@earendil-works/pi-tui";
import { SYM, theme, fit, clamp } from "../theme.js";
import type { ContactRecord, RenderState } from "../../types.js";

/**
 * Contact search picker with styled rows.
 */
export class ContactPicker {
  render(state: RenderState, width: number, rows: number): string[] {
    const lines: string[] = [];

    // Search prompt
    const promptPrefix = `  ${theme.dim("search")} ${theme.accent(SYM.arrow)} `;
    lines.push(`${fit(`${promptPrefix}${state.searchKeyword}`, Math.max(1, width - 1))}${CURSOR_MARKER}`);
    lines.push("");

    const maxVisible = clamp(rows - 8, 3, 12);
    const windowed = windowItems(state.searchResults, state.selectedSearchIndex, maxVisible);

    if (state.searchResults.length === 0) {
      const empty = state.searchKeyword
        ? "No matches found."
        : "Type to search contacts and groups.";
      lines.push(fit(`  ${theme.dim(empty)}`, width));
      return lines;
    }

    for (let offset = 0; offset < windowed.items.length; offset += 1) {
      const index = windowed.start + offset;
      const contact = windowed.items[offset];
      const selected = index === state.selectedSearchIndex;
      lines.push(formatContactRow(contact, selected, width));
    }

    if (state.searchResults.length > maxVisible) {
      const info = `${windowed.start + 1}-${windowed.start + windowed.items.length} of ${state.searchResults.length}`;
      lines.push(fit(`  ${theme.dim(info)}`, width));
    }

    return lines;
  }
}

function formatContactRow(contact: ContactRecord, selected: boolean, width: number): string {
  const marker = selected ? theme.accent(`${SYM.arrow} `) : "  ";
  const nameWidth = Math.max(12, Math.min(30, Math.floor(width * 0.4)));
  const nameText = truncateToWidth(contact.displayName, nameWidth, "…", true);
  const kindBadge = theme.dim(`[${contact.kind}]`);

  if (selected) {
    return fit(`${marker}${theme.accentBold(nameText)} ${kindBadge}`, width);
  }
  return fit(`${marker}${nameText} ${kindBadge}`, width);
}

function windowItems<T>(items: T[], selectedIndex: number, limit: number): { items: T[]; start: number } {
  if (items.length <= limit) {
    return { items, start: 0 };
  }
  const selected = clamp(selectedIndex, 0, items.length - 1);
  const start = clamp(selected - Math.floor(limit / 2), 0, Math.max(0, items.length - limit));
  return { items: items.slice(start, start + limit), start };
}
