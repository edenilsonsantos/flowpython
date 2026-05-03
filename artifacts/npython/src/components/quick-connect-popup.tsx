import { useState, useEffect, useRef, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { NODE_DEFINITIONS, NODE_CATEGORY_META, NodeDef } from "@/lib/node-definitions";
import { Link2, Search, X } from "lucide-react";

// ── Context ──────────────────────────────────────────────────────────────────

export interface QuickConnectCtxValue {
  onAddAndConnect: (sourceId: string, nodeType: string) => void;
}

export const QuickConnectCtx = createContext<QuickConnectCtxValue>({
  onAddAndConnect: () => {},
});

// ── Popup component ───────────────────────────────────────────────────────────

interface QuickConnectPopupProps {
  sourceNodeId: string;
  anchorRect: DOMRect;
  onClose: () => void;
}

// Only node types that make sense as connection targets (no triggers)
const CONNECTABLE_DEFS: NodeDef[] = NODE_DEFINITIONS.filter(
  (d) => !d.type.startsWith("trigger_") && d.hasInput
);

// Group by category
const CATEGORY_ORDER = ["logic", "transform", "variables", "data", "integration", "utility", "database"] as const;

export function QuickConnectPopup({ sourceNodeId, anchorRect, onClose }: QuickConnectPopupProps) {
  const { onAddAndConnect } = useContext(QuickConnectCtx);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const q = query.toLowerCase().trim();
  const filtered = q
    ? CONNECTABLE_DEFS.filter((d) =>
        d.label.toLowerCase().includes(q) ||
        d.type.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q)
      )
    : CONNECTABLE_DEFS;

  // Group by category when no query; flat when searching
  const grouped: { category: string; defs: NodeDef[] }[] = [];
  if (q) {
    grouped.push({ category: "", defs: filtered });
  } else {
    for (const cat of CATEGORY_ORDER) {
      const defs = filtered.filter((d) => d.category === cat);
      if (defs.length) grouped.push({ category: cat, defs });
    }
  }

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose();
    };
    requestAnimationFrame(() => document.addEventListener("mousedown", handleClick));
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Position: to the right of the anchor, vertically centred
  const popupWidth = 290;
  const popupMaxH = 380;
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;

  let left = anchorRect.right + 10;
  if (left + popupWidth > viewW - 8) left = anchorRect.left - popupWidth - 10;

  let top = anchorRect.top - 20;
  if (top + popupMaxH > viewH - 8) top = viewH - popupMaxH - 8;
  if (top < 8) top = 8;

  const handleSelect = (def: NodeDef) => {
    onAddAndConnect(sourceNodeId, def.type);
    onClose();
  };

  return createPortal(
    <div
      ref={popupRef}
      style={{
        position: "fixed",
        left,
        top,
        width: popupWidth,
        maxHeight: popupMaxH,
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3)",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{
        padding: "10px 12px 8px",
        borderBottom: "1px solid hsl(var(--border))",
        display: "flex",
        alignItems: "center",
        gap: 7,
        flexShrink: 0,
      }}>
        <Link2 size={13} style={{ color: "#a78bfa", flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--foreground))", flex: 1 }}>
          Adicionar e conectar
        </span>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "hsl(var(--muted-foreground))" }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: "8px 12px", borderBottom: "1px solid hsl(var(--border))", flexShrink: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 7,
          background: "hsl(var(--background))",
          border: "1px solid hsl(var(--border))",
          borderRadius: 6, padding: "5px 10px",
        }}>
          <Search size={12} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar nodo..."
            style={{
              background: "none", border: "none", outline: "none",
              fontSize: 12, color: "hsl(var(--foreground))", flex: 1, width: "100%",
            }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "hsl(var(--muted-foreground))" }}>
              <X size={10} />
            </button>
          )}
        </div>
      </div>

      {/* Node list grouped by category */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "16px 12px", textAlign: "center", fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
            Nenhum nodo encontrado
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.category}>
              {group.category && (
                <div style={{
                  padding: "6px 12px 3px",
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: NODE_CATEGORY_META[group.category as keyof typeof NODE_CATEGORY_META]?.color ?? "hsl(var(--muted-foreground))",
                  borderBottom: "1px solid hsl(var(--border))",
                  background: "rgba(255,255,255,0.015)",
                }}>
                  {NODE_CATEGORY_META[group.category as keyof typeof NODE_CATEGORY_META]?.label ?? group.category}
                </div>
              )}
              {group.defs.map((def) => {
                const catMeta = NODE_CATEGORY_META[def.category];
                return (
                  <button
                    key={def.type}
                    onClick={() => handleSelect(def)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 9,
                      padding: "7px 12px", background: "transparent", border: "none",
                      cursor: "pointer", textAlign: "left",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                  >
                    {/* Icon dot */}
                    <div style={{
                      width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                      background: catMeta?.bg ?? "rgba(148,163,184,0.12)",
                      border: `1px solid ${def.color}44`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: def.color }} />
                    </div>

                    {/* Label + description */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 600, color: "hsl(var(--foreground))",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {def.label}
                      </div>
                      <div style={{
                        fontSize: 10, color: "hsl(var(--muted-foreground))",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {def.description}
                      </div>
                    </div>

                    <Link2 size={10} style={{ color: "#a78bfa", flexShrink: 0, opacity: 0.5 }} />
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Footer hint */}
      <div style={{
        padding: "5px 12px", borderTop: "1px solid hsl(var(--border))", flexShrink: 0,
        fontSize: 10, color: "hsl(var(--muted-foreground))", textAlign: "center",
      }}>
        Cria um novo nodo e conecta • Esc para fechar
      </div>
    </div>,
    document.body
  );
}
