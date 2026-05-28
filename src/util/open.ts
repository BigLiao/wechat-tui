import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { platform } from "node:os";

/**
 * Open a file or URL with the system's default application.
 * Detached so it doesn't block the TUI process.
 *
 * - macOS: `open`
 * - Linux: `xdg-open`
 * - Windows: `start`
 */
export function openWithSystem(target: string): void {
  const os = platform();
  let command: string;
  let args: string[];

  switch (os) {
    case "darwin":
      command = "open";
      args = [target];
      break;
    case "win32":
      command = "cmd";
      args = ["/c", "start", "", target];
      break;
    default:
      // Linux and others
      command = "xdg-open";
      args = [target];
      break;
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

/**
 * Reveal a file in the system file manager (Finder / Explorer / file manager).
 * The file manager will open with the file selected/highlighted.
 *
 * - macOS: `open -R <path>` (reveal in Finder)
 * - Linux: `xdg-open <parent-dir>`
 * - Windows: `explorer /select,<path>`
 */
export function revealInFileManager(target: string): void {
  const os = platform();
  let command: string;
  let args: string[];

  switch (os) {
    case "darwin":
      command = "open";
      args = ["-R", target];
      break;
    case "win32":
      command = "explorer";
      args = [`/select,${target}`];
      break;
    default: {
      // Linux: open the parent directory
      command = "xdg-open";
      args = [dirname(target)];
      break;
    }
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}
