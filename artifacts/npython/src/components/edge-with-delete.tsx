import { useState } from "react";
import {
  EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
  useReactFlow,
} from "reactflow";
import { X } from "lucide-react";

export function EdgeWithDelete({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd,
  style,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const { setEdges } = useReactFlow();

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEdges((eds) => eds.filter((edge) => edge.id !== id));
  };

  const show = hovered || selected;

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: show ? "hsl(var(--primary))" : style?.stroke,
          strokeWidth: show ? 2.5 : 2,
          transition: "stroke 0.15s, stroke-width 0.15s",
        }}
      />

      {/* Invisible wide hit area for hover */}
      <path
        d={edgePath}
        fill="none"
        strokeWidth={20}
        strokeOpacity={0}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ cursor: "pointer" }}
      />

      {show && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              zIndex: 20,
            }}
            className="nodrag nopan"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <button
              onClick={handleDelete}
              title="Remover conexão"
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "hsl(var(--destructive))",
                border: "2px solid hsl(var(--background))",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                transition: "transform 0.1s",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.transform = "scale(1.15)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.transform = "scale(1)")
              }
            >
              <X size={10} color="white" strokeWidth={3} />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
