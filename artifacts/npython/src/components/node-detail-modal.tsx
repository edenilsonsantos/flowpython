import { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Node as ReactFlowNode, Edge as ReactFlowEdge } from "reactflow";
import { X, Search, Play, Loader2, ChevronRight, ChevronDown, Info, AlertTriangle, Pin, PinOff } from "lucide-react";
import {
  NodeConfigPanel,
  NodeOutputMap,
  nodeColorFromId,
  insertVarRef,
  VarColorCtx,
  VarColorInfo,
} from "@/components/node-config-panel";
import { getNodeDef } from "@/lib/node-definitions";
import { useToast } from "@/hooks/use-toast";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ValueKind = "string" | "number" | "boolean" | "null" | "array" | "object";
function kindOf(v: unknown): ValueKind {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "string") return "string";
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  return "object";
}

const KIND_META: Record<ValueKind, { color: string; tag: string; symbol: string }> = {
  string:  { color: "#34d399", tag: "T",  symbol: "T" },
  number:  { color: "#60a5fa", tag: "#",  symbol: "#" },
  boolean: { color: "#f472b6", tag: "✓",  symbol: "✓" },
  null:    { color: "#94a3b8", tag: "○",  symbol: "○" },
  array:   { color: "#f59e0b", tag: "[]", symbol: "[]" },
  object:  { color: "#a78bfa", tag: "{}", symbol: "{}" },
};

function shortPreview(v: unknown, max = 56): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `${v.length} item${v.length !== 1 ? "s" : ""}`;
  if (typeof v === "object") return `${Object.keys(v as object).length} key${Object.keys(v as object).length !== 1 ? "s" : ""}`;
  const s = String(v);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// Build a Python `pipeline["x"][...]` expression from a path of segments.
// All upstream variables live in the shared `pipeline` dict regardless of
// which node produced them, so the node label is informational only and is
// intentionally not emitted into the generated code.
function buildVarRef(_nodeLabel: string, path: (string | number)[]): string {
  if (path.length === 0) return "pipeline";
  let ref = "pipeline";
  for (const seg of path) {
    if (typeof seg === "number") {
      ref += `[${seg}]`;
    } else {
      // Always use bracket + JSON-quoted key so it works for any name
      // (including ones with hyphens, dots, spaces, reserved words).
      ref += `[${JSON.stringify(seg)}]`;
    }
  }
  return ref;
}

// ─── Schema tree row ──────────────────────────────────────────────────────────

interface SchemaNodeProps {
  name: string | number;
  value: unknown;
  path: (string | number)[];
  nodeLabel: string;
  nodeColor: string;
  depth: number;
  query: string;
  onInsert: (ref: string) => void;
  defaultOpen?: boolean;
}

function matchesQuery(name: string, value: unknown, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (String(name).toLowerCase().includes(q)) return true;
  const k = kindOf(value);
  if (k === "string" || k === "number" || k === "boolean") {
    return String(value).toLowerCase().includes(q);
  }
  if (k === "array" || k === "object") {
    const entries = Array.isArray(value)
      ? (value as unknown[]).map((v, i) => [i, v] as [number, unknown])
      : Object.entries(value as object);
    return entries.some(([k2, v2]) => matchesQuery(String(k2), v2, q));
  }
  return false;
}

