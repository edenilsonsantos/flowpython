import { useState } from "react";
import { useListCredentials, useCreateCredential, useDeleteCredential, getListCredentialsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function Credentials() {
  const { data: credentials, isLoading } = useListCredentials();
  const createCredential = useCreateCredential();
  const deleteCredential = useDeleteCredential();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"api_key" | "basic_auth" | "oauth2" | "custom">("api_key");
  const [apiKey, setApiKey] = useState("");

  const handleCreate = async () => {
    if (!newName) return;
    try {
      await createCredential.mutateAsync({
        data: { 
          name: newName, 
          type: newType,
          data: { api_key: apiKey } // simplified for now
        }
      });
      toast({ title: "Credential saved securely" });
      setCreateDialogOpen(false);
      setNewName("");
      setApiKey("");
      queryClient.invalidateQueries({ queryKey: getListCredentialsQueryKey() });
    } catch (e) {
      toast({ title: "Failed to save credential", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCredential.mutateAsync({ id });
      toast({ title: "Credential deleted" });
      queryClient.invalidateQueries({ queryKey: getListCredentialsQueryKey() });
    } catch (e) {
      toast({ title: "Failed to delete credential", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Credentials</h1>
          <p className="text-muted-foreground mt-2">Securely store API keys and authentication tokens.</p>
        </div>
        
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Add Credential</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Credential</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="OpenAI API Key" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Type</label>
                <Select value={newType} onValueChange={(val: any) => setNewType(val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="api_key">API Key</SelectItem>
                    <SelectItem value="basic_auth">Basic Auth</SelectItem>
                    <SelectItem value="oauth2">OAuth2</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newType === "api_key" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">API Key / Token</label>
                  <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!newName || createCredential.isPending}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Loading credentials...</div>
      ) : !credentials?.length ? (
        <div className="flex flex-col items-center justify-center h-64 border rounded-lg border-dashed">
          <KeyRound className="h-10 w-10 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No credentials</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Store API keys securely to use them in your workflows.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {credentials.map(c => (
            <Card key={c.id}>
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-lg font-medium">{c.name}</CardTitle>
                <KeyRound className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="pb-3">
                <Badge variant="outline">{c.type}</Badge>
              </CardContent>
              <CardFooter className="pt-0 text-xs text-muted-foreground justify-between">
                <span>Stored securely</span>
                <Button variant="ghost" size="sm" className="text-destructive h-8 px-2" onClick={() => handleDelete(c.id)}>
                  <Trash2 className="h-3 w-3 mr-1" /> Delete
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
