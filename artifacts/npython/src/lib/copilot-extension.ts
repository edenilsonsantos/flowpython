import { Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { keymap } from "@codemirror/view";

// ── Ghost text widget ────────────────────────────────────────────────────────

class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-copilot-ghost";
    span.textContent = this.text;
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }

  eq(other: GhostTextWidget): boolean {
    return this.text === other.text;
  }
}

// ── State effects and field ──────────────────────────────────────────────────

export const setSuggestionEffect = StateEffect.define<{ text: string; pos: number } | null>();

export const suggestionField = StateField.define<{ text: string; pos: number } | null>({
  create: () => null,
  update(current, tr) {
    for (const e of tr.effects) {
      if (e.is(setSuggestionEffect)) return e.value;
    }
    if (tr.docChanged || tr.selection) {
      return null;
    }
    return current;
  },
});

const ghostDecorationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decs, tr) {
    const suggestion = tr.state.field(suggestionField);
    if (!suggestion) return Decoration.none;

    const pos = tr.state.selection.main.head;
    if (pos !== suggestion.pos) return Decoration.none;

    return Decoration.set([
      Decoration.widget({
        widget: new GhostTextWidget(suggestion.text),
        side: 1,
      }).range(pos),
    ]);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Ghost text CSS ───────────────────────────────────────────────────────────

const ghostTextTheme = EditorView.baseTheme({
  ".cm-copilot-ghost": {
    color: "rgba(160, 160, 180, 0.45)",
    fontStyle: "italic",
    pointerEvents: "none",
    userSelect: "none",
  },
});

// ── Main extension factory ───────────────────────────────────────────────────

export type CopilotOptions = {
  enabled: () => boolean;
  onSuggest: (code: string, cursorPos: number, cursorLine: string) => Promise<string | null>;
};

export function copilotExtension(options: CopilotOptions): Extension {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSuggestion: string | null = null;
  let abortController: AbortController | null = null;

  const clearSuggestion = (view: EditorView) => {
    activeSuggestion = null;
    view.dispatch({ effects: setSuggestionEffect.of(null) });
  };

  const tabKey = keymap.of([
    {
      key: "Tab",
      run(view) {
        if (!activeSuggestion) return false;
        const pos = view.state.selection.main.head;
        view.dispatch({
          changes: { from: pos, insert: activeSuggestion },
          selection: { anchor: pos + activeSuggestion.length },
          effects: setSuggestionEffect.of(null),
        });
        activeSuggestion = null;
        return true;
      },
    },
    {
      key: "Escape",
      run(view) {
        if (!activeSuggestion) return false;
        clearSuggestion(view);
        return true;
      },
    },
  ]);

  const plugin = ViewPlugin.fromClass(
    class {
      update(upd: ViewUpdate) {
        if (!options.enabled()) {
          if (activeSuggestion) clearSuggestion(upd.view);
          return;
        }

        if (upd.docChanged || (upd.selectionSet && !upd.docChanged)) {
          if (debounceTimer) clearTimeout(debounceTimer);
          if (abortController) abortController.abort();

          if (activeSuggestion) {
            activeSuggestion = null;
            upd.view.dispatch({ effects: setSuggestionEffect.of(null) });
          }

          if (!upd.docChanged) return;

          debounceTimer = setTimeout(async () => {
            if (!options.enabled()) return;

            const state = upd.view.state;
            const pos = state.selection.main.head;
            const code = state.doc.toString();
            const line = state.doc.lineAt(pos);
            const cursorLine = line.text;

            if (!cursorLine.trim() || cursorLine.trim().startsWith("#")) return;
            if (cursorLine.endsWith("\\")) return;

            abortController = new AbortController();
            try {
              const suggestion = await options.onSuggest(code, pos, cursorLine);
              if (suggestion && suggestion.trim()) {
                activeSuggestion = suggestion;
                upd.view.dispatch({
                  effects: setSuggestionEffect.of({ text: suggestion, pos }),
                });
              }
            } catch {
            }
          }, 650);
        }
      }

      destroy() {
        if (debounceTimer) clearTimeout(debounceTimer);
        if (abortController) abortController.abort();
      }
    }
  );

  return [suggestionField, ghostDecorationField, ghostTextTheme, tabKey, plugin];
}
