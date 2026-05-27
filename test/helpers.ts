import type { RenderState, UiEvent, UiKey, WorkbenchRenderer } from "../src/types.js";

export class FakeRenderer implements WorkbenchRenderer {
  readonly states: RenderState[] = [];
  private onEvent?: (event: UiEvent) => void;
  private onClose?: () => void;

  start(onEvent: (event: UiEvent) => void, onClose: () => void): void {
    this.onEvent = onEvent;
    this.onClose = onClose;
  }

  stop(): void {
    this.onClose?.();
  }

  render(state: RenderState): void {
    this.states.push(structuredClone(state));
  }

  get latest(): RenderState {
    const state = this.states.at(-1);
    if (!state) {
      throw new Error("renderer has no state");
    }
    return state;
  }

  press(key: UiKey): void {
    this.onEvent?.({ type: "key", key });
  }

  emit(event: UiEvent): void {
    this.onEvent?.(event);
  }

  changeChat(text: string): void {
    this.onEvent?.({ type: "chat-change", text });
  }

  submitChat(text: string): void {
    this.onEvent?.({ type: "chat-submit", text });
  }
}

export const key = {
  text(value: string): UiKey {
    return { sequence: value };
  },
  enter(): UiKey {
    return { sequence: "\r", name: "return" };
  },
  escape(): UiKey {
    return { sequence: "\u001b", name: "escape" };
  },
  up(): UiKey {
    return { sequence: "\u001b[A", name: "up" };
  },
  down(): UiKey {
    return { sequence: "\u001b[B", name: "down" };
  }
};
