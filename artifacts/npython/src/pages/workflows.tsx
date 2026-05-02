import { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  useListWorkflows, 
  useCreateWorkflow, 
  useDeleteWorkflow,
  useExecuteWorkflow
} from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Search, Plus, MoreVertical, Play, Edit3, Trash2, Activity, Box } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListWorkflowsQueryKey } from "@workspace/api-client-react";

export default function Workflows() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState("");
  const [newWorkflowDescription, setNewWorkflowDescription] = useState("");

  const { data: workflows, isLoading, isError } = useListWorkflows();
  const createWorkflow = useCreateWorkflow();
  const deleteWorkflow = useDeleteWorkflow();
  const executeWorkflow = useExecuteWorkflow();

  const handleCreate = async () => {
    if (!newWorkflowName.trim()) return;
    try {
      const res = await createWorkflow.mutateAsync({
        data: { name: newWorkflowName, description: newWorkflowDescription }
      });
      toast({ title: "Workflow created" });
      setCreateDialogOpen(false);
      setLocation(`/workflows/${res.id}/edit`);
    } catch (error) {
      toast({ title: "Failed to create workflow", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWorkflow.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey() });
      toast({ title: "Workflow deleted" });
    } catch (error) {
      toast({ title: "Failed to delete workflow", variant: "destructive" });
    }
  };

  const handleExecute = async (id: string) => {
    try {
      const res = await executeWorkflow.mutateAsync({ id });
      toast({ title: "Execution started" });
      setLocation(`/executions/${res.id}`);
    } catch (error) {
      toast({ title: "Failed to execute workflow", variant: "destructive" });
    }
  };

  const filteredWorkflows = workflows?.filter(w => 
    w.name.toLowerCase().includes(search.toLowerCase()) || 
    w.description?.toLowerCase().includes(search.toLowerCase())
  ) || [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workflows</h1>
          <p className="text-muted-foreground mt-2">Loading workflows...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workflows</h1>
          <p className="text-destructive mt-2">Failed to load workflows.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workflows</h1>
          <p className="text-muted-foreground mt-2">Manage and monitor your automation workflows.</p>
        </div>
        <div className="flex space-x-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search workflows..." 
              className="pl-9 w-[250px]" 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> New Workflow
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Workflow</DialogTitle>
                <DialogDescription>
                  Create a new python automation workflow.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input 
                    placeholder="e.g. Data Sync" 
                    value={newWorkflowName}
                    onChange={(e) => setNewWorkflowName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description (Optional)</label>
                  <Input 
                    placeholder="What does this workflow do?" 
                    value={newWorkflowDescription}
                    onChange={(e) => setNewWorkflowDescription(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={!newWorkflowName.trim() || createWorkflow.isPending}>
                  {createWorkflow.isPending ? "Creating..." : "Create Workflow"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {filteredWorkflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 border rounded-lg border-dashed">
          <Activity className="h-10 w-10 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No workflows found</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            {search ? "Try adjusting your search query." : "Create your first workflow to get started."}
          </p>
          {!search && (
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Create Workflow
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredWorkflows.map((workflow) => (
            <Card key={workflow.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">
                      <Link href={`/workflows/${workflow.id}/edit`} className="hover:underline">
                        {workflow.name}
                      </Link>
                    </CardTitle>
                    <CardDescription className="line-clamp-2 min-h-[40px]">
                      {workflow.description || "No description provided."}
                    </CardDescription>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 -mt-1 -mr-2">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setLocation(`/workflows/${workflow.id}/edit`)}>
                        <Edit3 className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleExecute(workflow.id)}>
                        <Play className="mr-2 h-4 w-4" /> Execute
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        className="text-destructive focus:text-destructive"
                        onClick={() => handleDelete(workflow.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="pb-3 flex-1">
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge variant={workflow.active ? "default" : "secondary"}>
                    {workflow.active ? "Active" : "Inactive"}
                  </Badge>
                  {workflow.lastStatus && (
                    <Badge variant={workflow.lastStatus === "success" ? "outline" : workflow.lastStatus === "failed" ? "destructive" : "secondary"} className="capitalize">
                      {workflow.lastStatus}
                    </Badge>
                  )}
                  {workflow.tags?.map((tag) => (
                    <Badge key={tag} variant="secondary">{tag}</Badge>
                  ))}
                </div>
              </CardContent>
              <CardFooter className="pt-0 text-xs text-muted-foreground justify-between">
                <div className="flex items-center">
                  <Box className="h-3 w-3 mr-1" /> {workflow.nodeCount} nodes
                </div>
                <div className="flex items-center">
                  {workflow.lastExecutedAt ? (
                    <>
                      <Activity className="h-3 w-3 mr-1" />
                      {formatDistanceToNow(new Date(workflow.lastExecutedAt), { addSuffix: true })}
                    </>
                  ) : (
                    "Never run"
                  )}
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
