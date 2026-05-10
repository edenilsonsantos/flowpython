import React, { memo, useState, useContext, useRef } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import {
  Play, Webhook, Clock, GitBranch, Code2, GitFork, RefreshCw,
  Variable, Database, Shuffle, Globe, Timer, StickyNote, Pin, Braces, Syringe, Package,
  ToggleRight, GitMerge, ListFilter, Layers, Sigma, Scissors,
  ArrowUpDown, FilterX, Hash, MoveRight, Link2, Share2,
  FileUp, FileDown, Binary, CheckCircle2, LayoutList,
  LucideProps,
} from "lucide-react";
import { getNodeDef, VARIABLE_SCOPES, getNodeOutputHandles } from "@/lib/node-definitions";
import { QuickConnectCtx, QuickConnectPopup } from "@/components/quick-connect-popup";

const ICON_MAP: Record<string, React.FC<LucideProps>> = {
  Play, Webhook, Clock, GitBranch, Code2, GitFork, RefreshCw,
  Variable, Database, Shuffle, Globe, Timer, StickyNote, Braces, Syringe, Package,
  ToggleRight, GitMerge, ListFilter, Layers, Sigma, Scissors,
  ArrowUpDown, FilterX, Hash, Share2,
  FileUp, FileDown, Binary, CheckCircle2, LayoutList,
};

// Visual constants ─ n8n-like compact node
const BODY_SIZE = 76;        // square icon body
const TRIGGER_RADIUS = 16;   // bigger rounding for triggers (rounded-rect look)
const NORMAL_RADIUS = 8;
const HANDLE_SIZE = 12;

