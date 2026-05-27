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
