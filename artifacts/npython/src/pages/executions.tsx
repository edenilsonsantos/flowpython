import { useState } from "react";
import { useLocation } from "wouter";
import { useListExecutions, ListExecutionsStatus } from "@workspace/api-client-react";
import { formatDistanceToNow, format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Search, Activity, CheckCircle2, XCircle, Loader2,
  Clock, Circle, ChevronRight, AlertTriangle, Filter,
  RefreshCw, Play
} from "lucide-react";

type ExecutionStatus = "success" | "failed" | "running" | "pending" | "stopped";

interface StatusConfig {
  icon: React.ReactNode;
  label: string;
  color: string;
  rowBorder: string;
}

function getStatusConfig(status: string): StatusConfig {
  switch (status) {
    case "success":
      return {
        icon: <CheckCircle2 size={14} />,
        label: "Success",
        color: "text-emerald-400",
        rowBorder: "border-l-emerald-500/40",
      };
    case "failed":
      return {
        icon: <XCircle size={14} />,
        label: "Failed",
        color: "text-red-400",
        rowBorder: "border-l-red-500/60",
      };
    case "running":
      return {
        icon: <Loader2 size={14} className="animate-spin" />,
        label: "Running",
        color: "text-blue-400",
        rowBorder: "border-l-blue-500/50",
      };
    case "pending":
      return {
        icon: <Circle size={14} />,
        label: "Pending",
        color: "text-muted-foreground",
        rowBorder: "border-l-muted/40",
      };
    case "stopped":
      return {
        icon: <Circle size={14} />,
        label: "Stopped",
        color: "text-yellow-500",
        rowBorder: "border-l-yellow-500/40",
      };
    default:
      return {
        icon: <Circle size={14} />,
        label: status,
        color: "text-muted-foreground",
        rowBorder: "border-l-muted/30",
      };
  }
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5 border-b border-border/40 animate-pulse">
      <div className="w-3 h-3 rounded-full bg-muted" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="h-3.5 bg-muted rounded w-48" />
        <div className="h-2.5 bg-muted/60 rounded w-24" />
      </div>
      <div className="h-3 bg-muted rounded w-20 hidden sm:block" />
      <div className="h-3 bg-muted rounded w-16 hidden md:block" />
      <div className="h-3 bg-muted rounded w-12 hidden lg:block" />
      <div className="w-4 h-4 bg-muted rounded hidden sm:block" />
    </div>
  );
}

export default function Executions() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ListExecutionsStatus | "all">("all");

  const queryParams = statusFilter !== "all" ? { status: statusFilter } : {};
  const { data: executions, isLoading, isError, refetch } = useListExecutions(queryParams);

  const filteredExecutions = (executions ?? []).filter(e =>
    e.workflowName.toLowerCase().includes(search.toLowerCase()) ||
    e.id.toLowerCase().includes(search.toLowerCase())
  );

  const counts = (executions ?? []).reduce(
    (acc, e) => { acc[e.status as string] = (acc[e.status as string] ?? 0) + 1; return acc; },
    {} as Record<string, number>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Page header */}
      <div className="flex-none px-6 py-5 border-b border-border/50">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Executions</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {executions == null ? "Loading history…" : `${executions.length} total run${executions.length !== 1 ? "s" : ""}`}
              {counts.running ? <span className="ml-2 text-blue-400">· {counts.running} running</span> : null}
              {counts.failed ? <span className="ml-2 text-red-400">· {counts.failed} failed</span> : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="h-8 gap-1.5"
            >
              <RefreshCw size={13} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by workflow name or ID…"
              className="pl-8 h-8 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={13} className="text-muted-foreground" />
            <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val as ListExecutionsStatus | "all")}>
              <SelectTrigger className="h-8 w-[160px] text-sm">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="stopped">Stopped</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {/* Column headers */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/50 px-4 py-2">
          <div className="flex items-center gap-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <div className="w-3 flex-none" />
            <div className="flex-1 min-w-0">Workflow</div>
            <div className="w-32 hidden sm:block">Trigger</div>
            <div className="w-36 hidden md:block">Started</div>
            <div className="w-20 hidden lg:block text-right">Duration</div>
            <div className="w-4 flex-none hidden sm:block" />
          </div>
        </div>

        {isLoading && (
          <div>
            {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="text-muted-foreground text-sm">Failed to load execution history.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </div>
        )}

        {!isLoading && !isError && filteredExecutions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <Activity className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground text-sm">
              {search || statusFilter !== "all" ? "No executions match your filters." : "No executions yet. Run a workflow to see history."}
            </p>
            {(search || statusFilter !== "all") && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setStatusFilter("all"); }}>
                Clear filters
              </Button>
            )}
          </div>
        )}

        {!isLoading && !isError && filteredExecutions.length > 0 && (
          <div>
            {filteredExecutions.map((execution) => {
              const sc = getStatusConfig(execution.status);
              return (
                <div
                  key={execution.id}
                  onClick={() => navigate(`/executions/${execution.id}`)}
                  className={`
                    group flex items-center gap-4 px-4 py-3.5
                    border-b border-border/40 border-l-2 ${sc.rowBorder}
                    cursor-pointer transition-colors duration-100
                    hover:bg-muted/30
                  `}
                >
                  {/* Status icon */}
                  <div className={`flex-none ${sc.color}`}>
                    {sc.icon}
                  </div>

                  {/* Workflow name + error/meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {execution.workflowName}
                      </span>
                      <span className={`hidden sm:inline text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                        execution.status === "success"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : execution.status === "failed"
                          ? "bg-red-500/10 text-red-400"
                          : execution.status === "running"
                          ? "bg-blue-500/10 text-blue-400"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {sc.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-muted-foreground/60 font-mono">
                        {execution.id.substring(0, 8)}
                      </span>
                      {execution.errorMessage && (
                        <span className="text-[11px] text-red-400/80 truncate max-w-xs hidden sm:block">
                          · {execution.errorMessage}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Trigger */}
                  <div className="w-32 hidden sm:flex items-center gap-1.5">
                    <Play size={10} className="text-muted-foreground/60 flex-none" />
                    <span className="text-xs text-muted-foreground capitalize truncate">
                      {execution.triggeredBy}
                    </span>
                  </div>

                  {/* Started */}
                  <div className="w-36 hidden md:block">
                    <div className="text-xs text-muted-foreground" title={format(new Date(execution.startedAt), "PPpp")}>
                      {formatDistanceToNow(new Date(execution.startedAt), { addSuffix: true })}
                    </div>
                    <div className="text-[10px] text-muted-foreground/50 mt-0.5">
                      {format(new Date(execution.startedAt), "MMM d, HH:mm:ss")}
                    </div>
                  </div>

                  {/* Duration */}
                  <div className="w-20 hidden lg:flex items-center justify-end gap-1 text-xs text-muted-foreground">
                    <Clock size={10} className="flex-none" />
                    {formatDuration(execution.durationMs)}
                  </div>

                  {/* Chevron */}
                  <div className="w-4 flex-none hidden sm:flex items-center justify-center">
                    <ChevronRight size={14} className="text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
