import process from "node:process";
import {
  CombinedAutocompleteProvider,
  Editor
} from "@earendil-works/pi-tui";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
  Component,
  EditorTheme,
  SelectListTheme,
  SlashCommand,
  TUI
} from "@earendil-works/pi-tui";
import { theme } from "../theme.js";
import type { UiEvent, ViewFileSuggestion } from "../../types.js";
import { imageFilePathFromPastedText } from "../../util/path-input.js";

const VIEW_FILE_COMPLETION_LIMIT = 5;

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

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
const IMAGE_MARKER_REGEX = /\[Image #(\d+)\]/g;
const INLINE_EMOTICON_COMPLETION_PREFIX = "inline-emoticon-command";
const EMOTICON_COMMAND_ITEM: AutocompleteItem = {
  value: "emoticons",
  label: "/emoticons",
  description: "Open WeChat emoticon picker"
};

/**
 * Chat editor — minimal input at the bottom.
 * Intercepts image file path pastes and converts them to [Image #N] markers.
 * Supports file input mode with path autocomplete for /send command.
 */
export class ChatEditor implements Component {
  readonly focusTarget: Editor;
  private suppressChange = false;
  private pendingInlineEmoticonOpen = false;
  private imageCounter = 0;
  private viewFileSuggestions: ViewFileSuggestion[] = [];
  private readonly imageAttachments = new Map<number, string>();
  private readonly autocompleteProvider: ChatAutocompleteProvider;

  constructor(private readonly tui: TUI, private readonly onEvent: (event: UiEvent) => void) {
    this.focusTarget = new Editor(tui, editorTheme, { paddingX: 1, autocompleteMaxVisible: 6 });
    this.autocompleteProvider = new ChatAutocompleteProvider(
      new CombinedAutocompleteProvider(this.commands(), process.cwd()),
      () => {
        this.pendingInlineEmoticonOpen = true;
      }
    );
    this.focusTarget.setAutocompleteProvider(this.autocompleteProvider);
    this.focusTarget.onChange = (text) => {
      if (!this.suppressChange) {
        this.onEvent({ type: "chat-change", text, cursorIndex: this.cursorIndex() });
        if (this.pendingInlineEmoticonOpen) {
          this.pendingInlineEmoticonOpen = false;
          this.onEvent({ type: "emoticon-open" });
        }
      }
    };
    this.focusTarget.onSubmit = (text) => {
      this.handleSubmit(text);
    };
  }

  setViewFileSuggestions(suggestions: ViewFileSuggestion[]): void {
    this.viewFileSuggestions = suggestions;
  }

  isAutocompleteOpen(): boolean {
    return this.focusTarget.isShowingAutocomplete();
  }

  canOpenInlineEmoticonCommand(): boolean {
    if (!this.focusTarget.getText()) {
      return false;
    }
    const cursor = this.focusTarget.getCursor();
    const currentLine = this.focusTarget.getLines()[cursor.line] ?? "";
    const textBeforeCursor = currentLine.slice(0, cursor.col);
    return textBeforeCursor.length === 0 || /\s$/u.test(textBeforeCursor);
  }

  openInlineEmoticonCommand(): void {
    this.autocompleteProvider.requestInlineEmoticonCommand();
    this.triggerAutocomplete();
  }

  private handleSubmit(text: string): void {
    // When /send or /view is selected from autocomplete without arguments,
    // put it back into the editor instead of submitting — let the user type the argument.
    if (/^\/send\s*$/.test(text)) {
      this.syncText("/send ");
      this.onEvent({ type: "chat-change", text: "/send ", cursorIndex: this.cursorIndex() });
      return;
    }
    if (/^\/view\s*$/.test(text)) {
      this.syncText("/view ");
      this.onEvent({ type: "chat-change", text: "/view ", cursorIndex: this.cursorIndex() });
      this.triggerAutocomplete();
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
        this.onEvent({ type: "chat-submit", text: remainingText, cursorIndex: remainingText.length });
      } else {
        this.onEvent({ type: "chat-submit", text: "", cursorIndex: 0 });
      }
    } else {
      this.onEvent({ type: "chat-submit", text, cursorIndex: this.cursorIndex() });
    }
  }

  syncText(text: string, cursorIndex?: number): void {
    if (this.focusTarget.getText() === text) {
      if (cursorIndex !== undefined) {
        this.setCursorIndex(cursorIndex);
      }
      return;
    }
    this.suppressChange = true;
    try {
      this.focusTarget.setText(text);
      if (cursorIndex !== undefined) {
        this.setCursorIndex(cursorIndex);
      }
    } finally {
      this.suppressChange = false;
    }
  }

  cursorIndex(): number {
    const cursor = this.focusTarget.getCursor();
    const lines = this.focusTarget.getLines();
    let index = 0;
    for (let line = 0; line < cursor.line; line += 1) {
      index += (lines[line]?.length ?? 0) + 1;
    }
    return clamp(index + cursor.col, 0, this.focusTarget.getText().length);
  }

  private setCursorIndex(index: number): void {
    const text = this.focusTarget.getText();
    const target = clamp(index, 0, text.length);
    const lines = this.focusTarget.getLines();
    let remaining = target;
    for (let line = 0; line < lines.length; line += 1) {
      const lineLength = lines[line]?.length ?? 0;
      if (remaining <= lineLength) {
        this.setEditorCursor(line, remaining);
        return;
      }
      remaining -= lineLength + 1;
    }
    const lastLine = Math.max(0, lines.length - 1);
    this.setEditorCursor(lastLine, lines[lastLine]?.length ?? 0);
  }

  private setEditorCursor(line: number, col: number): void {
    const editor = this.focusTarget as unknown as { state: { cursorLine: number; cursorCol: number } };
    editor.state.cursorLine = line;
    editor.state.cursorCol = col;
  }

  private triggerAutocomplete(): void {
    const editor = this.focusTarget as unknown as {
      requestAutocomplete?: (options: { force: boolean; explicitTab: boolean }) => void;
    };
    editor.requestAutocomplete?.({ force: false, explicitTab: true });
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
    const imagePath = imageFilePathFromPastedText(pasteContent);
    if (!imagePath) {
      return undefined;
    }

    this.imageCounter++;
    const id = this.imageCounter;
    this.imageAttachments.set(id, imagePath);
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

  private commands(): SlashCommand[] {
    return [
      { name: "emoticons", description: "Open WeChat emoticon picker" },
      { name: "send", description: "Send a file (image, video, doc)" },
      {
        name: "view",
        description: "Open a file by hash",
        argumentHint: "<hash>",
        getArgumentCompletions: (argumentPrefix) => this.viewFileCompletions(argumentPrefix)
      }
    ];
  }

  private viewFileCompletions(argumentPrefix: string): AutocompleteItem[] {
    const query = argumentPrefix.trim().replace(/^#/, "").toLocaleLowerCase();
    return this.viewFileSuggestions
      .filter((suggestion) => {
        if (!query) {
          return true;
        }
        return (
          suggestion.hash.toLocaleLowerCase().includes(query) ||
          suggestion.filename.toLocaleLowerCase().includes(query) ||
          suggestion.messageType.toLocaleLowerCase().includes(query)
        );
      })
      .slice(0, VIEW_FILE_COMPLETION_LIMIT)
      .map((suggestion) => ({
        value: suggestion.hash,
        label: `#${suggestion.hash}`,
        description: `[${suggestion.messageType}] ${suggestion.filename}`
      }));
  }
}

class ChatAutocompleteProvider implements AutocompleteProvider {
  private inlineEmoticonCommandRequested = false;

  constructor(
    private readonly delegate: CombinedAutocompleteProvider,
    private readonly onInlineEmoticonCompletion: () => void
  ) {}

  requestInlineEmoticonCommand(): void {
    this.inlineEmoticonCommandRequested = true;
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean }
  ): Promise<AutocompleteSuggestions | null> {
    if (this.inlineEmoticonCommandRequested && !options.force) {
      this.inlineEmoticonCommandRequested = false;
      return { items: [EMOTICON_COMMAND_ITEM], prefix: INLINE_EMOTICON_COMPLETION_PREFIX };
    }
    this.inlineEmoticonCommandRequested = false;
    return this.delegate.getSuggestions(lines, cursorLine, cursorCol, options);
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    if (prefix === INLINE_EMOTICON_COMPLETION_PREFIX && item.value === EMOTICON_COMMAND_ITEM.value) {
      this.onInlineEmoticonCompletion();
      return { lines, cursorLine, cursorCol };
    }
    return this.delegate.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
  }

  shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean {
    return this.delegate.shouldTriggerFileCompletion(lines, cursorLine, cursorCol);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
