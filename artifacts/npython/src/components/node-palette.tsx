import { useState } from "react";
import {
  Play, Webhook, Clock, GitBranch, Code2, GitFork, RefreshCw,
  Variable, Database, Shuffle, Globe, Timer, StickyNote,
  ChevronDown, ChevronRight, LucideProps,
} from "lucide-react";
import { NODE_DEFINITIONS, NODE_CATEGORY_META, NodeCategory, NodeDef } from "@/lib/node-definitions";

const ICON_MAP: Record<string, React.FC<LucideProps>> = {
  Play, Webhook, Clock, GitBranch, Code2, GitFork, RefreshCw,
  Variable, Database, Shuffle, Globe, Timer, StickyNote,
};

const CATEGORY_ORDER: NodeCategory[] = ["trigger", "logic", "data", "integration", "utility"];

interface NodePaletteProps {
  onAddNode: (def: NodeDef) => void;
}

export function NodePalette({ onAddNode }: NodePaletteProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (cat: string) =>
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }));

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    meta: NODE_CATEGORY_META[cat],
    nodes: NODE_DEFINITIONS.filter((n) => n.category === cat),
  }));

  const handleDragStart = (e: React.DragEvent, def: NodeDef) => {
    e.dataTransfer.setData("application/flowpython-node", JSON.stringify(def));
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div
      style={{
        width: 220,
        height: "100%",
        background: "hsl(var(--card))",
        borderRight: "1px solid hsl(var(--border))",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          padding: "12px 14px 10px",
          borderBottom: "1px solid hsl(var(--border))",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: "hsl(var(--muted-foreground))",
          textTransform: "uppercase",
        }}
      >
        Nodes
      </div>

      {grouped.map(({ cat, meta, nodes }) => {
        const isOpen = !collapsed[cat];
        return (
          <div key={cat}>
            <button
              onClick={() => toggle(cat)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid hsl(var(--border))",
                cursor: "pointer",
                color: meta.color,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: meta.color,
                  flexShrink: 0,
                }}
              />
              {meta.label}
            </button>

            {isOpen && (
              <div style={{ padding: "4px 8px 8px" }}>
                {nodes.map((def) => {
                  const Icon = ICON_MAP[def.iconName] ?? Code2;
                  return (
                    <div
                      key={def.type}
                      draggable
                      onDragStart={(e) => handleDragStart(e, def)}
                      onClick={() => onAddNode(def)}
                      title={def.description}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "7px 8px",
                        borderRadius: 7,
                        cursor: "grab",
                        marginBottom: 2,
                        border: "1px solid transparent",
                        transition: "background 0.12s, border-color 0.12s",
                        userSelect: "none",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background = `${def.color}14`;
                        (e.currentTarget as HTMLDivElement).style.borderColor = `${def.color}33`;
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background = "transparent";
                        (e.currentTarget as HTMLDivElement).style.borderColor = "transparent";
                      }}
                    >
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 6,
                          background: `${def.color}22`,
                          border: `1px solid ${def.color}44`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Icon size={13} color={def.color} strokeWidth={2} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {def.label}
                        </div>
                        <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {def.description}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
