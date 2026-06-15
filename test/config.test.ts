import { describe, expect, it } from "vitest";
import { formatHelp, parseCliConfig } from "../src/config.js";

describe("CLI config", () => {
  it("enables debug logging through --debug", () => {
    const config = parseCliConfig(["--debug", "--data-dir", "/tmp/wechat-tui-data"], {});

    expect(config.debug).toBe(true);
    expect(config.logLevel).toBe("debug");
  });

  it("uses wechat-tui defaults and environment variables", () => {
    const config = parseCliConfig([], {
      WECHAT_TUI_DATA_DIR: "/tmp/wechat-tui-home",
      WECHAT_TUI_MOCK: "1",
      WECHAT_TUI_DEBUG: "1",
      WECHAT_TUI_LOG_LEVEL: "trace"
    });

    expect(config.dataDir).toBe("/tmp/wechat-tui-home");
    expect(config.dbPath).toBe("/tmp/wechat-tui-home/wechat-tui.sqlite");
    expect(config.mock).toBe(true);
    expect(config.debug).toBe(true);
    expect(config.logLevel).toBe("trace");
  });

  it("documents debug logging", () => {
    expect(formatHelp()).toContain("--debug");
    expect(formatHelp()).toContain("wechat-tui");
    expect(formatHelp()).toContain("~/.wechat-tui/logs");
    expect(formatHelp()).toContain("WECHAT_TUI_DEBUG=1");
  });

  it("documents redraw keyboard controls", () => {
    expect(formatHelp()).toContain("Up/Down select");
    expect(formatHelp()).toContain("/contacts");
    expect(formatHelp()).toContain("/readall");
    expect(formatHelp()).toContain("Chat > text");
    expect(formatHelp()).toContain("Esc back");
  });
});
