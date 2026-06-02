import { describe, expect, it } from "vitest";
import { formatChatTimestamp, formatConversationPreviewTime } from "../src/util/time.js";

describe("time formatting", () => {
  it("formats today's timestamps with only hour and minute", () => {
    const now = new Date(2023, 10, 16, 12, 0).getTime();
    const timestamp = new Date(2023, 10, 16, 6, 13).getTime();

    expect(formatChatTimestamp(timestamp, now)).toBe("06:13");
  });

  it("formats yesterday by the previous local calendar day", () => {
    const now = new Date(2023, 10, 16, 0, 5).getTime();
    const timestamp = new Date(2023, 10, 15, 23, 59).getTime();

    expect(formatChatTimestamp(timestamp, now)).toBe("昨天 23:59");
  });

  it("formats dates before yesterday in the current year with month, day, and time", () => {
    const now = new Date(2023, 10, 16, 12, 0).getTime();
    const timestamp = new Date(2023, 10, 14, 6, 13).getTime();

    expect(formatChatTimestamp(timestamp, now)).toBe("11月14日 06:13");
  });

  it("formats dates before yesterday in a different year with the full year, month, day, and time", () => {
    const now = new Date(2024, 0, 2, 12, 0).getTime();
    const timestamp = new Date(2023, 11, 30, 6, 13).getTime();

    expect(formatChatTimestamp(timestamp, now)).toBe("2023年12月30日 06:13");
  });

  it("handles yesterday across month and year boundaries", () => {
    const now = new Date(2024, 0, 1, 0, 5).getTime();
    const timestamp = new Date(2023, 11, 31, 23, 59).getTime();

    expect(formatChatTimestamp(timestamp, now)).toBe("昨天 23:59");
  });

  it("keeps conversation previews aligned with chat timestamps", () => {
    const now = new Date(2023, 10, 16, 12, 0).getTime();
    const timestamp = new Date(2023, 10, 15, 6, 13).getTime();

    expect(formatConversationPreviewTime(timestamp, now)).toBe(formatChatTimestamp(timestamp, now));
  });
});
