import { createRequire } from "node:module";
import process from "node:process";

export type SqliteModule = typeof import("node:sqlite");

const require = createRequire(import.meta.url);
let sqliteModule: SqliteModule | undefined;

export function loadNodeSqlite(): SqliteModule {
  if (sqliteModule) {
    return sqliteModule;
  }

  const previousEmitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const type = typeof args[0] === "string" ? args[0] : undefined;
    if (type === "ExperimentalWarning" && String(warning).includes("SQLite")) {
      return;
    }
    return (previousEmitWarning as (...innerArgs: unknown[]) => void).call(process, warning, ...args);
  }) as typeof process.emitWarning;

  try {
    sqliteModule = require("node:sqlite") as SqliteModule;
    return sqliteModule;
  } finally {
    process.emitWarning = previousEmitWarning;
  }
}
