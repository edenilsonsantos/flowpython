import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useLocation, Link } from "wouter";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node as RFNode,
  Edge as RFEdge,
  ReactFlowProvider,
  useReactFlow,
  NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  Calendar,
  Activity,
  Terminal,
  Edit2,
  Save,
  X,
  AlertTriangle,
  ChevronRight,
  Wrench,
  RefreshCw,
  Code2,
  Layers,
  Table2,
  Braces,
  List,
  Hash,
  Type,
  ToggleLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { CanvasNode } from "@/components/canvas-node";
import { format } from "date-fns";
import { useStopExecution, getGetExecutionQueryKey } from "@workspace/api-client-react";
import { DataTableModal, isTabular } from "./data-table-modal";
import { useQueryClient } from "@tanstack/react-query";
import { NodeConfigPanel, VarColorCtx, type NodeOutputMap } from "@/components/node-config-panel";
import { NodeDetailModal } from "@/components/node-detail-modal";

const nodeTypes = { custom: CanvasNode };

interface NodeResult {
  nodeId: string;
  nodeLabel: string;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  output: string | null;
  error: string | null;
  inputSnapshot?: Record<string, unknown>;
  outputSnapshot?: Record<string, unknown>;
  nodeConfig?: Record<string, unknown>;
}

interface DebugNode {
  id: string;
  type: string;
  label: string;
  positionX: number;
  positionY: number;
  config: Record<string, unknown>;
}

interface DebugEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  label?: string;
  condition?: string;
}

interface DebugLog {
  id: string;
  nodeId: string | null;
  level: string;
  message: string;
  timestamp: string;
}

interface DebugData {
  id: string;
  workflowId: string;
  workflowName: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  nodeResults: NodeResult[];
  nodes: DebugNode[];
  edges: DebugEdge[];
  logs: DebugLog[];
}

