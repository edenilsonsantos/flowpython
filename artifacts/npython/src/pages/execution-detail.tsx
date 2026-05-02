import { useParams, Link } from "wouter";
import { useGetExecution, useGetExecutionLogs, useStopExecution, getGetExecutionQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Clock, Calendar, Activity, StopCircle, Terminal } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function ExecutionDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: execution, isLoading, isError } = useGetExecution(id || "", {
    query: { enabled: !!id, queryKey: getGetExecutionQueryKey(id || ""), refetchInterval: (data) => data?.status === 'running' ? 2000 : false }
  });

  const { data: logs } = useGetExecutionLogs(id || "", undefined, {
    query: { enabled: !!id, refetchInterval: execution?.status === 'running' ? 2000 : false }
  });

  const stopExecution = useStopExecution();

  const handleStop = async () => {
    if (!id) return;
    try {
      await stopExecution.mutateAsync({ id });
      toast({ title: "Execution stopped" });
      queryClient.invalidateQueries({ queryKey: getGetExecutionQueryKey(id) });
    } catch (error) {
      toast({ title: "Failed to stop execution", variant: "destructive" });
    }
  };

  if (isLoading) {
    return <div className="p-8 text-muted-foreground">Loading execution details...</div>;
  }

  if (isError || !execution) {
    return <div className="p-8 text-destructive">Failed to load execution details.</div>;
  }

  const isRunning = execution.status === "running" || execution.status === "pending";

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-4">
          <Link href="/executions">
            <Button variant="outline" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-2xl font-bold tracking-tight">Execution: {execution.workflowName}</h1>
              <Badge variant={
                execution.status === "success" ? "default" : 
                execution.status === "failed" ? "destructive" : 
                "secondary"
              } className="capitalize">
                {execution.status}
              </Badge>
            </div>
            <p className="text-sm font-mono text-muted-foreground mt-1">{execution.id}</p>
          </div>
        </div>
        
        {isRunning && (
          <Button variant="destructive" onClick={handleStop} disabled={stopExecution.isPending}>
            <StopCircle className="mr-2 h-4 w-4" /> Stop Execution
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-4 shrink-0">
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Started At</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 flex items-center">
            <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
            {format(new Date(execution.startedAt), "MMM d, yyyy HH:mm:ss")}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Duration</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 flex items-center">
            <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
            {execution.durationMs != null ? `${(execution.durationMs / 1000).toFixed(2)}s` : "-"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Triggered By</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 flex items-center capitalize">
            <Activity className="mr-2 h-4 w-4 text-muted-foreground" />
            {execution.triggeredBy}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Status</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 font-medium capitalize">
            {execution.status}
          </CardContent>
        </Card>
      </div>

      {execution.errorMessage && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-md shrink-0">
          <h4 className="font-bold text-sm mb-1">Execution Error</h4>
          <p className="font-mono text-sm whitespace-pre-wrap">{execution.errorMessage}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-1 min-h-0">
        {/* Node Results Timeline */}
        <Card className="md:col-span-1 flex flex-col h-full overflow-hidden">
          <CardHeader className="pb-3 shrink-0">
            <CardTitle className="text-base">Node Execution Timeline</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto pr-2">
            <div className="space-y-4 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
              {execution.nodeResults?.map((result, i) => (
                <div key={result.nodeId} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-5 h-5 rounded-full border-2 border-background bg-card shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2">
                    <div className={`w-2 h-2 rounded-full ${
                      result.status === 'success' ? 'bg-primary' : 
                      result.status === 'failed' ? 'bg-destructive' : 
                      'bg-muted-foreground'
                    }`}></div>
                  </div>
                  <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] p-3 rounded border bg-card shadow-sm">
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="font-semibold text-sm">{result.nodeLabel}</h4>
                    </div>
                    <div className="text-xs text-muted-foreground flex justify-between">
                      <span className="capitalize">{result.status}</span>
                      <span>{result.durationMs ? `${(result.durationMs / 1000).toFixed(2)}s` : ''}</span>
                    </div>
                    {result.error && (
                      <div className="mt-2 text-xs text-destructive font-mono truncate">{result.error}</div>
                    )}
                  </div>
                </div>
              ))}
              {!execution.nodeResults?.length && (
                <p className="text-muted-foreground text-sm text-center py-4">No node results available.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Logs Panel */}
        <Card className="md:col-span-2 flex flex-col h-full overflow-hidden bg-[#0d1117] border-border text-gray-300 font-mono">
          <CardHeader className="py-2 px-4 border-b border-border/30 bg-[#161b22] shrink-0 flex flex-row items-center">
            <Terminal className="h-4 w-4 mr-2" />
            <CardTitle className="text-sm font-normal">Execution Logs</CardTitle>
          </CardHeader>
          <CardContent className="p-4 flex-1 overflow-y-auto text-xs">
            {logs?.length === 0 ? (
              <p className="text-gray-500">No logs generated.</p>
            ) : (
              <div className="space-y-1">
                {logs?.map((log) => (
                  <div key={log.id} className="flex space-x-2">
                    <span className="text-gray-500 shrink-0">
                      {format(new Date(log.timestamp), "HH:mm:ss.SSS")}
                    </span>
                    <span className={`shrink-0 w-12 font-bold ${
                      log.level === 'error' ? 'text-red-400' :
                      log.level === 'warn' ? 'text-yellow-400' :
                      log.level === 'debug' ? 'text-blue-400' :
                      'text-green-400'
                    }`}>
                      [{log.level.toUpperCase()}]
                    </span>
                    <span className="whitespace-pre-wrap break-all">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