export const CanvasNode = memo(({ id, data, isConnectable, selected }: NodeProps) => {
  const def = getNodeDef(data.type as string);
  const color = def?.color ?? "#94a3b8";
  const executionStatus = data.executionStatus as string | undefined;
  const executionDurationMs = data.executionDurationMs as number | undefined;
  const IconComponent = def ? (ICON_MAP[def.iconName] ?? Code2) : Code2;
  const hasInput = def?.hasInput ?? true;
  const hasOutput = def?.hasOutput ?? true;
  const isNote = data.type === "note";
  const isTrigger = !hasInput && hasOutput;
  const isPinned = !!(data.config as Record<string, unknown>)?.pinned;
  const nodeId = id;

  const { onAddAndConnect } = useContext(QuickConnectCtx);
  const [popupAnchor, setPopupAnchor] = useState<DOMRect | null>(null);
  const [hovered, setHovered] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHide = () => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  };
  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = setTimeout(() => { setHovered(false); hideTimer.current = null; }, 450);
  };

  // Subtype-specific badges (rendered as small pill below the body)
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

  const radius = isTrigger ? TRIGGER_RADIUS : NORMAL_RADIUS;
  const statusRingColor =
    executionStatus === "success" ? "#22c55e" :
    executionStatus === "failed"  ? "#ef4444" :
    executionStatus === "running" ? "#3b82f6" : null;

  // ── Note: render as a sticky pad (different shape) ──────────
  if (isNote) {
    const noteText = (cfg.text as string) ?? "";
    return (
      <div
        onMouseEnter={() => { cancelHide(); setHovered(true); }}
        onMouseLeave={scheduleHide}
        style={{
          minWidth: 160, maxWidth: 240,
          background: "rgba(251,191,36,0.10)",
          border: `1.5px ${selected ? "solid" : "dashed"} ${selected ? "#fbbf24" : "rgba(251,191,36,0.35)"}`,
          borderRadius: 8, padding: "8px 10px",
          fontSize: 11, color: "rgba(252,211,77,0.95)",
          fontStyle: noteText ? "normal" : "italic",
          whiteSpace: "pre-wrap", overflow: "hidden", maxHeight: 140,
          boxShadow: selected ? "0 0 0 3px rgba(251,191,36,0.18)" : "none",
        }}
      >
        {noteText || (data.label as string) || "Anotação..."}
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => { cancelHide(); setHovered(true); }}
      onMouseLeave={scheduleHide}
      style={{
        position: "relative",
        display: "flex", flexDirection: "column", alignItems: "center",
        // Keep wrapper width narrow so label wraps without dragging the body
        width: BODY_SIZE,
      }}
    >
      {/* ── Body (square with icon) ─────────────────────────── */}
      <div
        style={{
          position: "relative",
          width: BODY_SIZE, height: BODY_SIZE,
          borderRadius: radius,
          background: `linear-gradient(180deg, ${color}1f 0%, ${color}10 100%)`,
          border: `1.5px solid ${selected ? color : isPinned ? `${color}88` : "rgba(255,255,255,0.10)"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: selected
            ? `0 0 0 3px ${color}33, 0 6px 18px rgba(0,0,0,0.45)`
            : "0 2px 10px rgba(0,0,0,0.35)",
          transition: "border-color 0.12s, box-shadow 0.12s, transform 0.12s",
          transform: hovered && !selected ? "translateY(-1px)" : "none",
        }}
      >
        {/* Execution status ring */}
        {statusRingColor && (
          <div style={{
            position: "absolute", inset: -3, borderRadius: radius + 3, pointerEvents: "none", zIndex: 1,
            border: `2.5px solid ${statusRingColor}`,
            boxShadow:
              executionStatus === "failed" ? "0 0 14px rgba(239,68,68,0.45)" :
              executionStatus === "success" ? "0 0 10px rgba(34,197,94,0.35)" :
              executionStatus === "running" ? "0 0 14px rgba(59,130,246,0.55)" : "none",
            animation: executionStatus === "running" ? "pulse-ring 1.4s ease-in-out infinite" : undefined,
          }} />
        )}

        {/* Icon */}
        <IconComponent size={32} color={color} strokeWidth={1.8} />

        {/* Pin badge (top-right corner) */}
        {isPinned && (
          <div
            title="Dados mockados (pinned)"
            style={{
              position: "absolute", top: -7, right: -7,
              width: 18, height: 18, borderRadius: "50%",
              background: "#f59e0b", border: "2px solid hsl(var(--background))",
              display: "flex", alignItems: "center", justifyContent: "center", zIndex: 5,
            }}
          >
            <Pin size={9} color="white" strokeWidth={3} />
          </div>
        )}

        {/* Status mini-dot (bottom-right) when no full ring */}
        {!statusRingColor && executionStatus && executionStatus !== "pending" && (
          <div style={{
            position: "absolute", bottom: -3, right: -3,
            width: 11, height: 11, borderRadius: "50%",
            background: "#6b7280", border: "2px solid hsl(var(--background))", zIndex: 4,
          }} />
        )}

        {/* Handles attached to the body so they align with the icon vertically */}
        {hasInput && (
          <Handle
            type="target"
            position={Position.Left}
            isConnectable={isConnectable}
            style={{
              background: color, border: "2px solid hsl(var(--background))",
              width: HANDLE_SIZE, height: HANDLE_SIZE, left: -HANDLE_SIZE / 2 - 1,
            }}
          />
        )}
        {hasOutput && (() => {
          const handles = getNodeOutputHandles(data.type as string, cfg);
          const isMulti = handles.length > 1;
          return (
            <>
              {handles.map((h, i) => {
                // Distribute handles evenly down the right side of the body.
                // IMPORTANT: Handle must be rendered directly (not wrapped in
                // a positioned div) so React Flow can compute correct anchor
                // positions for each individual handle.
                const topPct = isMulti
                  ? `${((i + 1) / (handles.length + 1)) * 100}%`
                  : "50%";
                return (
                  <React.Fragment key={h.id}>
                    <Handle
                      id={h.id}
                      type="source"
                      position={Position.Right}
                      isConnectable={isConnectable}
                      style={{
                        background: h.color,
                        border: "2px solid hsl(var(--background))",
                        width: HANDLE_SIZE,
                        height: HANDLE_SIZE,
                        right: -HANDLE_SIZE / 2 - 1,
                        top: topPct,
                      }}
                    />
                    {isMulti && (
                      <span
                        className="nodrag nopan"
                        style={{
                          position: "absolute",
                          right: -6 - HANDLE_SIZE,
                          top: topPct,
                          transform: "translate(100%, -50%)",
                          fontSize: 9,
                          fontWeight: 600,
                          color: h.color,
                          whiteSpace: "nowrap",
                          pointerEvents: "none",
                          textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                        }}
                      >
                        {h.label}
                      </span>
                    )}
                  </React.Fragment>
                );
              })}

            {/* Quick-connect button on hover, to the right of the source handle */}
            <button
              className="nodrag nopan"
              title="Adicionar nova conexão"
              onClick={handleQuickConnectClick}
              onMouseEnter={() => { cancelHide(); setHovered(true); }}
              onMouseLeave={scheduleHide}
              style={{
                position: "absolute",
                right: -34, top: "50%", transform: "translateY(-50%)",
                width: 22, height: 22, borderRadius: "50%",
                background: hovered || popupAnchor ? `${color}cc` : "transparent",
                border: `1.5px solid ${hovered || popupAnchor ? color : "transparent"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", transition: "all 0.15s",
                opacity: hovered || popupAnchor ? 1 : 0,
                zIndex: 20, padding: 0,
                pointerEvents: hovered || popupAnchor ? "all" : "none",
              }}
            >
              <Link2 size={11} color="white" strokeWidth={2.5} />
            </button>
          </>
          );
        })()}
      </div>

      {/* ── Label below the body ───────────────────────────── */}
      <div
        style={{
          marginTop: 6,
          width: 130, // wider than body so longer labels don't truncate harshly
          textAlign: "center",
          fontSize: 11, fontWeight: 600,
          color: selected ? color : "hsl(var(--foreground))",
          lineHeight: 1.25,
          // Allow up to 2 lines, then ellipsis
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          wordBreak: "break-word",
          textShadow: "0 1px 2px rgba(0,0,0,0.6)",
          pointerEvents: "none",
        }}
        title={data.label as string}
      >
        {data.label as string}
      </div>

      {/* Subtype context line — small pill row below label */}
      {(isPinned || isVariable || (isDataNode && (dataInputVar || dataOutputVar)) || isPip) && (
        <div style={{
          marginTop: 3, display: "flex", flexWrap: "wrap", justifyContent: "center",
          gap: 3, maxWidth: 150, pointerEvents: "none",
        }}>
          {isPinned && (
            <Pill color="#f59e0b" text="PINNED" />
          )}

          {isVariable && operation && (
            <Pill color={operation === "set" ? "#f59e0b" : "#60a5fa"} text={operation.toUpperCase()} />
          )}
          {isVariable && scopeMeta && (
            <Pill color={scopeMeta.color} text={scopeMeta.label.toUpperCase()} />
          )}
          {isVariable && !!cfg.key && (
            <Pill color="#94a3b8" text={cfg.key as string} mono />
          )}

          {isDataNode && dataInputVar && (
            <Pill color="#60a5fa" text={dataInputVar} mono />
          )}
          {isDataNode && dataInputVar && dataOutputVar && (
            <span style={{ display: "inline-flex", alignItems: "center", color }}>
              <MoveRight size={9} />
            </span>
          )}
          {isDataNode && dataOutputVar && (
            <Pill color="#34d399" text={dataOutputVar} mono />
          )}
          {data.type === "switch" && !!cfg.conditions && (
            <Pill color="#94a3b8" text={`${((cfg.conditions as unknown[]) ?? []).length}b`} />
          )}

          {isPip && (
            <>
              <Pill
                color={pipAction === "uninstall" ? "#ef4444" : "#34d399"}
                text={pipAction === "uninstall" ? "UNINSTALL" : "INSTALL"}
              />
              <Pill
                color="#f472b6"
                text={pipMode === "requirements" ? "req.txt" : pipMode === "multiple" ? `${pipPkgCount} pkg${pipPkgCount !== 1 ? "s" : ""}` : (cfg.packageName as string || "single")}
                mono={pipMode !== "multiple" && pipMode !== "requirements"}
              />
            </>
          )}
        </div>
      )}

      {/* Execution duration */}
      {executionDurationMs !== undefined && executionDurationMs !== null && (
        <div style={{
          marginTop: 3,
          fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
          color: executionStatus === "failed" ? "#ef4444" : executionStatus === "success" ? "#22c55e" : "hsl(var(--muted-foreground))",
          background: "hsl(var(--background))",
          border: `1px solid ${executionStatus === "failed" ? "rgba(239,68,68,0.4)" : executionStatus === "success" ? "rgba(34,197,94,0.4)" : "hsl(var(--border))"}`,
          borderRadius: 4, padding: "0px 5px", lineHeight: "14px",
          pointerEvents: "none",
        }}>
          {executionDurationMs < 1000 ? `${executionDurationMs}ms` : `${(executionDurationMs / 1000).toFixed(2)}s`}
        </div>
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

// ─── Tiny inline pill component ──────────────────────────────────────────────

function Pill({ color, text, mono }: { color: string; text: string; mono?: boolean }) {
  return (
    <span
      style={{
        fontSize: 8.5, fontWeight: 700, letterSpacing: mono ? 0 : "0.06em",
        color, background: `${color}18`, border: `1px solid ${color}38`,
        borderRadius: 3, padding: "1px 5px", lineHeight: 1.25,
        fontFamily: mono ? "monospace" : "inherit",
        maxWidth: 84, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}
