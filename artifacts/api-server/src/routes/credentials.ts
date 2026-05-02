import { Router } from "express";
import { db, credentialsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateId } from "../lib/id";

const router = Router();

// GET /credentials
router.get("/credentials", async (req, res) => {
  try {
    const creds = await db.select().from(credentialsTable).orderBy(credentialsTable.name);
    res.json(
      creds.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        description: c.description ?? null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /credentials
router.post("/credentials", async (req, res) => {
  try {
    const { name, type, description, data } = req.body;
    if (!name || !type) return res.status(400).json({ error: "name and type are required" });

    const id = generateId();
    const [cred] = await db
      .insert(credentialsTable)
      .values({ id, name, type, description, data: data ?? {} })
      .returning();

    res.status(201).json({
      id: cred!.id,
      name: cred!.name,
      type: cred!.type,
      description: cred!.description ?? null,
      createdAt: cred!.createdAt.toISOString(),
      updatedAt: cred!.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /credentials/:id
router.put("/credentials/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, data } = req.body;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (data !== undefined) updates.data = data;

    const [cred] = await db
      .update(credentialsTable)
      .set(updates)
      .where(eq(credentialsTable.id, id))
      .returning();

    if (!cred) return res.status(404).json({ error: "Credential not found" });

    res.json({
      id: cred.id,
      name: cred.name,
      type: cred.type,
      description: cred.description ?? null,
      createdAt: cred.createdAt.toISOString(),
      updatedAt: cred.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /credentials/:id
router.delete("/credentials/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(credentialsTable).where(eq(credentialsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
