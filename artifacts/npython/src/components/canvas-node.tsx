import { memo, useState, useContext } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import {
  Play, Webhook, Clock, GitBranch, Code2, GitFork, RefreshCw,
  Variable, Database, Shuffle, Globe, Timer, StickyNote, Pin, Braces, Syringe, Package,
  ToggleRight, GitMerge, ListFilter, Layers, Sigma, Scissors,
  ArrowUpDown, FilterX, Hash, MoveRight, Link2,
  LucideProps,
} from "lucide-react";
import { getNodeDef, NODE_CATEGORY_META, VARIABLE_SCOPES } from "@/lib/node-definitions";
import { QuickConnectCtx, QuickConnectPopup } from "@/components/quick-connect-popup";

const ICON_MAP: Record<string, React.FC<LucideProps>> = {
  Play, Webhook, Clock, GitBranch, Code2, GitFork, RefreshCw,
  Variable, Database, Shuffle, Globe, Timer, StickyNote, Braces, Syringe, Package,
  ToggleRight, GitMerge, ListFilter, Layers, Sigma, Scissors,
  ArrowUpDown, FilterX, Hash,
};

export const CanvasNode = memo(({ id, data, isConnectable, selected }: NodeProps) => {
  const def = getNodeDef(data.type as string);
  const color = def?.color ?? "#94a3b8";
  const executionStatus = data.executionStatus as string | undefined;
  const executionDurationMs = data.executionDurationMs as number | undefined;
  const catMeta = def ? NODE_CATEGORY_META[def.category] : null;
  const bg = catMeta?.bg ?? "rgba(148,163,184,0.12)";
  const IconComponent = def ? (ICON_MAP[def.iconName] ?? Code2) : Code2;
  const hasInput = def?.hasInput ?? true;
  const hasOutput = def?.hasOutput ?? true;
  const isNote = data.type === "note";
  const isPinned = !!(data.config as Record<string, unknown>)?.pinned;
  const nodeId = id;

  const { onQuickConnect } = useContext(QuickConnectCtx);
  const [popupAnchor, setPopupAnchor] = useState<DOMRect | null>(null);
  const [hovered, setHovered] = useState(false);

  // For variable nodes: show scope badge
  const cfg = (data.config as Record<string, unknown>) ?? {};
  const isVariable = data.type === "variable" || data.type === "variable_inject";
  const scope = cfg.scope as string | undefined;
  const scopeMeta = scope ? VARIABLE_SCOPES.find((s) => s.value === scope) : null;
  const operation = cfg.operation as string | undefined;

  const DATA_NODE_TYPES = ["filter_list","batch_split","aggregate","split_out","sort_list","remove_duplicates","limit","merge_lists","switch"];
  const isDataNode = DATA_NODE_TYPES.includes(data.type as string);
  const dataInputVar = cfg.inputVar as string | undefined;
  const dataOutputVar = (cfg.outputVar as string | undefined) ?? (cfg.field as string | undefined);

  const isPip = data.type === "pip_install";
  const pipAction = cfg.action as string | undefined;
  const pipMode = cfg.mode as string | undefined;
  const pipPkgCount = pipMode === "multiple"
    ? ((cfg.packages as unknown[]) ?? []).length
    : pipMode === "single" ? (cfg.packageName ? 1 : 0) : null;

  const handleQuickConnectClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
    setPopupAnchor(rect);
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: `2px solid ${selected ? color : isPinned ? `${color}88` : "rgba(255,255,255,0.12)"}`,
        borderRadius: 10,
        background: isNote ? "rgba(148,163,184,0.08)" : "hsl(var(--card))",
        minWidth: 160,
        maxWidth: 220,
        boxShadow: selected
          ? `0 0 0 3px ${color}33, 0 4px 16px rgba(0,0,0,0.4)`
          : "0 2px 8px rgba(0,0,0,0.3)",
        transition: "box-shadow 0.15s, border-color 0.15s",
        position: "relative",
      }}
    >
      {/* Execution status ring */}
      {!!(executionStatus && executionStatus !== "pending") && (
        <div style={{
          position: "absolute", inset: -3, borderRadius: 13, pointerEvents: "none", zIndex: 1,
          border: `2.5px solid ${
            executionStatus === "success" ? "#22c55e" :
            executionStatus === "failed" ? "#ef4444" :
            executionStatus === "running" ? "#3b82f6" : "#6b7280"
          }`,
          boxShadow:
            executionStatus === "failed" ? "0 0 14px rgba(239,68,68,0.4)" :
            executionStatus === "success" ? "0 0 10px rgba(34,197,94,0.3)" :
            executionStatus === "running" ? "0 0 14px rgba(59,130,246,0.45)" : "none",
        }} />
      )}
      {/* Execution duration badge */}
      {executionDurationMs !== undefined && executionDurationMs !== null && (
        <div style={{
          position: "absolute", bottom: -12, left: "50%", transform: "translateX(-50%)", zIndex: 10,
          fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
          color: executionStatus === "failed" ? "#ef4444" : executionStatus === "success" ? "#22c55e" : "hsl(var(--muted-foreground))",
          background: "hsl(var(--background))", border: `1px solid ${executionStatus === "failed" ? "rgba(239,68,68,0.4)" : executionStatus === "success" ? "rgba(34,197,94,0.4)" : "hsl(var(--border))"}`,
          borderRadius: 4, padding: "0px 5px", lineHeight: "16px", whiteSpace: "nowrap",
        }}>
          {executionDurationMs < 1000 ? `${executionDurationMs}ms` : `${(executionDurationMs / 1000).toFixed(2)}s`}
        </div>
      )}

      {/* Pin badge */}
      {isPinned && (
        <div
          title="Dados mockados (pinned)"
          style={{
            position: "absolute", top: -8, right: -8,
            width: 18, height: 18, borderRadius: "50%",
            background: "#f59e0b", border: "2px solid hsl(var(--background))",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 5,
          }}
        >
          <Pin size={9} color="white" strokeWidth={3} />
        </div>
      )}

      {hasInput && (
        <Handle
          type="target"
          position={Position.Left}
          isConnectable={isConnectable}
          style={{ background: color, border: "2px solid hsl(var(--background))", width: 12, height: 12, left: -7 }}
        />
      )}

      {/* Header */}
      <div
        style={{
          background: bg,
          borderRadius: "8px 8px 0 0",
          padding: "8px 10px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: (isNote && !isVariable) ? "none" : "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div
          style={{
            background: `${color}22`, border: `1px solid ${color}55`,
            borderRadius: 6, width: 28, height: 28,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}
        >
          <IconComponent size={14} color={color} strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "hsl(var(--foreground))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {data.label as string}
          </div>
          <div style={{ fontSize: 10, color: color, fontWeight: 500, marginTop: 1 }}>
            {isPinned ? "📌 PINNED" : (def ? def.category.toUpperCase() : "NODE")}
          </div>
        </div>
      </div>

      {/* Variable node: show scope + operation pill */}
      {isVariable && (
        <div
          style={{
            padding: "5px 10px 6px",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          {operation && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
              textTransform: "uppercase", color: operation === "set" ? "#f59e0b" : "#60a5fa",
              background: operation === "set" ? "rgba(245,158,11,0.12)" : "rgba(96,165,250,0.12)",
              border: `1px solid ${operation === "set" ? "rgba(245,158,11,0.3)" : "rgba(96,165,250,0.3)"}`,
              borderRadius: 4, padding: "2px 6px",
            }}>
              {operation}
            </span>
          )}
          {scopeMeta && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
              textTransform: "uppercase", color: scopeMeta.color,
              background: `${scopeMeta.color}14`,
              border: `1px solid ${scopeMeta.color}33`,
              borderRadius: 4, padding: "2px 6px",
            }}>
              {scopeMeta.label}
            </span>
          )}
          {!!(cfg.key) && (
            <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80 }}>
              {cfg.key as string}
            </span>
          )}
        </div>
      )}

      {/* Data node: inputVar → outputVar flow */}
      {isDataNode && (dataInputVar || dataOutputVar) && (
        <div style={{ padding: "4px 10px 6px", display: "flex", alignItems: "center", gap: 4, minHeight: 22 }}>
          {dataInputVar && (
            <span style={{ fontSize: 10, fontFamily: "monospace", color: "#60a5fa", background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.25)", borderRadius: 4, padding: "1px 5px", maxWidth: 60, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {dataInputVar}
            </span>
          )}
          {dataInputVar && dataOutputVar && (
            <MoveRight size={10} color={color} style={{ flexShrink: 0 }} />
          )}
          {dataOutputVar && (
            <span style={{ fontSize: 10, fontFamily: "monospace", color: "#34d399", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 4, padding: "1px 5px", maxWidth: 60, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {dataOutputVar}
            </span>
          )}
          {data.type === "switch" && !!(cfg.conditions) && (
            <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", marginLeft: 2 }}>
              {((cfg.conditions as unknown[]) ?? []).length} branches
            </span>
          )}
        </div>
      )}

      {/* Pip install badges */}
      {isPip && (
        <div style={{ padding: "5px 10px 6px", display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
            color: pipAction === "uninstall" ? "#ef4444" : "#34d399",
            background: pipAction === "uninstall" ? "rgba(239,68,68,0.12)" : "rgba(52,211,153,0.12)",
            border: `1px solid ${pipAction === "uninstall" ? "rgba(239,68,68,0.3)" : "rgba(52,211,153,0.3)"}`,
            borderRadius: 4, padding: "2px 6px",
          }}>
            {pipAction === "uninstall" ? "uninstall" : "install"}
          </span>
          <span style={{
            fontSize: 9, fontWeight: 600, color: "#f472b6",
            background: "rgba(244,114,182,0.1)", border: "1px solid rgba(244,114,182,0.25)",
            borderRadius: 4, padding: "2px 6px",
          }}>
            {pipMode === "requirements" ? "req.txt" : pipMode === "multiple" ? `${pipPkgCount} pkg${pipPkgCount !== 1 ? "s" : ""}` : (cfg.packageName as string || "single")}
          </span>
        </div>
      )}

      {/* Note text */}
      {isNote && !!(cfg.text) && (
        <div style={{ padding: "8px 10px", fontSize: 11, color: "hsl(var(--muted-foreground))", fontStyle: "italic", whiteSpace: "pre-wrap", maxHeight: 80, overflow: "hidden" }}>
          {cfg.text as string}
        </div>
      )}

      {hasOutput && (
        <>
          <Handle
            type="source"
            position={Position.Right}
            isConnectable={isConnectable}
            style={{ background: color, border: "2px solid hsl(var(--background))", width: 12, height: 12, right: -7 }}
          />

          {/* Quick-connect button — appears on hover, overlaid above/near the source handle */}
          <button
            className="nodrag nopan"
            title="Adicionar nova conexão"
            onClick={handleQuickConnectClick}
            style={{
              position: "absolute",
              right: -34,
              top: "50%",
              transform: "translateY(-50%)",
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: hovered || popupAnchor ? `${color}cc` : "transparent",
              border: `1.5px solid ${hovered || popupAnchor ? color : "transparent"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "all 0.15s",
              opacity: hovered || popupAnchor ? 1 : 0,
              zIndex: 20,
              padding: 0,
              pointerEvents: hovered || popupAnchor ? "all" : "none",
            }}
          >
            <Link2 size={10} color="white" strokeWidth={2.5} />
          </button>
        </>
      )}

      {/* Quick-connect popup */}
      {popupAnchor && (
        <QuickConnectPopup
          sourceNodeId={nodeId}
          anchorRect={popupAnchor}
          onClose={() => setPopupAnchor(null)}
        />
      )}
    </div>
  );
});

CanvasNode.displayName = "CanvasNode";
