import { Router } from "express";
import { db, workflowsTable, nodesTable, edgesTable, executionsTable } from "@workspace/db";
import { eq, desc, count, sql } from "drizzle-orm";
import { generateId } from "../lib/id";

const router = Router();

// GET /workflows
router.get("/workflows", async (req, res) => {
  try {
    const workflows = await db.select().from(workflowsTable).orderBy(desc(workflowsTable.updatedAt));

    const nodeCountsRaw = await db
      .select({ workflowId: nodesTable.workflowId, cnt: count() })
      .from(nodesTable)
      .groupBy(nodesTable.workflowId);
    const nodeCounts = Object.fromEntries(nodeCountsRaw.map((r) => [r.workflowId, Number(r.cnt)]));

    const lastExecs = await db
      .selectDistinctOn([executionsTable.workflowId], {
        workflowId: executionsTable.workflowId,
        status: executionsTable.status,
        startedAt: executionsTable.startedAt,
      })
      .from(executionsTable)
      .orderBy(executionsTable.workflowId, desc(executionsTable.startedAt));
    const lastExecMap = Object.fromEntries(lastExecs.map((e) => [e.workflowId, e]));

    const result = workflows.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description ?? undefined,
      active: w.active,
      tags: w.tags,
      nodeCount: nodeCounts[w.id] ?? 0,
      lastExecutedAt: lastExecMap[w.id]?.startedAt?.toISOString() ?? null,
      lastStatus: lastExecMap[w.id]?.status ?? null,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
    }));

    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /workflows
router.post("/workflows", async (req, res) => {
  try {
    const { name, description, tags } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const id = generateId();
    const [workflow] = await db
      .insert(workflowsTable)
      .values({ id, name, description, tags: tags ?? [] })
      .returning();

    res.status(201).json({
      id: workflow!.id,
      name: workflow!.name,
      description: workflow!.description ?? undefined,
      active: workflow!.active,
      tags: workflow!.tags,
      nodeCount: 0,
      lastExecutedAt: null,
      lastStatus: null,
      createdAt: workflow!.createdAt.toISOString(),
      updatedAt: workflow!.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /workflows/:id
router.get("/workflows/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [workflow] = await db.select().from(workflowsTable).where(eq(workflowsTable.id, id));
    if (!workflow) return res.status(404).json({ error: "Workflow not found" });

    const nodes = await db.select().from(nodesTable).where(eq(nodesTable.workflowId, id));
    const edges = await db.select().from(edgesTable).where(eq(edgesTable.workflowId, id));

    const lastExecArr = await db
      .selectDistinctOn([executionsTable.workflowId], {
        workflowId: executionsTable.workflowId,
        status: executionsTable.status,
        startedAt: executionsTable.startedAt,
      })
      .from(executionsTable)
      .where(eq(executionsTable.workflowId, id))
      .orderBy(executionsTable.workflowId, desc(executionsTable.startedAt))
      .limit(1);
    const lastExec = lastExecArr[0];

    res.json({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description ?? undefined,
      active: workflow.active,
      tags: workflow.tags,
      nodeCount: nodes.length,
      lastExecutedAt: lastExec?.startedAt?.toISOString() ?? null,
      lastStatus: lastExec?.status ?? null,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
      nodes: nodes.map((n) => ({
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
      })),
      edges: edges.map((e) => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        label: e.label ?? undefined,
        condition: e.condition ?? undefined,
      })),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /workflows/:id
router.put("/workflows/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, active, tags, nodes, edges } = req.body;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (active !== undefined) updates.active = active;
    if (tags !== undefined) updates.tags = tags;

    const [updated] = await db
      .update(workflowsTable)
      .set(updates)
      .where(eq(workflowsTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Workflow not found" });

    // Sync nodes and edges if provided
    if (nodes !== undefined) {
      await db.delete(nodesTable).where(eq(nodesTable.workflowId, id));
      if (nodes.length > 0) {
        await db.insert(nodesTable).values(
          nodes.map((n: any) => ({
            id: n.id || generateId(),
            workflowId: id,
            type: n.type,
            label: n.label,
            positionX: Math.round(n.positionX ?? 0),
            positionY: Math.round(n.positionY ?? 0),
            config: n.config ?? {},
            retryCount: n.retryCount ?? 0,
            retryDelayMs: n.retryDelayMs ?? 1000,
            continueOnError: n.continueOnError ?? false,
            stopOnError: n.stopOnError ?? true,
          }))
        );
      }
    }

    if (edges !== undefined) {
      await db.delete(edgesTable).where(eq(edgesTable.workflowId, id));
      if (edges.length > 0) {
        await db.insert(edgesTable).values(
          edges.map((e: any) => ({
            id: e.id || generateId(),
            workflowId: id,
            sourceNodeId: e.sourceNodeId,
            targetNodeId: e.targetNodeId,
            label: e.label ?? null,
            condition: e.condition ?? null,
          }))
        );
      }
    }

    const nodeCount = await db
      .select({ cnt: count() })
      .from(nodesTable)
      .where(eq(nodesTable.workflowId, id));

    res.json({
      id: updated.id,
      name: updated.name,
      description: updated.description ?? undefined,
      active: updated.active,
      tags: updated.tags,
      nodeCount: Number(nodeCount[0]?.cnt ?? 0),
      lastExecutedAt: null,
      lastStatus: null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /workflows/:id
router.delete("/workflows/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(workflowsTable).where(eq(workflowsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /workflows/:id/stats
router.get("/workflows/:id/stats", async (req, res) => {
  try {
    const { id } = req.params;
    const execs = await db
      .select()
      .from(executionsTable)
      .where(eq(executionsTable.workflowId, id))
      .orderBy(desc(executionsTable.startedAt));

    const totalExecutions = execs.length;
    const successCount = execs.filter((e) => e.status === "success").length;
    const failedCount = execs.filter((e) => e.status === "failed").length;
    const durationsMs = execs.filter((e) => e.durationMs != null).map((e) => e.durationMs!);
    const avgDurationMs =
      durationsMs.length > 0 ? durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length : null;

    // Build last 7 days
    const days: { date: string; count: number; successCount: number; failedCount: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayExecs = execs.filter((e) => e.startedAt.toISOString().slice(0, 10) === dateStr);
      days.push({
        date: dateStr,
        count: dayExecs.length,
        successCount: dayExecs.filter((e) => e.status === "success").length,
        failedCount: dayExecs.filter((e) => e.status === "failed").length,
      });
    }

    res.json({ totalExecutions, successCount, failedCount, avgDurationMs, lastSevenDays: days });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
