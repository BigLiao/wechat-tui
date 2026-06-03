import chalk from "chalk";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ConnectionState } from "../types.js";

// ─── Theme ────────────────────────────────────────────────────────────────────
// Color hierarchy: accent (primary) → text (default) → muted → dim
// One accent dominates. Everything secondary uses muted/dim.

export const theme = {
  // Primary accent — used sparingly for active/important elements
  accent: chalk.cyan,
  accentBold: chalk.cyan.bold,

  // Text — default content (no special styling needed, use raw string)
  text: (s: string) => s,
  bold: chalk.bold,

  // Secondary — de-emphasized
  muted: chalk.dim,
  dim: chalk.gray,
  media: chalk.hex("#5f9fb7"),
  unreadActive: chalk.bgHex("#245463").white,

  // Semantic — status indicators only
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,

  // Structural
  border: chalk.dim,
  borderAccent: chalk.cyan,

  // Message senders
  selfName: chalk.cyan.bold,
  otherName: chalk.bold,
};

// ─── Box-drawing ──────────────────────────────────────────────────────────────

export const BOX = {
  h: "─",       // horizontal
  v: "│",       // vertical
  tl: "╭",      // top-left
  tr: "╮",      // top-right
  bl: "╰",      // bottom-left
  br: "╯",      // bottom-right
} as const;

// ─── Symbols ──────────────────────────────────────────────────────────────────

export const SYM = {
  dot: "●",
  circle: "○",
  bullet: "·",
  arrow: "▸",
  check: "✓",
} as const;

// ─── Connection state ─────────────────────────────────────────────────────────

export function connectionIndicator(state: ConnectionState): string {
  switch (state) {
    case "online":
    case "idle":
      return theme.success(`${SYM.dot} Online`);
    case "syncing":
      return theme.warning(`${SYM.dot} Syncing`);
    case "reconnecting":
      return theme.warning(`${SYM.dot} Reconnecting`);
    case "waiting_scan":
      return theme.warning(`${SYM.circle} Scan QR`);
    case "waiting_confirm":
      return theme.warning(`${SYM.circle} Confirm`);
    case "error":
      return theme.error(`${SYM.dot} Error`);
    case "offline":
    case "logout":
      return theme.error(`${SYM.circle} Offline`);
    default:
      return theme.dim(`${SYM.circle} Init`);
  }
}

// ─── Layout primitives ────────────────────────────────────────────────────────

/** Truncate text to width, optionally pad with spaces */
export function fit(text: string, width: number, pad = false): string {
  const maxWidth = Math.max(1, width);
  const fitted = truncateToWidth(text, maxWidth, "…", pad);
  if (!pad || visibleWidth(fitted) >= maxWidth) {
    return fitted;
  }
  return `${fitted}${" ".repeat(maxWidth - visibleWidth(fitted))}`;
}

/** Horizontal border line */
export function border(width: number): string {
  return theme.border(BOX.h.repeat(Math.max(0, width)));
}

/** Fill with empty lines to reach target row count */
export function fillLines(rows: number, used: number, reserved: number, width: number): string[] {
  const count = Math.max(0, rows - used - reserved);
  return Array.from({ length: count }, () => " ".repeat(Math.max(0, width)));
}

/** Right-pad a string to exact visible width */
export function pad(text: string, width: number): string {
  const vis = visibleWidth(text);
  return text + " ".repeat(Math.max(0, width - vis));
}

/** Format key hint: dimmed "key action" */
export function keyHint(key: string, action: string): string {
  return `${theme.muted(key)} ${theme.dim(action)}`;
}

/** Relative time from timestamp */
export function relativeTime(timestamp: number | undefined): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  if (diff < 0) return "";
  const s = Math.floor(diff / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

/** Clamp value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
