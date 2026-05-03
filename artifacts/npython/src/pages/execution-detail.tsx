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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { CanvasNode } from "@/components/canvas-node";
import { format } from "date-fns";
import { useStopExecution, getGetExecutionQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

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
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        data.nodes.map((n) => ({
          id: n.id,
          type: "custom",
          position: { x: n.positionX, y: n.positionY },
          data: {
            type: n.type,
            label: n.label,
            config: n.config,
            executionStatus: nodeResultsMap[n.id]?.status ?? "skipped",
            executionDurationMs: nodeResultsMap[n.id]?.durationMs ?? undefined,
          },
          selectable: true,
          draggable: false,
          connectable: false,
        }))
      );

      setRfEdges(
        data.edges.map((e) => ({
          id: e.id,
          source: e.sourceNodeId,
          target: e.targetNodeId,
          label: e.label ?? undefined,
          type: "smoothstep",
          style: { stroke: "#475569", strokeWidth: 2 },
          labelStyle: { fill: "#94a3b8", fontSize: 10 },
          labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.9 },
        }))
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
              variant={editMode ? "secondary" : "outline"}
              size="sm"
              onClick={() => { setEditMode(!editMode); if (editMode) setEditedConfigs({}); }}
              className="gap-1.5"
            >
              {editMode ? <X size={13} /> : <Edit2 size={13} />}
              {editMode ? "Cancelar edição" : "Editar nodos"}
            </Button>
          )}
          {editMode && (
            <Button
              size="sm"
              onClick={handleApplyToProduction}
              disabled={isSaving || !hasEdits}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isSaving ? <Activity size={13} className="animate-spin" /> : <Save size={13} />}
              Aplicar ao Workflow
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

      {/* ── Body: Canvas + Inspector ── */}
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

        {/* ── Inspector Panel ── */}
        {selectedNodeId && selectedNode && (
          <div className="w-[420px] flex-shrink-0 border-l border-border flex flex-col bg-card overflow-hidden">
            {/* Node header */}
            <div className="flex-shrink-0 px-4 py-3 border-b border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Code2 size={15} className="text-primary flex-shrink-0" />
                  <span className="font-semibold text-sm truncate">{selectedNode.label}</span>
                  {selectedNodeResult && <StatusBadge status={selectedNodeResult.status} />}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-shrink-0"
                  onClick={() => setSelectedNodeId(null)}
                >
                  <X size={14} />
                </Button>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{selectedNode.type}</span>
                {selectedNodeResult?.durationMs != null && (
                  <span className="flex items-center gap-1">
                    <Clock size={10} />
                    {selectedNodeResult.durationMs < 1000
                      ? `${selectedNodeResult.durationMs}ms`
                      : `${(selectedNodeResult.durationMs / 1000).toFixed(2)}s`}
                  </span>
                )}
                {selectedNodeResult?.startedAt && (
                  <span className="flex items-center gap-1">
                    <Calendar size={10} />
                    {format(new Date(selectedNodeResult.startedAt), "HH:mm:ss")}
                  </span>
                )}
                {editMode && editedConfigs[selectedNodeId] && (
                  <span className="text-amber-400 font-semibold">● Editado</span>
                )}
              </div>
            </div>

            {/* Error display */}
            {selectedNodeResult?.error && (
              <div className="flex-shrink-0 mx-3 mt-3 flex items-start gap-2 bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2 text-xs text-red-400 font-mono">
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                <span className="whitespace-pre-wrap break-all">{selectedNodeResult.error}</span>
              </div>
            )}

            {/* Tabs */}
            <Tabs defaultValue="output" className="flex flex-col flex-1 min-h-0">
              <TabsList className="flex-shrink-0 mx-3 mt-3 mb-0 grid grid-cols-4 h-8">
                <TabsTrigger value="output" className="text-xs">Saída</TabsTrigger>
                <TabsTrigger value="input" className="text-xs">Entrada</TabsTrigger>
                <TabsTrigger value="params" className="text-xs">Parâmetros</TabsTrigger>
                <TabsTrigger value="logs" className="text-xs">
                  Logs {selectedNodeLogs.length > 0 && `(${selectedNodeLogs.length})`}
                </TabsTrigger>
              </TabsList>

              {/* OUTPUT tab */}
              <TabsContent value="output" className="flex-1 overflow-y-auto px-3 pb-3 mt-2 space-y-3">
                {selectedNodeResult?.output ? (
                  <div className="rounded-lg border border-border/40 overflow-hidden">
                    <div className="px-3 py-1.5 bg-muted/30 border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Resultado da execução
                    </div>
                    <pre className="p-3 text-xs font-mono bg-[#0d1117] text-emerald-300 whitespace-pre-wrap break-all max-h-48 overflow-auto">
                      {selectedNodeResult.output}
                    </pre>
                  </div>
                ) : selectedNodeResult?.status === "failed" ? (
                  <div className="text-xs text-muted-foreground italic text-center py-4">Sem saída — nodo falhou.</div>
                ) : selectedNodeResult?.status === "pending" || selectedNodeResult?.status === "skipped" ? (
                  <div className="text-xs text-muted-foreground italic text-center py-4">Nodo não executado.</div>
                ) : null}

                {selectedNodeResult?.outputSnapshot !== undefined && (
                  <JsonViewer data={selectedNodeResult.outputSnapshot} title="Contexto do pipeline após execução" />
                )}
              </TabsContent>

              {/* INPUT tab */}
              <TabsContent value="input" className="flex-1 overflow-y-auto px-3 pb-3 mt-2 space-y-3">
                {selectedNodeResult?.inputSnapshot !== undefined ? (
                  <JsonViewer data={selectedNodeResult.inputSnapshot} title="Contexto do pipeline antes da execução" />
                ) : (
                  <div className="text-xs text-muted-foreground italic text-center py-6">
                    Snapshot de entrada não disponível.<br />
                    <span className="text-[11px]">Execute o workflow novamente para capturar dados.</span>
                  </div>
                )}
              </TabsContent>

              {/* PARAMS tab */}
              <TabsContent value="params" className="flex-1 overflow-y-auto px-3 pb-3 mt-2">
                {selectedNode.type === "code" ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">Código Python</span>
                      {editMode && editedConfigs[selectedNodeId] && (
                        <span className="text-[10px] text-amber-400 font-medium">● Alterado</span>
                      )}
                    </div>
                    <div className={`rounded-lg overflow-hidden border ${editMode ? "border-primary/50 ring-1 ring-primary/20" : "border-border/40"}`}>
                      <CodeMirror
                        value={String(currentConfig.code ?? "")}
                        height="320px"
                        extensions={[python()]}
                        theme="dark"
                        editable={editMode}
                        onChange={(val) => editMode && updateConfig("code", val)}
                        basicSetup={{ lineNumbers: true, foldGutter: false }}
                      />
                    </div>
                    {!editMode && (
                      <p className="text-[10px] text-muted-foreground">
                        Ative o <strong>Modo Edição</strong> no topo para modificar este código.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-muted-foreground block mb-2">Configuração do nodo</span>
                    {Object.entries(currentConfig).length === 0 ? (
                      <div className="text-xs text-muted-foreground italic text-center py-4">Sem parâmetros configurados.</div>
                    ) : (
                      Object.entries(currentConfig).map(([key, val]) => (
                        <div key={key} className="flex items-start gap-2 py-2 border-b border-border/30 last:border-0">
                          <span className="text-[11px] font-mono text-muted-foreground w-28 flex-shrink-0 pt-0.5">{key}</span>
                          {editMode ? (
                            <input
                              className="flex-1 text-xs font-mono bg-muted/30 border border-border rounded px-2 py-1 text-foreground outline-none focus:border-primary/50 min-w-0"
                              value={String(val ?? "")}
                              onChange={(e) => updateConfig(key, e.target.value)}
                            />
                          ) : (
                            <span className="text-xs font-mono text-foreground break-all">
                              {typeof val === "boolean"
                                ? (val ? "true" : "false")
                                : typeof val === "object"
                                ? JSON.stringify(val)
                                : String(val ?? "")}
                            </span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </TabsContent>

              {/* LOGS tab */}
              <TabsContent value="logs" className="flex-1 overflow-y-auto px-3 pb-3 mt-2">
                <div className="rounded-lg border border-border/40 overflow-hidden">
                  <div className="px-3 py-1.5 bg-[#161b22] border-b border-border/30 flex items-center gap-2">
                    <Terminal size={12} className="text-muted-foreground" />
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Log lines — {selectedNode.label}
                    </span>
                  </div>
                  <div className="bg-[#0d1117] p-3 max-h-96 overflow-y-auto">
                    {selectedNodeLogs.length === 0 ? (
                      <span className="text-xs text-slate-600 italic">Sem logs para este nodo.</span>
                    ) : (
                      selectedNodeLogs.map((log) => <LogLine key={log.id} log={log} />)
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      {/* ── Global logs drawer (bottom, always visible) ── */}
      <GlobalLogs logs={debugData.logs.filter((l) => !l.nodeId)} />
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
