import { useState } from "react";
import { Link } from "wouter";
import { useListExecutions, ListExecutionsStatus } from "@workspace/api-client-react";
import { formatDistanceToNow, format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Activity, Calendar, Clock, TerminalSquare } from "lucide-react";

export default function Executions() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ListExecutionsStatus | "all">("all");

  // Since we might not want to pass undefined to API if "all" is selected
  const queryParams = statusFilter !== "all" ? { status: statusFilter } : {};

  const { data: executions, isLoading, isError } = useListExecutions(queryParams);

  const filteredExecutions = executions?.filter(e => 
    e.workflowName.toLowerCase().includes(search.toLowerCase()) ||
    e.id.toLowerCase().includes(search.toLowerCase())
  ) || [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Executions</h1>
          <p className="text-muted-foreground mt-2">Loading execution history...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Executions</h1>
          <p className="text-destructive mt-2">Failed to load execution history.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Executions</h1>
          <p className="text-muted-foreground mt-2">History of workflow runs.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3 border-b border-border/50">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="relative w-full sm:w-[300px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search workflows or ID..." 
                className="pl-9" 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val as any)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="stopped">Stopped</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredExecutions.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-64">
              <Activity className="h-10 w-10 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No executions found.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExecutions.map((execution) => (
                  <TableRow key={execution.id}>
                    <TableCell className="font-medium">
                      <Link href={`/executions/${execution.id}`} className="hover:underline flex items-center">
                        <TerminalSquare className="h-4 w-4 mr-2 text-primary" />
                        {execution.workflowName}
                      </Link>
                      <div className="text-xs text-muted-foreground font-mono mt-1">
                        {execution.id.substring(0, 8)}...
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        execution.status === "success" ? "default" : 
                        execution.status === "failed" ? "destructive" : 
                        "secondary"
                      } className="capitalize">
                        {execution.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {execution.triggeredBy}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center text-muted-foreground">
                        <Calendar className="h-3 w-3 mr-1" />
                        {format(new Date(execution.startedAt), "MMM d, HH:mm:ss")}
                      </div>
                    </TableCell>
                    <TableCell>
                      {execution.durationMs != null ? (
                        <div className="flex items-center text-muted-foreground">
                          <Clock className="h-3 w-3 mr-1" />
                          {(execution.durationMs / 1000).toFixed(2)}s
                        </div>
                      ) : "-"}
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
