import { useState, useCallback, useEffect, useRef, useMemo, createContext, useContext } from "react";
import { useParams, useLocation } from "wouter";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node as ReactFlowNode,
  Edge as ReactFlowEdge,
  applyNodeChanges,
  applyEdgeChanges,
  NodeChange,
  EdgeChange,
  Connection,
  addEdge,
  ReactFlowProvider,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  useGetWorkflow,
  useUpdateWorkflow,
  useExecuteWorkflow,
  Node as ApiNode,
  Edge as ApiEdge,
  getGetWorkflowQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Play, Save, Settings, X, Trash2, AlertTriangle,
  FlaskConical, Pin, PinOff, CheckCircle2, XCircle, Loader2, Plus, Package,
  Eye, EyeOff, Lock, ShieldOff, Shield, Database,
  ChevronDown, ChevronRight, Network, Copy, Zap, Download, PackageCheck,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";

import { CanvasNode } from "@/components/canvas-node";
import { EdgeWithDelete } from "@/components/edge-with-delete";
import { NodePalette } from "@/components/node-palette";
import { NodeDef, getNodeDef, isTriggerType, isDatabaseNodeType, parseDbNodeType, DB_META, DB_OP_META, VARIABLE_SCOPES } from "@/lib/node-definitions";
import {
  useListVariables,
} from "@workspace/api-client-react";

const nodeTypes = { custom: CanvasNode };
const edgeTypes = { custom: EdgeWithDelete };

// ─── Dep map: node type → required pip package ────────────────────────────────
function getNodePkg(nodeType: string): string | null {
  if (/^pg_/.test(nodeType))       return "psycopg2-binary";
  if (/^mysql_/.test(nodeType))    return "pymysql";
  if (/^mssql_/.test(nodeType))    return "pyodbc";
  if (/^oracle_/.test(nodeType))   return "oracledb";
  if (/^supabase_/.test(nodeType)) return "requests";
  if (nodeType === "http_request") return "requests";
  return null;
}

// ─── Inner editor ─────────────────────────────────────────────────────────────

