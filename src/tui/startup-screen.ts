import { visibleWidth } from "@earendil-works/pi-tui";
import { fit, theme } from "./theme.js";
import type { RenderState } from "../types.js";

const SCENE_FRAMES = [
  [
    "                 .-''''''''''''''''''-.                 ",
    "             .-'   _..---.._    .--.   '-.             ",
    "           .'   .-'   .--.  '-.  \\  \\     '.           ",
    "          /    /  .--'    '--. \\  '--'      \\          ",
    "         /    |  /  .-''-.    | |  .--.      \\         ",
    "        |     |  | (  ~~  )   | | / __ \\      |        ",
    "        |     \\  \\  '-..-'   / /  \\____/      |        ",
    "        |      '. '-._____.-' .'     .--.     |        ",
    "         \\       '-._______ .-'   .-'    '-. /         ",
    "          \\   .-.._       _..-.  /  .--.   /          ",
    "           '. \\    ''---''    /  \\  '--' .'           ",
    "             '-.              '.  '.__.-'             ",
    "                 '-..______________..-'                 ",
    "                         o                              ",
    "                        /|\\                             ",
    "                        / \\                             ",
    "             _________./___\\._________                 ",
    "        _.-''                         ''-._             "
  ],
  [
    "                 .-''''''''''''''''''-.                 ",
    "             .-'    .--.    _..---.._ '-.              ",
    "           .'      /  /  .-'  .--.   '-. '.            ",
    "          /       '--'  / .--'    '--.  \\  \\           ",
    "         /       .--.  | |    .-''-.  \\  |  \\          ",
    "        |       / __ \\ | |   (  ~~  ) |  |   |         ",
    "        |       \\____/  \\ \\   '-..-' /  /    |         ",
    "        |      .--.      '. '-.____.-' .'    |         ",
    "         \\  .-'    '-.     '-.______.-'     /          ",
    "          \\   .--.   \\  .-.._       _..-.  /           ",
    "           '. '--'  /  \\    ''---''    / .'            ",
    "             '-.__.'  .'              .-'              ",
    "                 '-..______________..-'                 ",
    "                         o                              ",
    "                        /|\\                             ",
    "                        / \\                             ",
    "             _________./___\\._________                 ",
    "        _.-''                         ''-._             "
  ],
  [
    "                 .-''''''''''''''''''-.                 ",
    "             .-'  .--.     _..---.._   '-.             ",
    "           .'    /  /  .-'    __    '-.   '.           ",
    "          /      '--' /   .--'  '--.    \\   \\          ",
    "         /    .--.   |   / .-''-.  \\   |    \\         ",
    "        |    / __ \\  |  | (  ~~  ) |   |     |        ",
    "        |    \\____/   \\  \\ '-..-' /   /      |        ",
    "        |      .--.    '. '-.____.-' .'      |        ",
    "         \\ .-'    '-.    '-.______.-'       /         ",
    "          \\  .-.._   \\ .-.._       _..-.   /          ",
    "           '.\\    ''-' \\    ''---''    / .'           ",
    "             '-.        '.              .-'            ",
    "                 '-..______________..-'                 ",
    "                         o                              ",
    "                        /|\\                             ",
    "                        / \\                             ",
    "             _________./___\\._________                 ",
    "        _.-''                         ''-._             "
  ],
  [
    "                 .-''''''''''''''''''-.                 ",
    "             .-'      .--.    _..---.._ '-.            ",
    "           .'        /  /  .-' .-..-.   '-.'.          ",
    "          /          '--' /  .'      '.    \\ \\         ",
    "         /     .--.      |  |  .--.   |    | \\        ",
    "        |     / __ \\     |  | (  ~~)  |    |  |       ",
    "        |     \\____/      \\  '.    .' /   /   |       ",
    "        |        .--.      '. '-..-' .'       |        ",
    "         \\   .-'    '-.      '-.__.-'       /         ",
    "          \\ /  .--.   \\  .-.._      _..-.  /          ",
    "           '.  '--'  /   \\    ''--''   / .'           ",
    "             '-.__.-'     '.          .-'             ",
    "                 '-..______________..-'                 ",
    "                         o                              ",
    "                        /|\\                             ",
    "                        / \\                             ",
    "             _________./___\\._________                 ",
    "        _.-''                         ''-._             "
  ]
];

export class StartupScreen {
  render(state: RenderState, width: number, rows: number): string[] {
    const frame = state.startupFrame ?? 0;
    const scene = SCENE_FRAMES[frame % SCENE_FRAMES.length] ?? SCENE_FRAMES[0];
    const spinner = loadingDots(frame);
    const message = state.startupMessage ?? state.statusMessage ?? "Opening WeChat TUI...";
    const content = [
      "",
      ...scene,
      "",
      `WECHAT TUI ${spinner}`,
      theme.dim(message)
    ];
    if (state.debugLogPath) {
      content.push(theme.dim(`debug: ${state.debugLogPath}`));
    }

    const topPad = Math.max(0, Math.floor((rows - content.length) / 2));
    const lines = Array.from({ length: topPad }, () => " ".repeat(Math.max(0, width)));
    lines.push(...content.map((line) => center(line, width)));
    while (lines.length < rows) {
      lines.push(" ".repeat(Math.max(0, width)));
    }
    return lines.slice(0, rows);
  }
}

function loadingDots(frame: number): string {
  return ".".repeat((frame % 4) + 1).padEnd(4, " ");
}

function center(line: string, width: number): string {
  const padding = Math.max(0, Math.floor((width - visibleWidth(line)) / 2));
  return fit(`${" ".repeat(padding)}${line}`, width, true);
}
