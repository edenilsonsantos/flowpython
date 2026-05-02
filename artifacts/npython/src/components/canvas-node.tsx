import { memo } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import {
  Play, Webhook, Clock, GitBranch, Code2, GitFork, RefreshCw,
  Variable, Database, Shuffle, Globe, Timer, StickyNote, Pin,
  LucideProps,
} from "lucide-react";
import { getNodeDef, NODE_CATEGORY_META } from "@/lib/node-definitions";

const ICON_MAP: Record<string, React.FC<LucideProps>> = {
  Play, Webhook, Clock, GitBranch, Code2, GitFork, RefreshCw,
  Variable, Database, Shuffle, Globe, Timer, StickyNote,
};

export const CanvasNode = memo(({ data, isConnectable, selected }: NodeProps) => {
  const def = getNodeDef(data.type as string);
  const color = def?.color ?? "#94a3b8";
  const catMeta = def ? NODE_CATEGORY_META[def.category] : null;
  const bg = catMeta?.bg ?? "rgba(148,163,184,0.12)";
  const IconComponent = def ? (ICON_MAP[def.iconName] ?? Code2) : Code2;
  const hasInput = def?.hasInput ?? true;
  const hasOutput = def?.hasOutput ?? true;
  const isNote = data.type === "note";
  const isPinned = !!(data.config as Record<string, unknown>)?.pinned;

  return (
    <div
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
      {/* Pin badge */}
      {isPinned && (
        <div
          title="Dados mockados (pinned)"
          style={{
            position: "absolute",
            top: -8,
            right: -8,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "#f59e0b",
            border: "2px solid hsl(var(--background))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 5,
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
          style={{
            background: color,
            border: "2px solid hsl(var(--background))",
            width: 12,
            height: 12,
            left: -7,
          }}
        />
      )}

      <div
        style={{
          background: bg,
          borderRadius: "8px 8px 0 0",
          padding: "8px 10px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: isNote ? "none" : "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div
          style={{
            background: `${color}22`,
            border: `1px solid ${color}55`,
            borderRadius: 6,
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <IconComponent size={14} color={color} strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "hsl(var(--foreground))",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {data.label as string}
          </div>
          <div style={{ fontSize: 10, color: color, fontWeight: 500, marginTop: 1 }}>
            {isPinned ? "📌 PINNED" : (def?.category.toUpperCase() ?? "NODE")}
          </div>
        </div>
      </div>

      {isNote && data.config && (data.config as Record<string, string>).text && (
        <div
          style={{
            padding: "8px 10px",
            fontSize: 11,
            color: "hsl(var(--muted-foreground))",
            fontStyle: "italic",
            whiteSpace: "pre-wrap",
            maxHeight: 80,
            overflow: "hidden",
          }}
        >
          {(data.config as Record<string, string>).text}
        </div>
      )}

      {hasOutput && (
        <Handle
          type="source"
          position={Position.Right}
          isConnectable={isConnectable}
          style={{
            background: color,
            border: "2px solid hsl(var(--background))",
            width: 12,
            height: 12,
            right: -7,
          }}
        />
      )}
    </div>
  );
});

CanvasNode.displayName = "CanvasNode";