function WorkflowEditorInner({ workflowId }: { workflowId: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const reactFlow = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { data: workflow, isLoading } = useGetWorkflow(workflowId, {
    query: { enabled: !!workflowId, queryKey: getGetWorkflowQueryKey(workflowId) },
  });
  const updateWorkflow = useUpdateWorkflow();
  const executeWorkflow = useExecuteWorkflow();

  const [nodes, setNodes] = useState<ReactFlowNode[]>([]);
  const [edges, setEdges] = useState<ReactFlowEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<ReactFlowNode | null>(null);
  const [testResult, setTestResult] = useState<{ output: string; success: boolean; durationMs: number } | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const initRef = useRef(false);

  // ── Last-run outputs (per-node pipeline snapshots) ─────────────────
  type NodeOutput = { pipeline: Record<string, unknown>; label: string; status: string; rawOutput: string | null };
  const [lastRunOutputs, setLastRunOutputs] = useState<Record<string, NodeOutput>>({});
  const [configPanelTab, setConfigPanelTab] = useState<"config" | "output">("config");

  // ── Installed packages + dep-install dialog ─────────────────────────
  const [installedPkgs, setInstalledPkgs] = useState<string[]>([]);
  type DepDialog = { def: NodeDef; pkg: string; position?: { x: number; y: number } };
  const [depDialog, setDepDialog] = useState<DepDialog | null>(null);
  const [depInstalling, setDepInstalling] = useState(false);

  // Clear test result + reset tab when selected node changes
  useEffect(() => { setTestResult(null); setConfigPanelTab("config"); }, [selectedNode?.id]);

  const fetchLastRunOutputs = useCallback(async () => {
    try {
      const res = await fetch(`/api/executions/workflow/${workflowId}/last-outputs`);
      if (!res.ok) return;
      const data = await res.json();
      setLastRunOutputs(data.nodeOutputs ?? {});
    } catch {}
  }, [workflowId]);

  const fetchInstalledPkgs = useCallback(async () => {
    try {
      const res = await fetch(`/api/workflows/${workflowId}/packages`);
      if (!res.ok) return;
      const data: { name: string }[] = await res.json();
      setInstalledPkgs(data.map((p) => p.name.toLowerCase()));
    } catch {}
  }, [workflowId]);

  useEffect(() => { fetchLastRunOutputs(); }, [fetchLastRunOutputs]);
  useEffect(() => { fetchInstalledPkgs(); }, [fetchInstalledPkgs]);

  // Load workflow nodes/edges once
  useEffect(() => {
    if (workflow && !initRef.current) {
      initRef.current = true;
      setNodes(
        (workflow.nodes || []).map((n) => ({
          id: n.id,
          type: "custom",
          position: { x: n.positionX, y: n.positionY },
          data: { ...n },
        }))
      );
      setEdges(
        (workflow.edges || []).map((e) => ({
          id: e.id,
          type: "custom",
          source: e.sourceNodeId,
          target: e.targetNodeId,
          label: e.label ?? undefined,
          animated: true,
          style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
        }))
      );
    }
  }, [workflow]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
    setSelectedNode((sel) => {
      if (!sel) return sel;
      return changes.some((c) => c.type === "remove" && c.id === sel.id) ? null : sel;
    });
  }, []);

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: "custom",
            animated: true,
            style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
          },
          eds
        )
      ),
    []
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: ReactFlowNode) => {
    setSelectedNode(node);
  }, []);

  // ── Drag-and-drop from palette ────────────────────────────────────
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const doAddNode = useCallback((def: NodeDef, position?: { x: number; y: number }) => {
    const pos = position ?? { x: 200 + Math.random() * 200, y: 150 + Math.random() * 150 };
    const newNode: ReactFlowNode = {
      id: `node_${Date.now()}`,
      type: "custom",
      position: pos,
      data: {
        label: def.label,
        type: def.type,
        config: { ...def.defaultConfig },
        retryCount: 0,
        retryDelayMs: 1000,
        continueOnError: false,
        stopOnError: true,
      },
    };
    setNodes((nds) => [...nds, newNode]);
  }, []);

  const addNodeFromDef = useCallback((def: NodeDef, position?: { x: number; y: number }) => {
    const pkg = getNodePkg(def.type);
    if (pkg && !installedPkgs.includes(pkg.toLowerCase())) {
      setDepDialog({ def, pkg, position });
      return;
    }
    doAddNode(def, position);
  }, [installedPkgs, doAddNode]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("application/flowpython-node");
      if (!raw) return;
      const def: NodeDef = JSON.parse(raw);
      const position = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNodeFromDef(def, position);
    },
    [reactFlow, addNodeFromDef]
  );

  // ── Save ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    const apiNodes: ApiNode[] = nodes.map((n) => ({
      id: n.id,
      workflowId,
      type: n.data.type || "code",
      label: n.data.label || "Node",
      positionX: n.position.x,
      positionY: n.position.y,
      config: n.data.config || {},
      retryCount: n.data.retryCount ?? 0,
      retryDelayMs: n.data.retryDelayMs ?? 1000,
      continueOnError: n.data.continueOnError ?? false,
      stopOnError: n.data.stopOnError ?? true,
      createdAt: n.data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const apiEdges: ApiEdge[] = edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.source,
      targetNodeId: e.target,
      label: e.label as string,
      condition: null,
    }));
    try {
      await updateWorkflow.mutateAsync({ id: workflowId, data: { nodes: apiNodes, edges: apiEdges } });
      toast({ title: "Workflow salvo" });
      queryClient.invalidateQueries({ queryKey: getGetWorkflowQueryKey(workflowId) });
    } catch {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    }
  };

  // ── Execute (validate trigger first) ─────────────────────────────
  const handleExecute = async () => {
    const hasTrigger = nodes.some((n) => isTriggerType(n.data.type as string));
    if (!hasTrigger) {
      toast({
        title: "Trigger obrigatório",
        description: "Adicione ao menos um nodo Trigger antes de executar.",
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await executeWorkflow.mutateAsync({ id: workflowId });
      toast({ title: "Execução iniciada" });
      setLocation(`/executions/${res.id}`);
    } catch {
      toast({ title: "Erro ao executar", variant: "destructive" });
    }
  };

  // ── Test single node ──────────────────────────────────────────────
  const handleTestNode = async () => {
    if (!selectedNode) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch(
        `/api/workflows/${workflowId}/nodes/${selectedNode.id}/execute`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }
      );
      const data = await res.json();
      setTestResult({ output: data.output ?? data.error ?? "", success: data.success, durationMs: data.durationMs ?? 0 });
      fetchLastRunOutputs();
    } catch (e: any) {
      setTestResult({ output: e.message, success: false, durationMs: 0 });
    } finally {
      setTestLoading(false);
    }
  };

  // ── Config panel helpers ──────────────────────────────────────────
  const updateNodeData = (key: string, value: unknown) => {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedNode.id) return n;
        const newData = { ...n.data, [key]: value };
        setSelectedNode({ ...n, data: newData });
        return { ...n, data: newData };
      })
    );
  };

  const updateNodeConfig = (key: string, value: unknown) => {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedNode.id) return n;
        const newConfig = { ...(n.data.config || {}), [key]: value };
        const newData = { ...n.data, config: newConfig };
        setSelectedNode({ ...n, data: newData });
        return { ...n, data: newData };
      })
    );
  };

  const deleteSelectedNode = () => {
    if (!selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNode(null);
  };

  const hasTrigger = nodes.some((n) => isTriggerType(n.data.type as string));

  // Map each pipeline variable name to its source node's color + label
  const varColorMap = useMemo<Record<string, VarColorInfo>>(() => {
    const map: Record<string, VarColorInfo> = {};
    for (const [nodeId, out] of Object.entries(lastRunOutputs)) {
      const color = nodeColorFromId(nodeId);
      for (const varName of Object.keys(out.pipeline)) {
        map[varName] = { color, nodeLabel: out.label, nodeId };
      }
    }
    return map;
  }, [lastRunOutputs]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Carregando editor...</div>;
  }

  // ── Dep-install confirmation handler ─────────────────────────────
  const handleInstallDep = async (skipInstall: boolean) => {
    if (!depDialog) return;
    const { def, pkg, position } = depDialog;
    if (!skipInstall) {
      setDepInstalling(true);
      try {
        const res = await fetch(`/api/workflows/${workflowId}/packages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: pkg, version: "" }),
        });
        if (res.ok) {
          setInstalledPkgs((prev) => [...prev, pkg.toLowerCase()]);
          toast({ title: "Biblioteca instalada", description: `${pkg} instalada com sucesso no ambiente do workflow.` });
        } else {
          const err = await res.json().catch(() => ({ error: "Erro desconhecido" }));
          toast({ title: "Erro ao instalar", description: err.error ?? "Falha na instalação.", variant: "destructive" });
        }
      } catch {
        toast({ title: "Erro de rede", description: "Não foi possível instalar a biblioteca.", variant: "destructive" });
      } finally {
        setDepInstalling(false);
      }
    }
    setDepDialog(null);
    doAddNode(def, position);
  };

  return (
    <VarColorCtx.Provider value={varColorMap}>

    {/* ── Dependency installation dialog ── */}
    <AlertDialog open={!!depDialog} onOpenChange={(o) => { if (!o && !depInstalling) setDepDialog(null); }}>
      <AlertDialogContent style={{ maxWidth: 440 }}>
        <AlertDialogHeader>
          <AlertDialogTitle style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Package className="h-5 w-5" style={{ color: "#f472b6" }} />
            Dependência Python detectada
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div style={{ lineHeight: 1.6 }}>
              <p>O nodo <strong>{depDialog?.def.label}</strong> requer a biblioteca:</p>
              <code style={{
                display: "inline-block", margin: "8px 0",
                padding: "4px 10px", borderRadius: 6,
                background: "hsl(var(--muted))", color: "#f472b6",
                fontWeight: 700, fontSize: 14,
              }}>{depDialog?.pkg}</code>
              <p style={{ marginTop: 4 }}>
                Deseja instalá-la agora no ambiente virtual deste workflow?
                A instalação pode levar alguns segundos.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter style={{ gap: 8 }}>
          <Button variant="ghost" size="sm" onClick={() => setDepDialog(null)} disabled={depInstalling}>
            Cancelar
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleInstallDep(true)} disabled={depInstalling}>
            Adicionar sem instalar
          </Button>
          <Button size="sm" onClick={() => handleInstallDep(false)} disabled={depInstalling}
            style={{ background: "#f472b6", color: "#000" }}>
            {depInstalling
              ? <><Loader2 className="h-4 w-4 animate-spin" style={{ marginRight: 6 }} />Instalando...</>
              : <><Download className="h-4 w-4" style={{ marginRight: 6 }} />Instalar e adicionar</>
            }
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <div className="flex h-full w-full" style={{ overflow: "hidden" }}>
      {/* Node palette */}
      <NodePalette onAddNode={(def) => addNodeFromDef(def)} />

      {/* Canvas area */}
      <div className="flex-1 flex flex-col h-full relative">
        {/* Header */}
        <div style={{
          height: 52, borderBottom: "1px solid hsl(var(--border))",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 12px", background: "hsl(var(--card))", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Button variant="ghost" size="icon" onClick={() => setLocation("/workflows")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{workflow?.name ?? "Workflow"}</span>
            {workflow?.active
              ? <Badge variant="default" className="text-xs">Active</Badge>
              : <Badge variant="secondary" className="text-xs">Inactive</Badge>}
            {!hasTrigger && nodes.length > 0 && (
              <div style={{
                display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#fbbf24",
                background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)",
                borderRadius: 6, padding: "3px 8px",
              }}>
                <AlertTriangle size={12} /> Adicione um Trigger
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Button variant="ghost" size="sm" onClick={handleSave} disabled={updateWorkflow.isPending}>
              <Save className="h-4 w-4 mr-1.5" /> Salvar
            </Button>
            <Button variant="default" size="sm" onClick={handleExecute} disabled={executeWorkflow.isPending}>
              <Play className="h-4 w-4 mr-1.5" /> Executar
            </Button>
          </div>
        </div>

        {/* Flow canvas */}
        <div ref={wrapperRef} className="flex-1" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={() => setSelectedNode(null)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            deleteKeyCode="Delete"
            style={{ background: "hsl(var(--background))" }}
          >
            <Background color="rgba(255,255,255,0.04)" gap={20} />
            <Controls style={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
            }} />
            <MiniMap
              style={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
              }}
              nodeColor={(n) => getNodeDef(n.data?.type)?.color ?? "#94a3b8"}
            />
          </ReactFlow>
        </div>
      </div>

      {/* Config panel */}
      {selectedNode && (
        <div style={{
          width: 390, height: "100%", background: "hsl(var(--card))",
          borderLeft: "1px solid hsl(var(--border))",
          display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden",
        }}>
          {/* Panel header + tabs */}
          <div style={{
            padding: "10px 14px 0", borderBottom: "1px solid hsl(var(--border))",
            flexShrink: 0, background: "hsl(var(--card))",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ minWidth: 0, flex: 1, paddingRight: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {selectedNode.data.label as string}
                </div>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 1 }}>
                  {getNodeDef(selectedNode.data.type as string)?.description}
                </div>
              </div>
              <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                <Button variant="ghost" size="icon" onClick={deleteSelectedNode} title="Deletar node">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setSelectedNode(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {/* Tabs */}
            <div style={{ display: "flex", gap: 0, marginBottom: -1 }}>
              {([
                { id: "config" as const, label: "Config", icon: <Settings size={11} /> },
                {
                  id: "output" as const,
                  label: "Saída",
                  icon: <Zap size={11} />,
                  badge: lastRunOutputs[selectedNode.id]
                    ? Object.keys(lastRunOutputs[selectedNode.id].pipeline).length
                    : null,
                  dot: !!lastRunOutputs[selectedNode.id],
                },
              ]).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setConfigPanelTab(tab.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "5px 14px", border: "none", background: "transparent",
                    borderBottom: configPanelTab === tab.id ? "2px solid #a78bfa" : "2px solid transparent",
                    color: configPanelTab === tab.id ? "#a78bfa" : "hsl(var(--muted-foreground))",
                    fontSize: 12, fontWeight: configPanelTab === tab.id ? 600 : 400,
                    cursor: "pointer", transition: "all 0.12s",
                  }}
                >
                  {tab.icon}
                  {tab.label}
                  {"badge" in tab && tab.badge != null && (
                    <span style={{
                      fontSize: 9, padding: "1px 5px", borderRadius: 10,
                      background: "rgba(167,139,250,0.2)", color: "#a78bfa", fontWeight: 700,
                    }}>{tab.badge}</span>
                  )}
                  {"dot" in tab && tab.dot && tab.badge === null && (
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#a78bfa" }} />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Panel body — drop zone for var chips */}
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
            {configPanelTab === "output" ? (
              <NodeOutputPreview
                nodeId={selectedNode.id}
                lastRunOutputs={lastRunOutputs}
                onInsert={(ref) => insertVarRef(ref, toast)}
              />
            ) : (
              <>
                <UpstreamVarPicker
                  nodeId={selectedNode.id}
                  nodes={nodes}
                  edges={edges}
                  lastRunOutputs={lastRunOutputs}
                  onInsert={(ref) => insertVarRef(ref, toast)}
                  onConnect={(sourceId) => {
                    setEdges((eds) => {
                      if (eds.some((e) => e.source === sourceId && e.target === selectedNode!.id)) return eds;
                      return addEdge({
                        id: `edge_${Date.now()}`,
                        source: sourceId,
                        target: selectedNode!.id,
                        type: "custom",
                        animated: true,
                        style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
                      }, eds);
                    });
                  }}
                />
                <NodeConfigPanel
                  node={selectedNode}
                  workflowId={workflowId}
                  onUpdateData={updateNodeData}
                  onUpdateConfig={updateNodeConfig}
                  onTestNode={handleTestNode}
                  testLoading={testLoading}
                  testResult={testResult}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
    </VarColorCtx.Provider>
  );
}

// ─── Config panel ─────────────────────────────────────────────────────────────

// ─── Variable Preview System ──────────────────────────────────────────────────

// Stable palette: each source node gets a unique accent color derived from its ID
const NODE_PALETTE = [
  "#14b8a6", // teal
  "#f97316", // orange
  "#06b6d4", // cyan
  "#f43f5e", // rose
  "#84cc16", // lime
  "#eab308", // yellow
  "#8b5cf6", // violet
  "#10b981", // emerald
  "#3b82f6", // blue
  "#ec4899", // pink
];
function nodeColorFromId(nodeId: string): string {
  let h = 0;
  for (let i = 0; i < nodeId.length; i++) h = (h * 31 + nodeId.charCodeAt(i)) & 0xffff;
  return NODE_PALETTE[h % NODE_PALETTE.length];
}

type VarColorInfo = { color: string; nodeLabel: string; nodeId: string };
const VarColorCtx = createContext<Record<string, VarColorInfo>>({});

// Extension that makes CodeMirror editors accept variable chip drops
const varDropExtension = EditorView.domEventHandlers({
  dragover(event) {
    if (event.dataTransfer?.types.includes("application/flowpython-var")) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }
  },
  drop(event, view) {
    const ref = event.dataTransfer?.getData("application/flowpython-var");
    if (ref) {
      event.preventDefault();
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.doc.length;
      view.dispatch({
        changes: { from: pos, insert: ref },
        selection: { anchor: pos + ref.length },
      });
    }
  },
});

// Parse a string into text segments and pipeline variable references
type VarSegment = { isVar: true; varName: string } | { isVar: false; text: string };
function parseVarRefs(value: string): VarSegment[] {
  const pattern = /pipeline\["([^"]+)"\]/g;
  const segments: VarSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) segments.push({ isVar: false, text: value.slice(lastIndex, match.index) });
    segments.push({ isVar: true, varName: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) segments.push({ isVar: false, text: value.slice(lastIndex) });
  return segments;
}

// Input field that renders pipeline["x"] variable references as colored visual chips when blurred
function VarTokenInput({
  value, onChange, placeholder, style,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; style?: React.CSSProperties;
}) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const segments = useMemo(() => parseVarRefs(value ?? ""), [value]);
  const showTokenView = !focused && segments.some((s) => s.isVar);
  const varColorMap = useContext(VarColorCtx);

  const handleDrop = (e: React.DragEvent) => {
    const ref = e.dataTransfer.getData("application/flowpython-var");
    if (!ref) return;
    e.preventDefault();
    const el = inputRef.current;
    if (el && focused) {
      const start = el.selectionStart ?? (value ?? "").length;
      const end = el.selectionEnd ?? start;
      const newVal = (value ?? "").slice(0, start) + ref + (value ?? "").slice(end);
      onChange(newVal);
      requestAnimationFrame(() => el.setSelectionRange(start + ref.length, start + ref.length));
    } else {
      onChange((value ?? "") + ref);
    }
  };

  const borderStyle = focused
    ? "1px solid hsl(var(--ring))"
    : "1px solid hsl(var(--border))";

  return (
    <div
      style={{ position: "relative", ...style }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("application/flowpython-var")) e.preventDefault(); }}
      onDrop={handleDrop}
    >
      {/* Real input — hidden when showing token view, but always in DOM for ref/focus */}
      <input
        ref={inputRef}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setTimeout(() => setFocused(false), 80); }}
        placeholder={showTokenView ? "" : placeholder}
        style={{
          display: showTokenView ? "none" : "block",
          width: "100%", height: 36, padding: "0 10px",
          background: "hsl(var(--background))",
          border: borderStyle,
          borderRadius: 6, color: "hsl(var(--foreground))",
          fontSize: 12, fontFamily: "monospace", outline: "none",
          boxSizing: "border-box",
        }}
      />
      {/* Token view — shown when value contains pipeline refs and input is not focused */}
      {showTokenView && (
        <div
          onClick={() => { setFocused(true); requestAnimationFrame(() => inputRef.current?.focus()); }}
          title="Clique para editar"
          style={{
            minHeight: 36, padding: "5px 10px",
            background: "hsl(var(--background))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 6,
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 3,
            cursor: "text",
          }}
        >
          {segments.map((seg, i) => {
            if (!seg.isVar) {
              return seg.text
                ? <span key={i} style={{ fontSize: 12, fontFamily: "monospace", color: "hsl(var(--foreground))" }}>{seg.text}</span>
                : null;
            }
            const meta = varColorMap[seg.varName];
            const chipColor = meta?.color ?? "#a78bfa";
            const chipLabel = meta?.nodeLabel;
            const truncChipLabel = chipLabel && chipLabel.length > 14 ? chipLabel.slice(0, 13) + "…" : chipLabel;
            return (
              <span key={i} style={{
                display: "inline-flex", flexDirection: "column", gap: 0,
                padding: "2px 8px 2px 6px", borderRadius: 4,
                background: `${chipColor}12`, border: `1px solid ${chipColor}40`,
                borderLeft: `3px solid ${chipColor}`,
                fontFamily: "monospace",
              }}>
                {truncChipLabel && (
                  <span style={{ fontSize: 8, fontWeight: 700, color: chipColor, textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1, opacity: 0.85 }}>
                    {truncChipLabel}
                  </span>
                )}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color: chipColor }}>
                  <Network size={9} /> {seg.varName}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function insertVarRef(ref: string, toast: ReturnType<typeof useToast>["toast"]) {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA") && !el.readOnly) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const newVal = el.value.slice(0, start) + ref + el.value.slice(end);
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) {
      setter.call(el, newVal);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.setSelectionRange(start + ref.length, start + ref.length);
      return;
    }
  }
  navigator.clipboard?.writeText(ref).catch(() => {});
  toast({ title: "Variável copiada!", description: ref, duration: 2000 });
}

function getVarMeta(value: unknown): { type: string; color: string; preview: string } {
  if (value === null || value === undefined) return { type: "null", color: "#94a3b8", preview: "null" };
  if (Array.isArray(value)) return { type: "lista", color: "#f59e0b", preview: `[${value.length} item(s)]` };
  const t = typeof value;
  if (t === "boolean") return { type: "bool", color: "#f472b6", preview: String(value) };
  if (t === "number") return { type: "num", color: "#60a5fa", preview: String(value) };
  if (t === "object") return {
    type: "dict", color: "#a78bfa",
    preview: `{${Object.keys(value as object).length} chave(s)}`,
  };
  const s = String(value);
  return { type: "str", color: "#34d399", preview: s.length > 38 ? s.slice(0, 38) + "…" : s };
}

function VarChip({
  varName, value, onInsert, nodeColor, nodeLabel,
}: {
  varName: string; value: unknown; onInsert: (ref: string) => void;
  nodeColor?: string; nodeLabel?: string;
}) {
  const ref = `pipeline["${varName}"]`;
  const { type, color: typeColor, preview } = getVarMeta(value);
  const accent = nodeColor ?? typeColor;
  const truncLabel = nodeLabel && nodeLabel.length > 16 ? nodeLabel.slice(0, 15) + "…" : nodeLabel;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/flowpython-var", ref);
        e.dataTransfer.setData("text/plain", ref);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onInsert(ref)}
      title={`${ref}${nodeLabel ? `  ←  ${nodeLabel}` : ""}`}
      style={{
        display: "inline-flex", flexDirection: "column", gap: 1,
        padding: "3px 8px 3px 6px", borderRadius: 6, marginBottom: 4, marginRight: 4,
        border: `1px solid ${accent}40`, background: `${accent}10`,
        borderLeft: `3px solid ${accent}`,
        cursor: "grab", userSelect: "none", maxWidth: "100%",
        transition: "background 0.12s",
      }}
    >
      {truncLabel && (
        <span style={{
          fontSize: 8, fontWeight: 700, color: accent, textTransform: "uppercase",
          letterSpacing: "0.06em", lineHeight: 1, opacity: 0.85,
        }}>
          {truncLabel}
        </span>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, color: accent, flexShrink: 0 }}>{varName}</span>
        <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3, background: `${typeColor}25`, color: typeColor, fontWeight: 700, flexShrink: 0 }}>{type}</span>
        <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 88 }}>{preview}</span>
      </div>
    </div>
  );
}

function JsonVarRow({ name, value }: { name: string; value: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const { type, color, preview } = getVarMeta(value);
  const isExpandable = typeof value === "object" && value !== null;
  return (
    <div style={{ marginBottom: 6 }}>
      <div
        style={{ display: "flex", alignItems: "baseline", gap: 6, cursor: isExpandable ? "pointer" : "default" }}
        onClick={() => isExpandable && setExpanded((e) => !e)}
      >
        <span style={{ width: 10, flexShrink: 0, color: "hsl(var(--muted-foreground))", fontSize: 10 }}>
          {isExpandable ? (expanded ? "▼" : "▶") : ""}
        </span>
        <span style={{ fontFamily: "monospace", fontSize: 11, color, fontWeight: 600 }}>{name}</span>
        <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", padding: "1px 3px", background: `${color}15`, borderRadius: 3 }}>{type}</span>
        {!expanded && (
          <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontFamily: "monospace", wordBreak: "break-all", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {preview}
          </span>
        )}
      </div>
      {expanded && isExpandable && (
        <pre style={{
          fontSize: 10, color: "hsl(var(--muted-foreground))", fontFamily: "monospace",
          whiteSpace: "pre-wrap", wordBreak: "break-all", margin: "4px 0 0 16px",
          maxHeight: 220, overflowY: "auto",
        }}>
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── Saída tab: output of the selected node ───────────────────────────────────

type NodeOutputMap = Record<string, {
  pipeline: Record<string, unknown>; label: string; status: string; rawOutput: string | null;
}>;

function NodeOutputPreview({
  nodeId, lastRunOutputs, onInsert,
}: {
  nodeId: string; lastRunOutputs: NodeOutputMap; onInsert: (ref: string) => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const out = lastRunOutputs[nodeId];

  if (!out) {
    return (
      <div style={{ padding: "32px 16px", textAlign: "center", color: "hsl(var(--muted-foreground))" }}>
        <Zap size={28} style={{ margin: "0 auto 10px", opacity: 0.3 }} />
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Nenhuma execução registrada</div>
        <div style={{ fontSize: 11 }}>Execute o workflow para ver a saída deste nodo.</div>
      </div>
    );
  }

  const vars = Object.entries(out.pipeline);
  const statusColor = out.status === "success" ? "#10b981" : out.status === "failed" ? "#ef4444" : "#94a3b8";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Status */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px",
          borderRadius: 12, background: `${statusColor}20`, border: `1px solid ${statusColor}44`,
          fontSize: 11, fontWeight: 600, color: statusColor,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }} />
          {out.status === "success" ? "Sucesso" : out.status === "failed" ? "Falhou" : out.status}
        </span>
        <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
          {vars.length} variável(is)
        </span>
      </div>

      {/* Draggable chips */}
      {vars.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Clique ou arraste para inserir no campo focado
          </div>
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {vars.map(([k, v]) => <VarChip key={k} varName={k} value={v} onInsert={onInsert} nodeColor={nodeColorFromId(nodeId)} nodeLabel={out.label} />)}
          </div>
        </div>
      )}

      {/* JSON tree */}
      {vars.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            Valores
          </div>
          <div style={{
            background: "rgba(0,0,0,0.25)", border: "1px solid hsl(var(--border))",
            borderRadius: 8, padding: "10px 12px", maxHeight: 300, overflowY: "auto",
          }}>
            {vars.map(([k, v]) => <JsonVarRow key={k} name={k} value={v} />)}
          </div>
        </div>
      )}

      {/* All-chips action row */}
      {vars.length > 1 && (
        <button
          onClick={() => {
            const allRefs = vars.map(([k]) => `pipeline["${k}"]`).join(", ");
            navigator.clipboard?.writeText(allRefs).catch(() => {});
            onInsert(allRefs);
          }}
          style={{
            display: "flex", alignItems: "center", gap: 6, fontSize: 11,
            color: "#a78bfa", background: "rgba(167,139,250,0.08)",
            border: "1px solid rgba(167,139,250,0.25)", borderRadius: 6,
            padding: "6px 12px", cursor: "pointer", width: "100%", justifyContent: "center",
          }}
        >
          <Copy size={11} /> Copiar todas as referências
        </button>
      )}

      {/* Raw stdout */}
      {out.rawOutput && (
        <div>
          <button
            onClick={() => setShowRaw((r) => !r)}
            style={{
              display: "flex", alignItems: "center", gap: 5, background: "none", border: "none",
              cursor: "pointer", color: "hsl(var(--muted-foreground))", fontSize: 11, padding: 0, marginBottom: showRaw ? 6 : 0,
            }}
          >
            {showRaw ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Saída bruta (stdout)
          </button>
          {showRaw && (
            <pre style={{
              fontSize: 10, background: "rgba(0,0,0,0.35)", border: "1px solid hsl(var(--border))",
              borderRadius: 6, padding: "8px 10px", maxHeight: 200, overflowY: "auto",
              margin: 0, color: "#a3e635", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all",
            }}>
              {out.rawOutput}
            </pre>
          )}
        </div>
      )}

      {vars.length === 0 && !out.rawOutput && (
        <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "10px 0" }}>
          Nenhuma variável no pipeline após esta execução.
        </div>
      )}
    </div>
  );
}

// ─── Upstream Var Picker: variables from all ancestor nodes ───────────────────

function UpstreamVarPicker({
  nodeId, nodes, edges, lastRunOutputs, onInsert, onConnect,
}: {
  nodeId: string;
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];
  lastRunOutputs: NodeOutputMap;
  onInsert: (ref: string) => void;
  onConnect: (sourceId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [openNodes, setOpenNodes] = useState<Record<string, boolean>>({});

  const allOtherNodesWithOutput = useMemo(() => {
    // Collect all ancestors recursively
    const ancestors = new Set<string>();
    const queue = [nodeId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of edges) {
        if (e.target === cur && !ancestors.has(e.source)) {
          ancestors.add(e.source);
          queue.push(e.source);
        }
      }
    }
    const directlyConnected = new Set(edges.filter((e) => e.target === nodeId).map((e) => e.source));

    // All OTHER nodes that have run output (prefer upstream first)
    return Object.entries(lastRunOutputs)
      .filter(([id]) => id !== nodeId)
      .map(([id, out]) => ({
        id,
        label: out.label,
        pipeline: out.pipeline,
        status: out.status,
        rawOutput: out.rawOutput,
        isAncestor: ancestors.has(id),
        isDirectlyConnected: directlyConnected.has(id),
      }))
      .sort((a, b) => (b.isAncestor ? 1 : 0) - (a.isAncestor ? 1 : 0));
  }, [nodeId, edges, lastRunOutputs]);

  if (allOtherNodesWithOutput.length === 0) return null;

  return (
    <div style={{
      border: "1px solid rgba(167,139,250,0.25)", borderRadius: 8,
      background: "rgba(167,139,250,0.04)", marginBottom: 14, overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 6,
          padding: "8px 12px", background: "transparent", border: "none",
          cursor: "pointer", color: "#a78bfa", fontSize: 12, fontWeight: 600,
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Network size={12} />
        Variáveis de outros nodos
        <span style={{
          marginLeft: "auto", fontSize: 10, padding: "1px 7px",
          background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)",
          borderRadius: 10, color: "#a78bfa",
        }}>
          {allOtherNodesWithOutput.length}
        </span>
      </button>

      {open && (
        <div style={{ borderTop: "1px solid rgba(167,139,250,0.15)" }}>
          {allOtherNodesWithOutput.map(({ id, label, pipeline, status, isAncestor, isDirectlyConnected }) => {
            const isNodeOpen = openNodes[id] !== false;
            const vars = Object.entries(pipeline);
            const statusColor = status === "success" ? "#10b981" : status === "failed" ? "#ef4444" : "#94a3b8";
            return (
              <div key={id} style={{ borderBottom: "1px solid rgba(167,139,250,0.1)" }}>
                {/* Node row header */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
                  background: isAncestor ? "rgba(167,139,250,0.06)" : "transparent",
                }}>
                  <button
                    onClick={() => setOpenNodes((prev) => ({ ...prev, [id]: !isNodeOpen }))}
                    style={{
                      display: "flex", alignItems: "center", gap: 5, flex: 1,
                      background: "none", border: "none", cursor: "pointer",
                      color: isAncestor ? "#a78bfa" : "hsl(var(--foreground))",
                      textAlign: "left", padding: 0, minWidth: 0,
                    }}
                  >
                    {isNodeOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    <span style={{
                      fontSize: 11, fontWeight: 600, overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                    }}>
                      {label}
                    </span>
                    {isAncestor && (
                      <span style={{
                        fontSize: 9, padding: "1px 5px", borderRadius: 4, flexShrink: 0,
                        background: "rgba(167,139,250,0.2)", color: "#a78bfa", fontWeight: 600,
                      }}>upstream</span>
                    )}
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
                    <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", flexShrink: 0 }}>
                      {vars.length}v
                    </span>
                  </button>

                  {/* Connect / connected indicator */}
                  {isDirectlyConnected ? (
                    <span style={{ fontSize: 9, color: "#10b981", fontWeight: 700, flexShrink: 0 }}>✓</span>
                  ) : (
                    <button
                      onClick={() => onConnect(id)}
                      title={`Conectar ${label} → este nodo`}
                      style={{
                        flexShrink: 0, fontSize: 10, padding: "2px 7px",
                        background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.35)",
                        borderRadius: 4, color: "#a78bfa", cursor: "pointer", fontWeight: 600,
                      }}
                    >
                      + Ligar
                    </button>
                  )}
                </div>

                {/* Variable chips */}
                {isNodeOpen && (
                  <div style={{ padding: "4px 12px 8px", display: "flex", flexWrap: "wrap" }}>
                    {vars.length > 0 ? (
                      vars.map(([k, v]) => <VarChip key={k} varName={k} value={v} onInsert={onInsert} nodeColor={nodeColorFromId(id)} nodeLabel={label} />)
                    ) : (
                      <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>sem variáveis</span>
                    )}
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

// ─────────────────────────────────────────────────────────────────────────────

function NodeConfigPanel({
  node,
  workflowId,
  onUpdateData,
  onUpdateConfig,
  onTestNode,
  testLoading,
  testResult,
}: {
  node: ReactFlowNode;
  workflowId: string;
  onUpdateData: (k: string, v: unknown) => void;
  onUpdateConfig: (k: string, v: unknown) => void;
  onTestNode: () => void;
  testLoading: boolean;
  testResult: { output: string; success: boolean; durationMs: number } | null;
}) {
  const cfg = (node.data.config as Record<string, unknown>) ?? {};
  const type = node.data.type as string;
  const isPinned = !!cfg.pinned;
  const isNote = type === "note";
  const isTrigger = isTriggerType(type);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* Label */}
      <Field label="Label">
        <Input value={(node.data.label as string) ?? ""} onChange={(e) => onUpdateData("label", e.target.value)} />
      </Field>

      {/* ── Type-specific config ─────────────────────────────────── */}
      {type === "trigger_manual" && <InfoBox>O workflow inicia manualmente via botão ou API.</InfoBox>}

      {type === "trigger_webhook" && <>
        <Field label="Método HTTP">
          <Select value={(cfg.method as string) ?? "POST"} onValueChange={(v) => onUpdateConfig("method", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["GET","POST","PUT","PATCH","DELETE"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Path">
          <Input value={(cfg.path as string) ?? "/webhook"} onChange={(e) => onUpdateConfig("path", e.target.value)} placeholder="/webhook" />
        </Field>
      </>}

      {type === "trigger_schedule" && <>
        <Field label="Cron Expression">
          <Input value={(cfg.cron as string) ?? "0 9 * * *"} onChange={(e) => onUpdateConfig("cron", e.target.value)} placeholder="0 9 * * *" style={{ fontFamily: "monospace" }} />
        </Field>
        <InfoBox>Ex: <code style={{ color: "#14b8a6" }}>0 9 * * *</code> = todo dia às 09:00</InfoBox>
      </>}

      {type === "trigger_subflow" && <InfoBox>Este workflow é chamado como sub-flow por outro workflow.</InfoBox>}

      {type === "code" && (
        <Field label="Código Python">
          <div style={{ border: "1px solid hsl(var(--border))", borderRadius: 6, overflow: "hidden" }}>
            <CodeMirror value={(cfg.code as string) ?? ""} height="220px" theme="dark" extensions={[python(), varDropExtension]} onChange={(val) => onUpdateConfig("code", val)} />
          </div>
        </Field>
      )}

      {type === "condition" && (
        <Field label="Expressão Python (True/False)">
          <VarTokenInput value={(cfg.expression as string) ?? ""} onChange={(v) => onUpdateConfig("expression", v)} placeholder="len(result) > 0" />
        </Field>
      )}

      {type === "loop" && (
        <Field label="Lista de itens (Python)">
          <VarTokenInput value={(cfg.itemsExpression as string) ?? ""} onChange={(v) => onUpdateConfig("itemsExpression", v)} placeholder="[1, 2, 3]" />
        </Field>
      )}

      {type === "set_variable" && <>
        <Field label="Chave"><Input value={(cfg.key as string) ?? ""} onChange={(e) => onUpdateConfig("key", e.target.value)} placeholder="MY_VAR" /></Field>
        <Field label="Valor"><VarTokenInput value={(cfg.value as string) ?? ""} onChange={(v) => onUpdateConfig("value", v)} placeholder='valor ou pipeline["var"]' /></Field>
      </>}

      {type === "get_variable" && (
        <Field label="Chave"><Input value={(cfg.key as string) ?? ""} onChange={(e) => onUpdateConfig("key", e.target.value)} placeholder="MY_VAR" /></Field>
      )}

      {type === "transform" && (
        <Field label="Código Python (variável `input`)">
          <div style={{ border: "1px solid hsl(var(--border))", borderRadius: 6, overflow: "hidden" }}>
            <CodeMirror value={(cfg.code as string) ?? "output = input"} height="160px" theme="dark" extensions={[python(), varDropExtension]} onChange={(val) => onUpdateConfig("code", val)} />
          </div>
        </Field>
      )}

      {type === "http_request" && (
        <HttpRequestConfig cfg={cfg} onUpdateConfig={onUpdateConfig} />
      )}

      {type === "wait" && (
        <Field label="Segundos">
          <Input type="number" min={1} value={(cfg.seconds as number) ?? 5} onChange={(e) => onUpdateConfig("seconds", Number(e.target.value))} />
        </Field>
      )}

      {isNote && (
        <Field label="Texto"><Textarea value={(cfg.text as string) ?? ""} onChange={(e) => onUpdateConfig("text", e.target.value)} rows={4} /></Field>
      )}

      {(type === "variable" || type === "variable_inject") && (
        <VariableNodeConfig cfg={cfg} type={type} onUpdateConfig={onUpdateConfig} />
      )}

      {type === "pip_install" && (
        <PipInstallConfig cfg={cfg} onUpdateConfig={onUpdateConfig} />
      )}

      {type === "switch" && (
        <SwitchNodeConfig cfg={cfg} onUpdateConfig={onUpdateConfig} />
      )}

      {type === "merge_lists" && (
        <MergeListsConfig cfg={cfg} onUpdateConfig={onUpdateConfig} />
      )}

      {(type === "filter_list" || type === "batch_split" || type === "aggregate" ||
        type === "split_out" || type === "sort_list" || type === "remove_duplicates" ||
        type === "limit") && (
        <DataNodeConfig nodeType={type} cfg={cfg} onUpdateConfig={onUpdateConfig} />
      )}

      {isDatabaseNodeType(type) && (
        <DatabaseNodeConfig nodeType={type} cfg={cfg} onUpdateConfig={onUpdateConfig} />
      )}

      {/* ── Pin / Mock Data section ──────────────────────────────── */}
      {!isNote && (
        <div style={{ borderTop: "1px solid hsl(var(--border))", paddingTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{
                width: 24, height: 24, borderRadius: 6,
                background: isPinned ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${isPinned ? "rgba(245,158,11,0.4)" : "hsl(var(--border))"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Pin size={12} color={isPinned ? "#f59e0b" : "hsl(var(--muted-foreground))"} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Mock Data (Pin)</div>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
                  {isPinned ? "Usando dados mockados — nodo não executa" : "Desativado — nodo executa normalmente"}
                </div>
              </div>
            </div>
            <Switch checked={isPinned} onCheckedChange={(v) => {
              onUpdateConfig("pinned", v);
              if (!v) onUpdateConfig("mockOutput", "");
            }} />
          </div>

          {isPinned && (
            <Field label="Output mockado (retornado sem executar)">
              <Textarea
                value={(cfg.mockOutput as string) ?? ""}
                onChange={(e) => onUpdateConfig("mockOutput", e.target.value)}
                placeholder='{"result": "valor mockado"}'
                rows={4}
                style={{ fontFamily: "monospace", fontSize: 12, borderColor: "rgba(245,158,11,0.4)" }}
              />
            </Field>
          )}
        </div>
      )}

      {/* ── Test single node ─────────────────────────────────────── */}
      {!isNote && (
        <div style={{ borderTop: "1px solid hsl(var(--border))", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.07em",
            textTransform: "uppercase", color: "hsl(var(--muted-foreground))",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <FlaskConical size={12} /> Teste individual
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={onTestNode}
            disabled={testLoading}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {testLoading
              ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Executando...</>
              : <><FlaskConical className="h-3.5 w-3.5 mr-2" /> Testar este nodo</>}
          </Button>

          {testResult && (
            <div style={{
              border: `1px solid ${testResult.success ? "rgba(20,184,166,0.35)" : "rgba(239,68,68,0.35)"}`,
              borderRadius: 7,
              background: testResult.success ? "rgba(20,184,166,0.06)" : "rgba(239,68,68,0.06)",
              padding: "10px 12px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                {testResult.success
                  ? <CheckCircle2 size={13} color="#14b8a6" />
                  : <XCircle size={13} color="#ef4444" />}
                <span style={{ fontSize: 11, fontWeight: 600, color: testResult.success ? "#14b8a6" : "#ef4444" }}>
                  {testResult.success ? "Sucesso" : "Falhou"} — {testResult.durationMs}ms
                </span>
              </div>
              <pre style={{
                fontSize: 11, color: "hsl(var(--foreground))", whiteSpace: "pre-wrap",
                wordBreak: "break-all", maxHeight: 160, overflowY: "auto", margin: 0,
                fontFamily: "monospace",
              }}>
                {testResult.output || "(sem output)"}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── Advanced (non-trigger, non-note) ─────────────────────── */}
      {!isTrigger && !isNote && (
        <div style={{ borderTop: "1px solid hsl(var(--border))", paddingTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.07em",
            textTransform: "uppercase", color: "hsl(var(--muted-foreground))",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <Settings size={12} /> Avançado
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13 }}>Continuar em caso de erro</span>
            <Switch checked={!!node.data.continueOnError} onCheckedChange={(v) => onUpdateData("continueOnError", v)} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13 }}>Parar em caso de erro</span>
            <Switch checked={!!node.data.stopOnError} onCheckedChange={(v) => onUpdateData("stopOnError", v)} />
          </div>
          <Field label="Tentativas de retry">
            <Input type="number" min={0} max={10} value={(node.data.retryCount as number) ?? 0} onChange={(e) => onUpdateData("retryCount", Number(e.target.value))} />
          </Field>
          <Field label="Delay entre retries (ms)">
            <Input type="number" min={100} value={(node.data.retryDelayMs as number) ?? 1000} onChange={(e) => onUpdateData("retryDelayMs", Number(e.target.value))} />
          </Field>
        </div>
      )}
    </div>
  );
}

// ─── Pip Install Config ───────────────────────────────────────────────────────

interface PipPackage { name: string; version: string; }

function PipInstallConfig({
  cfg,
  onUpdateConfig,
}: {
  cfg: Record<string, unknown>;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const action = (cfg.action as string) ?? "install";
  const mode = (cfg.mode as string) ?? "single";
  const packages = (cfg.packages as PipPackage[]) ?? [];

  const updatePackage = (idx: number, field: "name" | "version", val: string) => {
    const next = packages.map((p, i) => i === idx ? { ...p, [field]: val } : p);
    onUpdateConfig("packages", next);
  };
  const addPackage = () => onUpdateConfig("packages", [...packages, { name: "", version: "" }]);
  const removePackage = (idx: number) => onUpdateConfig("packages", packages.filter((_, i) => i !== idx));

  const MODES = [
    { value: "single",       label: "Lib única",       desc: "Uma biblioteca com nome e versão" },
    { value: "multiple",     label: "Múltiplas libs",  desc: "Lista de bibliotecas com versões exatas" },
    { value: "requirements", label: "requirements.txt", desc: "Cole o conteúdo do arquivo diretamente" },
  ] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Action toggle */}
      <div>
        <label style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))", display: "block", marginBottom: 6 }}>
          Ação
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          {(["install", "uninstall"] as const).map((a) => (
            <button
              key={a}
              onClick={() => onUpdateConfig("action", a)}
              style={{
                flex: 1, padding: "8px 0", borderRadius: 8, border: "1.5px solid",
                borderColor: action === a ? (a === "uninstall" ? "#ef4444" : "#34d399") : "hsl(var(--border))",
                background: action === a ? (a === "uninstall" ? "rgba(239,68,68,0.1)" : "rgba(52,211,153,0.1)") : "transparent",
                color: action === a ? (a === "uninstall" ? "#ef4444" : "#34d399") : "hsl(var(--muted-foreground))",
                fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <Package size={13} />
              {a === "install" ? "Instalar" : "Remover"}
            </button>
          ))}
        </div>
      </div>

      {/* Mode selector */}
      <div>
        <label style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))", display: "block", marginBottom: 6 }}>
          Modo
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {MODES.filter((m) => !(action === "uninstall" && m.value === "requirements")).map((m) => (
            <button
              key={m.value}
              onClick={() => onUpdateConfig("mode", m.value)}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 11px",
                borderRadius: 7, border: `1.5px solid ${mode === m.value ? "#f472b6" : "hsl(var(--border))"}`,
                background: mode === m.value ? "rgba(244,114,182,0.08)" : "transparent",
                cursor: "pointer", textAlign: "left", width: "100%",
              }}
            >
              <div style={{
                width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
                background: mode === m.value ? "#f472b6" : "hsl(var(--muted-foreground))",
              }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: mode === m.value ? "#f472b6" : "hsl(var(--foreground))" }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 1 }}>{m.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Single mode */}
      {mode === "single" && <>
        <Field label="Nome exato da biblioteca">
          <Input
            value={(cfg.packageName as string) ?? ""}
            onChange={(e) => onUpdateConfig("packageName", e.target.value)}
            placeholder="requests"
            style={{ fontFamily: "monospace" }}
          />
        </Field>
        <Field label={`Versão exata ${action === "uninstall" ? "(ignorada ao remover)" : "(opcional)"}`}>
          <Input
            value={(cfg.packageVersion as string) ?? ""}
            onChange={(e) => onUpdateConfig("packageVersion", e.target.value)}
            placeholder="2.31.0"
            disabled={action === "uninstall"}
            style={{ fontFamily: "monospace", opacity: action === "uninstall" ? 0.4 : 1 }}
          />
        </Field>
      </>}

      {/* Multiple mode */}
      {mode === "multiple" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))" }}>
              Bibliotecas ({packages.length})
            </label>
            <Button size="sm" variant="outline" onClick={addPackage} style={{ height: 26, fontSize: 11, padding: "0 10px" }}>
              <Plus size={11} className="mr-1" /> Adicionar
            </Button>
          </div>

          {packages.length === 0 && (
            <div style={{
              padding: "12px", borderRadius: 7, border: "1px dashed hsl(var(--border))",
              textAlign: "center", fontSize: 12, color: "hsl(var(--muted-foreground))",
            }}>
              Clique em Adicionar para incluir bibliotecas
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {packages.map((pkg, idx) => (
              <div key={idx} style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <Input
                  value={pkg.name}
                  onChange={(e) => updatePackage(idx, "name", e.target.value)}
                  placeholder="numpy"
                  style={{ fontFamily: "monospace", fontSize: 12, flex: 2 }}
                />
                <Input
                  value={pkg.version}
                  onChange={(e) => updatePackage(idx, "version", e.target.value)}
                  placeholder="1.26.0"
                  disabled={action === "uninstall"}
                  style={{ fontFamily: "monospace", fontSize: 12, flex: 1, opacity: action === "uninstall" ? 0.4 : 1 }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => removePackage(idx)}
                  style={{ width: 28, height: 28, flexShrink: 0 }}
                >
                  <Trash2 size={12} className="text-destructive" />
                </Button>
              </div>
            ))}
          </div>

          {packages.length > 0 && (
            <div style={{ marginTop: 6, padding: "7px 10px", borderRadius: 6, background: "rgba(244,114,182,0.06)", border: "1px solid rgba(244,114,182,0.2)", fontSize: 11, fontFamily: "monospace", color: "hsl(var(--muted-foreground))" }}>
              pip {action} {packages.map((p) => action === "uninstall" ? p.name : (p.version ? `${p.name}==${p.version}` : p.name)).filter(Boolean).join(" ")}
            </div>
          )}
        </div>
      )}

      {/* Requirements.txt mode */}
      {mode === "requirements" && (
        <Field label="Conteúdo do requirements.txt">
          <Textarea
            value={(cfg.requirementsTxt as string) ?? ""}
            onChange={(e) => onUpdateConfig("requirementsTxt", e.target.value)}
            placeholder={"requests==2.31.0\nnumpy>=1.26.0\npandas\nfastapi==0.104.1"}
            rows={8}
            style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }}
          />
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
            Suporta todos os formatos de pinning do pip: <code>==</code>, <code>&gt;=</code>, <code>~=</code>, etc.
          </div>
        </Field>
      )}
    </div>
  );
}

// ─── Switch Node Config ────────────────────────────────────────────────────────

function SwitchNodeConfig({
  cfg,
  onUpdateConfig,
}: {
  cfg: Record<string, unknown>;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const conditions = (cfg.conditions as Array<{ expression: string; label: string }>) ?? [];
  const update = (idx: number, field: "expression" | "label", val: string) => {
    const next = conditions.map((c, i) => i === idx ? { ...c, [field]: val } : c);
    onUpdateConfig("conditions", next);
  };
  const add = () => onUpdateConfig("conditions", [...conditions, { expression: "value > 0", label: `branch${conditions.length + 1}` }]);
  const remove = (idx: number) => onUpdateConfig("conditions", conditions.filter((_, i) => i !== idx));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Field label="Variável de entrada (pipeline)">
        <VarTokenInput value={(cfg.inputVar as string) ?? ""} onChange={(v) => onUpdateConfig("inputVar", v)} placeholder='myValue ou pipeline["var"]' />
      </Field>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 500 }}>Condições ({conditions.length})</label>
          <Button size="sm" variant="outline" onClick={add} style={{ height: 26, fontSize: 11, padding: "0 10px" }}>
            <Plus size={11} className="mr-1" /> Adicionar
          </Button>
        </div>
        {conditions.length === 0 && (
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "10px 0" }}>Nenhuma condição adicionada</div>
        )}
        {conditions.map((cond, idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
            <VarTokenInput value={cond.expression} onChange={(v) => update(idx, "expression", v)} placeholder="value > 100" style={{ flex: 2 }} />
            <Input value={cond.label} onChange={(e) => update(idx, "label", e.target.value)} placeholder="branch" style={{ fontFamily: "monospace", fontSize: 11, flex: 1 }} />
            <Button size="icon" variant="ghost" onClick={() => remove(idx)} style={{ height: 28, width: 28, flexShrink: 0 }}>
              <Trash2 size={12} />
            </Button>
          </div>
        ))}
        {conditions.length > 0 && (
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
            Colunas: <strong>expressão Python</strong> (usa <code>value</code> ou campos do dict) → <strong>label da branch</strong>
          </div>
        )}
      </div>
      <Field label="Branch fallback (sem match)">
        <Input value={(cfg.fallback as string) ?? "default"} onChange={(e) => onUpdateConfig("fallback", e.target.value)} placeholder="default" style={{ fontFamily: "monospace" }} />
      </Field>
      <InfoBox>O resultado fica em <code>_switch_result</code> no contexto do pipeline para uso em nodos downstream.</InfoBox>
    </div>
  );
}

// ─── Merge Lists Config ────────────────────────────────────────────────────────

function MergeListsConfig({
  cfg,
  onUpdateConfig,
}: {
  cfg: Record<string, unknown>;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const vars = (cfg.vars as string[]) ?? [];
  const addVar = () => onUpdateConfig("vars", [...vars, ""]);
  const updateVar = (idx: number, val: string) => onUpdateConfig("vars", vars.map((v, i) => i === idx ? val : v));
  const removeVar = (idx: number) => onUpdateConfig("vars", vars.filter((_, i) => i !== idx));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 500 }}>Variáveis para combinar ({vars.length})</label>
          <Button size="sm" variant="outline" onClick={addVar} style={{ height: 26, fontSize: 11, padding: "0 10px" }}>
            <Plus size={11} className="mr-1" /> Adicionar
          </Button>
        </div>
        {vars.length === 0 && (
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "8px 0" }}>Adicione variáveis do pipeline</div>
        )}
        {vars.map((v, idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
            <Input value={v} onChange={(e) => updateVar(idx, e.target.value)} placeholder={`lista${idx + 1}`} style={{ fontFamily: "monospace", fontSize: 11 }} />
            <Button size="icon" variant="ghost" onClick={() => removeVar(idx)} style={{ height: 28, width: 28 }}>
              <Trash2 size={12} />
            </Button>
          </div>
        ))}
      </div>
      <Field label="Modo de combinação">
        <Select value={(cfg.mode as string) ?? "append"} onValueChange={(v) => onUpdateConfig("mode", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="append">Append — concatenar arrays</SelectItem>
            <SelectItem value="zip">Zip — mesclar por posição (objeto por objeto)</SelectItem>
            <SelectItem value="merge_objects">Merge Object — Object.assign no primeiro item</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Variável de saída">
        <Input value={(cfg.outputVar as string) ?? "merged"} onChange={(e) => onUpdateConfig("outputVar", e.target.value)} placeholder="merged" style={{ fontFamily: "monospace" }} />
      </Field>
    </div>
  );
}

// ─── Generic Data Node Config ──────────────────────────────────────────────────

function DataNodeConfig({
  nodeType,
  cfg,
  onUpdateConfig,
}: {
  nodeType: string;
  cfg: Record<string, unknown>;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const inputVarField = (
    <Field label="Variável de entrada (pipeline)">
      <VarTokenInput value={(cfg.inputVar as string) ?? ""} onChange={(v) => onUpdateConfig("inputVar", v)} placeholder='items ou pipeline["var"]' />
    </Field>
  );
  const outputVarField = (
    <Field label="Variável de saída">
      <Input value={(cfg.outputVar as string) ?? ""} onChange={(e) => onUpdateConfig("outputVar", e.target.value)} placeholder="result" style={{ fontFamily: "monospace" }} />
    </Field>
  );

  if (nodeType === "filter_list") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {inputVarField}
      <Field label="Expressão Python por item (variável: item)">
        <VarTokenInput value={(cfg.expression as string) ?? ""} onChange={(v) => onUpdateConfig("expression", v)} placeholder="item['active'] == True" />
      </Field>
      {outputVarField}
      <InfoBox>Equivale a <code>[item for item in lista if (<em>expressão</em>)]</code>. Use <code>item</code> para acessar cada elemento.</InfoBox>
    </div>
  );

  if (nodeType === "batch_split") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {inputVarField}
      <Field label="Tamanho do lote">
        <Input type="number" min={1} value={(cfg.batchSize as number) ?? 10} onChange={(e) => onUpdateConfig("batchSize", Number(e.target.value))} />
      </Field>
      {outputVarField}
      <InfoBox>Saída é uma lista de listas — ex.: 25 itens com tamanho 10 → [[...10], [...10], [...5]]</InfoBox>
    </div>
  );

  if (nodeType === "aggregate") {
    const operation = (cfg.operation as string) ?? "count";
    const needsField = ["sum","avg","min","max","join","list"].includes(operation);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {inputVarField}
        <Field label="Operação">
          <Select value={operation} onValueChange={(v) => onUpdateConfig("operation", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="count">Count — quantidade de itens</SelectItem>
              <SelectItem value="sum">Sum — soma de um campo numérico</SelectItem>
              <SelectItem value="avg">Average — média de um campo numérico</SelectItem>
              <SelectItem value="min">Min — menor valor do campo</SelectItem>
              <SelectItem value="max">Max — maior valor do campo</SelectItem>
              <SelectItem value="first">First — primeiro item da lista</SelectItem>
              <SelectItem value="last">Last — último item da lista</SelectItem>
              <SelectItem value="join">Join — concatenar campo como texto</SelectItem>
              <SelectItem value="list">List — extrair campo em nova lista</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {needsField && (
          <Field label="Campo (deixe vazio para usar o item inteiro)">
            <Input value={(cfg.field as string) ?? ""} onChange={(e) => onUpdateConfig("field", e.target.value)} placeholder="price" style={{ fontFamily: "monospace" }} />
          </Field>
        )}
        {operation === "join" && (
          <Field label="Separador">
            <Input value={(cfg.separator as string) ?? ", "} onChange={(e) => onUpdateConfig("separator", e.target.value)} placeholder=", " />
          </Field>
        )}
        {outputVarField}
      </div>
    );
  }

  if (nodeType === "split_out") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {inputVarField}
      <Field label="Campo que contém a lista aninhada">
        <Input value={(cfg.field as string) ?? "items"} onChange={(e) => onUpdateConfig("field", e.target.value)} placeholder="items" style={{ fontFamily: "monospace" }} />
      </Field>
      <Field label="Manter campos do pai junto com cada item">
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
          <Switch checked={!!(cfg.keepParent)} onCheckedChange={(v) => onUpdateConfig("keepParent", v)} />
          <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
            {cfg.keepParent ? "Sim — inclui campos do objeto pai" : "Não — retorna apenas os itens do campo"}
          </span>
        </div>
      </Field>
      {outputVarField}
      <InfoBox>Ex: lista de pedidos, cada um com campo <code>items</code> → gera uma lista plana de todos os itens individuais.</InfoBox>
    </div>
  );

  if (nodeType === "sort_list") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {inputVarField}
      <Field label="Campo para ordenação (vazio = item inteiro)">
        <Input value={(cfg.key as string) ?? ""} onChange={(e) => onUpdateConfig("key", e.target.value)} placeholder="name" style={{ fontFamily: "monospace" }} />
      </Field>
      <Field label="Ordem">
        <Select value={(cfg.order as string) ?? "asc"} onValueChange={(v) => onUpdateConfig("order", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="asc">Crescente (A → Z, 0 → 9)</SelectItem>
            <SelectItem value="desc">Decrescente (Z → A, 9 → 0)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {outputVarField}
    </div>
  );

  if (nodeType === "remove_duplicates") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {inputVarField}
      <Field label="Chave de deduplicação (vazio = item inteiro como JSON)">
        <Input value={(cfg.key as string) ?? ""} onChange={(e) => onUpdateConfig("key", e.target.value)} placeholder="id" style={{ fontFamily: "monospace" }} />
      </Field>
      {outputVarField}
      <InfoBox>Mantém a primeira ocorrência de cada valor único da chave. Preserva a ordem original.</InfoBox>
    </div>
  );

  if (nodeType === "limit") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {inputVarField}
      <Field label="Máximo de itens">
        <Input type="number" min={1} value={(cfg.maxItems as number) ?? 10} onChange={(e) => onUpdateConfig("maxItems", Number(e.target.value))} />
      </Field>
      <Field label="Quais itens manter">
        <Select value={(cfg.keep as string) ?? "first"} onValueChange={(v) => onUpdateConfig("keep", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="first">Primeiros N (slice do início)</SelectItem>
            <SelectItem value="last">Últimos N (slice do fim)</SelectItem>
            <SelectItem value="random">N aleatórios (shuffle + slice)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {outputVarField}
    </div>
  );

  return null;
}

// ─── HTTP Request Config ──────────────────────────────────────────────────────

interface KVPair { key: string; value: string; enabled: boolean; }

function KeyValueEditor({
  pairs,
  onChange,
  keyPlaceholder = "chave",
  valuePlaceholder = "valor",
  addLabel = "Adicionar linha",
}: {
  pairs: KVPair[];
  onChange: (pairs: KVPair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
}) {
  const add = () => onChange([...pairs, { key: "", value: "", enabled: true }]);
  const remove = (i: number) => onChange(pairs.filter((_, idx) => idx !== i));
  const update = (i: number, field: keyof KVPair, val: string | boolean) =>
    onChange(pairs.map((p, idx) => idx === i ? { ...p, [field]: val } : p));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {pairs.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={p.enabled}
            onChange={(e) => update(i, "enabled", e.target.checked)}
            style={{ cursor: "pointer", accentColor: "#14b8a6", flexShrink: 0, width: 14, height: 14 }}
          />
          <Input
            value={p.key}
            onChange={(e) => update(i, "key", e.target.value)}
            placeholder={keyPlaceholder}
            style={{ fontFamily: "monospace", fontSize: 11, flex: 1, opacity: p.enabled ? 1 : 0.45, height: 30 }}
          />
          <div style={{ flex: 1.5, opacity: p.enabled ? 1 : 0.45 }}>
            <VarTokenInput
              value={p.value}
              onChange={(v) => update(i, "value", v)}
              placeholder={valuePlaceholder}
              style={{ fontSize: 11, height: 30 }}
            />
          </div>
          <Button size="icon" variant="ghost" onClick={() => remove(i)} style={{ height: 28, width: 28, flexShrink: 0 }}>
            <Trash2 size={11} className="text-destructive" />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={add}
        style={{ height: 26, fontSize: 11, padding: "0 10px", alignSelf: "flex-start", marginTop: 2 }}
      >
        <Plus size={10} style={{ marginRight: 4 }} /> {addLabel}
      </Button>
    </div>
  );
}

// ─── Database Node Config ──────────────────────────────────────────────────────

interface DbField { column: string; value: string; enabled: boolean; }

function DatabaseNodeConfig({
  nodeType,
  cfg,
  onUpdateConfig,
}: {
  nodeType: string;
  cfg: Record<string, unknown>;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const parsed = parseDbNodeType(nodeType);
  if (!parsed) return null;
  const { dbType, operation } = parsed;
  const dbMeta = DB_META[dbType];
  const opMeta = DB_OP_META[operation];

  const [fetchedColumns, setFetchedColumns] = useState<string[]>([]);
  const [fetchingCols, setFetchingCols] = useState(false);
  const [fetchColsError, setFetchColsError] = useState("");

  const isSupabase = dbType === "supabase";

  const str = (key: string, def = "") => (cfg[key] as string) ?? def;
  const num = (key: string, def: number) => Number(cfg[key] ?? def);
  const bool = (key: string, def = false) => (cfg[key] as boolean) ?? def;
  const arr = (key: string): DbField[] => (cfg[key] as DbField[]) ?? [];

  const handleFetchColumns = async () => {
    setFetchingCols(true);
    setFetchColsError("");
    try {
      const res = await fetch("/api/db/columns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dbType,
          connectionString: str("connectionString"),
          host: str("host", "localhost"),
          port: num("port", dbMeta.defaultPort),
          dbName: str("dbName"),
          user: str("user"),
          password: str("password"),
          table: str("table"),
          supabaseUrl: str("supabaseUrl"),
          supabaseKey: str("supabaseKey"),
        }),
      });
      const data = await res.json();
      if (data.columns) {
        setFetchedColumns(data.columns as string[]);
      } else {
        setFetchColsError(data.error ?? "Erro desconhecido");
      }
    } catch (e: unknown) {
      setFetchColsError((e as Error).message);
    } finally {
      setFetchingCols(false);
    }
  };

  const updateField = (fieldKey: string, index: number, k: keyof DbField, v: string | boolean) => {
    const fields = arr(fieldKey);
    const updated = [...fields];
    updated[index] = { ...updated[index], [k]: v };
    onUpdateConfig(fieldKey, updated);
  };
  const removeField = (fieldKey: string, index: number) => {
    onUpdateConfig(fieldKey, arr(fieldKey).filter((_, i) => i !== index));
  };
  const addField = (fieldKey: string) => {
    onUpdateConfig(fieldKey, [...arr(fieldKey), { column: "", value: "", enabled: true }]);
  };

  const colInput = (field: DbField, fieldKey: string, index: number) => (
    <>
      <input
        list="db-cols-list"
        value={field.column}
        onChange={(e) => updateField(fieldKey, index, "column", e.target.value)}
        placeholder="coluna"
        style={{ flex: "0 0 38%", fontFamily: "monospace", fontSize: 11, height: 28, padding: "0 6px", background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 5, color: "hsl(var(--foreground))", minWidth: 0 }}
      />
      <input
        value={field.value}
        onChange={(e) => updateField(fieldKey, index, "value", e.target.value)}
        placeholder='valor / pipeline["x"]'
        style={{ flex: 1, fontFamily: "monospace", fontSize: 11, height: 28, padding: "0 6px", background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 5, color: "hsl(var(--foreground))", minWidth: 0 }}
      />
    </>
  );

  const renderFieldRow = (field: DbField, index: number, fieldKey: string) => (
    <div key={index} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
      <input type="checkbox" checked={field.enabled !== false} onChange={(e) => updateField(fieldKey, index, "enabled", e.target.checked)} style={{ width: 13, height: 13, flexShrink: 0, cursor: "pointer" }} />
      {colInput(field, fieldKey, index)}
      <button onClick={() => removeField(fieldKey, index)} style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "#ef4444", fontSize: 16, lineHeight: 1, padding: "0 4px", borderRadius: 4 }}>×</button>
    </div>
  );

  const addBtn = (fieldKey: string, color: string) => (
    <button onClick={() => addField(fieldKey)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, fontSize: 11, color, background: `${color}10`, border: `1px dashed ${color}66`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", width: "100%", marginTop: 4 }}>
      + Adicionar campo
    </button>
  );

  const sectionTitle = (label: string) => (
    <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, marginTop: 12 }}>{label}</div>
  );

  const whereRow = (colKey: string, valKey: string) => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      <input list="db-cols-list" value={str(colKey)} onChange={(e) => onUpdateConfig(colKey, e.target.value)} placeholder="coluna WHERE" style={{ fontFamily: "monospace", fontSize: 11, height: 32, padding: "0 8px", background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 6, color: "hsl(var(--foreground))" }} />
      <Input value={str(valKey)} onChange={(e) => onUpdateConfig(valKey, e.target.value)} placeholder='valor / pipeline["id"]' style={{ fontFamily: "monospace", fontSize: 11 }} />
    </div>
  );

  return (
    <div>
      {/* Column autocomplete datalist */}
      <datalist id="db-cols-list">
        {fetchedColumns.map((col) => <option key={col} value={col} />)}
      </datalist>

      {/* DB + operation badges */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <span style={{ padding: "2px 10px", borderRadius: 20, background: `${dbMeta.color}22`, border: `1px solid ${dbMeta.color}55`, color: dbMeta.color, fontSize: 11, fontWeight: 600 }}>{dbMeta.label}</span>
        <span style={{ padding: "2px 10px", borderRadius: 20, background: `${opMeta.color}22`, border: `1px solid ${opMeta.color}55`, color: opMeta.color, fontSize: 11, fontWeight: 600 }}>{opMeta.label}</span>
      </div>

      {/* ── CONEXÃO ─────────────────────────────── */}
      {sectionTitle("Conexão")}
      {isSupabase ? (
        <>
          <Field label="Supabase URL">
            <Input value={str("supabaseUrl")} onChange={(e) => onUpdateConfig("supabaseUrl", e.target.value)} placeholder="https://xxxx.supabase.co" />
          </Field>
          <Field label="API Key">
            <Input type="password" value={str("supabaseKey")} onChange={(e) => onUpdateConfig("supabaseKey", e.target.value)} placeholder="anon/service-role key" />
          </Field>
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Switch checked={bool("useConnectionString")} onCheckedChange={(v) => onUpdateConfig("useConnectionString", v)} />
            <span style={{ fontSize: 12 }}>Usar connection string</span>
          </div>
          {bool("useConnectionString") ? (
            <Field label="Connection String">
              <Input value={str("connectionString")} onChange={(e) => onUpdateConfig("connectionString", e.target.value)} placeholder={`postgresql://user:pass@host:${dbMeta.defaultPort}/db`} style={{ fontFamily: "monospace", fontSize: 12 }} />
            </Field>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 72px", gap: 6, marginBottom: 6 }}>
                <div>
                  <label style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 3 }}>Host</label>
                  <Input value={str("host", "localhost")} onChange={(e) => onUpdateConfig("host", e.target.value)} placeholder="localhost" />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 3 }}>Porta</label>
                  <Input type="number" value={num("port", dbMeta.defaultPort)} onChange={(e) => onUpdateConfig("port", Number(e.target.value))} />
                </div>
              </div>
              <Field label="Database">
                <Input value={str("dbName")} onChange={(e) => onUpdateConfig("dbName", e.target.value)} placeholder="meu_banco" />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
                <div>
                  <label style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 3 }}>Usuário</label>
                  <Input value={str("user")} onChange={(e) => onUpdateConfig("user", e.target.value)} placeholder="postgres" />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 3 }}>Senha</label>
                  <Input type="password" value={str("password")} onChange={(e) => onUpdateConfig("password", e.target.value)} placeholder="••••••" />
                </div>
              </div>
              {(dbType === "mssql" || dbType === "oracle") && (
                <div style={{ padding: "7px 10px", background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.3)", borderRadius: 6, fontSize: 11, color: "#fb923c", marginBottom: 6 }}>
                  Requer <strong>{dbMeta.installPkg}</strong> instalado.
                  Adicione um nodo <strong>Pip Packages</strong> antes e instale <code>{dbMeta.installPkg}</code>.
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── TABELA + Buscar colunas ─────────────── */}
      {sectionTitle("Tabela")}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <Input
          value={str("table")}
          onChange={(e) => onUpdateConfig("table", e.target.value)}
          placeholder="nome_da_tabela"
          style={{ flex: 1 }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleFetchColumns}
          disabled={fetchingCols || !str("table")}
          style={{ whiteSpace: "nowrap", fontSize: 11, gap: 4, flexShrink: 0, height: 36 }}
        >
          {fetchingCols
            ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
            : <Database size={12} />}
          Buscar colunas
        </Button>
      </div>
      {fetchColsError && (
        <div style={{ padding: "6px 10px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, fontSize: 11, color: "#ef4444", marginBottom: 6 }}>
          {fetchColsError}
        </div>
      )}
      {fetchedColumns.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 8 }}>
          {fetchedColumns.map((col) => (
            <span key={col} style={{ padding: "1px 7px", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, fontSize: 10, color: "#10b981", fontFamily: "monospace" }}>{col}</span>
          ))}
        </div>
      )}

      {/* ── OPERAÇÃO ────────────────────────────── */}
      <div style={{ borderTop: `2px solid ${opMeta.color}55`, marginBottom: 8, marginTop: 8 }} />
      <div style={{ fontSize: 11, fontWeight: 700, color: opMeta.color, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>{opMeta.label}</div>

      {operation === "select" && (
        <>
          <Field label="Colunas (SELECT)">
            <Input value={str("selectColumns", "*")} onChange={(e) => onUpdateConfig("selectColumns", e.target.value)} placeholder="* ou col1, col2" />
          </Field>
          <Field label="WHERE (cláusula SQL)">
            <Input value={str("whereClause")} onChange={(e) => onUpdateConfig("whereClause", e.target.value)} placeholder="id = 1 ou status = 'ativo'" style={{ fontFamily: "monospace", fontSize: 12 }} />
          </Field>
          <Field label="ORDER BY">
            <Input value={str("orderBy")} onChange={(e) => onUpdateConfig("orderBy", e.target.value)} placeholder="created_at DESC" style={{ fontFamily: "monospace", fontSize: 12 }} />
          </Field>
          <Field label="LIMIT">
            <Input type="number" min={1} value={num("limit", 100)} onChange={(e) => onUpdateConfig("limit", Number(e.target.value))} />
          </Field>
        </>
      )}

      {operation === "insert" && (
        <>
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 8 }}>
            Valor pode ser literal (<code>"texto"</code>, <code>42</code>) ou expressão Python (<code>pipeline["campo"]</code>).
          </div>
          {arr("fields").map((f, i) => renderFieldRow(f, i, "fields"))}
          {addBtn("fields", "#34d399")}
        </>
      )}

      {operation === "update" && (
        <>
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 4 }}>WHERE — coluna e valor de filtro:</div>
          {whereRow("whereColumn", "whereValue")}
          {sectionTitle("Campos para atualizar")}
          {arr("fields").map((f, i) => renderFieldRow(f, i, "fields"))}
          {addBtn("fields", "#f59e0b")}
        </>
      )}

      {operation === "delete" && (
        <>
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 4 }}>WHERE — coluna e valor de filtro:</div>
          {whereRow("whereColumn", "whereValue")}
        </>
      )}

      {operation === "upsert" && (
        <>
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 4 }}>Verificar existência por coluna:</div>
          {whereRow("checkColumn", "checkValue")}
          <div style={{ fontSize: 11, fontWeight: 600, color: "#34d399", marginBottom: 4, marginTop: 10 }}>✦ Se NÃO existir — Inserir:</div>
          {arr("insertFields").map((f, i) => renderFieldRow(f, i, "insertFields"))}
          {addBtn("insertFields", "#34d399")}
          <div style={{ fontSize: 11, fontWeight: 600, color: "#f59e0b", marginBottom: 4, marginTop: 14 }}>✦ Se JÁ existir — Atualizar:</div>
          {arr("updateFields").map((f, i) => renderFieldRow(f, i, "updateFields"))}
          {addBtn("updateFields", "#f59e0b")}
        </>
      )}

      {/* ── SAÍDA ──────────────────────────────── */}
      {sectionTitle("Saída")}
      <Field label="Variável de saída">
        <Input value={str("outputVar", "result")} onChange={(e) => onUpdateConfig("outputVar", e.target.value)} placeholder="result" />
      </Field>
      {!isSupabase && (
        <div style={{ padding: "6px 10px", background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.2)", borderRadius: 6, fontSize: 11, color: "#60a5fa" }}>
          Necessário: <strong>{dbMeta.installPkg}</strong>. Use o nodo <strong>Pip Packages</strong> (ação Install) antes deste nodo se não instalado.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function HttpRequestConfig({
  cfg,
  onUpdateConfig,
}: {
  cfg: Record<string, unknown>;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showBearer, setShowBearer] = useState(false);

  const method = (cfg.method as string) ?? "GET";
  const bodyType = (cfg.bodyType as string) ?? "none";
  const authType = (cfg.authType as string) ?? "none";
  const params = (cfg.params as KVPair[]) ?? [];
  const headers = (cfg.headers as KVPair[]) ?? [];
  const bodyForm = (cfg.bodyForm as KVPair[]) ?? [];
  const sslVerify = (cfg.sslVerify as boolean) !== false;

  const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
  const BODY_TYPES = [
    { value: "none", label: "Sem body" },
    { value: "json", label: "JSON" },
    { value: "form", label: "Form Data" },
    { value: "raw", label: "Raw Text" },
  ];
  const AUTH_TYPES = [
    { value: "none", label: "Sem auth" },
    { value: "bearer", label: "Bearer Token" },
    { value: "basic", label: "Basic Auth" },
    { value: "apikey", label: "API Key" },
  ];

  const tabLabel = (label: string, count?: number) =>
    count !== undefined && count > 0 ? `${label} (${count})` : label;

  const activeParams = params.filter((p) => p.enabled && p.key).length;
  const activeHeaders = headers.filter((h) => h.enabled && h.key).length;

  const sectionStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 10, paddingTop: 10 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Method + URL */}
      <div style={{ display: "flex", gap: 7, alignItems: "flex-end" }}>
        <div style={{ flexShrink: 0, width: 110 }}>
          <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Método</label>
          <Select value={method} onValueChange={(v) => onUpdateConfig("method", v)}>
            <SelectTrigger style={{ height: 32, fontSize: 12, fontWeight: 700 }}><SelectValue /></SelectTrigger>
            <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>URL</label>
          <VarTokenInput
            value={(cfg.url as string) ?? ""}
            onChange={(v) => onUpdateConfig("url", v)}
            placeholder="https://api.example.com/v1/resource"
            style={{ fontSize: 12 }}
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="params">
        <TabsList style={{ width: "100%", height: 32 }}>
          <TabsTrigger value="params" style={{ flex: 1, fontSize: 11 }}>{tabLabel("Params", activeParams)}</TabsTrigger>
          <TabsTrigger value="headers" style={{ flex: 1, fontSize: 11 }}>{tabLabel("Headers", activeHeaders)}</TabsTrigger>
          <TabsTrigger value="body" style={{ flex: 1, fontSize: 11 }}>Body</TabsTrigger>
          <TabsTrigger value="auth" style={{ flex: 1, fontSize: 11 }}>Auth</TabsTrigger>
          <TabsTrigger value="options" style={{ flex: 1, fontSize: 11 }}>Opções</TabsTrigger>
        </TabsList>

        {/* ── Params ── */}
        <TabsContent value="params">
          <div style={sectionStyle}>
            {params.length === 0 && (
              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "8px 0" }}>
                Nenhum query param — aparecem após ? na URL
              </div>
            )}
            <KeyValueEditor
              pairs={params}
              onChange={(v) => onUpdateConfig("params", v)}
              keyPlaceholder="param"
              valuePlaceholder="valor"
            />
          </div>
        </TabsContent>

        {/* ── Headers ── */}
        <TabsContent value="headers">
          <div style={sectionStyle}>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {[
                ["Content-Type", "application/json"],
                ["Accept", "application/json"],
                ["Authorization", "Bearer ..."],
                ["User-Agent", "flowpython/1.0"],
              ].map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => {
                    if (!headers.find((h) => h.key === k)) {
                      onUpdateConfig("headers", [...headers, { key: k, value: v, enabled: true }]);
                    }
                  }}
                  style={{
                    fontSize: 10, padding: "3px 8px", borderRadius: 5,
                    border: "1px solid hsl(var(--border))",
                    background: "rgba(255,255,255,0.04)", cursor: "pointer",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  + {k}
                </button>
              ))}
            </div>
            <KeyValueEditor
              pairs={headers}
              onChange={(v) => onUpdateConfig("headers", v)}
              keyPlaceholder="Header-Name"
              valuePlaceholder="valor"
            />
          </div>
        </TabsContent>

        {/* ── Body ── */}
        <TabsContent value="body">
          <div style={sectionStyle}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 6 }}>Tipo de body</label>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {BODY_TYPES.map((bt) => (
                  <button
                    key={bt.value}
                    onClick={() => onUpdateConfig("bodyType", bt.value)}
                    style={{
                      padding: "4px 11px", borderRadius: 6, fontSize: 11, cursor: "pointer",
                      border: `1.5px solid ${bodyType === bt.value ? "#60a5fa" : "hsl(var(--border))"}`,
                      background: bodyType === bt.value ? "rgba(96,165,250,0.12)" : "transparent",
                      color: bodyType === bt.value ? "#60a5fa" : "hsl(var(--muted-foreground))",
                      fontWeight: bodyType === bt.value ? 700 : 400,
                    }}
                  >
                    {bt.label}
                  </button>
                ))}
              </div>
            </div>

            {bodyType === "json" && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>JSON Body</label>
                <Textarea
                  value={(cfg.bodyJson as string) ?? ""}
                  onChange={(e) => onUpdateConfig("bodyJson", e.target.value)}
                  placeholder={'{\n  "key": "value"\n}'}
                  rows={5}
                  style={{ fontFamily: "monospace", fontSize: 11, lineHeight: 1.5 }}
                />
              </div>
            )}

            {bodyType === "form" && (
              <KeyValueEditor
                pairs={bodyForm}
                onChange={(v) => onUpdateConfig("bodyForm", v)}
                keyPlaceholder="campo"
                valuePlaceholder="valor"
                addLabel="Adicionar campo"
              />
            )}

            {bodyType === "raw" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Content-Type</label>
                  <Select value={(cfg.bodyRawContentType as string) ?? "text/plain"} onValueChange={(v) => onUpdateConfig("bodyRawContentType", v)}>
                    <SelectTrigger style={{ height: 30, fontSize: 11 }}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["text/plain","text/html","application/xml","text/xml","application/javascript","text/css"].map((ct) => (
                        <SelectItem key={ct} value={ct} style={{ fontSize: 12 }}>{ct}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Textarea
                  value={(cfg.bodyRaw as string) ?? ""}
                  onChange={(e) => onUpdateConfig("bodyRaw", e.target.value)}
                  placeholder="Raw text body..."
                  rows={5}
                  style={{ fontFamily: "monospace", fontSize: 11 }}
                />
              </div>
            )}

            {bodyType === "none" && (
              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "4px 0" }}>
                Nenhum body será enviado
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Auth ── */}
        <TabsContent value="auth">
          <div style={sectionStyle}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 6 }}>Tipo de autenticação</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {AUTH_TYPES.map((at) => (
                  <button
                    key={at.value}
                    onClick={() => onUpdateConfig("authType", at.value)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "7px 10px", borderRadius: 7, cursor: "pointer", textAlign: "left",
                      border: `1.5px solid ${authType === at.value ? "#f472b6" : "hsl(var(--border))"}`,
                      background: authType === at.value ? "rgba(244,114,182,0.08)" : "transparent",
                    }}
                  >
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                      background: authType === at.value ? "#f472b6" : "hsl(var(--muted-foreground))",
                    }} />
                    <span style={{ fontSize: 12, fontWeight: authType === at.value ? 600 : 400, color: authType === at.value ? "#f472b6" : "hsl(var(--foreground))" }}>
                      {at.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {authType === "bearer" && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Token</label>
                <div style={{ position: "relative" }}>
                  <Input
                    type={showBearer ? "text" : "password"}
                    value={(cfg.authBearer as string) ?? ""}
                    onChange={(e) => onUpdateConfig("authBearer", e.target.value)}
                    placeholder="eyJhbGciOi..."
                    style={{ fontFamily: "monospace", fontSize: 11, paddingRight: 32 }}
                  />
                  <button
                    onClick={() => setShowBearer(!showBearer)}
                    style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", padding: 0 }}
                  >
                    {showBearer ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>Adicionado como <code>Authorization: Bearer &lt;token&gt;</code></div>
              </div>
            )}

            {authType === "basic" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Usuário</label>
                  <Input
                    value={(cfg.authUsername as string) ?? ""}
                    onChange={(e) => onUpdateConfig("authUsername", e.target.value)}
                    placeholder="username"
                    style={{ fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Senha</label>
                  <div style={{ position: "relative" }}>
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={(cfg.authPassword as string) ?? ""}
                      onChange={(e) => onUpdateConfig("authPassword", e.target.value)}
                      placeholder="••••••••"
                      style={{ paddingRight: 32, fontSize: 12 }}
                    />
                    <button
                      onClick={() => setShowPassword(!showPassword)}
                      style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", padding: 0 }}
                    >
                      {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {authType === "apikey" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Nome da chave</label>
                  <Input
                    value={(cfg.authApiKeyName as string) ?? "X-API-Key"}
                    onChange={(e) => onUpdateConfig("authApiKeyName", e.target.value)}
                    placeholder="X-API-Key"
                    style={{ fontFamily: "monospace", fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Valor</label>
                  <Input
                    value={(cfg.authApiKeyValue as string) ?? ""}
                    onChange={(e) => onUpdateConfig("authApiKeyValue", e.target.value)}
                    placeholder="sk-..."
                    style={{ fontFamily: "monospace", fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Enviar como</label>
                  <Select value={(cfg.authApiKeyIn as string) ?? "header"} onValueChange={(v) => onUpdateConfig("authApiKeyIn", v)}>
                    <SelectTrigger style={{ height: 30, fontSize: 11 }}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="header">Header HTTP</SelectItem>
                      <SelectItem value="query">Query string</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Opções ── */}
        <TabsContent value="options">
          <div style={sectionStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                {sslVerify
                  ? <Shield size={13} color="#22c55e" />
                  : <ShieldOff size={13} color="#f59e0b" />}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>Verificar SSL</div>
                  <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
                    {sslVerify ? "Certificados SSL validados" : "SSL ignorado (inseguro)"}
                  </div>
                </div>
              </div>
              <Switch checked={sslVerify} onCheckedChange={(v) => onUpdateConfig("sslVerify", v)} />
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500 }}>Seguir redirecionamentos</div>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>Segue automaticamente 3xx</div>
              </div>
              <Switch
                checked={(cfg.followRedirects as boolean) !== false}
                onCheckedChange={(v) => onUpdateConfig("followRedirects", v)}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Timeout (segundos)</label>
              <Input
                type="number"
                min={1}
                max={300}
                value={(cfg.timeout as number) ?? 30}
                onChange={(e) => onUpdateConfig("timeout", Number(e.target.value))}
                style={{ fontSize: 12 }}
              />
            </div>

            {!sslVerify && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>
                  Caminho do certificado CA (opcional)
                </label>
                <Input
                  value={(cfg.certPath as string) ?? ""}
                  onChange={(e) => onUpdateConfig("certPath", e.target.value)}
                  placeholder="/path/to/ca-bundle.crt"
                  style={{ fontFamily: "monospace", fontSize: 11 }}
                />
                <div style={{ fontSize: 10, color: "#f59e0b", marginTop: 4 }}>
                  ⚠️ Desativar SSL pode expor dados sensíveis
                </div>
              </div>
            )}

            {sslVerify && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>
                  Certificado cliente (opcional, .pem)
                </label>
                <Input
                  value={(cfg.certPath as string) ?? ""}
                  onChange={(e) => onUpdateConfig("certPath", e.target.value)}
                  placeholder="/path/to/client.pem"
                  style={{ fontFamily: "monospace", fontSize: 11 }}
                />
              </div>
            )}

            <div>
              <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Variável de saída</label>
              <Input
                value={(cfg.outputVar as string) ?? "response"}
                onChange={(e) => onUpdateConfig("outputVar", e.target.value)}
                placeholder="response"
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
              <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
                Resposta JSON salva no contexto como esta variável
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Variable Node Config ─────────────────────────────────────────────────────

function VariableNodeConfig({
  cfg,
  type,
  onUpdateConfig,
}: {
  cfg: Record<string, unknown>;
  type: string;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const { data: variablesData } = useListVariables({});
  const globalVars = variablesData ?? [];

  const scope = (cfg.scope as string) ?? "workflow";
  const operation = (cfg.operation as string) ?? "get";
  const isInject = type === "variable_inject";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Scope selector */}
      <div>
        <label style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))", display: "block", marginBottom: 8 }}>
          Escopo
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {VARIABLE_SCOPES.map((s) => (
            <button
              key={s.value}
              onClick={() => onUpdateConfig("scope", s.value)}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 11px",
                borderRadius: 8, border: `1.5px solid ${scope === s.value ? s.color : "hsl(var(--border))"}`,
                background: scope === s.value ? `${s.color}10` : "transparent",
                cursor: "pointer", textAlign: "left", transition: "border-color 0.12s, background 0.12s",
                width: "100%",
              }}
            >
              <div style={{
                width: 10, height: 10, borderRadius: "50%", background: s.color,
                flexShrink: 0, marginTop: 3, boxShadow: scope === s.value ? `0 0 6px ${s.color}` : "none",
              }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: scope === s.value ? s.color : "hsl(var(--foreground))" }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", lineHeight: 1.5, marginTop: 1 }}>
                  {s.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {!isInject && (
        <>
          {/* Operation toggle */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))", display: "block", marginBottom: 6 }}>
              Operação
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              {(["get", "set"] as const).map((op) => (
                <button
                  key={op}
                  onClick={() => onUpdateConfig("operation", op)}
                  style={{
                    flex: 1, padding: "7px 0", borderRadius: 7, border: `1.5px solid`,
                    borderColor: operation === op ? (op === "set" ? "#f59e0b" : "#60a5fa") : "hsl(var(--border))",
                    background: operation === op ? (op === "set" ? "rgba(245,158,11,0.1)" : "rgba(96,165,250,0.1)") : "transparent",
                    color: operation === op ? (op === "set" ? "#f59e0b" : "#60a5fa") : "hsl(var(--muted-foreground))",
                    fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em",
                    cursor: "pointer", transition: "all 0.12s",
                  }}
                >
                  {op === "get" ? "Ler" : "Definir"}
                </button>
              ))}
            </div>
          </div>

          {/* Key input — with suggestions for global scope */}
          <Field label="Chave (nome da variável)">
            {scope === "global" && globalVars.length > 0 ? (
              <Select value={(cfg.key as string) ?? ""} onValueChange={(v) => onUpdateConfig("key", v)}>
                <SelectTrigger><SelectValue placeholder="Selecionar variável global..." /></SelectTrigger>
                <SelectContent>
                  {globalVars.map((v: any) => (
                    <SelectItem key={v.id} value={v.key}>
                      <span style={{ fontFamily: "monospace" }}>{v.key}</span>
                      {v.value && <span style={{ color: "hsl(var(--muted-foreground))", marginLeft: 8, fontSize: 11 }}>= {String(v.value).slice(0, 20)}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={(cfg.key as string) ?? ""}
                onChange={(e) => onUpdateConfig("key", e.target.value)}
                placeholder="NOME_DA_VARIAVEL"
                style={{ fontFamily: "monospace" }}
              />
            )}
          </Field>

          {/* Value input — only for set */}
          {operation === "set" && (
            <Field label="Valor">
              <Textarea
                value={(cfg.value as string) ?? ""}
                onChange={(e) => onUpdateConfig("value", e.target.value)}
                placeholder="Valor a definir..."
                rows={3}
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </Field>
          )}
        </>
      )}

      {isInject && (
        <>
          <Field label="Chaves a injetar (uma por linha, vazio = todas)">
            <Textarea
              value={((cfg.keys as string[]) ?? []).join("\n")}
              onChange={(e) => onUpdateConfig("keys", e.target.value.split("\n").filter(Boolean))}
              placeholder={"API_KEY\nDB_URL"}
              rows={4}
              style={{ fontFamily: "monospace", fontSize: 12 }}
            />
          </Field>
          <div style={{
            background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.2)",
            borderRadius: 7, padding: "9px 11px", fontSize: 11,
            color: "hsl(var(--muted-foreground))", lineHeight: 1.6,
          }}>
            As variáveis injetadas ficam disponíveis para nodos downstream via pipeline scope.
          </div>
        </>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))" }}>{label}</label>
      {children}
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)", border: "1px solid hsl(var(--border))",
      borderRadius: 7, padding: "10px 12px", fontSize: 12,
      color: "hsl(var(--muted-foreground))", lineHeight: 1.6,
    }}>
      {children}
    </div>
  );
}

// ─── Public export ────────────────────────────────────────────────────────────

export default function WorkflowEditor() {
  const { id } = useParams();
  if (!id) return null;
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner workflowId={id} />
    </ReactFlowProvider>
  );
}
