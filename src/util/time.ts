export function formatClock(timestamp: number, locale = "zh-CN"): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(timestamp));
}

export function formatDateTime(timestamp: number, locale = "zh-CN"): string {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(timestamp));
}

export function formatChatTimestamp(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const current = new Date(now);
  const time = formatClock(timestamp);
  if (isSameLocalDay(date, current)) {
    return time;
  }
  if (isPreviousLocalDay(date, current)) {
    return `昨天 ${time}`;
  }
  if (date.getFullYear() === current.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

export function formatConversationPreviewTime(timestamp: number, now = Date.now()): string {
  return formatChatTimestamp(timestamp, now);
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isPreviousLocalDay(date: Date, current: Date): boolean {
  const yesterday = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1);
  return isSameLocalDay(date, yesterday);
}
