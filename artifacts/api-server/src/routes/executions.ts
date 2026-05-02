import { Router } from "express";
import { db, workflowsTable, nodesTable, edgesTable, executionsTable, logLinesTable, variablesTable } from "@workspace/db";
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

    // ── Scoped variable stores ─────────────────────────────────────
    // workflow: persists for entire execution, all nodes can access
    const workflowContext: Record<string, unknown> = {};
    // pipeline: accumulated as nodes execute; downstream nodes see upstream sets
    const pipelineContext: Record<string, unknown> = {};

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
        } else if (node.type === "variable") {
          const config = node.config as Record<string, unknown>;
          const operation = (config.operation as string) ?? "get";
          const key = (config.key as string) ?? "";
          const scope = (config.scope as string) ?? "workflow";
          const setValue = String(config.value ?? "");

          if (!key) {
            success = false;
            error = "Variable key is required";
            await addLog(executionId, node.id, "error", error);
          } else if (scope === "global") {
            if (operation === "set") {
              const existing = await db.select().from(variablesTable).where(eq(variablesTable.key, key)).limit(1);
              if (existing.length > 0) {
                await db.update(variablesTable).set({ value: setValue, updatedAt: new Date() }).where(eq(variablesTable.key, key));
              } else {
                await db.insert(variablesTable).values({ id: generateId(), key, value: setValue, type: "string" });
              }
              output = `[global] Set "${key}" = ${JSON.stringify(setValue)}`;
            } else {
              const [v] = await db.select().from(variablesTable).where(eq(variablesTable.key, key)).limit(1);
              output = v
                ? `[global] "${key}" = ${JSON.stringify(v.value)}`
                : `[global] "${key}" não encontrada`;
            }
            success = true;
            await addLog(executionId, node.id, "info", output);
          } else if (scope === "workflow") {
            if (operation === "set") {
              workflowContext[key] = setValue;
              output = `[workflow] Set "${key}" = ${JSON.stringify(setValue)}`;
            } else {
              const val = workflowContext[key];
              output = `[workflow] Get "${key}" = ${JSON.stringify(val ?? null)}`;
            }
            success = true;
            await addLog(executionId, node.id, "info", output);
          } else {
            // node scope — flows downstream in pipeline
            if (operation === "set") {
              pipelineContext[key] = setValue;
              output = `[node] Set "${key}" = ${JSON.stringify(setValue)} (disponível downstream)`;
            } else {
              const val = pipelineContext[key];
              output = `[node] Get "${key}" = ${JSON.stringify(val ?? null)}`;
            }
            success = true;
            await addLog(executionId, node.id, "info", output);
          }
        } else if (node.type === "variable_inject") {
          const config = node.config as Record<string, unknown>;
          const scope = (config.scope as string) ?? "workflow";
          const keys = (config.keys as string[]) ?? [];

          let ctx: Record<string, unknown> = {};
          if (scope === "global") {
            const vars = await db.select().from(variablesTable);
            ctx = Object.fromEntries(vars.map((v) => [v.key, v.value]));
          } else if (scope === "workflow") {
            ctx = { ...workflowContext };
          } else {
            ctx = { ...pipelineContext };
          }

          const filtered = keys.length > 0 ? Object.fromEntries(keys.map((k) => [k, ctx[k] ?? null])) : ctx;
          output = `[inject:${scope}] Injetado: ${Object.keys(filtered).join(", ") || "(vazio)"}`;
          // Make injected vars available in pipeline
          Object.assign(pipelineContext, filtered);
          success = true;
          await addLog(executionId, node.id, "info", output);
        } else if (node.type === "set_variable") {
          const config = node.config as Record<string, string>;
          output = `Set variable ${config.key ?? "?"} = ${config.value ?? ""}`;
          success = true;
          await addLog(executionId, node.id, "info", output);
        } else if (node.type === "pip_install") {
          const config = node.config as Record<string, unknown>;
          const action = (config.action as string) ?? "install";
          const mode = (config.mode as string) ?? "single";
          const venvDir = path.join(venovsDir, workflowId);
          const venvPip = path.join(venvDir, "bin", "pip");

          // Ensure venv exists when installing
          if (action === "install") {
            try {
              await fs.access(path.join(venvDir, "bin", "pip"));
            } catch {
              await addLog(executionId, node.id, "info", "Criando ambiente virtual Python...");
              await new Promise<void>((resolve, reject) => {
                const proc = spawn("python3", ["-m", "venv", venvDir], { timeout: 60000 });
                proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`venv exit ${code}`))));
                proc.on("error", reject);
              });
            }
          }

          let pipBin = "pip3";
          try { await fs.access(venvPip); pipBin = venvPip; } catch {}

          // Build pip args
          let pipArgs: string[] = [];
          let tmpReqFile: string | null = null;

          if (action === "install") {
            if (mode === "single") {
              const name = ((config.packageName as string) ?? "").trim();
              const ver = ((config.packageVersion as string) ?? "").trim();
              if (!name) { success = false; error = "Nome da biblioteca é obrigatório"; await addLog(executionId, node.id, "error", error); }
              else { pipArgs = ["install", ver ? `${name}==${ver}` : name]; }
            } else if (mode === "multiple") {
              const pkgs = (config.packages as Array<{ name: string; version: string }>) ?? [];
              const specs = pkgs.map((p) => (p.version ? `${p.name}==${p.version}` : p.name)).filter(Boolean);
              if (!specs.length) { success = false; error = "Nenhuma biblioteca especificada"; await addLog(executionId, node.id, "error", error); }
              else { pipArgs = ["install", ...specs]; }
            } else if (mode === "requirements") {
              const txt = ((config.requirementsTxt as string) ?? "").trim();
              if (!txt) { success = false; error = "Conteúdo do requirements.txt está vazio"; await addLog(executionId, node.id, "error", error); }
              else {
                tmpReqFile = path.join(os.tmpdir(), `req_${executionId}_${node.id}.txt`);
                await fs.writeFile(tmpReqFile, txt, "utf8");
                pipArgs = ["install", "-r", tmpReqFile];
              }
            }
          } else {
            // uninstall — requirements mode not supported for uninstall
            if (mode === "single") {
              const name = ((config.packageName as string) ?? "").trim();
              if (!name) { success = false; error = "Nome da biblioteca é obrigatório"; await addLog(executionId, node.id, "error", error); }
              else { pipArgs = ["uninstall", "-y", name]; }
            } else if (mode === "multiple") {
              const pkgs = (config.packages as Array<{ name: string; version: string }>) ?? [];
              const names = pkgs.map((p) => p.name).filter(Boolean);
              if (!names.length) { success = false; error = "Nenhuma biblioteca especificada"; await addLog(executionId, node.id, "error", error); }
              else { pipArgs = ["uninstall", "-y", ...names]; }
            }
          }

          if (pipArgs.length > 0) {
            await addLog(executionId, node.id, "info", `Executando: pip ${pipArgs.join(" ")}`);
            const result = await new Promise<{ success: boolean; output: string; error: string | null }>((resolve) => {
              const proc = spawn(pipBin, pipArgs, { timeout: 120000 });
              let stdout = ""; let stderr = "";
              proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
              proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
              proc.on("close", (code) => {
                const combinedOut = (stdout + "\n" + stderr).trim();
                resolve(code === 0
                  ? { success: true, output: combinedOut, error: null }
                  : { success: false, output: stdout.trim(), error: stderr.trim() || `pip exit ${code}` });
              });
              proc.on("error", (err) => resolve({ success: false, output: "", error: err.message }));
            });
            success = result.success;
            output = result.output;
            error = result.error;
            if (output) await addLog(executionId, node.id, "info", output);
            if (error) await addLog(executionId, node.id, "error", error);
            if (tmpReqFile) { try { await fs.unlink(tmpReqFile); } catch {} }
          }
        } else if (node.type === "switch") {
          // ── Switch: multi-branch routing via Python expressions ──
          const config = node.config as Record<string, unknown>;
          const inputVar = (config.inputVar as string) ?? "";
          const conditions = (config.conditions as Array<{ expression: string; label: string }>) ?? [];
          const fallback = (config.fallback as string) ?? "default";
          const rawValue = inputVar ? (pipelineContext[inputVar] ?? workflowContext[inputVar] ?? null) : null;
          const valueJson = JSON.stringify(rawValue);
          const condJson = JSON.stringify(conditions);

          const script = `import json, sys\nvalue = json.loads(sys.argv[1])\nconditions = json.loads(sys.argv[2])\nfor c in conditions:\n    try:\n        ctx = {'value': value}\n        if isinstance(value, dict): ctx.update(value)\n        if eval(c['expression'], ctx):\n            print(c['label']); sys.exit(0)\n    except: pass\nprint('${fallback}')`;
          const tmpScript = path.join(os.tmpdir(), `switch_${executionId}.py`);
          await fs.writeFile(tmpScript, script, "utf8");
          const switchResult = await new Promise<string>((resolve) => {
            const proc = spawn("python3", [tmpScript, valueJson, condJson], { timeout: 10000 });
            let out = ""; proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
            proc.on("close", () => resolve(out.trim() || fallback));
            proc.on("error", () => resolve(fallback));
          });
          await fs.unlink(tmpScript).catch(() => {});
          pipelineContext["_switch_result"] = switchResult;
          output = `Branch: "${switchResult}" (input: ${valueJson})`;
          success = true;
          await addLog(executionId, node.id, "info", output);

        } else if (node.type === "merge_lists") {
          // ── Merge: combine multiple pipeline lists ───────────────
          const config = node.config as Record<string, unknown>;
          const vars = (config.vars as string[]) ?? [];
          const outputVar = (config.outputVar as string) ?? "merged";
          const mode = (config.mode as string) ?? "append";
          const lists = vars.map(v => {
            const val = pipelineContext[v] ?? workflowContext[v];
            return Array.isArray(val) ? val : (val !== undefined ? [val] : []);
          });
          let merged: unknown;
          if (mode === "append") {
            merged = lists.flat();
          } else if (mode === "zip") {
            const maxLen = Math.max(0, ...lists.map(l => l.length));
            merged = Array.from({ length: maxLen }, (_, i) =>
              Object.assign({}, ...lists.map(l => (typeof l[i] === "object" && l[i] !== null ? l[i] : { value: l[i] })))
            );
          } else {
            merged = Object.assign({}, ...lists.map(l => typeof l[0] === "object" ? l[0] : {}));
          }
          pipelineContext[outputVar] = merged;
          output = `[merge:${mode}] ${vars.join(" + ")} → "${outputVar}" (${Array.isArray(merged) ? merged.length + " itens" : "objeto"})`;
          success = true;
          await addLog(executionId, node.id, "info", output);

        } else if (node.type === "filter_list") {
          // ── Filter: filter items by Python expression ────────────
          const config = node.config as Record<string, unknown>;
          const inputVar = (config.inputVar as string) ?? "items";
          const outputVar = (config.outputVar as string) ?? "filtered";
          const expression = (config.expression as string) ?? "True";
          const items = pipelineContext[inputVar] ?? workflowContext[inputVar];
          if (!Array.isArray(items)) throw new Error(`"${inputVar}" não é uma lista (${typeof items})`);
          const itemsJson = JSON.stringify(items);
          const script = `import json,sys\nitems=json.loads(sys.argv[1])\nresult=[item for item in items if (${expression})]\nprint(json.dumps(result))`;
          const tmpScript = path.join(os.tmpdir(), `filter_${executionId}.py`);
          await fs.writeFile(tmpScript, script, "utf8");
          const filterResult = await new Promise<{ success: boolean; data: unknown; error: string | null }>((resolve) => {
            const proc = spawn("python3", [tmpScript, itemsJson], { timeout: 30000 });
            let out = ""; let err = "";
            proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
            proc.stderr.on("data", (d: Buffer) => { err += d.toString(); });
            proc.on("close", (code) => {
              try { resolve({ success: code === 0, data: JSON.parse(out), error: err || null }); }
              catch { resolve({ success: false, data: [], error: err || "Parse error" }); }
            });
            proc.on("error", (e) => resolve({ success: false, data: [], error: e.message }));
          });
          await fs.unlink(tmpScript).catch(() => {});
          if (filterResult.success) {
            pipelineContext[outputVar] = filterResult.data;
            const filtered = filterResult.data as unknown[];
            output = `[filter] ${items.length} → ${filtered.length} itens → "${outputVar}"`;
            success = true;
            await addLog(executionId, node.id, "info", output);
          } else {
            success = false; error = filterResult.error;
            await addLog(executionId, node.id, "error", error!);
          }

        } else if (node.type === "batch_split") {
          // ── Split in Batches ─────────────────────────────────────
          const config = node.config as Record<string, unknown>;
          const inputVar = (config.inputVar as string) ?? "items";
          const outputVar = (config.outputVar as string) ?? "batches";
          const batchSize = Math.max(1, Number(config.batchSize ?? 10));
          const items = pipelineContext[inputVar] ?? workflowContext[inputVar];
          if (!Array.isArray(items)) throw new Error(`"${inputVar}" não é uma lista`);
          const batches: unknown[][] = [];
          for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize));
          pipelineContext[outputVar] = batches;
          output = `[batch] ${items.length} itens → ${batches.length} lotes de ≤${batchSize} → "${outputVar}"`;
          success = true;
          await addLog(executionId, node.id, "info", output);

        } else if (node.type === "aggregate") {
          // ── Aggregate: reduce list to single value ───────────────
          const config = node.config as Record<string, unknown>;
          const inputVar = (config.inputVar as string) ?? "items";
          const outputVar = (config.outputVar as string) ?? "result";
          const operation = (config.operation as string) ?? "count";
          const field = (config.field as string) ?? "";
          const separator = (config.separator as string) ?? ", ";
          const items = pipelineContext[inputVar] ?? workflowContext[inputVar];
          if (!Array.isArray(items)) throw new Error(`"${inputVar}" não é uma lista`);
          const getField = (item: unknown) => field ? (item as Record<string, unknown>)?.[field] : item;
          let result: unknown;
          if (operation === "count") result = items.length;
          else if (operation === "sum") result = items.reduce((acc, i) => acc + Number(getField(i) ?? 0), 0);
          else if (operation === "avg") result = items.length ? items.reduce((acc, i) => acc + Number(getField(i) ?? 0), 0) / items.length : 0;
          else if (operation === "min") result = items.reduce((acc, i) => Math.min(acc, Number(getField(i) ?? Infinity)), Infinity);
          else if (operation === "max") result = items.reduce((acc, i) => Math.max(acc, Number(getField(i) ?? -Infinity)), -Infinity);
          else if (operation === "first") result = items[0] ?? null;
          else if (operation === "last") result = items[items.length - 1] ?? null;
          else if (operation === "join") result = items.map(i => String(getField(i) ?? "")).join(separator);
          else if (operation === "list") result = items.map(i => getField(i));
          else result = items.length;
          pipelineContext[outputVar] = result;
          output = `[aggregate:${operation}${field ? `:${field}` : ""}] ${items.length} itens → ${JSON.stringify(result).slice(0, 60)} → "${outputVar}"`;
          success = true;
          await addLog(executionId, node.id, "info", output);

        } else if (node.type === "split_out") {
          // ── Split Out: explode list field into individual items ───
          const config = node.config as Record<string, unknown>;
          const inputVar = (config.inputVar as string) ?? "data";
          const field = (config.field as string) ?? "items";
          const outputVar = (config.outputVar as string) ?? "split";
          const keepParent = config.keepParent === true;
          const items = pipelineContext[inputVar] ?? workflowContext[inputVar];
          const arr = Array.isArray(items) ? items : [items];
          const split = arr.flatMap((item: unknown) => {
            const fieldVal = (item as Record<string, unknown>)?.[field];
            const nested = Array.isArray(fieldVal) ? fieldVal : [fieldVal];
            return keepParent ? nested.map(n => ({ ...(item as object), [field]: n })) : nested;
          });
          pipelineContext[outputVar] = split;
          output = `[split_out] ${arr.length} itens × campo "${field}" → ${split.length} itens → "${outputVar}"`;
          success = true;
          await addLog(executionId, node.id, "info", output);

        } else if (node.type === "sort_list") {
          // ── Sort ─────────────────────────────────────────────────
          const config = node.config as Record<string, unknown>;
          const inputVar = (config.inputVar as string) ?? "items";
          const outputVar = (config.outputVar as string) ?? "sorted";
          const key = (config.key as string) ?? "";
          const order = (config.order as string) ?? "asc";
          const items = pipelineContext[inputVar] ?? workflowContext[inputVar];
          if (!Array.isArray(items)) throw new Error(`"${inputVar}" não é uma lista`);
          const sorted = [...items].sort((a, b) => {
            const av = key ? (a as Record<string, unknown>)?.[key] : a;
            const bv = key ? (b as Record<string, unknown>)?.[key] : b;
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return order === "desc" ? -cmp : cmp;
          });
          pipelineContext[outputVar] = sorted;
          output = `[sort:${order}${key ? `:${key}` : ""}] ${items.length} itens → "${outputVar}"`;
          success = true;
          await addLog(executionId, node.id, "info", output);

        } else if (node.type === "remove_duplicates") {
          // ── Remove Duplicates ────────────────────────────────────
          const config = node.config as Record<string, unknown>;
          const inputVar = (config.inputVar as string) ?? "items";
          const outputVar = (config.outputVar as string) ?? "unique";
          const key = (config.key as string) ?? "";
          const items = pipelineContext[inputVar] ?? workflowContext[inputVar];
          if (!Array.isArray(items)) throw new Error(`"${inputVar}" não é uma lista`);
          const seen = new Set<string>();
          const unique = items.filter((item) => {
            const k = key ? String((item as Record<string, unknown>)?.[key]) : JSON.stringify(item);
            if (seen.has(k)) return false;
            seen.add(k); return true;
          });
          pipelineContext[outputVar] = unique;
          output = `[dedup:${key || "full"}] ${items.length} → ${unique.length} únicos → "${outputVar}"`;
          success = true;
          await addLog(executionId, node.id, "info", output);

        } else if (node.type === "limit") {
          // ── Limit ────────────────────────────────────────────────
          const config = node.config as Record<string, unknown>;
          const inputVar = (config.inputVar as string) ?? "items";
          const outputVar = (config.outputVar as string) ?? "limited";
          const maxItems = Math.max(1, Number(config.maxItems ?? 10));
          const keep = (config.keep as string) ?? "first";
          const items = pipelineContext[inputVar] ?? workflowContext[inputVar];
          if (!Array.isArray(items)) throw new Error(`"${inputVar}" não é uma lista`);
          let limited: unknown[];
          if (keep === "last") limited = items.slice(-maxItems);
          else if (keep === "random") {
            const shuffled = [...items].sort(() => Math.random() - 0.5);
            limited = shuffled.slice(0, maxItems);
          } else limited = items.slice(0, maxItems);
          pipelineContext[outputVar] = limited;
          output = `[limit:${keep}] ${items.length} → ${limited.length} itens → "${outputVar}"`;
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
