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
import { ArrowLeft, Play, Save, Settings, X, Trash2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";

import { CanvasNode } from "@/components/canvas-node";
import { NodePalette } from "@/components/node-palette";
import { NodeDef, getNodeDef, isTriggerType } from "@/lib/node-definitions";

const nodeTypes = { custom: CanvasNode };

// ─── Inner editor (needs useReactFlow context) ────────────────────────────────

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
  const initRef = useRef(false);

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
          source: e.sourceNodeId,
          target: e.targetNodeId,
          label: e.label ?? undefined,
          animated: true,
          style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
        }))
      );
    }
  }, [workflow]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      setSelectedNode((sel) => {
        if (!sel) return sel;
        const removed = changes.some(
          (c) => c.type === "remove" && c.id === sel.id
        );
        return removed ? null : sel;
      });
    },
    []
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge(
          { ...params, animated: true, style: { stroke: "hsl(var(--primary))", strokeWidth: 2 } },
          eds
        )
      ),
    []
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: ReactFlowNode) => {
    setSelectedNode(node);
  }, []);

  // ── Drag-and-drop from palette ─────────────────────────────────
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

      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const position = reactFlow.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      addNodeFromDef(def, position);
    },
    [reactFlow]
  );

  // ── Add node helpers ───────────────────────────────────────────
  const addNodeFromDef = useCallback(
    (def: NodeDef, position?: { x: number; y: number }) => {
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
    },
    []
  );

  // ── Save ───────────────────────────────────────────────────────
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
      toast({ title: "Workflow salvo com sucesso" });
      queryClient.invalidateQueries({ queryKey: getGetWorkflowQueryKey(workflowId) });
    } catch {
      toast({ title: "Falha ao salvar workflow", variant: "destructive" });
    }
  };

  // ── Execute (validate trigger first) ──────────────────────────
  const handleExecute = async () => {
    const hasTrigger = nodes.some((n) => isTriggerType(n.data.type as string));
    if (!hasTrigger) {
      toast({
        title: "Trigger obrigatório",
        description: "Adicione ao menos um nodo de Trigger antes de executar.",
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await executeWorkflow.mutateAsync({ id: workflowId });
      toast({ title: "Execução iniciada" });
      setLocation(`/executions/${res.id}`);
    } catch {
      toast({ title: "Falha ao iniciar execução", variant: "destructive" });
    }
  };

  // ── Config panel helpers ───────────────────────────────────────
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
    setEdges((eds) =>
      eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id)
    );
    setSelectedNode(null);
  };

  // ── Trigger warning ────────────────────────────────────────────
  const hasTrigger = nodes.some((n) => isTriggerType(n.data.type as string));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Carregando editor...
      </div>
    );
  }

  return (
    <div className="flex h-full w-full" style={{ overflow: "hidden" }}>
      {/* Node palette */}
      <NodePalette onAddNode={(def) => addNodeFromDef(def)} />

      {/* Canvas */}
      <div className="flex-1 flex flex-col h-full relative">
        {/* Header toolbar */}
        <div
          style={{
            height: 52,
            borderBottom: "1px solid hsl(var(--border))",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 12px",
            background: "hsl(var(--card))",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Button variant="ghost" size="icon" onClick={() => setLocation("/workflows")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{workflow?.name ?? "Workflow"}</span>
            {workflow?.active ? (
              <Badge variant="default" className="text-xs">Active</Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">Inactive</Badge>
            )}
            {!hasTrigger && nodes.length > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  color: "#fbbf24",
                  background: "rgba(251,191,36,0.1)",
                  border: "1px solid rgba(251,191,36,0.3)",
                  borderRadius: 6,
                  padding: "3px 8px",
                }}
              >
                <AlertTriangle size={12} />
                Adicione um Trigger
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSave}
              disabled={updateWorkflow.isPending}
            >
              <Save className="h-4 w-4 mr-1.5" /> Salvar
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleExecute}
              disabled={executeWorkflow.isPending}
            >
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
            fitView
            deleteKeyCode="Delete"
            style={{ background: "hsl(var(--background))" }}
          >
            <Background color="rgba(255,255,255,0.04)" gap={20} />
            <Controls
              style={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
              }}
            />
            <MiniMap
              style={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
              }}
              nodeColor={(n) => {
                const def = getNodeDef(n.data?.type);
                return def?.color ?? "#94a3b8";
              }}
            />
          </ReactFlow>
        </div>
      </div>

      {/* Config panel */}
      {selectedNode && (
        <div
          style={{
            width: 340,
            height: "100%",
            background: "hsl(var(--card))",
            borderLeft: "1px solid hsl(var(--border))",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          {/* Panel header */}
          <div
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid hsl(var(--border))",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexShrink: 0,
            }}
          >
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
              onUpdateData={updateNodeData}
              onUpdateConfig={updateNodeConfig}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Config panel per node type ───────────────────────────────────────────────

function NodeConfigPanel({
  node,
  onUpdateData,
  onUpdateConfig,
}: {
  node: ReactFlowNode;
  onUpdateData: (k: string, v: unknown) => void;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const cfg = (node.data.config as Record<string, unknown>) ?? {};
  const type = node.data.type as string;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Label (all nodes) */}
      <Field label="Label">
        <Input
          value={(node.data.label as string) ?? ""}
          onChange={(e) => onUpdateData("label", e.target.value)}
        />
      </Field>

      {/* ── Trigger: Manual ──────────────────────────────────── */}
      {type === "trigger_manual" && (
        <InfoBox>O workflow será iniciado manualmente via botão ou API.</InfoBox>
      )}

      {/* ── Trigger: Webhook ─────────────────────────────────── */}
      {type === "trigger_webhook" && (
        <>
          <Field label="Método HTTP">
            <Select
              value={(cfg.method as string) ?? "POST"}
              onValueChange={(v) => onUpdateConfig("method", v)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Path">
            <Input
              value={(cfg.path as string) ?? "/webhook"}
              onChange={(e) => onUpdateConfig("path", e.target.value)}
              placeholder="/webhook"
            />
          </Field>
        </>
      )}

      {/* ── Trigger: Schedule ────────────────────────────────── */}
      {type === "trigger_schedule" && (
        <>
          <Field label="Cron Expression">
            <Input
              value={(cfg.cron as string) ?? "0 9 * * *"}
              onChange={(e) => onUpdateConfig("cron", e.target.value)}
              placeholder="0 9 * * *"
              style={{ fontFamily: "monospace" }}
            />
          </Field>
          <InfoBox>
            Formato: <code style={{ color: "#14b8a6" }}>min hora dia mês dia-semana</code>
            <br />Ex: <code>0 9 * * *</code> = todo dia às 09:00
          </InfoBox>
        </>
      )}

      {/* ── Trigger: Subflow ─────────────────────────────────── */}
      {type === "trigger_subflow" && (
        <InfoBox>Este workflow será chamado como sub-flow por outro workflow.</InfoBox>
      )}

      {/* ── Code ─────────────────────────────────────────────── */}
      {type === "code" && (
        <Field label="Código Python">
          <div style={{ border: "1px solid hsl(var(--border))", borderRadius: 6, overflow: "hidden" }}>
            <CodeMirror
              value={(cfg.code as string) ?? ""}
              height="260px"
              theme="dark"
              extensions={[python()]}
              onChange={(val) => onUpdateConfig("code", val)}
            />
          </div>
        </Field>
      )}

      {/* ── Condition ────────────────────────────────────────── */}
      {type === "condition" && (
        <Field label="Expressão Python (retorna True/False)">
          <Input
            value={(cfg.expression as string) ?? ""}
            onChange={(e) => onUpdateConfig("expression", e.target.value)}
            placeholder="len(result) > 0"
            style={{ fontFamily: "monospace" }}
          />
        </Field>
      )}

      {/* ── Loop ─────────────────────────────────────────────── */}
      {type === "loop" && (
        <Field label="Expressão da lista (Python)">
          <Input
            value={(cfg.itemsExpression as string) ?? ""}
            onChange={(e) => onUpdateConfig("itemsExpression", e.target.value)}
            placeholder="[1, 2, 3]"
            style={{ fontFamily: "monospace" }}
          />
        </Field>
      )}

      {/* ── Set Variable ─────────────────────────────────────── */}
      {type === "set_variable" && (
        <>
          <Field label="Chave">
            <Input
              value={(cfg.key as string) ?? ""}
              onChange={(e) => onUpdateConfig("key", e.target.value)}
              placeholder="MY_VAR"
            />
          </Field>
          <Field label="Valor">
            <Input
              value={(cfg.value as string) ?? ""}
              onChange={(e) => onUpdateConfig("value", e.target.value)}
              placeholder="valor"
            />
          </Field>
        </>
      )}

      {/* ── Get Variable ─────────────────────────────────────── */}
      {type === "get_variable" && (
        <Field label="Chave">
          <Input
            value={(cfg.key as string) ?? ""}
            onChange={(e) => onUpdateConfig("key", e.target.value)}
            placeholder="MY_VAR"
          />
        </Field>
      )}

      {/* ── Transform ────────────────────────────────────────── */}
      {type === "transform" && (
        <Field label="Código Python (usa variável `input`)">
          <div style={{ border: "1px solid hsl(var(--border))", borderRadius: 6, overflow: "hidden" }}>
            <CodeMirror
              value={(cfg.code as string) ?? "output = input"}
              height="180px"
              theme="dark"
              extensions={[python()]}
              onChange={(val) => onUpdateConfig("code", val)}
            />
          </div>
        </Field>
      )}

      {/* ── HTTP Request ─────────────────────────────────────── */}
      {type === "http_request" && (
        <>
          <Field label="Método">
            <Select
              value={(cfg.method as string) ?? "GET"}
              onValueChange={(v) => onUpdateConfig("method", v)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="URL">
            <Input
              value={(cfg.url as string) ?? ""}
              onChange={(e) => onUpdateConfig("url", e.target.value)}
              placeholder="https://api.example.com/endpoint"
            />
          </Field>
          <Field label="Body (JSON)">
            <Textarea
              value={(cfg.body as string) ?? ""}
              onChange={(e) => onUpdateConfig("body", e.target.value)}
              placeholder='{"key": "value"}'
              rows={3}
              style={{ fontFamily: "monospace", fontSize: 12 }}
            />
          </Field>
        </>
      )}

      {/* ── Wait ─────────────────────────────────────────────── */}
      {type === "wait" && (
        <Field label="Segundos de espera">
          <Input
            type="number"
            min={1}
            value={(cfg.seconds as number) ?? 5}
            onChange={(e) => onUpdateConfig("seconds", Number(e.target.value))}
          />
        </Field>
      )}

      {/* ── Note ─────────────────────────────────────────────── */}
      {type === "note" && (
        <Field label="Texto da nota">
          <Textarea
            value={(cfg.text as string) ?? ""}
            onChange={(e) => onUpdateConfig("text", e.target.value)}
            rows={4}
          />
        </Field>
      )}

      {/* ── Advanced (all non-trigger, non-note) ─────────────── */}
      {!isTriggerType(type) && type !== "note" && (
        <div
          style={{
            paddingTop: 14,
            borderTop: "1px solid hsl(var(--border))",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color: "hsl(var(--muted-foreground))",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Settings size={12} /> Avançado
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13 }}>Continuar em caso de erro</span>
            <Switch
              checked={!!(node.data.continueOnError)}
              onCheckedChange={(v) => onUpdateData("continueOnError", v)}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13 }}>Parar em caso de erro</span>
            <Switch
              checked={!!(node.data.stopOnError)}
              onCheckedChange={(v) => onUpdateData("stopOnError", v)}
            />
          </div>
          <Field label="Tentativas de retry">
            <Input
              type="number"
              min={0}
              max={10}
              value={(node.data.retryCount as number) ?? 0}
              onChange={(e) => onUpdateData("retryCount", Number(e.target.value))}
            />
          </Field>
          <Field label="Delay entre retries (ms)">
            <Input
              type="number"
              min={100}
              value={(node.data.retryDelayMs as number) ?? 1000}
              onChange={(e) => onUpdateData("retryDelayMs", Number(e.target.value))}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

// ─── Small helper components ─────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid hsl(var(--border))",
        borderRadius: 7,
        padding: "10px 12px",
        fontSize: 12,
        color: "hsl(var(--muted-foreground))",
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}

// ─── Public export (wraps with ReactFlowProvider) ────────────────────────────

export default function WorkflowEditor() {
  const { id } = useParams();
  if (!id) return null;
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner workflowId={id} />
    </ReactFlowProvider>
  );
}
