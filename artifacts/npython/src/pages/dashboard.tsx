import { useGetExecutionSummary, ExecutionSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Play, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";

export default function Dashboard() {
  const { data: summary, isLoading, isError } = useGetExecutionSummary();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-2">Loading execution summary...</p>
        </div>
      </div>
    );
  }

  if (isError || !summary) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-destructive mt-2">Failed to load execution summary.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-2">Overview of your automation platform.</p>
        </div>
        <div className="flex space-x-2">
          <Link href="/workflows">
            <Button>
              <Play className="mr-2 h-4 w-4" /> View Workflows
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Executions Today</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalToday}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Successful</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.successToday}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <XCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.failedToday}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Running Now</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.runningNow}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Recent Executions</CardTitle>
            <CardDescription>Executions from the last 24 hours.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {summary.recentExecutions.length === 0 ? (
                <p className="text-muted-foreground text-sm">No recent executions.</p>
              ) : (
                summary.recentExecutions.map((execution) => (
                  <div key={execution.id} className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">
                        <Link href={`/executions/${execution.id}`} className="hover:underline">
                          {execution.workflowName}
                        </Link>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(execution.startedAt), { addSuffix: true })}
                      </p>
                    </div>
                    <Badge variant={execution.status === "success" ? "default" : execution.status === "failed" ? "destructive" : "secondary"}>
                      {execution.status}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
        
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Top Workflows</CardTitle>
            <CardDescription>Most frequently executed workflows.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {summary.topWorkflows.length === 0 ? (
                <p className="text-muted-foreground text-sm">No workflows executed yet.</p>
              ) : (
                summary.topWorkflows.map((workflow) => (
                  <div key={workflow.workflowId} className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">
                        <Link href={`/workflows/${workflow.workflowId}/edit`} className="hover:underline">
                          {workflow.workflowName}
                        </Link>
                      </p>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {workflow.executionCount} runs
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
