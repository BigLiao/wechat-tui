import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { SYMBOLS, colors, fit, visiblePickerRows, windowItems } from "../theme.js";
import type { ContactRecord, RenderState } from "../../types.js";

/**
 * Contact search picker with styled rows.
 */
export class ContactPicker {
  render(state: RenderState, width: number, rows: number): string[] {
    const lines: string[] = [];

    // Search prompt
    const query = state.searchKeyword;
    const prompt = query
      ? `${colors.muted("Search")} ${colors.primary(SYMBOLS.arrow)} ${query}`
      : `${colors.muted("Search")} ${colors.primary(SYMBOLS.arrow)} ${colors.muted("type to search contacts...")}`;
    lines.push(fit(prompt, width));
    lines.push("");

    const maxVisible = visiblePickerRows(rows);
    const windowed = windowItems(state.searchResults, state.selectedSearchIndex, maxVisible);

    if (state.searchResults.length === 0) {
      const empty = state.searchKeyword
        ? "No matches found."
        : "Type to search contacts and groups.";
      lines.push(fit(`  ${colors.muted(empty)}`, width));
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
      lines.push(fit(`  ${colors.muted(info)}`, width));
    }

    return lines;
  }
}

function formatContactRow(contact: ContactRecord, selected: boolean, width: number): string {
  // Selection marker
  const marker = selected ? colors.primary(`${SYMBOLS.arrow} `) : "  ";

  // Name
  const nameWidth = Math.max(12, Math.min(30, Math.floor(width * 0.4)));
  const nameText = truncateToWidth(contact.displayName, nameWidth, "...", true);

  // Kind badge
  const kindBadge = formatKindBadge(contact.kind);

  if (selected) {
    const row = `${colors.primary(`${SYMBOLS.arrow} `)}${colors.primaryBold(nameText)} ${kindBadge}`;
    return fit(row, width);
  }
  const row = `${marker}${nameText} ${kindBadge}`;
  return fit(row, width);
}

function formatKindBadge(kind: string): string {
  switch (kind) {
    case "group":
      return colors.groupName("[group]");
    case "private":
      return colors.muted("[contact]");
    case "public":
      return colors.muted("[public]");
    default:
      return colors.muted(`[${kind}]`);
  }
}
