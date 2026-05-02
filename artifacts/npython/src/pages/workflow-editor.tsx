import { useState, useCallback, useEffect, useRef } from "react";
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
  ArrowLeft, Play, Save, Settings, X, Trash2, AlertTriangle,
  FlaskConical, Pin, PinOff, CheckCircle2, XCircle, Loader2, Plus, Package,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";

import { CanvasNode } from "@/components/canvas-node";
import { EdgeWithDelete } from "@/components/edge-with-delete";
import { NodePalette } from "@/components/node-palette";
import { NodeDef, getNodeDef, isTriggerType, VARIABLE_SCOPES } from "@/lib/node-definitions";
import {
  useListVariables,
} from "@workspace/api-client-react";

const nodeTypes = { custom: CanvasNode };
const edgeTypes = { custom: EdgeWithDelete };

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

  // Clear test result when selected node changes
  useEffect(() => { setTestResult(null); }, [selectedNode?.id]);

  // Load workflow nodes/edges once
  useEffect(() => {
    if (workflow && !initRef.current) {
      initRef.current = true;
      setNodes(
        (workflow.nodes || []).map((n) => ({
          id: n.id,
          type: "custom",
          position: { x: n.positionX, y: n.positionY },
          data: { label: n.label, type: n.type, config: n.config, ...n },
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

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("application/flowpython-node");
      if (!raw) return;
      const def: NodeDef = JSON.parse(raw);
      const position = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNodeFromDef(def, position);
    },
    [reactFlow]
  );

  const addNodeFromDef = useCallback((def: NodeDef, position?: { x: number; y: number }) => {
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

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Carregando editor...</div>;
  }

  return (
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
          width: 360, height: "100%", background: "hsl(var(--card))",
          borderLeft: "1px solid hsl(var(--border))",
          display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden",
        }}>
          {/* Panel header */}
          <div style={{
            padding: "12px 14px", borderBottom: "1px solid hsl(var(--border))",
            display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Configurar Node</div>
              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
                {getNodeDef(selectedNode.data.type as string)?.description}
              </div>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <Button variant="ghost" size="icon" onClick={deleteSelectedNode} title="Deletar node">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setSelectedNode(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Panel body */}
          <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
            <NodeConfigPanel
              node={selectedNode}
              workflowId={workflowId}
              onUpdateData={updateNodeData}
              onUpdateConfig={updateNodeConfig}
              onTestNode={handleTestNode}
              testLoading={testLoading}
              testResult={testResult}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Config panel ─────────────────────────────────────────────────────────────

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
            <CodeMirror value={(cfg.code as string) ?? ""} height="220px" theme="dark" extensions={[python()]} onChange={(val) => onUpdateConfig("code", val)} />
          </div>
        </Field>
      )}

      {type === "condition" && (
        <Field label="Expressão Python (True/False)">
          <Input value={(cfg.expression as string) ?? ""} onChange={(e) => onUpdateConfig("expression", e.target.value)} placeholder="len(result) > 0" style={{ fontFamily: "monospace" }} />
        </Field>
      )}

      {type === "loop" && (
        <Field label="Lista de itens (Python)">
          <Input value={(cfg.itemsExpression as string) ?? ""} onChange={(e) => onUpdateConfig("itemsExpression", e.target.value)} placeholder="[1, 2, 3]" style={{ fontFamily: "monospace" }} />
        </Field>
      )}

      {type === "set_variable" && <>
        <Field label="Chave"><Input value={(cfg.key as string) ?? ""} onChange={(e) => onUpdateConfig("key", e.target.value)} placeholder="MY_VAR" /></Field>
        <Field label="Valor"><Input value={(cfg.value as string) ?? ""} onChange={(e) => onUpdateConfig("value", e.target.value)} /></Field>
      </>}

      {type === "get_variable" && (
        <Field label="Chave"><Input value={(cfg.key as string) ?? ""} onChange={(e) => onUpdateConfig("key", e.target.value)} placeholder="MY_VAR" /></Field>
      )}

      {type === "transform" && (
        <Field label="Código Python (variável `input`)">
          <div style={{ border: "1px solid hsl(var(--border))", borderRadius: 6, overflow: "hidden" }}>
            <CodeMirror value={(cfg.code as string) ?? "output = input"} height="160px" theme="dark" extensions={[python()]} onChange={(val) => onUpdateConfig("code", val)} />
          </div>
        </Field>
      )}

      {type === "http_request" && <>
        <Field label="Método">
          <Select value={(cfg.method as string) ?? "GET"} onValueChange={(v) => onUpdateConfig("method", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["GET","POST","PUT","PATCH","DELETE"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="URL"><Input value={(cfg.url as string) ?? ""} onChange={(e) => onUpdateConfig("url", e.target.value)} placeholder="https://api.example.com/endpoint" /></Field>
        <Field label="Body (JSON)">
          <Textarea value={(cfg.body as string) ?? ""} onChange={(e) => onUpdateConfig("body", e.target.value)} placeholder='{"key": "value"}' rows={3} style={{ fontFamily: "monospace", fontSize: 12 }} />
        </Field>
      </>}

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
