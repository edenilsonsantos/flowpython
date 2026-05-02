import { Router } from "express";
import { db, nodesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateId } from "../lib/id";
import { spawn } from "child_process";
import path from "path";
import os from "os";
import fs from "fs/promises";

const router = Router();

// GET /workflows/:workflowId/nodes
router.get("/workflows/:workflowId/nodes", async (req, res) => {
  try {
    const { workflowId } = req.params;
    const nodes = await db.select().from(nodesTable).where(eq(nodesTable.workflowId, workflowId));
    res.json(
      nodes.map((n) => ({
        id: n.id,
        workflowId: n.workflowId,
        type: n.type,
        label: n.label,
        positionX: n.positionX,
        positionY: n.positionY,
        config: n.config,
        retryCount: n.retryCount,
        retryDelayMs: n.retryDelayMs,
        continueOnError: n.continueOnError,
        stopOnError: n.stopOnError,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /workflows/:workflowId/nodes
router.post("/workflows/:workflowId/nodes", async (req, res) => {
  try {
    const { workflowId } = req.params;
    const { type, label, positionX, positionY, config } = req.body;

    const id = generateId();
    const [node] = await db
      .insert(nodesTable)
      .values({
        id,
        workflowId,
        type: type ?? "code",
        label: label ?? "New Node",
        positionX: Math.round(positionX ?? 0),
        positionY: Math.round(positionY ?? 0),
        config: config ?? {},
      })
      .returning();

    res.status(201).json({
      id: node!.id,
      workflowId: node!.workflowId,
      type: node!.type,
      label: node!.label,
      positionX: node!.positionX,
      positionY: node!.positionY,
      config: node!.config,
      retryCount: node!.retryCount,
      retryDelayMs: node!.retryDelayMs,
      continueOnError: node!.continueOnError,
      stopOnError: node!.stopOnError,
      createdAt: node!.createdAt.toISOString(),
      updatedAt: node!.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /workflows/:workflowId/nodes/:nodeId
router.put("/workflows/:workflowId/nodes/:nodeId", async (req, res) => {
  try {
    const { workflowId, nodeId } = req.params;
    const { label, positionX, positionY, config, retryCount, retryDelayMs, continueOnError, stopOnError } = req.body;

    const updates: Record<string, unknown> = {};
    if (label !== undefined) updates.label = label;
    if (positionX !== undefined) updates.positionX = Math.round(positionX);
    if (positionY !== undefined) updates.positionY = Math.round(positionY);
    if (config !== undefined) updates.config = config;
    if (retryCount !== undefined) updates.retryCount = retryCount;
    if (retryDelayMs !== undefined) updates.retryDelayMs = retryDelayMs;
    if (continueOnError !== undefined) updates.continueOnError = continueOnError;
    if (stopOnError !== undefined) updates.stopOnError = stopOnError;

    const [node] = await db
      .update(nodesTable)
      .set(updates)
      .where(and(eq(nodesTable.id, nodeId), eq(nodesTable.workflowId, workflowId)))
      .returning();

    if (!node) return res.status(404).json({ error: "Node not found" });

    res.json({
      id: node.id,
      workflowId: node.workflowId,
      type: node.type,
      label: node.label,
      positionX: node.positionX,
      positionY: node.positionY,
      config: node.config,
      retryCount: node.retryCount,
      retryDelayMs: node.retryDelayMs,
      continueOnError: node.continueOnError,
      stopOnError: node.stopOnError,
      createdAt: node.createdAt.toISOString(),
      updatedAt: node.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /workflows/:workflowId/nodes/:nodeId
router.delete("/workflows/:workflowId/nodes/:nodeId", async (req, res) => {
  try {
    const { workflowId, nodeId } = req.params;
    await db.delete(nodesTable).where(and(eq(nodesTable.id, nodeId), eq(nodesTable.workflowId, workflowId)));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /workflows/:workflowId/nodes/:nodeId/execute — run a single node in isolation
router.post("/workflows/:workflowId/nodes/:nodeId/execute", async (req, res) => {
  const { workflowId, nodeId } = req.params;
  const inputData = req.body?.inputData ?? {};

  try {
    const [node] = await db
      .select()
      .from(nodesTable)
      .where(and(eq(nodesTable.id, nodeId), eq(nodesTable.workflowId, workflowId)));

    if (!node) return res.status(404).json({ error: "Node not found" });

    const config = node.config as Record<string, unknown>;
    const code = (config.code as string) ?? "";

    if (node.type !== "code") {
      return res.json({
        success: true,
        output: `Node type '${node.type}' executed (no code to run).`,
        returnValue: null,
        durationMs: 0,
        error: null,
      });
    }

    // Write a temp python script
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "npython-"));
    const scriptPath = path.join(tmpDir, "script.py");

    const wrappedCode = `
import json, sys

_input = ${JSON.stringify(inputData)}

${code}
`;
    await fs.writeFile(scriptPath, wrappedCode, "utf8");

    const start = Date.now();

    const venvPython = path.join(
      process.env.NPYTHON_VENVS_DIR ?? "/tmp/npython-venvs",
      workflowId,
      "bin",
      "python3"
    );

    // Use venv python if exists, else fallback to system python3
    let pythonBin = "python3";
    try {
      await fs.access(venvPython);
      pythonBin = venvPython;
    } catch {}

    const result = await new Promise<{ success: boolean; output: string; error: string | null }>(
      (resolve) => {
        const proc = spawn(pythonBin, [scriptPath], { timeout: 30000 });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        proc.on("close", (code) => {
          if (code === 0) {
            resolve({ success: true, output: stdout, error: null });
          } else {
            resolve({ success: false, output: stdout, error: stderr || `Process exited with code ${code}` });
          }
        });
        proc.on("error", (err) => {
          resolve({ success: false, output: "", error: err.message });
        });
      }
    );

    await fs.rm(tmpDir, { recursive: true, force: true });

    const durationMs = Date.now() - start;

    res.json({
      success: result.success,
      output: result.output || result.error || "",
      returnValue: null,
      durationMs,
      error: result.error,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
