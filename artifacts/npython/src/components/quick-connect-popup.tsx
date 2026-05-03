import { useState, useEffect, useRef, createContext, useContext, useCallback } from "react";
import { createPortal } from "react-dom";
import { Node as ReactFlowNode } from "reactflow";
import { getNodeDef, NODE_CATEGORY_META } from "@/lib/node-definitions";
import { Link2, Search, X } from "lucide-react";

// ── Context ──────────────────────────────────────────────────────────────────

export interface QuickConnectCtxValue {
  nodes: ReactFlowNode[];
  edges: { source: string; target: string }[];
  onQuickConnect: (sourceId: string, targetId: string) => void;
}

export const QuickConnectCtx = createContext<QuickConnectCtxValue>({
  nodes: [],
  edges: [],
  onQuickConnect: () => {},
});

// ── Popup component ───────────────────────────────────────────────────────────

interface QuickConnectPopupProps {
  sourceNodeId: string;
  anchorRect: DOMRect;
  onClose: () => void;
}

export function QuickConnectPopup({ sourceNodeId, anchorRect, onClose }: QuickConnectPopupProps) {
  const { nodes, edges, onQuickConnect } = useContext(QuickConnectCtx);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const alreadyConnected = new Set(
    edges.filter((e) => e.source === sourceNodeId).map((e) => e.target)
  );

  const filtered = nodes.filter((n) => {
    if (n.id === sourceNodeId) return false;
    if (!query.trim()) return true;
    const label = ((n.data.label as string) ?? "").toLowerCase();
    const type = ((n.data.type as string) ?? "").toLowerCase();
    const q = query.toLowerCase();
    return label.includes(q) || type.includes(q);
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    requestAnimationFrame(() => {
      document.addEventListener("mousedown", handleClick);
    });
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Position: to the right of the anchor, vertically centred
  const popupWidth = 280;
  const popupMaxH = 340;
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;

  let left = anchorRect.right + 8;
  if (left + popupWidth > viewW - 8) left = anchorRect.left - popupWidth - 8;

  let top = anchorRect.top - 16;
  if (top + popupMaxH > viewH - 8) top = viewH - popupMaxH - 8;
  if (top < 8) top = 8;

  const handleConnect = (targetId: string) => {
    onQuickConnect(sourceNodeId, targetId);
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
        boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
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
          Conectar a...
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

      {/* Node list */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "16px 12px", textAlign: "center", fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
            Nenhum nodo encontrado
          </div>
        ) : (
          filtered.map((node) => {
            const def = getNodeDef(node.data.type as string);
            const color = def?.color ?? "#94a3b8";
            const catMeta = def ? NODE_CATEGORY_META[def.category] : null;
            const label = (node.data.label as string) ?? (def?.label ?? "Nodo");
            const isConnected = alreadyConnected.has(node.id);

            return (
              <button
                key={node.id}
                onClick={() => !isConnected && handleConnect(node.id)}
                disabled={isConnected}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 9,
                  padding: "8px 12px", background: "transparent", border: "none",
                  cursor: isConnected ? "default" : "pointer", textAlign: "left",
                  opacity: isConnected ? 0.5 : 1,
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => { if (!isConnected) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >
                {/* Color dot */}
                <div style={{
                  width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                  background: catMeta?.bg ?? "rgba(148,163,184,0.12)",
                  border: `1px solid ${color}44`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                </div>

                {/* Label + type */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: "hsl(var(--foreground))",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 10, color, fontWeight: 500 }}>
                    {def?.category?.toUpperCase() ?? "NODE"}
                  </div>
                </div>

                {isConnected ? (
                  <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700, flexShrink: 0 }}>✓ Ligado</span>
                ) : (
                  <Link2 size={11} style={{ color: "#a78bfa", flexShrink: 0, opacity: 0.6 }} />
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Footer hint */}
      <div style={{
        padding: "6px 12px", borderTop: "1px solid hsl(var(--border))", flexShrink: 0,
        fontSize: 10, color: "hsl(var(--muted-foreground))", textAlign: "center",
      }}>
        Clique para conectar • Esc para fechar
      </div>
    </div>,
    document.body
  );
}

// ── Hook used by CanvasNode ──────────────────────────────────────────────────

export function useQuickConnect(nodeId: string) {
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const open = useCallback(() => {
    if (btnRef.current) {
      setAnchorRect(btnRef.current.getBoundingClientRect());
    }
  }, []);

  const close = useCallback(() => setAnchorRect(null), []);

  return { btnRef, anchorRect, open, close };
}
