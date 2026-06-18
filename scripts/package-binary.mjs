#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJsonPath = path.join(rootDir, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const packageName = typeof packageJson.name === "string" ? packageJson.name : "wechat-tui";
const packageVersion = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

const currentTargets = {
  darwin: {
    arm64: "node22-macos-arm64",
    x64: "node22-macos-x64"
  },
  linux: {
    arm64: "node22-linux-arm64",
    x64: "node22-linux-x64"
  },
  win32: {
    x64: "node22-win-x64"
  }
};

const args = parseArgs(process.argv.slice(2));
const target = args.target ?? currentTargets[process.platform]?.[process.arch];

if (!target) {
  fail(`Unsupported host platform for binary packaging: ${process.platform}-${process.arch}`);
}

const targetInfo = parseTarget(target);
if (targetInfo.nodePlatform !== process.platform || targetInfo.arch !== process.arch) {
  fail(
    `Cross-target packaging is disabled because sqlite3 includes a native addon. ` +
      `Run this script on ${targetInfo.slug} instead.`
  );
}

const distEntry = path.join(rootDir, "dist", "index.js");
const tmpDir = path.join(rootDir, ".tmp");
const bundleEntry = path.join(tmpDir, "pkg-entry.mjs");
const outDir = path.resolve(rootDir, args.outDir ?? "artifacts");
const outputPath = path.join(outDir, `${packageName}-v${packageVersion}-${targetInfo.slug}${targetInfo.extension}`);

if (!existsSync(distEntry)) {
  fail("Missing dist/index.js. Run npm run build before npm run package:binary.");
}

rmSync(bundleEntry, { force: true });
mkdirSync(tmpDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

run(binPath("esbuild"), [
  path.relative(rootDir, distEntry),
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--target=node22",
  "--external:sqlite3",
  `--outfile=${path.relative(rootDir, bundleEntry)}`
]);

run(
  binPath("pkg"),
  [
    path.relative(rootDir, bundleEntry),
    "--config",
    "pkg.config.mjs",
    "--targets",
    target,
    "--output",
    path.relative(rootDir, outputPath),
    "--compress",
    "Brotli"
  ],
  {
    PKG_CACHE_PATH: process.env.PKG_CACHE_PATH ?? path.join(rootDir, ".tmp", "pkg-cache")
  }
);

process.stdout.write(`${path.relative(rootDir, outputPath)}\n`);

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--target") {
      parsed.target = readValue(argv, (index += 1), arg);
    } else if (arg.startsWith("--target=")) {
      parsed.target = arg.slice("--target=".length);
    } else if (arg === "--out-dir") {
      parsed.outDir = readValue(argv, (index += 1), arg);
    } else if (arg.startsWith("--out-dir=")) {
      parsed.outDir = arg.slice("--out-dir=".length);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function readValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    fail(`Missing value for ${option}`);
  }
  return value;
}

function parseTarget(value) {
  const match = /^node22-(linux|macos)-(x64|arm64)$|^node22-win-(x64)$/.exec(value);
  if (!match) {
    fail(`Unsupported target "${value}". Expected node22-linux-x64, node22-linux-arm64, node22-macos-x64, node22-macos-arm64, or node22-win-x64.`);
  }

  const platform = match[1] ?? "win";
  const arch = match[2] ?? match[3];
  return {
    arch,
    extension: platform === "win" ? ".exe" : "",
    nodePlatform: platform === "macos" ? "darwin" : platform === "win" ? "win32" : "linux",
    slug: `${platform === "win" ? "windows" : platform}-${arch}`
  };
}

function run(command, commandArgs, env = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    env: {
      ...process.env,
      ...env
    },
    shell: process.platform === "win32",
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function binPath(name) {
  return path.join(rootDir, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
}

function printHelp() {
  process.stdout.write(`Usage: npm run package:binary -- [--target node22-linux-x64] [--out-dir artifacts]

Builds a dependency-free executable for the selected pkg target.
When --target is omitted, the current host platform and architecture are used.
Cross-target packaging is disabled because sqlite3 ships a native addon.
`);
}

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}
