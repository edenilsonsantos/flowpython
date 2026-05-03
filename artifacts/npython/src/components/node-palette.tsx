import { useState } from "react";
import {
  Play, Webhook, Clock, GitBranch, Code2, GitFork, RefreshCw,
  Variable, Database, Shuffle, Globe, Timer, StickyNote,
  ChevronDown, ChevronRight, Braces, Syringe, Package,
  ToggleRight, GitMerge, ListFilter, Layers, Sigma, Scissors,
  ArrowUpDown, FilterX, Hash, Search, Plus, PenLine, Trash2, LucideProps,
} from "lucide-react";
import { NODE_DEFINITIONS, NODE_CATEGORY_META, NodeCategory, NodeDef } from "@/lib/node-definitions";

const ICON_MAP: Record<string, React.FC<LucideProps>> = {
  Play, Webhook, Clock, GitBranch, Code2, GitFork, RefreshCw,
  Variable, Database, Shuffle, Globe, Timer, StickyNote, Braces, Syringe, Package,
  ToggleRight, GitMerge, ListFilter, Layers, Sigma, Scissors,
  ArrowUpDown, FilterX, Hash, Search, Plus, PenLine, Trash2,
};

const CATEGORY_ORDER: NodeCategory[] = ["trigger", "logic", "transform", "variables", "data", "integration", "database", "utility"];

interface NodePaletteProps {
  onAddNode: (def: NodeDef) => void;
}

const DB_SUB_ORDER = ["PostgreSQL", "MySQL", "SQL Server", "Oracle", "Supabase"];

function NodeItem({ def, onDragStart, onAddNode }: { def: NodeDef; onDragStart: (e: React.DragEvent, def: NodeDef) => void; onAddNode: (def: NodeDef) => void }) {
  const Icon = ICON_MAP[def.iconName] ?? Code2;
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, def)}
      onClick={() => onAddNode(def)}
      title={def.description}
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 7, cursor: "grab", marginBottom: 2, border: "1px solid transparent", transition: "background 0.12s, border-color 0.12s", userSelect: "none" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = `${def.color}14`; (e.currentTarget as HTMLDivElement).style.borderColor = `${def.color}33`; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; (e.currentTarget as HTMLDivElement).style.borderColor = "transparent"; }}
    >
      <div style={{ width: 26, height: 26, borderRadius: 6, background: `${def.color}22`, border: `1px solid ${def.color}44`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={13} color={def.color} strokeWidth={2} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{def.label}</div>
        <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{def.description}</div>
      </div>
    </div>
  );
}

export function NodePalette({ onAddNode }: NodePaletteProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ data: true });
  const [collapsedSubs, setCollapsedSubs] = useState<Record<string, boolean>>({});

  const toggle = (cat: string) => setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }));
  const toggleSub = (sub: string) => setCollapsedSubs((prev) => ({ ...prev, [sub]: !prev[sub] }));

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

        // ── Database: render with sub-groups ─────────────────────
        if (cat === "database") {
          const subMap = new Map<string, NodeDef[]>();
          nodes.forEach((n) => {
            const sub = n.subCategory ?? "Other";
            if (!subMap.has(sub)) subMap.set(sub, []);
            subMap.get(sub)!.push(n);
          });
          const orderedSubs = DB_SUB_ORDER.filter((s) => subMap.has(s));

          return (
            <div key={cat}>
              <button onClick={() => toggle(cat)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "transparent", border: "none", borderBottom: "1px solid hsl(var(--border))", cursor: "pointer", color: meta.color, fontSize: 12, fontWeight: 600 }}>
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
                {meta.label}
              </button>
              {isOpen && (
                <div style={{ paddingBottom: 4 }}>
                  {orderedSubs.map((sub) => {
                    const subNodes = subMap.get(sub)!;
                    const subColor = subNodes[0]?.color ?? meta.color;
                    const isSubOpen = collapsedSubs[sub] !== true;
                    return (
                      <div key={sub}>
                        <button onClick={() => toggleSub(sub)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 5, padding: "5px 14px 5px 18px", background: "transparent", border: "none", borderBottom: "1px solid hsl(var(--border))", cursor: "pointer", color: subColor, fontSize: 11, fontWeight: 600 }}>
                          {isSubOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: subColor, flexShrink: 0 }} />
                          {sub}
                        </button>
                        {isSubOpen && (
                          <div style={{ padding: "2px 6px 4px 14px" }}>
                            {subNodes.map((def) => (
                              <NodeItem key={def.type} def={def} onDragStart={handleDragStart} onAddNode={onAddNode} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        }

        // ── Regular categories ────────────────────────────────────
        return (
          <div key={cat}>
            <button
              onClick={() => toggle(cat)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "transparent", border: "none", borderBottom: "1px solid hsl(var(--border))", cursor: "pointer", color: meta.color, fontSize: 12, fontWeight: 600 }}
            >
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
              {meta.label}
              {cat === "data" && (
                <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", marginLeft: "auto", fontWeight: 400 }}>legado</span>
              )}
            </button>
            {isOpen && (
              <div style={{ padding: "4px 8px 8px" }}>
                {nodes.map((def) => (
                  <NodeItem key={def.type} def={def} onDragStart={handleDragStart} onAddNode={onAddNode} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
