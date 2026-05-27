import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

export interface CliConfig {
  dataDir: string;
  dbPath: string;
  mock: boolean;
  debug: boolean;
  help: boolean;
  version: boolean;
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
}

const CliConfigSchema = z.object({
  dataDir: z.string().min(1),
  dbPath: z.string().min(1),
  mock: z.boolean(),
  debug: z.boolean(),
  help: z.boolean(),
  version: z.boolean(),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal"])
});

export function parseCliConfig(argv: string[], env: NodeJS.ProcessEnv = process.env): CliConfig {
  const parsed = parseArgs(argv);
  const dataDir = resolvePath(parsed.dataDir ?? env.WECHAT_TUI_DATA_DIR ?? "~/.wechat-tui");
  const dbPath = resolvePath(parsed.dbPath ?? env.WECHAT_TUI_DB ?? `${dataDir}/wechat-tui.sqlite`);
  const mock = parsed.mock || env.WECHAT_TUI_MOCK === "1";
  const debug = parsed.debug || env.WECHAT_TUI_DEBUG === "1";
  const logLevel = (env.WECHAT_TUI_LOG_LEVEL ?? (debug ? "debug" : "info")) as CliConfig["logLevel"];

  return CliConfigSchema.parse({
    dataDir,
    dbPath,
    mock,
    debug,
    help: parsed.help,
    version: parsed.version,
    logLevel
  });
}

export function formatHelp(): string {
  return [
    "wechat-tui",
    "",
    "Usage:",
    "  wechat-tui [--data-dir <path>] [--db <path>] [--mock] [--debug]",
    "",
    "Options:",
    "  --data-dir <path>  local data directory, default ~/.wechat-tui",
    "  --db <path>        sqlite database path",
    "  --mock             use local mock protocol for smoke testing",
    "  --debug            write detailed logs to ~/.wechat-tui/logs",
    "  --help             show help",
    "  --version          show version",
    "",
    "Environment:",
    "  WECHAT_TUI_DATA_DIR",
    "  WECHAT_TUI_DB",
    "  WECHAT_TUI_MOCK=1",
    "  WECHAT_TUI_DEBUG=1",
    "  WECHAT_TUI_LOG_LEVEL=trace|debug|info|warn|error|fatal",
    "",
    "Controls:",
    "  chats:   type to filter local chats, Up/Down select, Enter open, /contacts, Esc/q quit",
    "  chat:    Chat > text, Enter send, Up/Down scroll messages, Esc chats, slash commands autocomplete",
    "  search:  Search > keyword, Up/Down select, Enter open, Esc back",
    "",
    "Commands:",
    "  /contacts  search contacts and groups",
    "  /chats     return to recent chats",
    "  /status    show connection status",
    "  /refresh   refresh local contacts",
    "  /load      load local history",
    "  /messages  search local messages",
    "  /quit      quit"
  ].join("\n");
}

function parseArgs(argv: string[]): {
  dataDir?: string;
  dbPath?: string;
  mock: boolean;
  debug: boolean;
  help: boolean;
  version: boolean;
} {
  const result = {
    mock: false,
    debug: false,
    help: false,
    version: false
  } as {
    dataDir?: string;
    dbPath?: string;
    mock: boolean;
    debug: boolean;
    help: boolean;
    version: boolean;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--data-dir":
        result.dataDir = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--db":
        result.dbPath = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--mock":
        result.mock = true;
        break;
      case "--debug":
        result.debug = true;
        break;
      case "--help":
      case "-h":
        result.help = true;
        break;
      case "--version":
      case "-v":
        result.version = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return result;
}

function requireValue(argv: string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function resolvePath(input: string): string {
  if (input === "~") {
    return homedir();
  }
  if (input.startsWith("~/")) {
    return resolve(homedir(), input.slice(2));
  }
  return resolve(input);
}
