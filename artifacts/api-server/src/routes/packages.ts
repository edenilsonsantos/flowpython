import { Router } from "express";
import { db, packagesTable, workflowsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateId } from "../lib/id";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";

const router = Router();

const VENVS_DIR = process.env.NPYTHON_VENVS_DIR ?? "/tmp/npython-venvs";

async function ensureVenv(workflowId: string): Promise<string> {
  const venvPath = path.join(VENVS_DIR, workflowId);
  try {
    await fs.access(path.join(venvPath, "bin", "python3"));
  } catch {
    await fs.mkdir(venvPath, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("python3", ["-m", "venv", venvPath]);
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`venv creation failed: ${code}`))));
      proc.on("error", reject);
    });
  }
  return venvPath;
}

// GET /workflows/:id/packages
router.get("/workflows/:id/packages", async (req, res) => {
  try {
    const { id: workflowId } = req.params;
    const pkgs = await db
      .select()
      .from(packagesTable)
      .where(eq(packagesTable.workflowId, workflowId));

    res.json(
      pkgs.map((p) => ({
        id: p.id,
        workflowId: p.workflowId,
        name: p.name,
        version: p.version ?? null,
        installedAt: p.installedAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /workflows/:id/packages
router.post("/workflows/:id/packages", async (req, res) => {
  const { id: workflowId } = req.params;
  const { name, version } = req.body;

  if (!name) return res.status(400).json({ error: "name is required" });

  try {
    const [workflow] = await db
      .select()
      .from(workflowsTable)
      .where(eq(workflowsTable.id, workflowId));
    if (!workflow) return res.status(404).json({ error: "Workflow not found" });

    const venvPath = await ensureVenv(workflowId);
    const pipBin = path.join(venvPath, "bin", "pip");
    const packageSpec = version ? `${name}==${version}` : name;

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(pipBin, ["install", packageSpec, "--quiet"], { env: { ...process.env, PIP_USER: "0" } });
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`pip install failed: ${code}`))));
      proc.on("error", reject);
    });

    // Get installed version
    let installedVersion: string | null = null;
    try {
      const result = await new Promise<string>((resolve) => {
        const proc = spawn(pipBin, ["show", name]);
        let out = "";
        proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
        proc.on("close", () => resolve(out));
      });
      const versionMatch = result.match(/^Version:\s*(.+)$/m);
      if (versionMatch) installedVersion = versionMatch[1]!.trim();
    } catch {}

    // Upsert in DB
    await db
      .delete(packagesTable)
      .where(and(eq(packagesTable.workflowId, workflowId), eq(packagesTable.name, name)));

    const id = generateId();
    const [pkg] = await db
      .insert(packagesTable)
      .values({ id, workflowId, name, version: installedVersion })
      .returning();

    res.json({
      id: pkg!.id,
      workflowId: pkg!.workflowId,
      name: pkg!.name,
      version: pkg!.version ?? null,
      installedAt: pkg!.installedAt.toISOString(),
    });
  } catch (err: any) {
    req.log.error(err);
    res.status(500).json({ error: err?.message ?? "Failed to install package" });
  }
});

// DELETE /workflows/:id/packages/:packageName
router.delete("/workflows/:id/packages/:packageName", async (req, res) => {
  const { id: workflowId, packageName } = req.params;

  try {
    const venvPath = path.join(VENVS_DIR, workflowId);
    const pipBin = path.join(venvPath, "bin", "pip");

    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(pipBin, ["uninstall", packageName, "-y", "--quiet"], { env: { ...process.env, PIP_USER: "0" } });
        proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`pip uninstall failed`))));
        proc.on("error", reject);
      });
    } catch {
      // If pip fails, still remove from DB
    }

    await db
      .delete(packagesTable)
      .where(and(eq(packagesTable.workflowId, workflowId), eq(packagesTable.name, packageName)));

    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