function SchemaNode({ name, value, path, nodeLabel, nodeColor, depth, query, onInsert, defaultOpen }: SchemaNodeProps) {
  const k = kindOf(value);
  const meta = KIND_META[k];
  const isExpandable = k === "array" || k === "object";
  const [open, setOpen] = useState(defaultOpen ?? depth < 2);

  if (query && !matchesQuery(String(name), value, query)) return null;

  const ref = buildVarRef(nodeLabel, path);
  const handleDrag = (e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.setData("application/flowpython-var", ref);
    e.dataTransfer.setData("text/plain", ref);
    e.dataTransfer.effectAllowed = "copy";
  };
  const handleClick = () => onInsert(ref);

  const indent = 8 + depth * 14;

  return (
    <div>
      <div
        draggable
        onDragStart={handleDrag}
        onClick={handleClick}
        title={`Clique ou arraste\n${ref}`}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: `4px 8px 4px ${indent}px`,
          cursor: "grab", borderRadius: 4,
          fontSize: 11, lineHeight: 1.35, userSelect: "none",
          borderLeft: `2px solid transparent`,
          transition: "background 0.1s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = `${nodeColor}14`; e.currentTarget.style.borderLeftColor = nodeColor; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderLeftColor = "transparent"; }}
      >
        {isExpandable ? (
          <button
            onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center" }}
          >
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        ) : (
          <span style={{ width: 11, flexShrink: 0 }} />
        )}
        <span style={{
          fontFamily: "monospace", fontSize: 10, fontWeight: 700,
          color: meta.color, background: `${meta.color}1a`,
          width: 18, textAlign: "center", borderRadius: 3, padding: "0 2px",
          flexShrink: 0,
        }}>{meta.symbol}</span>
        <span style={{
          fontFamily: "monospace", fontWeight: 600, color: "hsl(var(--foreground))",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          flexShrink: 0, maxWidth: 180,
        }}>{name}</span>
        {!isExpandable || !open ? (
          <span style={{
            fontFamily: "monospace", fontSize: 10, color: "hsl(var(--muted-foreground))",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0,
          }}>{shortPreview(value)}</span>
        ) : (
          <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", flex: 1 }}>
            {Array.isArray(value) ? `${value.length} item${value.length !== 1 ? "s" : ""}` : `${Object.keys(value as object).length} key${Object.keys(value as object).length !== 1 ? "s" : ""}`}
          </span>
        )}
      </div>
      {isExpandable && open && (
        <ChildrenList
          value={value}
          path={path}
          nodeLabel={nodeLabel}
          nodeColor={nodeColor}
          depth={depth + 1}
          query={query}
          onInsert={onInsert}
        />
      )}
    </div>
  );
}

function ChildrenList({
  value, path, nodeLabel, nodeColor, depth, query, onInsert,
}: {
  value: unknown;
  path: (string | number)[];
  nodeLabel: string;
  nodeColor: string;
  depth: number;
  query: string;
  onInsert: (ref: string) => void;
}) {
  const PAGE = 50;
  const [shown, setShown] = useState(PAGE);
  const entries: Array<[string | number, unknown]> = Array.isArray(value)
    ? (value as unknown[]).map((v, i) => [i, v])
    : Object.entries(value as Record<string, unknown>);
  const visible = entries.slice(0, shown);
  return (
    <div>
      {visible.map(([k, v]) => (
        <SchemaNode key={String(k)} name={k} value={v} path={[...path, k]}
          nodeLabel={nodeLabel} nodeColor={nodeColor} depth={depth}
          query={query} onInsert={onInsert} />
      ))}
      {entries.length > shown && (
        <button
          onClick={() => setShown((s) => s + PAGE)}
          style={{
            marginLeft: 8 + depth * 14, marginTop: 4, marginBottom: 4,
            padding: "3px 10px", fontSize: 10, fontWeight: 600,
            background: "rgba(255,255,255,0.04)", color: "hsl(var(--muted-foreground))",
            border: "1px solid hsl(var(--border))", borderRadius: 4, cursor: "pointer",
          }}
        >+ Mostrar mais ({entries.length - shown})</button>
      )}
    </div>
  );
}

// ─── Schema/Table/JSON tabs view ─────────────────────────────────────────────

type ViewMode = "schema" | "table" | "json";

function DataTabs({ mode, onChange, side }: { mode: ViewMode; onChange: (m: ViewMode) => void; side: "input" | "output" }) {
  const tabs: { id: ViewMode; label: string }[] = [
    { id: "schema", label: "Schema" },
    { id: "table", label: "Table" },
    { id: "json", label: "JSON" },
  ];
  const accent = side === "input" ? "#60a5fa" : "#34d399";
  return (
    <div style={{ display: "flex", gap: 0, padding: "4px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            padding: "5px 14px", border: "none",
            background: mode === t.id ? accent : "transparent",
            color: mode === t.id ? "#000" : "hsl(var(--muted-foreground))",
            fontSize: 11, fontWeight: 600, cursor: "pointer", borderRadius: 5,
            transition: "all 0.12s",
          }}
        >{t.label}</button>
      ))}
    </div>
  );
}

