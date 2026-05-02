import { useState, useCallback, useMemo, useEffect, useRef } from "react";
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
  Panel
} from "reactflow";
import "reactflow/dist/style.css";
import { 
  useGetWorkflow, 
  useUpdateWorkflow,
  useExecuteWorkflow,
  Node as ApiNode,
  Edge as ApiEdge,
  getGetWorkflowQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Play, Save, Settings, X, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";

// Custom node component (placeholder for complex styling)
const CustomNode = ({ data, isConnectable }: any) => {
  return (
    <div className="px-4 py-2 shadow-md rounded-md bg-card border-2 border-border">
      <div className="flex items-center">
        <div className="rounded-full w-8 h-8 flex items-center justify-center bg-primary/20 text-primary mr-2">
          {data.type?.substring(0, 2).toUpperCase()}
        </div>
        <div className="font-bold text-sm">{data.label}</div>
      </div>
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

export default function WorkflowEditor() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: workflow, isLoading } = useGetWorkflow(id || "", {
    query: { enabled: !!id, queryKey: getGetWorkflowQueryKey(id || "") }
  });

  const updateWorkflow = useUpdateWorkflow();
  const executeWorkflow = useExecuteWorkflow();

  const [nodes, setNodes] = useState<ReactFlowNode[]>([]);
  const [edges, setEdges] = useState<ReactFlowEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<ReactFlowNode | null>(null);

  const initRef = useRef(false);

  useEffect(() => {
    if (workflow && !initRef.current) {
      initRef.current = true;
      const initialNodes = (workflow.nodes || []).map((n) => ({
        id: n.id,
        type: 'custom',
        position: { x: n.positionX, y: n.positionY },
        data: { label: n.label, type: n.type, config: n.config, ...n }
      }));
      
      const initialEdges = (workflow.edges || []).map((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        label: e.label || undefined,
        animated: true
      }));

      setNodes(initialNodes);
      setEdges(initialEdges);
    }
  }, [workflow]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    []
  );

  const onNodeClick = useCallback((event: React.MouseEvent, node: ReactFlowNode) => {
    setSelectedNode(node);
  }, []);

  const handleSave = async () => {
    if (!id) return;
    
    // Map back to API schema
    const apiNodes: ApiNode[] = nodes.map(n => ({
      id: n.id,
      workflowId: id,
      type: n.data.type || 'code',
      label: n.data.label || 'Node',
      positionX: n.position.x,
      positionY: n.position.y,
      config: n.data.config || {},
      retryCount: n.data.retryCount,
      retryDelayMs: n.data.retryDelayMs,
      continueOnError: n.data.continueOnError,
      stopOnError: n.data.stopOnError,
      createdAt: n.data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));

    const apiEdges: ApiEdge[] = edges.map(e => ({
      id: e.id,
      sourceNodeId: e.source,
      targetNodeId: e.target,
      label: e.label as string,
      condition: null // Simplified for now
    }));

    try {
      await updateWorkflow.mutateAsync({
        id,
        data: { nodes: apiNodes, edges: apiEdges }
      });
      toast({ title: "Workflow saved" });
      queryClient.invalidateQueries({ queryKey: getGetWorkflowQueryKey(id) });
    } catch (error) {
      toast({ title: "Failed to save workflow", variant: "destructive" });
    }
  };

  const handleExecute = async () => {
    if (!id) return;
    try {
      const res = await executeWorkflow.mutateAsync({ id });
      toast({ title: "Execution started" });
      setLocation(`/executions/${res.id}`);
    } catch (error) {
      toast({ title: "Failed to execute", variant: "destructive" });
    }
  };

  const updateSelectedNodeData = (key: string, value: any) => {
    if (!selectedNode) return;
    setNodes(nds => nds.map(n => {
      if (n.id === selectedNode.id) {
        const newData = { ...n.data, [key]: value };
        setSelectedNode({ ...n, data: newData }); // keep selected node state in sync
        return { ...n, data: newData };
      }
      return n;
    }));
  };

  const updateSelectedNodeConfig = (key: string, value: any) => {
    if (!selectedNode) return;
    setNodes(nds => nds.map(n => {
      if (n.id === selectedNode.id) {
        const newConfig = { ...(n.data.config || {}), [key]: value };
        const newData = { ...n.data, config: newConfig };
        setSelectedNode({ ...n, data: newData });
        return { ...n, data: newData };
      }
      return n;
    }));
  };

  const handleAddNode = () => {
    const newNode: ReactFlowNode = {
      id: `node_${Date.now()}`,
      type: 'custom',
      position: { x: Math.random() * 200 + 100, y: Math.random() * 200 + 100 },
      data: { 
        label: 'New Node', 
        type: 'code',
        config: { code: 'print("Hello World")' },
        createdAt: new Date().toISOString()
      }
    };
    setNodes(nds => [...nds, newNode]);
  };


  if (isLoading) {
    return <div className="p-8 text-muted-foreground">Loading editor...</div>;
  }

  return (
    <div className="flex h-full w-full relative">
      {/* Canvas Area */}
      <div className="flex-1 h-full relative border-r border-border">
        {/* Header Toolbar */}
        <div className="absolute top-0 left-0 right-0 z-10 p-4 flex items-center justify-between pointer-events-none">
          <div className="pointer-events-auto flex items-center space-x-2 bg-background/90 backdrop-blur border border-border p-1 rounded-md">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/workflows")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="px-2 font-medium">
              {workflow?.name || "Workflow"}
            </div>
            {workflow?.active ? <Badge variant="default" className="scale-75">Active</Badge> : <Badge variant="secondary" className="scale-75">Inactive</Badge>}
          </div>

          <div className="pointer-events-auto flex items-center space-x-2 bg-background/90 backdrop-blur border border-border p-1 rounded-md">
            <Button variant="ghost" size="sm" onClick={handleSave} disabled={updateWorkflow.isPending}>
              <Save className="h-4 w-4 mr-2" /> Save
            </Button>
            <Button variant="default" size="sm" onClick={handleExecute} disabled={executeWorkflow.isPending}>
              <Play className="h-4 w-4 mr-2" /> Run
            </Button>
          </div>
        </div>

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
          className="bg-card"
        >
          <Background color="var(--border)" gap={16} />
          <Controls className="!bg-background !border-border !fill-foreground" />
          <MiniMap className="!bg-card !border-border" nodeColor="var(--primary)" />
          
          <Panel position="bottom-left" className="mb-4 ml-4">
            <Button onClick={handleAddNode} variant="secondary" className="shadow-md">
              <Plus className="mr-2 h-4 w-4" /> Add Node
            </Button>
          </Panel>
        </ReactFlow>
      </div>

      {/* Config Panel */}
      {selectedNode && (
        <div className="w-96 h-full bg-card overflow-y-auto flex flex-col border-l border-border animate-in slide-in-from-right-8 duration-200">
          <div className="p-4 border-b border-border flex items-center justify-between sticky top-0 bg-card z-10">
            <h3 className="font-bold">Node Configuration</h3>
            <Button variant="ghost" size="icon" onClick={() => setSelectedNode(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="p-4 flex-1 space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Node Label</label>
              <Input 
                value={selectedNode.data.label || ""} 
                onChange={(e) => updateSelectedNodeData("label", e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Node Type</label>
              <div className="p-2 bg-secondary rounded-md text-sm border font-mono">
                {selectedNode.data.type}
              </div>
            </div>

            {selectedNode.data.type === 'code' && (
              <div className="space-y-2 flex-1">
                <label className="text-sm font-medium">Python Code</label>
                <div className="border border-border rounded-md overflow-hidden">
                  <CodeMirror
                    value={(selectedNode.data.config?.code as string) || ""}
                    height="300px"
                    theme="dark"
                    extensions={[python()]}
                    onChange={(val) => updateSelectedNodeConfig("code", val)}
                  />
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-border space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground flex items-center">
                <Settings className="w-4 h-4 mr-2" /> Advanced Settings
              </h4>
              
              <div className="flex items-center justify-between">
                <label className="text-sm">Continue On Error</label>
                <Switch 
                  checked={!!selectedNode.data.continueOnError}
                  onCheckedChange={(checked) => updateSelectedNodeData("continueOnError", checked)}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <label className="text-sm">Stop On Error</label>
                <Switch 
                  checked={!!selectedNode.data.stopOnError}
                  onCheckedChange={(checked) => updateSelectedNodeData("stopOnError", checked)}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
