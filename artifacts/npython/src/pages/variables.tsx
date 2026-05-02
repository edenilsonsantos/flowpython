import { useState } from "react";
import { useListVariables, useCreateVariable, useDeleteVariable, getListVariablesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function Variables() {
  const { data: variables, isLoading } = useListVariables();
  const createVariable = useCreateVariable();
  const deleteVariable = useDeleteVariable();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newType, setNewType] = useState<"string" | "number" | "boolean" | "json">("string");
  
  const [visibleValues, setVisibleValues] = useState<Record<string, boolean>>({});

  const handleCreate = async () => {
    if (!newKey || !newValue) return;
    try {
      await createVariable.mutateAsync({
        data: { key: newKey, value: newValue, type: newType }
      });
      toast({ title: "Variable created" });
      setCreateDialogOpen(false);
      setNewKey("");
      setNewValue("");
      queryClient.invalidateQueries({ queryKey: getListVariablesQueryKey() });
    } catch (e) {
      toast({ title: "Failed to create variable", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteVariable.mutateAsync({ id });
      toast({ title: "Variable deleted" });
      queryClient.invalidateQueries({ queryKey: getListVariablesQueryKey() });
    } catch (e) {
      toast({ title: "Failed to delete variable", variant: "destructive" });
    }
  };

  const toggleVisibility = (id: string) => {
    setVisibleValues(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Global Variables</h1>
          <p className="text-muted-foreground mt-2">Manage environment variables available to all workflows.</p>
        </div>
        
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Add Variable</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Global Variable</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Key</label>
                <Input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="API_URL" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Type</label>
                <Select value={newType} onValueChange={(val: any) => setNewType(val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">String</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="boolean">Boolean</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Value</label>
                <Input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="https://api.example.com" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!newKey || !newValue || createVariable.isPending}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Variables</CardTitle>
          <CardDescription>These values can be accessed in Python nodes using `get_variable(key)`.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading variables...</div>
          ) : !variables?.length ? (
            <div className="p-8 text-center text-muted-foreground">No variables defined.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variables.map(v => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono font-medium">{v.key}</TableCell>
                    <TableCell><Badge variant="outline">{v.type}</Badge></TableCell>
                    <TableCell className="font-mono text-sm">
                      <div className="flex items-center space-x-2">
                        <span>{visibleValues[v.id] ? v.value : "••••••••••••••••"}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleVisibility(v.id)}>
                          {visibleValues[v.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDelete(v.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
