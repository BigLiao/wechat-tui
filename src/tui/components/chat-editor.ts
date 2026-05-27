import { existsSync } from "node:fs";
import { extname } from "node:path";
import process from "node:process";
import {
  CombinedAutocompleteProvider,
  Editor
} from "@earendil-works/pi-tui";
import type { Component, EditorTheme, SelectListTheme, TUI } from "@earendil-works/pi-tui";
import { theme } from "../theme.js";
import type { UiEvent } from "../../types.js";

const COMMANDS = [
  { name: "send", description: "Send a file (image, video, doc)" }
];

const selectListTheme: SelectListTheme = {
  selectedPrefix: (text) => theme.accent(text),
  selectedText: (text) => theme.accent(text),
  description: (text) => theme.dim(text),
  scrollInfo: (text) => theme.dim(text),
  noMatch: (text) => theme.dim(text)
};

const editorTheme: EditorTheme = {
  borderColor: (text) => theme.border(text),
  selectList: selectListTheme
};

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp"]);
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
const IMAGE_MARKER_REGEX = /\[Image #(\d+)\]/g;

function isImageFilePath(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (!/^[/~.]/.test(trimmed)) return false;
  const ext = extname(trimmed).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Chat editor — minimal input at the bottom.
 * Intercepts image file path pastes and converts them to [Image #N] markers.
 * Supports file input mode with path autocomplete for /send command.
 */
export class ChatEditor implements Component {
  readonly focusTarget: Editor;
  private suppressChange = false;
  private imageCounter = 0;
  private readonly imageAttachments = new Map<number, string>();

  constructor(private readonly tui: TUI, private readonly onEvent: (event: UiEvent) => void) {
    this.focusTarget = new Editor(tui, editorTheme, { paddingX: 1, autocompleteMaxVisible: 6 });
    this.focusTarget.setAutocompleteProvider(new CombinedAutocompleteProvider(COMMANDS, process.cwd()));
    this.focusTarget.onChange = (text) => {
      if (!this.suppressChange) {
        this.onEvent({ type: "chat-change", text });
      }
    };
    this.focusTarget.onSubmit = (text) => {
      this.handleSubmit(text);
    };
  }

  private handleSubmit(text: string): void {
    // When /send is selected from autocomplete without a file path argument,
    // put it back into the editor instead of submitting — let the user type the path.
    if (/^\/send\s*$/.test(text)) {
      this.syncText("/send ");
      this.onEvent({ type: "chat-change", text: "/send " });
      return;
    }

    // Check for image markers in the submitted text
    const markerMatch = text.match(IMAGE_MARKER_REGEX);
    if (markerMatch) {
      for (const marker of markerMatch) {
        const idMatch = marker.match(/\[Image #(\d+)\]/);
        if (idMatch) {
          const id = Number(idMatch[1]);
          const filePath = this.imageAttachments.get(id);
          if (filePath) {
            this.onEvent({ type: "file-submit", filePath });
            this.imageAttachments.delete(id);
          }
        }
      }
      const remainingText = text.replace(IMAGE_MARKER_REGEX, "").trim();
      if (remainingText) {
        this.onEvent({ type: "chat-submit", text: remainingText });
      } else {
        this.onEvent({ type: "chat-submit", text: "" });
      }
    } else {
      this.onEvent({ type: "chat-submit", text });
    }
  }

  syncText(text: string): void {
    if (this.focusTarget.getText() === text) {
      return;
    }
    this.suppressChange = true;
    try {
      this.focusTarget.setText(text);
    } finally {
      this.suppressChange = false;
    }
  }

  invalidate(): void {
    this.focusTarget.invalidate();
  }

  render(width: number): string[] {
    return this.focusTarget.render(width);
  }

  /**
   * Called by the input listener BEFORE data reaches the Editor.
   * If the paste contains an image file path, transforms it to an [Image #N] marker.
   * Returns the transformed data string, or undefined if no transformation needed.
   */
  transformPasteData(data: string): string | undefined {
    if (!data.includes(BRACKETED_PASTE_START)) return undefined;

    const startIdx = data.indexOf(BRACKETED_PASTE_START);
    const endIdx = data.indexOf(BRACKETED_PASTE_END, startIdx);
    if (endIdx === -1) return undefined;

    const pasteContent = data.slice(startIdx + BRACKETED_PASTE_START.length, endIdx);
    if (!isImageFilePath(pasteContent) || !existsSync(pasteContent.trim())) {
      return undefined;
    }

    this.imageCounter++;
    const id = this.imageCounter;
    this.imageAttachments.set(id, pasteContent.trim());
    const marker = `[Image #${id}]`;
    return (
      data.slice(0, startIdx) +
      BRACKETED_PASTE_START +
      marker +
      BRACKETED_PASTE_END +
      data.slice(endIdx + BRACKETED_PASTE_END.length)
    );
  }

  handleInput(data: string): void {
    this.focusTarget.handleInput(data);
  }
}
