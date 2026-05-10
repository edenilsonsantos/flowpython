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
  usePublishWorkflow,
  useUnpublishWorkflow,
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
  Bot, Wand2, Sparkles, MoveRight, Share2, Globe2, GitCommit, Rocket,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { autocompletion } from "@codemirror/autocomplete";

import { CanvasNode } from "@/components/canvas-node";
import { EdgeWithDelete } from "@/components/edge-with-delete";
import { NodePalette } from "@/components/node-palette";
import { NodeDetailModal } from "@/components/node-detail-modal";
import { NodeDef, NODE_DEFINITIONS, getNodeDef, getNodeOutputHandles, isTriggerType, isDatabaseNodeType, parseDbNodeType, DB_META, DB_OP_META, VARIABLE_SCOPES } from "@/lib/node-definitions";
import { pythonLibraryCompletionSource } from "@/lib/python-completions";
import { copilotExtension } from "@/lib/copilot-extension";
import { QuickConnectCtx } from "@/components/quick-connect-popup";
import {
  useListVariables,
  useListWorkflows,
} from "@workspace/api-client-react";
import {
  nodeColorFromId,
  VarColorInfo,
  VarColorCtx,
  NodeOutputMap,
  NodeOutputPreview,
  UpstreamVarPicker,
  NodeConfigPanel,
  insertVarRef,
} from "@/components/node-config-panel";

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

  // ── "Editar nodos" from executions page: pin each node's config with its
  //    snapshot from the chosen execution so the user can move/edit/add freely.
  const fromExecutionId = (() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("fromExecution");
  })();
  const [pinnedFromExec, setPinnedFromExec] = useState<{ executionId: string; pinnedCount: number } | null>(null);

  const { data: workflow, isLoading } = useGetWorkflow(workflowId, {
    query: { enabled: !!workflowId, queryKey: getGetWorkflowQueryKey(workflowId) },
  });
  const updateWorkflow = useUpdateWorkflow();
  const executeWorkflow = useExecuteWorkflow();
  const publishWorkflow = usePublishWorkflow();
  const unpublishWorkflow = useUnpublishWorkflow();

  const [nodes, setNodes] = useState<ReactFlowNode[]>([]);
  const [edges, setEdges] = useState<ReactFlowEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<ReactFlowNode | null>(null);
  const [testResult, setTestResult] = useState<{ output: string; success: boolean; durationMs: number; pipeline?: Record<string, unknown> | null } | null>(null);
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

  // Detail modal (3-column INPUT|PARAMETERS|OUTPUT) opened via double-click
  const [detailNode, setDetailNode] = useState<ReactFlowNode | null>(null);

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

  // Load workflow nodes/edges once. If we arrived via ?fromExecution=:id,
  // first fetch the execution's debug data and pin each node's snapshot.
  useEffect(() => {
    if (!workflow || initRef.current) return;
    initRef.current = true;

    // Color edges leaving a branching node by their source handle so users
    // can visually distinguish which output (true/false/case/etc) each edge
    // came from. Non-branching edges keep the default primary color.
    const nodeById = new Map((workflow.nodes ?? []).map((n) => [n.id, n]));
    const baseEdges = (workflow.edges || []).map((e) => {
      const src = nodeById.get(e.sourceNodeId);
      let stroke = "hsl(var(--primary))";
      if (src && e.sourceHandle) {
        const handles = getNodeOutputHandles(src.type as string, (src.config as Record<string, unknown>) ?? {});
        const h = handles.find((x) => x.id === e.sourceHandle);
        if (h && handles.length > 1) stroke = h.color;
      }
      return {
        id: e.id,
        type: "custom",
        source: e.sourceNodeId,
        target: e.targetNodeId,
        sourceHandle: e.sourceHandle ?? undefined,
        label: e.label ?? undefined,
        animated: true,
        style: { stroke, strokeWidth: 2 },
      };
    });
    const baseNodes = (workflow.nodes || []).map((n) => ({
      id: n.id,
      type: "custom" as const,
      position: { x: n.positionX, y: n.positionY },
      data: { ...n } as Record<string, unknown>,
    }));

    if (!fromExecutionId) {
      setNodes(baseNodes);
      setEdges(baseEdges);
      return;
    }

    // Pin each node with the snapshot captured during the chosen execution.
    (async () => {
      try {
        const res = await fetch(`/api/executions/${fromExecutionId}/debug`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const debug = await res.json() as {
          nodeResults: { nodeId: string; outputSnapshot?: { pipeline?: Record<string, unknown> } }[];
        };
        const snapshotsByNode: Record<string, Record<string, unknown>> = {};
        for (const r of debug.nodeResults ?? []) {
          const pipeline = r.outputSnapshot?.pipeline;
          if (pipeline && typeof pipeline === "object") snapshotsByNode[r.nodeId] = pipeline;
        }
        let pinnedCount = 0;
        const pinnedNodes = baseNodes.map((n) => {
          const snap = snapshotsByNode[n.id];
          if (!snap || Object.keys(snap).length === 0) return n;
          pinnedCount += 1;
          const data = n.data as Record<string, unknown>;
          const cfg = (data.config as Record<string, unknown>) ?? {};
          return {
            ...n,
            data: { ...data, config: { ...cfg, pinned: true, pinnedData: snap } },
          };
        });
        setNodes(pinnedNodes);
        setEdges(baseEdges);
        setPinnedFromExec({ executionId: fromExecutionId, pinnedCount });
        toast({
          title: "Snapshot da execução carregado",
          description: `${pinnedCount} nodo(s) pinado(s) com dados da execução. Salve para persistir.`,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "erro desconhecido";
        toast({ title: "Falha ao carregar execução", description: msg, variant: "destructive" });
        setNodes(baseNodes);
        setEdges(baseEdges);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: ReactFlowNode) => {
    setSelectedNode(node);
    setDetailNode(node);
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
      sourceHandle: (e.sourceHandle as string | undefined) ?? null,
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

  // ── Publish / unpublish ──────────────────────────────────────────
  const handlePublish = async () => {
    try {
      // Save first so the snapshot reflects the current editor state
      await handleSave();
      await publishWorkflow.mutateAsync({ id: workflowId });
      toast({ title: "Workflow publicado", description: "A versão atual está agora ativa para triggers." });
      queryClient.invalidateQueries({ queryKey: getGetWorkflowQueryKey(workflowId) });
    } catch {
      toast({ title: "Erro ao publicar", variant: "destructive" });
    }
  };

  const handleUnpublish = async () => {
    try {
      await unpublishWorkflow.mutateAsync({ id: workflowId });
      toast({ title: "Publicação removida" });
      queryClient.invalidateQueries({ queryKey: getGetWorkflowQueryKey(workflowId) });
    } catch {
      toast({ title: "Erro ao despublicar", variant: "destructive" });
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
      setTestResult({ output: data.output ?? data.error ?? "", success: data.success, durationMs: data.durationMs ?? 0, pipeline: data.returnValue ?? null });
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

  // ── Quick-connect: create new node of given type and connect ─────
  const handleAddAndConnect = useCallback((sourceId: string, nodeType: string) => {
    const def = NODE_DEFINITIONS.find((d) => d.type === nodeType);
    if (!def) return;
    const sourceNode = nodes.find((n) => n.id === sourceId);
    const pos = sourceNode
      ? { x: sourceNode.position.x + 280, y: sourceNode.position.y }
      : { x: 400 + Math.random() * 100, y: 200 + Math.random() * 100 };
    const newId = `node_${Date.now()}`;
    const newNode: ReactFlowNode = {
      id: newId,
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
    setEdges((eds) => {
      if (eds.some((e) => e.source === sourceId && e.target === newId)) return eds;
      return addEdge({
        id: `edge_${Date.now()}`,
        source: sourceId,
        target: newId,
        type: "custom",
        animated: true,
        style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
      }, eds);
    });
  }, [nodes]);

  const quickConnectCtxValue = useMemo(() => ({
    onAddAndConnect: handleAddAndConnect,
  }), [handleAddAndConnect]);

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
    <QuickConnectCtx.Provider value={quickConnectCtxValue}>
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
            {/* Draft / Published / Draft has changes pill */}
            {(() => {
              if (!workflow) return null;
              const isPublished = !!workflow.publishedAt;
              const dirty = !!workflow.hasUnpublishedChanges;
              const cfg = isPublished
                ? (dirty
                    ? { color: "#fbbf24", bg: "rgba(251,191,36,0.12)", border: "rgba(251,191,36,0.35)", icon: <GitCommit size={11} />, text: "Draft com alterações" }
                    : { color: "#22c55e", bg: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.35)",  icon: <Globe2 size={11} />,    text: "Publicado" })
                : { color: "#94a3b8", bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.30)", icon: <GitCommit size={11} />, text: "Draft" };
              return (
                <div title={isPublished ? `Publicado em ${new Date(workflow.publishedAt!).toLocaleString()}` : "Sem versão publicada"}
                  style={{
                    display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600,
                    color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`,
                    borderRadius: 6, padding: "3px 8px",
                  }}>
                  {cfg.icon} {cfg.text}
                </div>
              );
            })()}
            {!hasTrigger && nodes.length > 0 && (
              <div style={{
                display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#fbbf24",
                background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)",
                borderRadius: 6, padding: "3px 8px",
              }}>
                <AlertTriangle size={12} /> Adicione um Trigger
              </div>
            )}
            {pinnedFromExec && (
              <div
                title={`Cada nodo está usando os dados produzidos na execução ${pinnedFromExec.executionId.slice(0, 8)}…`}
                style={{
                  display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600,
                  color: "#a78bfa", background: "rgba(167,139,250,0.10)",
                  border: "1px solid rgba(167,139,250,0.35)", borderRadius: 6, padding: "3px 10px",
                }}
              >
                <Pin size={11} /> Snapshot pinado · {pinnedFromExec.pinnedCount} nodo(s)
                <button
                  onClick={() => {
                    // Strip pinned/pinnedData from every node's config, then drop the badge.
                    setNodes((nds) => nds.map((n) => {
                      const data = n.data as Record<string, unknown>;
                      const cfg = { ...((data.config as Record<string, unknown>) ?? {}) };
                      delete cfg.pinned;
                      delete cfg.pinnedData;
                      return { ...n, data: { ...data, config: cfg } };
                    }));
                    setPinnedFromExec(null);
                    toast({ title: "Snapshots removidos de todos os nodos" });
                  }}
                  style={{
                    marginLeft: 4, background: "transparent", border: "none",
                    color: "#a78bfa", cursor: "pointer", padding: "0 2px",
                    display: "flex", alignItems: "center",
                  }}
                  title="Remover todos os pins"
                >
                  <X size={11} />
                </button>
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Button variant="ghost" size="sm" onClick={handleSave} disabled={updateWorkflow.isPending}>
              <Save className="h-4 w-4 mr-1.5" /> Salvar
            </Button>
            {workflow?.publishedAt && !workflow.hasUnpublishedChanges ? (
              <Button variant="ghost" size="sm" onClick={handleUnpublish}
                disabled={unpublishWorkflow.isPending}
                title="Remover versão publicada"
                style={{ color: "#ef4444" }}>
                <PinOff className="h-4 w-4 mr-1.5" /> Despublicar
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={handlePublish}
                disabled={publishWorkflow.isPending || nodes.length === 0}
                title="Publicar versão atual como ativa"
                style={{ color: "#22c55e" }}>
                {publishWorkflow.isPending
                  ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  : <Rocket className="h-4 w-4 mr-1.5" />}
                {workflow?.publishedAt ? "Republicar" : "Publicar"}
              </Button>
            )}
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
            onNodeDoubleClick={onNodeDoubleClick}
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

    {/* Node detail modal (double-click) */}
    <NodeDetailModal
      open={!!detailNode}
      onClose={() => setDetailNode(null)}
      node={detailNode ? (nodes.find((n) => n.id === detailNode.id) ?? detailNode) : null}
      workflowId={workflowId}
      nodes={nodes}
      edges={edges}
      lastRunOutputs={lastRunOutputs}
      onUpdateData={updateNodeData}
      onUpdateConfig={updateNodeConfig}
      onTestNode={handleTestNode}
      testLoading={testLoading}
      testResult={testResult}
      onRefreshOutputs={fetchLastRunOutputs}
    />
    </div>
    </VarColorCtx.Provider>
    </QuickConnectCtx.Provider>
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
