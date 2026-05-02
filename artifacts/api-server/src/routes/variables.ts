import { Router } from "express";
import { db, variablesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateId } from "../lib/id";

const router = Router();

// GET /variables
router.get("/variables", async (req, res) => {
  try {
    const vars = await db.select().from(variablesTable).orderBy(variablesTable.key);
    res.json(
      vars.map((v) => ({
        id: v.id,
        key: v.key,
        value: v.value,
        type: v.type,
        description: v.description ?? null,
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /variables
router.post("/variables", async (req, res) => {
  try {
    const { key, value, type, description } = req.body;
    if (!key || value === undefined || !type) {
      return res.status(400).json({ error: "key, value, and type are required" });
    }

    const id = generateId();
    const [variable] = await db
      .insert(variablesTable)
      .values({ id, key, value: String(value), type, description })
      .returning();

    res.status(201).json({
      id: variable!.id,
      key: variable!.key,
      value: variable!.value,
      type: variable!.type,
      description: variable!.description ?? null,
      createdAt: variable!.createdAt.toISOString(),
      updatedAt: variable!.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /variables/:id
router.put("/variables/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { key, value, type, description } = req.body;

    const updates: Record<string, unknown> = {};
    if (key !== undefined) updates.key = key;
    if (value !== undefined) updates.value = String(value);
    if (type !== undefined) updates.type = type;
    if (description !== undefined) updates.description = description;

    const [variable] = await db
      .update(variablesTable)
      .set(updates)
      .where(eq(variablesTable.id, id))
      .returning();

    if (!variable) return res.status(404).json({ error: "Variable not found" });

    res.json({
      id: variable.id,
      key: variable.key,
      value: variable.value,
      type: variable.type,
      description: variable.description ?? null,
      createdAt: variable.createdAt.toISOString(),
      updatedAt: variable.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /variables/:id
router.delete("/variables/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(variablesTable).where(eq(variablesTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
