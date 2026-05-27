import qrcode from "qrcode-terminal";
import { colors, fit, fillLines } from "./theme.js";
import { Header } from "./components/header.js";
import { StatusBar, loginHints } from "./components/status-bar.js";
import type { ProtocolQrEvent, RenderState } from "../types.js";

export class LoginScreen {
  private readonly header = new Header();
  private readonly statusBar = new StatusBar();

  render(state: RenderState, width: number, rows: number): string[] {
    // Fixed top: header
    const headerLines = this.header.render(state, "Login", width);

    // Content
    const contentLines: string[] = [];
    if (state.statusMessage) {
      contentLines.push(fit(`  ${colors.muted(state.statusMessage)}`, width));
    }
    if (state.errorMessage) {
      contentLines.push(fit(`  ${colors.error(state.errorMessage)}`, width));
    }
    if (state.debugLogPath) {
      contentLines.push(fit(`  ${colors.muted(`debug: ${state.debugLogPath}`)}`, width));
    }
    contentLines.push("");

    if (state.qr) {
      contentLines.push(fit(`  ${colors.muted("Scan with WeChat:")} ${colors.primary(state.qr.qrUrl)}`, width));
      contentLines.push("");
      contentLines.push(...qrLines(state.qr).map((line) => fit(`  ${line}`, width)));
    } else {
      contentLines.push(fit(`  ${colors.muted("Waiting for login QR code...")}`, width));
    }

    // Fixed bottom: status bar
    const bottomLines = [this.statusBar.render(state, loginHints(), width)];

    // Layout: header → fill → content → bottom (bottom-aligned)
    const fixedCount = headerLines.length + contentLines.length + bottomLines.length;
    const fill = fillLines(rows, fixedCount, 0, width);

    return [...headerLines, ...fill, ...contentLines, ...bottomLines];
  }
}

function qrLines(event: ProtocolQrEvent): string[] {
  let output = "";
  qrcode.generate(event.loginUrl, { small: true }, (qr) => {
    output = qr;
  });
  return output.split("\n").filter(Boolean);
}