function TableView({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <div style={{ padding: 20, fontSize: 12, color: "hsl(var(--muted-foreground))", textAlign: "center" }}>Sem dados</div>;
  }
  return (
    <div style={{ padding: 4 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid hsl(var(--border))" }}>
            <th style={{ textAlign: "left", padding: "6px 8px", color: "hsl(var(--muted-foreground))", fontWeight: 600 }}>Key</th>
            <th style={{ textAlign: "left", padding: "6px 8px", color: "hsl(var(--muted-foreground))", fontWeight: 600 }}>Type</th>
            <th style={{ textAlign: "left", padding: "6px 8px", color: "hsl(var(--muted-foreground))", fontWeight: 600 }}>Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([k, v]) => {
            const kind = kindOf(v);
            const meta = KIND_META[kind];
            return (
              <tr key={k} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ padding: "5px 8px", fontWeight: 600, color: "hsl(var(--foreground))", verticalAlign: "top" }}>{k}</td>
                <td style={{ padding: "5px 8px", verticalAlign: "top" }}>
                  <span style={{ color: meta.color, fontSize: 10 }}>{kind}</span>
                </td>
                <td style={{ padding: "5px 8px", color: "hsl(var(--muted-foreground))", wordBreak: "break-all" }}>
                  {kind === "object" || kind === "array"
                    ? <pre style={{ margin: 0, fontSize: 10 }}>{JSON.stringify(v, null, 2)}</pre>
                    : String(v)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function JsonView({ data }: { data: unknown }) {
  return (
    <pre style={{
      margin: 0, padding: 12, fontSize: 11, fontFamily: "monospace",
      background: "rgba(0,0,0,0.25)", color: "#e2e8f0",
      whiteSpace: "pre-wrap", wordBreak: "break-all",
    }}>{JSON.stringify(data, null, 2)}</pre>
  );
}

// ─── INPUT panel: tree of all upstream nodes ──────────────────────────────────

function InputPanel({
  nodeId, nodes, edges, lastRunOutputs, onInsert, mode, query,
}: {
  nodeId: string;
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];
  lastRunOutputs: NodeOutputMap;
  onInsert: (ref: string) => void;
  mode: ViewMode;
  query: string;
}) {
  // Find ancestors via BFS over edges
  const ancestors = useMemo(() => {
    const set = new Set<string>();
    const queue = [nodeId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of edges) {
        if (e.target === cur && !set.has(e.source)) {
          set.add(e.source); queue.push(e.source);
        }
      }
    }
    return set;
  }, [nodeId, edges]);

  const upstreamNodes = useMemo(() => {
    return nodes
      .filter((n) => ancestors.has(n.id))
      .map((n) => ({
        id: n.id,
        label: n.data.label as string,
        output: lastRunOutputs[n.id]?.pipeline ?? null,
        status: lastRunOutputs[n.id]?.status,
      }));
  }, [nodes, ancestors, lastRunOutputs]);

  const [openNodes, setOpenNodes] = useState<Record<string, boolean>>({});
  // Auto-open first 3 nodes on mount
  useEffect(() => {
    const initial: Record<string, boolean> = {};
    upstreamNodes.slice(0, 3).forEach((n) => { initial[n.id] = true; });
    setOpenNodes(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  if (upstreamNodes.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 12 }}>
        <Info size={28} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Sem nodos anteriores</div>
        <div style={{ fontSize: 11 }}>Conecte um nodo a montante para ver suas variáveis aqui.</div>
      </div>
    );
  }

  if (mode === "json") {
    const merged: Record<string, unknown> = {};
    for (const n of upstreamNodes) {
      merged[n.label] = n.output ?? {};
    }
    return <JsonView data={merged} />;
  }

  if (mode === "table") {
    return (
      <div>
        {upstreamNodes.map((n) => (
          <div key={n.id} style={{ marginBottom: 12 }}>
            <div style={{
              padding: "6px 10px", fontSize: 11, fontWeight: 700,
              color: nodeColorFromId(n.id), background: `${nodeColorFromId(n.id)}10`,
              borderLeft: `3px solid ${nodeColorFromId(n.id)}`,
            }}>{n.label}</div>
            {n.output ? <TableView data={n.output} /> : (
              <div style={{ padding: 10, fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                Nodo ainda não executado.
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Schema mode
  return (
    <div>
      {upstreamNodes.map((n) => {
        const isOpen = openNodes[n.id] ?? false;
        const color = nodeColorFromId(n.id);
        const itemCount = n.output ? Object.keys(n.output).length : 0;
        return (
          <div key={n.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <button
              onClick={() => setOpenNodes((p) => ({ ...p, [n.id]: !isOpen }))}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 6,
                padding: "8px 10px", background: isOpen ? `${color}10` : "transparent",
                border: "none", borderLeft: `3px solid ${isOpen ? color : "transparent"}`,
                cursor: "pointer", color: "hsl(var(--foreground))", textAlign: "left",
                fontSize: 12, fontWeight: 600, transition: "all 0.12s",
              }}
            >
              {isOpen ? <ChevronDown size={12} color={color} /> : <ChevronRight size={12} color={color} />}
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {n.label}
              </span>
              <span style={{
                fontSize: 9, padding: "1px 6px", borderRadius: 8,
                background: `${color}22`, color, fontWeight: 700,
              }}>
                {n.output ? `${itemCount} item${itemCount !== 1 ? "s" : ""}` : "no run"}
              </span>
            </button>
            {isOpen && (
              <div style={{ padding: "4px 0 8px" }}>
                {n.output && Object.keys(n.output).length > 0 ? (
                  Object.entries(n.output).map(([k, v]) => (
                    <SchemaNode key={k} name={k} value={v} path={[k]}
                      nodeLabel={n.label} nodeColor={color} depth={0}
                      query={query} onInsert={onInsert} defaultOpen={false} />
                  ))
                ) : (
                  <div style={{ padding: "8px 14px", fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                    {n.output ? "Nodo executou mas não produziu variáveis." : "Execute o workflow para ver dados aqui."}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── OUTPUT panel ─────────────────────────────────────────────────────────────

function OutputPanel({
  nodeId, nodeLabel, lastRunOutputs, mode, query, onInsert,
}: {
  nodeId: string;
  nodeLabel: string;
  lastRunOutputs: NodeOutputMap;
  mode: ViewMode;
  query: string;
  onInsert: (ref: string) => void;
}) {
  const out = lastRunOutputs[nodeId];

  if (!out) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 12 }}>
        <Info size={28} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Nenhuma execução</div>
        <div style={{ fontSize: 11 }}>Clique em "Executar nodo" acima para gerar uma saída.</div>
      </div>
    );
  }

  const data = out.pipeline ?? {};
  const color = nodeColorFromId(nodeId);

  if (mode === "json") return <JsonView data={data} />;
  if (mode === "table") return <TableView data={data} />;

  // Schema
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return (
      <div style={{ padding: 20, fontSize: 12, color: "hsl(var(--muted-foreground))", textAlign: "center" }}>
        Nodo executou mas não produziu variáveis.
      </div>
    );
  }
  return (
    <div style={{ padding: "4px 0" }}>
      {entries.map(([k, v]) => (
        <SchemaNode key={k} name={k} value={v} path={[k]}
          nodeLabel={nodeLabel} nodeColor={color} depth={0}
          query={query} onInsert={onInsert} defaultOpen={false} />
      ))}
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function NodeDetailModal({
  open, onClose, node, workflowId, nodes, edges, lastRunOutputs,
  onUpdateData, onUpdateConfig, onTestNode, testLoading, testResult, onRefreshOutputs,
  nodeLogs,
}: {
  open: boolean;
  onClose: () => void;
  node: ReactFlowNode | null;
  workflowId: string;
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];
  lastRunOutputs: NodeOutputMap;
  onUpdateData: (k: string, v: unknown) => void;
  onUpdateConfig: (k: string, v: unknown) => void;
  onTestNode: () => void;
  testLoading: boolean;
  testResult: { output: string; success: boolean; durationMs: number; pipeline?: Record<string, unknown> | null } | null;
  onRefreshOutputs: () => void;
  /** Optional per-node execution logs (rendered below OUTPUT). Used in the executions debugger. */
  nodeLogs?: { id: string; level: string; message: string; timestamp: string }[];
}) {
  const { toast } = useToast();
  const [inputMode, setInputMode] = useState<ViewMode>("schema");
  const [outputMode, setOutputMode] = useState<ViewMode>("schema");
  const [centerTab, setCenterTab] = useState<"params" | "settings">("params");
  const [inputQuery, setInputQuery] = useState("");
  const [outputQuery, setOutputQuery] = useState("");
  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Refresh outputs whenever modal opens for a node
  useEffect(() => {
    if (open && node) onRefreshOutputs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, node?.id]);

  const handleInsert = useCallback((ref: string) => insertVarRef(ref, toast), [toast]);

  // Build a varColorMap of pipeline["x"] refs colored by the originating node
  const varColorMap = useMemo<Record<string, VarColorInfo>>(() => {
    const map: Record<string, VarColorInfo> = {};
    for (const [id, out] of Object.entries(lastRunOutputs)) {
      const color = nodeColorFromId(id);
      for (const varName of Object.keys(out.pipeline)) {
        if (!map[varName]) map[varName] = { color, nodeLabel: out.label, nodeId: id };
      }
    }
    return map;
  }, [lastRunOutputs]);

  if (!open || !node) return null;

  const def = getNodeDef(node.data.type as string);
  const nodeLabel = node.data.label as string;
  const status = lastRunOutputs[node.id]?.status;

  const modal = (
    <VarColorCtx.Provider value={varColorMap}>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)",
          backdropFilter: "blur(2px)", zIndex: 1000,
          display: "flex", alignItems: "stretch", justifyContent: "center",
          padding: "2vh 1vw",
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "100%", maxWidth: 1600, height: "96vh",
            background: "hsl(var(--background))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 10, display: "flex", flexDirection: "column",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)", overflow: "hidden",
          }}
        >
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px", borderBottom: "1px solid hsl(var(--border))",
            background: "hsl(var(--card))", flexShrink: 0,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: `${def?.color ?? "#94a3b8"}22`,
              border: `1px solid ${def?.color ?? "#94a3b8"}55`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: def?.color ?? "#94a3b8", fontSize: 13, fontWeight: 700,
              flexShrink: 0,
            }}>
              {def?.label?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {nodeLabel}
              </div>
              <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
                {def?.label ?? node.data.type as string} • {def?.description ?? ""}
              </div>
            </div>
            {status && (
              <span style={{
                fontSize: 10, padding: "3px 8px", borderRadius: 10, fontWeight: 700,
                color: status === "success" ? "#10b981" : status === "failed" ? "#ef4444" : "#94a3b8",
                background: status === "success" ? "rgba(16,185,129,0.15)" : status === "failed" ? "rgba(239,68,68,0.15)" : "rgba(148,163,184,0.15)",
                border: `1px solid ${status === "success" ? "rgba(16,185,129,0.4)" : status === "failed" ? "rgba(239,68,68,0.4)" : "rgba(148,163,184,0.4)"}`,
              }}>last: {status}</span>
            )}
            <button
              onClick={onClose}
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                color: "hsl(var(--muted-foreground))", padding: 6, borderRadius: 4,
                display: "flex", alignItems: "center",
              }}
            ><X size={18} /></button>
          </div>

          {/* 3-column body */}
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1.2fr 1fr", minHeight: 0, overflow: "hidden" }}>
            {/* INPUT */}
            <div style={{
              borderRight: "1px solid hsl(var(--border))",
              display: "flex", flexDirection: "column", minHeight: 0,
              background: "rgba(96,165,250,0.02)",
            }}>
              <div style={{
                padding: "10px 14px 8px", borderBottom: "1px solid hsl(var(--border))",
                display: "flex", flexDirection: "column", gap: 8, flexShrink: 0,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "#60a5fa" }}>INPUT</span>
                  <span style={{ flex: 1 }} />
                  <DataTabs mode={inputMode} onChange={setInputMode} side="input" />
                </div>
                <div style={{ position: "relative" }}>
                  <Search size={11} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "hsl(var(--muted-foreground))" }} />
                  <input
                    value={inputQuery}
                    onChange={(e) => setInputQuery(e.target.value)}
                    placeholder="Buscar variáveis..."
                    style={{
                      width: "100%", height: 26, padding: "0 8px 0 24px",
                      background: "hsl(var(--background))", border: "1px solid hsl(var(--border))",
                      borderRadius: 5, color: "hsl(var(--foreground))", fontSize: 11, outline: "none",
                    }}
                  />
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
                <InputPanel
                  nodeId={node.id}
                  nodes={nodes}
                  edges={edges}
                  lastRunOutputs={lastRunOutputs}
                  onInsert={handleInsert}
                  mode={inputMode}
                  query={inputQuery}
                />
              </div>
            </div>

            {/* PARAMETERS / SETTINGS */}
            <div style={{
              display: "flex", flexDirection: "column", minHeight: 0,
              borderRight: "1px solid hsl(var(--border))",
            }}>
              <div style={{
                padding: "8px 14px", borderBottom: "1px solid hsl(var(--border))",
                display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                background: "hsl(var(--card))",
              }}>
                {([
                  { id: "params" as const, label: "Parameters" },
                  { id: "settings" as const, label: "Settings" },
                ]).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setCenterTab(t.id)}
                    style={{
                      padding: "5px 14px", border: "none", background: "transparent",
                      borderBottom: centerTab === t.id ? "2px solid #f97316" : "2px solid transparent",
                      color: centerTab === t.id ? "#f97316" : "hsl(var(--muted-foreground))",
                      fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: -1,
                    }}
                  >{t.label}</button>
                ))}
                <div style={{ flex: 1 }} />
                <button
                  onClick={onTestNode}
                  disabled={testLoading}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "5px 12px", borderRadius: 5,
                    background: testLoading ? "rgba(239,68,68,0.4)" : "#ef4444",
                    color: "#fff", fontSize: 11, fontWeight: 700,
                    border: "none", cursor: testLoading ? "wait" : "pointer",
                  }}
                >
                  {testLoading ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                  Executar nodo
                </button>
              </div>
              <div
                style={{ flex: 1, overflowY: "auto", padding: 14 }}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("application/flowpython-var")) e.preventDefault();
                }}
                onDrop={(e) => {
                  const ref = e.dataTransfer.getData("application/flowpython-var");
                  if (!ref) return;
                  e.preventDefault();
                  insertVarRef(ref, toast);
                }}
              >
                {centerTab === "params" ? (
                  <NodeConfigPanel
                    node={node}
                    workflowId={workflowId}
                    onUpdateData={onUpdateData}
                    onUpdateConfig={onUpdateConfig}
                    onTestNode={onTestNode}
                    testLoading={testLoading}
                    testResult={testResult}
                  />
                ) : (
                  <SettingsTab node={node} onUpdateData={onUpdateData} onUpdateConfig={onUpdateConfig} />
                )}
              </div>
            </div>

            {/* OUTPUT */}
            <div style={{
              display: "flex", flexDirection: "column", minHeight: 0,
              background: "rgba(52,211,153,0.02)",
            }}>
              <div style={{
                padding: "10px 14px 8px", borderBottom: "1px solid hsl(var(--border))",
                display: "flex", flexDirection: "column", gap: 8, flexShrink: 0,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "#34d399" }}>OUTPUT</span>
                  {status === "failed" && (
                    <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "#ef4444" }}>
                      <AlertTriangle size={11} /> erro
                    </span>
                  )}
                  {(() => {
                    const cfg = (node.data.config as Record<string, unknown>) ?? {};
                    const isPinned = cfg.pinned === true;
                    const lastOut = lastRunOutputs[node.id]?.pipeline;
                    const canPin = !isPinned && !!lastOut && Object.keys(lastOut).length > 0;
                    return isPinned ? (
                      <button
                        onClick={() => { onUpdateConfig("pinned", false); toast({ title: "Pin removido" }); }}
                        title="Remover pin (volta a executar normalmente)"
                        style={{
                          display: "flex", alignItems: "center", gap: 4,
                          fontSize: 10, fontWeight: 700, color: "#f59e0b",
                          background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.4)",
                          borderRadius: 4, padding: "2px 7px", cursor: "pointer",
                        }}
                      >
                        <PinOff size={10} /> PINNED
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          if (!canPin) { toast({ title: "Sem dados", description: "Execute o nodo antes de fixar o output.", variant: "destructive" }); return; }
                          onUpdateConfig("pinnedData", lastOut);
                          onUpdateConfig("pinned", true);
                          toast({ title: "Output fixado", description: "Próximas execuções usarão estes dados mockados." });
                        }}
                        title="Fixar dados atuais como output mockado"
                        disabled={!canPin}
                        style={{
                          display: "flex", alignItems: "center", gap: 4,
                          fontSize: 10, fontWeight: 600,
                          color: canPin ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                          background: "transparent",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 4, padding: "2px 7px",
                          cursor: canPin ? "pointer" : "not-allowed", opacity: canPin ? 1 : 0.5,
                        }}
                      >
                        <Pin size={10} /> Fixar
                      </button>
                    );
                  })()}
                  <span style={{ flex: 1 }} />
                  <DataTabs mode={outputMode} onChange={setOutputMode} side="output" />
                </div>
                <div style={{ position: "relative" }}>
                  <Search size={11} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "hsl(var(--muted-foreground))" }} />
                  <input
                    value={outputQuery}
                    onChange={(e) => setOutputQuery(e.target.value)}
                    placeholder="Buscar..."
                    style={{
                      width: "100%", height: 26, padding: "0 8px 0 24px",
                      background: "hsl(var(--background))", border: "1px solid hsl(var(--border))",
                      borderRadius: 5, color: "hsl(var(--foreground))", fontSize: 11, outline: "none",
                    }}
                  />
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
                <OutputPanel
                  nodeId={node.id}
                  nodeLabel={nodeLabel}
                  lastRunOutputs={lastRunOutputs}
                  mode={outputMode}
                  query={outputQuery}
                  onInsert={handleInsert}
                />
                {nodeLogs && nodeLogs.length > 0 && (
                  <div style={{ borderTop: "1px solid hsl(var(--border))", marginTop: 8 }}>
                    <div style={{
                      padding: "8px 14px 4px",
                      fontSize: 10, fontWeight: 800, letterSpacing: "0.12em",
                      color: "#94a3b8", display: "flex", alignItems: "center", gap: 6,
                    }}>
                      LOGS DO NODO ({nodeLogs.length})
                    </div>
                    <div style={{
                      padding: "4px 14px 12px", fontSize: 11, fontFamily: "monospace",
                      maxHeight: 240, overflowY: "auto",
                    }}>
                      {nodeLogs.map((log) => {
                        const color =
                          log.level === "error" ? "#ef4444" :
                          log.level === "warn"  ? "#fbbf24" : "#94a3b8";
                        return (
                          <div key={log.id} style={{
                            display: "flex", gap: 8, padding: "3px 0",
                            borderBottom: "1px solid rgba(255,255,255,0.04)",
                            color, lineHeight: 1.45,
                          }}>
                            <span style={{ color: "#64748b", flexShrink: 0, fontSize: 10 }}>
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </span>
                            <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1 }}>
                              {log.message}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer hint */}
          <div style={{
            padding: "6px 14px", borderTop: "1px solid hsl(var(--border))",
            background: "hsl(var(--card))", fontSize: 10,
            color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center", gap: 14, flexShrink: 0,
          }}>
            <span>↔ Arraste variáveis do INPUT/OUTPUT para campos no centro</span>
            <span>•</span>
            <span>Sintaxe: <code style={{ color: "#a78bfa" }}>{`pipeline["nome_da_variavel"]`}</code></span>
            <span style={{ flex: 1 }} />
            <span>ESC para fechar</span>
          </div>
        </div>
      </div>
    </VarColorCtx.Provider>
  );

  return createPortal(modal, document.body);
}

// ─── Settings tab (placeholder using existing fields) ────────────────────────

function SettingsTab({
  node, onUpdateData, onUpdateConfig,
}: {
  node: ReactFlowNode;
  onUpdateData: (k: string, v: unknown) => void;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const cfg = (node.data.config as Record<string, unknown>) ?? {};
  const retryCount = (node.data.retryCount as number) ?? 0;
  const retryDelay = (node.data.retryDelayMs as number) ?? 1000;
  const continueOnError = (node.data.continueOnError as boolean) ?? false;
  const stopOnError = (node.data.stopOnError as boolean) ?? true;
  const notes = (cfg.notes as string) ?? "";
  const displayNoteInFlow = (cfg.displayNoteInFlow as boolean) ?? false;

  const Row = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
        {hint && <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );

  const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 36, height: 20, borderRadius: 10, padding: 0, border: "none",
        background: checked ? "#10b981" : "hsl(var(--muted))",
        position: "relative", cursor: "pointer", transition: "background 0.15s",
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: checked ? 18 : 2,
        width: 16, height: 16, borderRadius: "50%", background: "#fff",
        transition: "left 0.15s",
      }} />
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 16, padding: "8px 12px",
        background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.2)", borderRadius: 6 }}>
        Configurações de execução comuns a todos os nodos. (Always Output Data, Execute Once e modo Continue/Error Output completos virão no Bloco 4.)
      </div>

      <Row label="Retry On Fail" hint="Tenta novamente em caso de falha">
        <Toggle checked={retryCount > 0} onChange={(v) => onUpdateData("retryCount", v ? 3 : 0)} />
      </Row>

      {retryCount > 0 && (
        <>
          <Row label="Max Tries">
            <input type="number" min={1} max={10} value={retryCount}
              onChange={(e) => onUpdateData("retryCount", parseInt(e.target.value, 10) || 1)}
              style={{ width: 80, height: 30, padding: "0 8px", background: "hsl(var(--background))",
                border: "1px solid hsl(var(--border))", borderRadius: 5, color: "hsl(var(--foreground))", fontSize: 12 }} />
          </Row>
          <Row label="Wait Between Tries (ms)">
            <input type="number" min={0} step={100} value={retryDelay}
              onChange={(e) => onUpdateData("retryDelayMs", parseInt(e.target.value, 10) || 0)}
              style={{ width: 120, height: 30, padding: "0 8px", background: "hsl(var(--background))",
                border: "1px solid hsl(var(--border))", borderRadius: 5, color: "hsl(var(--foreground))", fontSize: 12 }} />
          </Row>
        </>
      )}

      <Row label="On Error" hint="O que fazer quando o nodo falhar">
        <select
          value={continueOnError ? "continue" : (stopOnError ? "stop" : "stop")}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "continue") { onUpdateData("continueOnError", true); onUpdateData("stopOnError", false); }
            else { onUpdateData("continueOnError", false); onUpdateData("stopOnError", true); }
          }}
          style={{ height: 32, padding: "0 8px", background: "hsl(var(--background))",
            border: "1px solid hsl(var(--border))", borderRadius: 5, color: "hsl(var(--foreground))", fontSize: 12 }}
        >
          <option value="stop">Stop Workflow</option>
          <option value="continue">Continue (regular output)</option>
        </select>
      </Row>

      <Row label="Notes" hint="Anotações livres sobre este nodo">
        <textarea
          value={notes}
          onChange={(e) => onUpdateConfig("notes", e.target.value)}
          rows={4}
          placeholder="Ex: este nodo busca todos os clientes ativos..."
          style={{ width: "100%", padding: "6px 8px", background: "hsl(var(--background))",
            border: "1px solid hsl(var(--border))", borderRadius: 5, color: "hsl(var(--foreground))",
            fontSize: 12, fontFamily: "inherit", resize: "vertical" }}
        />
      </Row>

      <Row label="Display Note in Flow?" hint="Mostra um balão com a nota próximo ao nodo no canvas">
        <Toggle checked={displayNoteInFlow} onChange={(v) => onUpdateConfig("displayNoteInFlow", v)} />
      </Row>
    </div>
  );
}
