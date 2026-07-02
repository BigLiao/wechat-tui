import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { BOX, fit, theme } from "../theme.js";
import type { EmoticonPickerRenderState, EmoticonPickerSection } from "../../types.js";

const MIN_CELL_WIDTH = 4;
const SECTION_INDENT = "  ";
const MAX_VISIBLE_CONTENT_LINES = 5;

interface RenderedPickerRow {
  line: string;
  itemIndexes: number[];
}

export class EmoticonPicker {
  invalidate(): void {}

  render(picker: EmoticonPickerRenderState, width: number): string[] {
    const contentWidth = Math.max(1, width - 2);
    const rows: RenderedPickerRow[] = [];
    let itemIndex = 0;
    if (picker.query) {
      rows.push({ line: this.renderSearchRow(picker.query, contentWidth), itemIndexes: [] });
    }
    for (const section of picker.sections) {
      if (!shouldRenderSection(section)) {
        continue;
      }
      rows.push({ line: this.renderSectionHeader(section, contentWidth), itemIndexes: [] });
      if (section.items.length === 0) {
        rows.push({ line: fit(`${SECTION_INDENT}${theme.dim(section.emptyText ?? "无匹配")}`, contentWidth), itemIndexes: [] });
      } else {
        rows.push(...this.renderItems(section.items, itemIndex, picker.selectedIndex, picker.columns, contentWidth));
      }
      itemIndex += section.items.length;
    }

    const visibleRows = this.visibleRows(rows, picker.selectedIndex);
    return [
      this.renderTopBorder(width),
      ...visibleRows.map((row) => this.renderFrameRow(row.line, width)),
      this.renderBottomBorder(width)
    ];
  }

  private renderSearchRow(query: string, width: number): string {
    return fit(`${SECTION_INDENT}${theme.dim(`🔍 ${query}`)}`, width);
  }

  private renderSectionHeader(section: EmoticonPickerSection, width: number): string {
    return fit(`${SECTION_INDENT}${theme.accentBold(section.title)}`, width);
  }

  private renderItems(
    items: string[],
    baseIndex: number,
    selectedIndex: number,
    columns: number,
    width: number
  ): RenderedPickerRow[] {
    const effectiveColumns = Math.max(1, columns);
    const cellWidth = Math.max(MIN_CELL_WIDTH, Math.floor((Math.max(1, width) - SECTION_INDENT.length) / effectiveColumns));
    const rows: RenderedPickerRow[] = [];

    for (let rowStart = 0; rowStart < items.length; rowStart += effectiveColumns) {
      const rowItems = items.slice(rowStart, rowStart + effectiveColumns);
      const itemIndexes: number[] = [];
      const row = rowItems.map((item, offset) => {
        const index = baseIndex + rowStart + offset;
        itemIndexes.push(index);
        const text = truncateToWidth(item, Math.max(1, cellWidth - 1), "…", true);
        const padded = visibleWidth(text) < cellWidth ? `${text}${" ".repeat(cellWidth - visibleWidth(text))}` : text;
        return index === selectedIndex ? theme.accentBold(padded) : padded;
      });
      rows.push({ line: fit(`${SECTION_INDENT}${row.join("")}`, width, true), itemIndexes });
    }

    return rows;
  }

  private renderTopBorder(width: number): string {
    if (width <= 2) {
      return fit("表情", width, true);
    }
    const contentWidth = width - 2;
    const title = ` 表情  ${theme.dim("Esc 取消 · Enter 插入 · ↑↓←→ 选择 · 🔍 输入搜索")} `;
    return `${theme.border(BOX.tl)}${fit(title, contentWidth, true)}${theme.border(BOX.tr)}`;
  }

  private renderBottomBorder(width: number): string {
    if (width <= 2) {
      return fit("", width, true);
    }
    return `${theme.border(BOX.bl)}${theme.border(BOX.h.repeat(width - 2))}${theme.border(BOX.br)}`;
  }

  private renderFrameRow(line: string, width: number): string {
    if (width <= 2) {
      return fit(line, width, true);
    }
    return `${theme.border(BOX.v)}${fit(line, width - 2, true)}${theme.border(BOX.v)}`;
  }

  private visibleRows(rows: RenderedPickerRow[], selectedIndex: number): RenderedPickerRow[] {
    const maxVisible = Math.min(MAX_VISIBLE_CONTENT_LINES, rows.length);
    if (rows.length <= maxVisible) {
      return rows;
    }

    const stickyRows = rows.slice(0, 1);
    const scrollRows = rows.slice(stickyRows.length);
    const scrollVisible = Math.max(1, maxVisible - stickyRows.length);
    const selectedRow = rows.findIndex((row) => row.itemIndexes.includes(selectedIndex));
    const anchor = selectedRow >= stickyRows.length ? selectedRow - stickyRows.length : 0;
    const start = clamp(anchor - Math.floor(scrollVisible / 2), 0, scrollRows.length - scrollVisible);
    return [...stickyRows, ...scrollRows.slice(start, start + scrollVisible)];
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function shouldRenderSection(section: EmoticonPickerSection): boolean {
  return section.title !== "最近使用" || section.items.length > 0;
}
