#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import process from "node:process";
import { parseCliConfig, formatHelp } from "./config.js";
import { checkStartupEnvironment, formatStartupEnvironmentReport } from "./environment-check.js";
import { createDebugLogger, summarizeConfig } from "./logging.js";
import { MockProtocol } from "./protocol/mock-protocol.js";
import { Wechat4uAdapter } from "./protocol/wechat4u-adapter.js";
import { WeChatRuntime } from "./runtime.js";
import { SqliteStore } from "./store/sqlite-store.js";
import { WorkbenchTerminalRenderer } from "./ui/workbench-renderer.js";
import { checkForPackageUpdate } from "./update-check.js";
import { readPackageInfo } from "./version.js";

const MINIMUM_STARTUP_MS = 3000;

async function main(): Promise<void> {
  const config = parseCliConfig(process.argv.slice(2));
  const packageInfo = readPackageInfo();

  if (config.help) {
    process.stdout.write(`${formatHelp()}\n`);
    return;
  }

  if (config.version) {
    process.stdout.write(`${packageInfo.version}\n`);
    return;
  }

  const environment = checkStartupEnvironment({ dbPath: config.dbPath });
  if (!environment.ok) {
    process.stderr.write(`${formatStartupEnvironmentReport(environment)}\n`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(config.dataDir, { recursive: true });
  const { logger, logPath } = createDebugLogger(config);

  logger?.debug({ config: summarizeConfig(config, logPath) }, "cli config parsed");

  const store = await SqliteStore.open(config.dbPath, { logger });
  const protocol = config.mock ? new MockProtocol() : new Wechat4uAdapter({ logger });
  const renderer = new WorkbenchTerminalRenderer();
  const runtime = new WeChatRuntime(protocol, store, renderer, {
    logger,
    debugLogPath: logPath,
    minimumStartupMs: MINIMUM_STARTUP_MS,
    updateCheck: () =>
      checkForPackageUpdate({
        packageName: packageInfo.name,
        currentVersion: packageInfo.version,
        logger
      })
  });

  let closed = false;
  const shutdown = (code: number) => {
    if (closed) {
      return;
    }
    closed = true;
    void (async () => {
      try {
        logger?.info({ code }, "shutdown");
        await store.close();
        renderer.stop();
        logger?.flush?.();
      } finally {
        process.exit(code);
      }
    })();
  };

  runtime.on("exit", (code: number) => {
    shutdown(code);
  });

  process.on("SIGINT", () => {
    logger?.info("received SIGINT");
    void runtime.handleKey({ sequence: "c", name: "c", ctrl: true });
  });

  try {
    await runtime.start();
  } catch (error) {
    await store.close();
    renderer.stop();
    logger?.flush?.();
    throw error;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
});