function statusColor(s: string) {
  if (s === "success") return "#22c55e";
  if (s === "failed") return "#ef4444";
  if (s === "running") return "#3b82f6";
  return "#6b7280";
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    failed: "bg-red-500/15 text-red-400 border-red-500/30",
    running: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    pending: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    stopped: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  };
  const cls = colorMap[status] ?? "bg-slate-500/15 text-slate-400 border-slate-500/30";
  const Icon =
    status === "success" ? CheckCircle2 :
    status === "failed" ? XCircle :
    status === "running" ? Activity : Clock;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${cls} capitalize`}>
      <Icon size={11} />
      {status}
    </span>
  );
}

function JsonViewer({ data, title }: { data: unknown; title?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const str = JSON.stringify(data, null, 2);
  const isEmpty = data == null || (typeof data === "object" && Object.keys(data as object).length === 0);

  return (
    <div className="rounded-lg border border-border/40 overflow-hidden text-xs font-mono">
      {title && (
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border/40 text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="font-semibold text-[10px] uppercase tracking-wider">{title}</span>
          <ChevronRight size={12} className={`transition-transform ${collapsed ? "" : "rotate-90"}`} />
        </button>
      )}
      {!collapsed && (
        <pre className="p-3 overflow-auto max-h-72 bg-[#0d1117] text-gray-300 leading-relaxed">
          {isEmpty ? <span className="text-slate-600 italic">{"{ }"}</span> : str}
        </pre>
      )}
    </div>
  );
}

// ─── Type badge helpers ───────────────────────────────────────────────────────

function getTypeInfo(value: unknown): { label: string; color: string; Icon: React.ElementType } {
  if (value === null || value === undefined) return { label: "null", color: "#6b7280", Icon: X };
  if (Array.isArray(value)) return { label: `list[${value.length}]`, color: "#fb923c", Icon: List };
  if (typeof value === "object") return { label: `dict[${Object.keys(value as object).length}]`, color: "#f472b6", Icon: Braces };
  if (typeof value === "number") return { label: Number.isInteger(value) ? "int" : "float", color: "#a78bfa", Icon: Hash };
  if (typeof value === "boolean") return { label: "bool", color: "#fb923c", Icon: ToggleLeft };
  return { label: "str", color: "#60a5fa", Icon: Type };
}

function PipelineVarsViewer({
  snapshot,
  title,
  onPreviewTable,
}: {
  snapshot: Record<string, unknown>;
  title: string;
  onPreviewTable: (varName: string, data: unknown) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pipeline = (snapshot.pipeline ?? {}) as Record<string, unknown>;
  const entries = Object.entries(pipeline);

  return (
    <div className="rounded-lg border border-border/40 overflow-hidden text-xs">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border/40 text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="font-semibold text-[10px] uppercase tracking-wider">{title}</span>
        <ChevronRight size={12} className={`transition-transform ${collapsed ? "" : "rotate-90"}`} />
      </button>

      {!collapsed && (
        <div className="bg-[#0d1117]">
          {entries.length === 0 ? (
            <div className="px-3 py-4 text-slate-600 italic text-center">Pipeline vazio</div>
          ) : (
            entries.map(([key, value]) => {
              const { label, color, Icon } = getTypeInfo(value);
              const tabular = isTabular(value);
              const preview =
                value === null || value === undefined
                  ? "null"
                  : Array.isArray(value)
                  ? `[${value.length} itens]`
                  : typeof value === "object"
                  ? `{${Object.keys(value as object).length} chaves}`
                  : String(value).slice(0, 120);

              return (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 10px",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  {/* Type badge */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: `${color}14`,
                      border: `1px solid ${color}30`,
                      flexShrink: 0,
                      minWidth: 56,
                      justifyContent: "center",
                    }}
                  >
                    <Icon size={9} color={color} />
                    <span style={{ fontSize: 9, fontWeight: 700, color, fontFamily: "monospace" }}>{label}</span>
                  </div>

                  {/* Key */}
                  <code style={{ fontSize: 11, color: "#34d399", flexShrink: 0, minWidth: 90 }}>
                    {key}
                  </code>

                  {/* Value preview */}
                  <span
                    style={{
                      fontSize: 11,
                      color: "#94a3b8",
                      fontFamily: "monospace",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                    }}
                  >
                    {preview}
                  </span>

                  {/* Preview table button */}
                  {tabular && (
                    <button
                      onClick={() => onPreviewTable(key, value)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "3px 8px",
                        borderRadius: 5,
                        background: "rgba(52,211,153,0.08)",
                        border: "1px solid rgba(52,211,153,0.25)",
                        color: "#34d399",
                        fontSize: 10,
                        cursor: "pointer",
                        flexShrink: 0,
                        fontWeight: 600,
                        transition: "all 0.12s",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "rgba(52,211,153,0.16)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "rgba(52,211,153,0.08)";
                      }}
                    >
                      <Table2 size={10} />
                      Tabela
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function LogLine({ log }: { log: DebugLog }) {
  const lvlCls: Record<string, string> = {
    error: "text-red-400",
    warn: "text-yellow-400",
    debug: "text-blue-400",
    info: "text-green-400",
  };
  return (
    <div className="flex gap-2 text-xs font-mono py-0.5">
      <span className="text-slate-500 shrink-0">{format(new Date(log.timestamp), "HH:mm:ss.SSS")}</span>
      <span className={`shrink-0 w-12 font-bold ${lvlCls[log.level] ?? "text-slate-400"}`}>[{log.level.toUpperCase()}]</span>
      <span className="text-slate-300 whitespace-pre-wrap break-all">{log.message}</span>
    </div>
  );
}

// ─── Debug canvas inner (needs useReactFlow) ──────────────────────────────────

function DebugCanvasInner({
  nodes,
  edges,
  onNodeClick,
  selectedNodeId,
}: {
  nodes: RFNode[];
  edges: RFEdge[];
  onNodeClick: (nodeId: string) => void;
  selectedNodeId: string | null;
}) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    setTimeout(() => fitView({ padding: 0.18, duration: 400 }), 80);
  }, [nodes.length]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: RFNode) => {
    onNodeClick(node.id);
  }, [onNodeClick]);

  return (
    <ReactFlow
      nodes={nodes.map((n) => ({ ...n, selected: n.id === selectedNodeId }))}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={true}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.25}
      maxZoom={2}
    >
      <Background color="#1e2a3a" gap={20} />
      <Controls />
      <MiniMap
        nodeColor={(n) => statusColor((n.data as any).executionStatus ?? "skipped")}
        className="!bg-card !border-border"
      />
    </ReactFlow>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ExecutionDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const stopExecution = useStopExecution();

  const [debugData, setDebugData] = useState<DebugData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editedConfigs, setEditedConfigs] = useState<Record<string, Record<string, unknown>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [rfNodes, setRfNodes] = useState<RFNode[]>([]);
  const [rfEdges, setRfEdges] = useState<RFEdge[]>([]);
  const [tablePreview, setTablePreview] = useState<{ varName: string; data: unknown } | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Esc closes table preview
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setTablePreview(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const loadDebugData = useCallback(async (): Promise<DebugData | undefined> => {
    if (!id) return undefined;
    try {
      const res = await fetch(`/api/executions/${id}/debug`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DebugData = await res.json();
      setDebugData(data);

      const nodeResultsMap = Object.fromEntries(
        (data.nodeResults ?? []).map((r) => [r.nodeId, r])
      );

      setRfNodes(
        data.nodes.map((n) => {
          // Derive which output branch was taken for branching nodes,
          // so canvas-node can highlight the corresponding handle in green.
          let chosenBranch: string | undefined;
          const snap = nodeResultsMap[n.id]?.outputSnapshot as
            { pipeline?: Record<string, unknown> } | undefined;
          const pl = snap?.pipeline ?? {};
          if (n.type === "if_and") {
            const r = pl["_condition_result"];
            if (r !== undefined) chosenBranch = (r === true || r === "true") ? "true" : "false";
          } else if (n.type === "if_else") {
            const b = pl["_branch"];
            if (typeof b === "string") chosenBranch = b;
          } else if (n.type === "case" || n.type === "switch") {
            const r = pl["_switch_result"];
            if (typeof r === "string") chosenBranch = r;
          }
          return {
            id: n.id,
            type: "custom",
            position: { x: n.positionX, y: n.positionY },
            data: {
              type: n.type,
              label: n.label,
              config: n.config,
              executionStatus: nodeResultsMap[n.id]?.status ?? "skipped",
              executionDurationMs: nodeResultsMap[n.id]?.durationMs ?? undefined,
              chosenBranch,
            },
            selectable: true,
            draggable: false,
            connectable: false,
          };
        })
      );

      // Build a per-source map of { nodeId → chosenHandle } so we can color
      // the edge that took the chosen path in green and dim the others.
      const chosenBySource = new Map<string, string>();
      for (const n of data.nodes) {
        const snap = nodeResultsMap[n.id]?.outputSnapshot as
          { pipeline?: Record<string, unknown> } | undefined;
        const pl = snap?.pipeline ?? {};
        if (n.type === "if_and") {
          const r = pl["_condition_result"];
          if (r !== undefined) chosenBySource.set(n.id, (r === true || r === "true") ? "true" : "false");
        } else if (n.type === "if_else") {
          const b = pl["_branch"];
          if (typeof b === "string") chosenBySource.set(n.id, b);
        } else if (n.type === "case" || n.type === "switch") {
          const r = pl["_switch_result"];
          if (typeof r === "string") chosenBySource.set(n.id, r);
        }
      }

      setRfEdges(
        data.edges.map((e) => {
          const chosen = chosenBySource.get(e.sourceNodeId);
          let stroke = "#475569";
          let strokeWidth = 2;
          let strokeDasharray: string | undefined;
          let animated = false;
          if (chosen !== undefined && e.sourceHandle) {
            if (e.sourceHandle === chosen) {
              stroke = "#22c55e"; // green for the chosen branch
              strokeWidth = 2.5;
              animated = true;
            } else {
              stroke = "#334155"; // very dim for skipped branches
              strokeWidth = 1.5;
              strokeDasharray = "4 4";
            }
          }
          return {
            id: e.id,
            source: e.sourceNodeId,
            target: e.targetNodeId,
            sourceHandle: e.sourceHandle ?? undefined,
            label: e.label ?? undefined,
            type: "smoothstep",
            animated,
            style: { stroke, strokeWidth, strokeDasharray },
            labelStyle: { fill: "#94a3b8", fontSize: 10 },
            labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.9 },
          };
        })
      );

      return data;
    } catch (err: any) {
      setFetchError(err.message ?? "Failed to load");
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDebugData().then((data) => {
      if (data?.status === "running" || data?.status === "pending") {
        pollingRef.current = setInterval(() => {
          loadDebugData().then((d) => {
            if (d && d.status !== "running" && d.status !== "pending") {
              clearInterval(pollingRef.current!);
            }
          });
        }, 2000);
      }
    });
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [loadDebugData]);

  const selectedNodeResult = debugData?.nodeResults?.find((r) => r.nodeId === selectedNodeId) ?? null;
  const selectedNode = debugData?.nodes?.find((n) => n.id === selectedNodeId) ?? null;
  const selectedNodeLogs = debugData?.logs?.filter((l) => l.nodeId === selectedNodeId) ?? [];
  const currentConfig = selectedNodeId
    ? { ...(selectedNode?.config ?? {}), ...(editedConfigs[selectedNodeId] ?? {}) }
    : {};

  // Build NodeOutputMap from this execution's snapshots so the modal's
  // INPUT/OUTPUT panels and the pipeline["x"] drag&drop work natively.
  const lastRunOutputs: NodeOutputMap = (() => {
    const map: NodeOutputMap = {};
    if (!debugData) return map;
    for (const r of debugData.nodeResults) {
      const snap = r.outputSnapshot as { pipeline?: Record<string, unknown> } | undefined;
      if (snap?.pipeline) {
        map[r.nodeId] = {
          pipeline: snap.pipeline,
          label: r.nodeLabel,
          status: r.status,
          rawOutput: r.output ?? null,
        };
      }
    }
    return map;
  })();

  // Wrap selected node into a ReactFlowNode shape consumed by NodeDetailModal.
  const modalNode: RFNode | null = selectedNode
    ? {
        id: selectedNode.id,
        type: "custom",
        position: { x: selectedNode.positionX, y: selectedNode.positionY },
        data: {
          type: selectedNode.type,
          label: selectedNode.label,
          config: currentConfig,
        },
      }
    : null;

  const updateConfig = (key: string, value: unknown) => {
    if (!selectedNodeId) return;
    setEditedConfigs((prev) => ({
      ...prev,
      [selectedNodeId]: { ...(prev[selectedNodeId] ?? selectedNode?.config ?? {}), [key]: value },
    }));
  };

  const handleStop = async () => {
    if (!id) return;
    await stopExecution.mutateAsync({ id });
    toast({ title: "Execução interrompida" });
    queryClient.invalidateQueries({ queryKey: getGetExecutionQueryKey(id) });
    loadDebugData();
  };

  const handleApplyToProduction = async () => {
    if (!debugData || !id) return;
    const hasEdits = Object.keys(editedConfigs).length > 0;
    if (!hasEdits) {
      toast({ title: "Nenhuma alteração para aplicar", description: "Edite pelo menos um nodo primeiro.", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const nodesToSave = debugData.nodes
        .filter((n) => editedConfigs[n.id])
        .map((n) => ({
          id: n.id,
          config: {
            ...n.config,
            ...editedConfigs[n.id],
            pinned: false,
          },
        }));

      const res = await fetch(`/api/executions/${id}/apply-fixes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes: nodesToSave }),
      });
      if (!res.ok) throw new Error("Falha ao aplicar correções");

      toast({
        title: "✅ Aplicado ao workflow!",
        description: `${nodesToSave.length} nodo(s) atualizado(s). A próxima execução usará o código corrigido.`,
      });
      setEditedConfigs({});
      setEditMode(false);
      loadDebugData();
    } catch (err: any) {
      toast({ title: "Erro ao aplicar", description: err.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const isRunning = debugData?.status === "running" || debugData?.status === "pending";
  const hasEdits = Object.keys(editedConfigs).length > 0;

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Activity className="h-8 w-8 animate-pulse text-primary mx-auto mb-3" />
          <p className="text-muted-foreground">Carregando debug da execução…</p>
        </div>
      </div>
    );
  }

  if (fetchError || !debugData) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-3" />
          <p className="text-destructive">Falha ao carregar: {fetchError}</p>
          <Button className="mt-4" variant="outline" onClick={loadDebugData}>Tentar novamente</Button>
        </div>
      </div>
    );
  }

  const totalNodes = debugData.nodeResults.length;
  const successNodes = debugData.nodeResults.filter((r) => r.status === "success").length;
  const failedNodes = debugData.nodeResults.filter((r) => r.status === "failed").length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="h-14 flex-shrink-0 flex items-center justify-between px-4 border-b border-border bg-card z-10">
        <div className="flex items-center gap-3">
          <Link href="/executions">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft size={16} />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm">{debugData.workflowName}</span>
              <StatusBadge status={debugData.status} />
              {debugData.durationMs != null && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock size={11} /> {(debugData.durationMs / 1000).toFixed(2)}s
                </span>
              )}
              {debugData.startedAt && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar size={11} /> {format(new Date(debugData.startedAt), "dd/MM HH:mm:ss")}
                </span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
              {debugData.id.substring(0, 12)}… · {successNodes}/{totalNodes} nodos ok{failedNodes > 0 ? ` · ${failedNodes} erro(s)` : ""}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isRunning && (
            <Button variant="destructive" size="sm" onClick={handleStop} disabled={stopExecution.isPending}>
              Parar
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadDebugData()}
            className="gap-1.5"
          >
            <RefreshCw size={13} />
            Atualizar
          </Button>
          {!isRunning && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation(`/workflows/${debugData.workflowId}/edit?fromExecution=${debugData.id}`)}
              className="gap-1.5"
              title="Abrir o workflow no editor com os dados desta execução pinados em cada nodo"
            >
              <Edit2 size={13} />
              Editar nodos
            </Button>
          )}
          <Link href={`/workflows/${debugData.workflowId}/edit`}>
            <Button variant="ghost" size="sm" className="gap-1.5">
              <Layers size={13} />
              Abrir workflow
            </Button>
          </Link>
        </div>
      </div>

      {/* ── Error banner ── */}
      {debugData.errorMessage && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs font-mono">
          <AlertTriangle size={13} />
          {debugData.errorMessage}
        </div>
      )}

      {/* ── Body: Canvas (modal opens on node click) ── */}
      <div className="flex flex-1 min-h-0">
        {/* Canvas */}
        <div className="flex-1 min-w-0 relative">
          <ReactFlowProvider>
            <DebugCanvasInner
              nodes={rfNodes}
              edges={rfEdges}
              onNodeClick={setSelectedNodeId}
              selectedNodeId={selectedNodeId}
            />
          </ReactFlowProvider>

          {/* Legend */}
          <div className="absolute bottom-4 left-4 flex items-center gap-3 text-[10px] font-medium bg-card/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2">
            {[
              { color: "#22c55e", label: "Sucesso" },
              { color: "#ef4444", label: "Falha" },
              { color: "#3b82f6", label: "Executando" },
              { color: "#6b7280", label: "Ignorado" },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5 text-muted-foreground">
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                {label}
              </div>
            ))}
          </div>

          {/* Click hint */}
          {!selectedNodeId && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 text-[11px] text-muted-foreground bg-card/80 backdrop-blur-sm border border-border rounded-full px-4 py-1.5 pointer-events-none">
              Clique em um nodo para inspecionar
            </div>
          )}
        </div>

      </div>

      {/* ── Detail modal (3-col INPUT / CONFIG / OUTPUT, pipeline["x"] drag&drop) ── */}
      <NodeDetailModal
        open={!!selectedNodeId && !!modalNode}
        onClose={() => setSelectedNodeId(null)}
        node={modalNode}
        workflowId={debugData?.workflowId ?? ""}
        nodes={rfNodes}
        edges={rfEdges}
        lastRunOutputs={lastRunOutputs}
        onUpdateData={(k, v) => {
          if (!editMode) return;
          if (k === "label") updateConfig("__label__", v);
        }}
        onUpdateConfig={(k, v) => { if (editMode) updateConfig(k, v); }}
        onTestNode={() => {
          toast({
            title: "Execução de nodo individual indisponível aqui",
            description: "Abra o workflow para testar nodos isoladamente.",
          });
        }}
        testLoading={false}
        testResult={
          selectedNodeResult
            ? {
                output: selectedNodeResult.output ?? "",
                success: selectedNodeResult.status === "success",
                durationMs: selectedNodeResult.durationMs ?? 0,
                pipeline:
                  (selectedNodeResult.outputSnapshot as { pipeline?: Record<string, unknown> } | undefined)
                    ?.pipeline ?? null,
              }
            : null
        }
        onRefreshOutputs={() => loadDebugData()}
        nodeLogs={selectedNodeLogs}
      />

      {/* ── Global logs drawer (bottom, always visible) ── */}
      <GlobalLogs logs={debugData.logs.filter((l) => !l.nodeId)} />

      {/* ── Data table preview modal ── */}
      {tablePreview && (
        <DataTableModal
          data={tablePreview.data}
          varName={tablePreview.varName}
          onClose={() => setTablePreview(null)}
        />
      )}
    </div>
  );
}

function GlobalLogs({ logs }: { logs: DebugLog[] }) {
  const [open, setOpen] = useState(false);
  if (logs.length === 0) return null;
  return (
    <div className="flex-shrink-0 border-t border-border">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/30 transition-colors text-xs text-muted-foreground"
      >
        <div className="flex items-center gap-2">
          <Terminal size={12} />
          <span className="font-semibold uppercase tracking-wider">Logs globais da execução</span>
          <Badge variant="secondary" className="text-[10px] h-4 px-1">{logs.length}</Badge>
        </div>
        <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="bg-[#0d1117] border-t border-border/50 px-4 py-3 max-h-40 overflow-y-auto font-mono">
          {logs.map((log) => <LogLine key={log.id} log={log} />)}
        </div>
      )}
    </div>
  );
}
