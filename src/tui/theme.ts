import chalk from "chalk";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ConnectionState } from "../types.js";

// ─── Color palette ────────────────────────────────────────────────────────────

export const colors = {
  primary: chalk.cyan,
  primaryBold: chalk.cyan.bold,
  secondary: chalk.blue,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  muted: chalk.dim,
  mutedItalic: chalk.dim.italic,
  bold: chalk.bold,
  white: chalk.white,
  whiteBold: chalk.white.bold,
  selfName: chalk.cyan,
  otherName: chalk.magenta,
  groupName: chalk.yellow,
  highlight: chalk.bgCyan.black,
  selectedBg: chalk.inverse
};

// ─── Box-drawing characters ───────────────────────────────────────────────────

export const BOX = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
  teeRight: "├",
  teeLeft: "┤",
  cross: "┼",
  lightHorizontal: "┈",
  thinVertical: "│",
  cornerTopLeft: "┌",
  cornerBottomLeft: "└"
} as const;

// ─── Symbols ──────────────────────────────────────────────────────────────────

export const SYMBOLS = {
  dot: "●",
  circle: "○",
  arrow: "›",
  unread: "◆",
  read: " ",
  check: "✓",
  separator: "│",
  messageBorder: "│",
  messageCorner: "┌",
  ellipsis: "…"
} as const;

// ─── Connection state styling ─────────────────────────────────────────────────

export function connectionDot(state: ConnectionState): string {
  switch (state) {
    case "online":
    case "idle":
      return colors.success(SYMBOLS.dot);
    case "syncing":
    case "reconnecting":
    case "waiting_scan":
    case "waiting_confirm":
      return colors.warning(SYMBOLS.dot);
    case "error":
    case "offline":
    case "logout":
      return colors.error(SYMBOLS.dot);
    default:
      return colors.muted(SYMBOLS.circle);
  }
}

export function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case "online":
      return "Online";
    case "idle":
      return "Ready";
    case "syncing":
      return "Syncing";
    case "reconnecting":
      return "Reconnecting";
    case "waiting_scan":
      return "Scan QR";
    case "waiting_confirm":
      return "Confirm";
    case "error":
      return "Error";
    case "offline":
      return "Offline";
    case "logout":
      return "Logged out";
    default:
      return "Init";
  }
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

/**
 * Truncate and optionally pad text to exactly `width` visible characters.
 */
export function fit(text: string, width: number, pad = false): string {
  const maxWidth = Math.max(1, width);
  const fitted = truncateToWidth(text, maxWidth, "...", pad);
  if (!pad || visibleWidth(fitted) >= maxWidth) {
    return fitted;
  }
  return `${fitted}${" ".repeat(maxWidth - visibleWidth(fitted))}`;
}

/**
 * Create a horizontal line/rule using box-drawing characters.
 */
export function horizontalRule(width: number, style: (s: string) => string = colors.muted): string {
  return style(BOX.horizontal.repeat(Math.max(0, width)));
}

/**
 * Fill remaining terminal height with empty lines.
 */
export function fillLines(rows: number, used: number, reserved: number, width: number): string[] {
  const count = Math.max(0, rows - used - reserved);
  return Array.from({ length: count }, () => " ".repeat(Math.max(0, width)));
}

/**
 * Format relative time (e.g., "2m", "1h", "3d").
 */
export function relativeTime(timestamp: number | undefined): string {
  if (!timestamp) return "";
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 0) return "";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

/**
 * Clamp a number between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Calculate max visible picker items based on terminal height.
 */
export function visiblePickerRows(rows: number): number {
  return clamp(rows - 10, 5, 12);
}

/**
 * Window a list around the selected index.
 */
export function windowItems<T>(items: T[], selectedIndex: number, limit: number): { items: T[]; start: number } {
  if (items.length <= limit) {
    return { items, start: 0 };
  }
  const selected = clamp(selectedIndex, 0, items.length - 1);
  const start = clamp(selected - Math.floor(limit / 2), 0, Math.max(0, items.length - limit));
  return { items: items.slice(start, start + limit), start };
}
