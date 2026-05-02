import { Router } from "express";
import { db, workflowsTable, nodesTable, edgesTable, executionsTable, logLinesTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { generateId } from "../lib/id";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import os from "os";
import fs from "fs/promises";

const router = Router();

// In-memory map of running execution PIDs
const runningProcesses = new Map<string, ChildProcess>();

// GET /executions
router.get("/executions", async (req, res) => {
  try {
    const { workflowId, status, limit } = req.query;
    const lim = Math.min(parseInt(String(limit ?? "50"), 10) || 50, 200);

    const conditions = [];
    if (workflowId) conditions.push(eq(executionsTable.workflowId, String(workflowId)));
    if (status) conditions.push(eq(executionsTable.status, String(status)));

    const execs = await db
      .select({
        exec: executionsTable,
        workflowName: workflowsTable.name,
      })
      .from(executionsTable)
      .innerJoin(workflowsTable, eq(executionsTable.workflowId, workflowsTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(executionsTable.startedAt))
      .limit(lim);

    res.json(
      execs.map(({ exec, workflowName }) => ({
        id: exec.id,
        workflowId: exec.workflowId,
        workflowName,
        status: exec.status,
        startedAt: exec.startedAt.toISOString(),
        finishedAt: exec.finishedAt?.toISOString() ?? null,
        durationMs: exec.durationMs ?? null,
        triggeredBy: exec.triggeredBy,
        errorMessage: exec.errorMessage ?? null,
      }))
    );
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /executions/summary
router.get("/executions/summary", async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const allExecs = await db
      .select({
        exec: executionsTable,
        workflowName: workflowsTable.name,
      })
      .from(executionsTable)
      .innerJoin(workflowsTable, eq(executionsTable.workflowId, workflowsTable.id))
      .orderBy(desc(executionsTable.startedAt))
      .limit(100);

    const todayExecs = allExecs.filter((r) => r.exec.startedAt >= today);
    const totalToday = todayExecs.length;
    const successToday = todayExecs.filter((r) => r.exec.status === "success").length;
    const failedToday = todayExecs.filter((r) => r.exec.status === "failed").length;
    const runningNow = allExecs.filter((r) => r.exec.status === "running").length;

    const recentExecutions = allExecs.slice(0, 10).map(({ exec, workflowName }) => ({
      id: exec.id,
      workflowId: exec.workflowId,
      workflowName,
      status: exec.status,
      startedAt: exec.startedAt.toISOString(),
      finishedAt: exec.finishedAt?.toISOString() ?? null,
      durationMs: exec.durationMs ?? null,
      triggeredBy: exec.triggeredBy,
      errorMessage: exec.errorMessage ?? null,
    }));

    // Count per workflow
    const wfCounts = new Map<string, { workflowId: string; workflowName: string; executionCount: number }>();
    for (const { exec, workflowName } of allExecs) {
      const existing = wfCounts.get(exec.workflowId);
      if (existing) {
        existing.executionCount++;
      } else {
        wfCounts.set(exec.workflowId, { workflowId: exec.workflowId, workflowName, executionCount: 1 });
      }
    }
    const topWorkflows = [...wfCounts.values()].sort((a, b) => b.executionCount - a.executionCount).slice(0, 5);

    res.json({ totalToday, successToday, failedToday, runningNow, recentExecutions, topWorkflows });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /executions/:id
router.get("/executions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [row] = await db
      .select({ exec: executionsTable, workflowName: workflowsTable.name })
      .from(executionsTable)
      .innerJoin(workflowsTable, eq(executionsTable.workflowId, workflowsTable.id))
      .where(eq(executionsTable.id, id));

    if (!row) return res.status(404).json({ error: "Execution not found" });

    const { exec, workflowName } = row;
    const nodeResults = (exec.nodeResults as any[]) ?? [];

    res.json({
      id: exec.id,
      workflowId: exec.workflowId,
      workflowName,
      status: exec.status,
      startedAt: exec.startedAt.toISOString(),
      finishedAt: exec.finishedAt?.toISOString() ?? null,
      durationMs: exec.durationMs ?? null,
      triggeredBy: exec.triggeredBy,
      errorMessage: exec.errorMessage ?? null,
      nodeResults,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /executions/:id/stop
router.post("/executions/:id/stop", async (req, res) => {
  try {
    const { id } = req.params;
    const proc = runningProcesses.get(id);
    if (proc) {
      proc.kill("SIGTERM");
      runningProcesses.delete(id);
    }

    const [updated] = await db
      .update(executionsTable)
      .set({ status: "stopped", finishedAt: new Date() })
      .where(and(eq(executionsTable.id, id), eq(executionsTable.status, "running")))
      .returning();

    const [row] = await db
      .select({ exec: executionsTable, workflowName: workflowsTable.name })
      .from(executionsTable)
      .innerJoin(workflowsTable, eq(executionsTable.workflowId, workflowsTable.id))
      .where(eq(executionsTable.id, id));

    if (!row) return res.status(404).json({ error: "Execution not found" });

    res.json({
      id: row.exec.id,
      workflowId: row.exec.workflowId,
      workflowName: row.workflowName,
      status: row.exec.status,
      startedAt: row.exec.startedAt.toISOString(),
      finishedAt: row.exec.finishedAt?.toISOString() ?? null,
      durationMs: row.exec.durationMs ?? null,
      triggeredBy: row.exec.triggeredBy,
      errorMessage: row.exec.errorMessage ?? null,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /executions/:id/logs
router.get("/executions/:id/logs", async (req, res) => {
  try {
    const { id } = req.params;
    const { nodeId } = req.query;

    const conditions = [eq(logLinesTable.executionId, id)];
    if (nodeId) conditions.push(eq(logLinesTable.nodeId, String(nodeId)));

    const logs = await db
      .select()
      .from(logLinesTable)
      .where(and(...conditions))
      .orderBy(logLinesTable.timestamp);

    res.json(
      logs.map((l) => ({
        id: l.id,
        executionId: l.executionId,
        nodeId: l.nodeId ?? null,
        level: l.level,
        message: l.message,
        timestamp: l.timestamp.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /workflows/:id/execute  — trigger full workflow execution
router.post("/workflows/:id/execute", async (req, res) => {
  const { id: workflowId } = req.params;

  try {
    const [workflow] = await db
      .select()
      .from(workflowsTable)
      .where(eq(workflowsTable.id, workflowId));

    if (!workflow) return res.status(404).json({ error: "Workflow not found" });

    const nodes = await db.select().from(nodesTable).where(eq(nodesTable.workflowId, workflowId));
    const edges = await db.select().from(edgesTable).where(eq(edgesTable.workflowId, workflowId));

    const executionId = generateId();
    const [execution] = await db
      .insert(executionsTable)
      .values({
        id: executionId,
        workflowId,
        status: "running",
        triggeredBy: "manual",
        nodeResults: nodes.map((n) => ({
          nodeId: n.id,
          nodeLabel: n.label,
          status: "pending",
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          output: null,
          error: null,
        })),
      })
      .returning();

    res.status(202).json({
      id: execution!.id,
      workflowId,
      workflowName: workflow.name,
      status: "running",
      startedAt: execution!.startedAt.toISOString(),
      finishedAt: null,
      durationMs: null,
      triggeredBy: "manual",
      errorMessage: null,
    });

    // Run workflow async after response
    runWorkflow({ executionId, workflowId, workflowName: workflow.name, nodes, edges });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function addLog(executionId: string, nodeId: string | null, level: string, message: string) {
  try {
    await db.insert(logLinesTable).values({
      id: generateId(),
      executionId,
      nodeId,
      level,
      message,
      timestamp: new Date(),
    });
  } catch {}
}

async function runWorkflow({
  executionId,
  workflowId,
  workflowName,
  nodes,
  edges,
}: {
  executionId: string;
  workflowId: string;
  workflowName: string;
  nodes: any[];
  edges: any[];
}) {
  const startTime = Date.now();

  try {
    await addLog(executionId, null, "info", `Starting workflow "${workflowName}"`);

    // ── 1. Find trigger nodes ──────────────────────────────────────
    const triggerNodes = nodes.filter((n) => String(n.type).startsWith("trigger_"));
    if (triggerNodes.length === 0) {
      await addLog(executionId, null, "error", "No trigger node found — workflow aborted");
      await db.update(executionsTable).set({
        status: "failed",
        finishedAt: new Date(),
        durationMs: Date.now() - startTime,
        errorMessage: "No trigger node found",
      }).where(eq(executionsTable.id, executionId));
      return;
    }

    // ── 2. BFS to find reachable nodes from triggers ───────────────
    const childrenMap = new Map<string, string[]>();
    for (const node of nodes) childrenMap.set(node.id, []);
    for (const edge of edges) {
      const arr = childrenMap.get(edge.sourceNodeId) ?? [];
      arr.push(edge.targetNodeId);
      childrenMap.set(edge.sourceNodeId, arr);
    }

    const reachable = new Set<string>(triggerNodes.map((n) => n.id));
    const bfsQueue = [...triggerNodes.map((n) => n.id)];
    let bfsIdx = 0;
    while (bfsIdx < bfsQueue.length) {
      const cur = bfsQueue[bfsIdx++];
      for (const child of childrenMap.get(cur) ?? []) {
        if (!reachable.has(child)) {
          reachable.add(child);
          bfsQueue.push(child);
        }
      }
    }

    const reachableNodes = nodes.filter((n) => reachable.has(n.id));
    await addLog(executionId, null, "info",
      `Executing ${reachableNodes.length} of ${nodes.length} nodes (connected to trigger)`);

    // ── 3. Topological sort of reachable nodes ─────────────────────
    const incomingMap = new Map<string, string[]>();
    for (const node of reachableNodes) incomingMap.set(node.id, []);
    for (const edge of edges) {
      if (reachable.has(edge.sourceNodeId) && reachable.has(edge.targetNodeId)) {
        const arr = incomingMap.get(edge.targetNodeId) ?? [];
        arr.push(edge.sourceNodeId);
        incomingMap.set(edge.targetNodeId, arr);
      }
    }

    const sorted: any[] = [];
    const visited = new Set<string>();

    function visit(nodeId: string) {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const deps = incomingMap.get(nodeId) ?? [];
      for (const dep of deps) visit(dep);
      const node = reachableNodes.find((n) => n.id === nodeId);
      if (node) sorted.push(node);
    }
    for (const node of reachableNodes) visit(node.id);

    const nodeResults: Record<string, any> = {};
    for (const node of sorted) {
      nodeResults[node.id] = {
        nodeId: node.id,
        nodeLabel: node.label,
        status: "pending",
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        output: null,
        error: null,
      };
    }

    let globalError = false;

    const venovsDir = process.env.NPYTHON_VENVS_DIR ?? "/tmp/npython-venvs";

    for (const node of sorted) {
      // Check if execution was stopped
      const [currentExec] = await db.select().from(executionsTable).where(eq(executionsTable.id, executionId));
      if (currentExec?.status === "stopped") {
        await addLog(executionId, null, "warn", "Execution stopped by user");
        break;
      }

      if (globalError) break;

      const nodeStart = Date.now();
      nodeResults[node.id].status = "running";
      nodeResults[node.id].startedAt = new Date().toISOString();

      await db
        .update(executionsTable)
        .set({ nodeResults: Object.values(nodeResults) })
        .where(eq(executionsTable.id, executionId));

      await addLog(executionId, node.id, "info", `Starting node "${node.label}" (${node.type})`);

      let success = false;
      let output = "";
      let error: string | null = null;

      try {
        // ── Pinned: return mock output without executing ────────────
        const nodeConfig = node.config as Record<string, unknown>;
        if (nodeConfig.pinned === true) {
          output = String(nodeConfig.mockOutput ?? "(pinned — sem output definido)");
          success = true;
          await addLog(executionId, node.id, "info", `[PINNED] ${output}`);
        } else if (node.type === "code") {
          const config = node.config as Record<string, unknown>;
          const code = (config.code as string) ?? "";

          const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "npython-"));
          const scriptPath = path.join(tmpDir, "script.py");
          await fs.writeFile(scriptPath, code, "utf8");

          const venvPython = path.join(venovsDir, workflowId, "bin", "python3");
          let pythonBin = "python3";
          try {
            await fs.access(venvPython);
            pythonBin = venvPython;
          } catch {}

          const result = await new Promise<{ success: boolean; output: string; error: string | null }>(
            (resolve) => {
              const proc = spawn(pythonBin, [scriptPath], { timeout: 60000 });
              runningProcesses.set(executionId, proc);
              let stdout = "";
              let stderr = "";
              proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
              proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
              proc.on("close", (code) => {
                runningProcesses.delete(executionId);
                if (code === 0) {
                  resolve({ success: true, output: stdout, error: null });
                } else {
                  resolve({ success: false, output: stdout, error: stderr || `Exit code ${code}` });
                }
              });
              proc.on("error", (err) => {
                runningProcesses.delete(executionId);
                resolve({ success: false, output: "", error: err.message });
              });
            }
          );

          await fs.rm(tmpDir, { recursive: true, force: true });

          success = result.success;
          output = result.output;
          error = result.error;

          if (output) await addLog(executionId, node.id, "info", output.trim());
          if (error) await addLog(executionId, node.id, "error", error.trim());
        } else if (node.type === "set_variable") {
          const config = node.config as Record<string, string>;
          output = `Set variable ${config.key ?? "?"} = ${config.value ?? ""}`;
          success = true;
          await addLog(executionId, node.id, "info", output);
        } else if (node.type === "wait") {
          const config = node.config as Record<string, unknown>;
          const ms = Number(config.delayMs ?? 1000);
          await new Promise((r) => setTimeout(r, ms));
          output = `Waited ${ms}ms`;
          success = true;
          await addLog(executionId, node.id, "info", output);
        } else {
          output = `Node type '${node.type}' executed.`;
          success = true;
          await addLog(executionId, node.id, "info", output);
        }
      } catch (e: any) {
        success = false;
        error = e?.message ?? String(e);
        await addLog(executionId, node.id, "error", error!);
      }

      const nodeEnd = Date.now();
      nodeResults[node.id].status = success ? "success" : "failed";
      nodeResults[node.id].finishedAt = new Date().toISOString();
      nodeResults[node.id].durationMs = nodeEnd - nodeStart;
      nodeResults[node.id].output = output || null;
      nodeResults[node.id].error = error;

      await db
        .update(executionsTable)
        .set({ nodeResults: Object.values(nodeResults) })
        .where(eq(executionsTable.id, executionId));

      if (!success && node.stopOnError && !node.continueOnError) {
        globalError = true;
        await addLog(executionId, node.id, "error", `Node failed and stopOnError=true — stopping workflow`);
      }
    }

    const endTime = Date.now();
    const finalStatus = globalError ? "failed" : "success";

    await db
      .update(executionsTable)
      .set({
        status: finalStatus,
        finishedAt: new Date(),
        durationMs: endTime - startTime,
        nodeResults: Object.values(nodeResults),
        errorMessage: globalError ? "One or more nodes failed" : null,
      })
      .where(eq(executionsTable.id, executionId));

    await addLog(executionId, null, finalStatus === "success" ? "info" : "error", `Workflow ${finalStatus}`);
  } catch (err: any) {
    await db
      .update(executionsTable)
      .set({
        status: "failed",
        finishedAt: new Date(),
        durationMs: Date.now() - startTime,
        errorMessage: err?.message ?? String(err),
      })
      .where(eq(executionsTable.id, executionId));
  }
}

export { router as executeWorkflowRouter };
export default router;
