import { Router } from "express";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";

const router = Router();
const VENVS_DIR = process.env.NPYTHON_VENVS_DIR ?? "/tmp/npython-venvs";

function runCmd(bin: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { timeout: 30000, env: env ?? process.env });
    let stdout = "", stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    proc.on("error", (e) => resolve({ stdout: "", stderr: e.message, code: 1 }));
  });
}

async function fetchLatestPipVersion(): Promise<string | null> {
  try {
    const res = await fetch("https://pypi.org/pypi/pip/json", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json() as { info?: { version?: string } };
    return data?.info?.version ?? null;
  } catch {
    return null;
  }
}

/** Try several pip binary names, return the first that works */
async function detectPipBin(): Promise<string> {
  for (const bin of ["pip", "pip3", "python3 -m pip"]) {
    const args = bin.includes(" ") ? [...bin.split(" ").slice(1), "--version"] : ["--version"];
    const exe  = bin.split(" ")[0]!;
    const r = await runCmd(exe, args);
    if (r.code === 0 && r.stdout.trim()) return bin;
  }
  return "pip";
}

function parsePythonVersion(raw: string): string | null {
  const m = raw.match(/Python\s+([\d.]+)/i);
  return m ? m[1]! : null;
}

function parsePipVersion(raw: string): string | null {
  const m = raw.match(/([\d.]+)/);
  return m ? m[1]! : null;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// GET /api/settings/python-env
router.get("/settings/python-env", async (req, res) => {
  try {
    // Count existing venvs and grab a pip from one of them for a reliable version
    let venvCount = 0;
    let venvPipBin: string | null = null;
    try {
      const entries = await fs.readdir(VENVS_DIR);
      for (const e of entries) {
        const p = path.join(VENVS_DIR, e, "bin", "pip");
        try { await fs.access(p); venvCount++; if (!venvPipBin) venvPipBin = p; } catch {}
      }
    } catch {}

    const [pyResult, latestPip] = await Promise.all([
      runCmd("python3", ["--version"]),
      fetchLatestPipVersion(),
    ]);

    // Get pip version: prefer a venv pip (most reliable), else try system pip / pip3
    let pipVersion: string | null = null;
    if (venvPipBin) {
      const r = await runCmd(venvPipBin, ["--version"]);
      pipVersion = parsePipVersion(r.stdout + r.stderr);
    }
    if (!pipVersion) {
      // Try system pip, pip3, python3 -m pip in order
      for (const [bin, args] of [
        ["pip",    ["--version"]],
        ["pip3",   ["--version"]],
        ["python3", ["-m", "pip", "--version"]],
      ] as [string, string[]][]) {
        const r = await runCmd(bin, args);
        const v = parsePipVersion(r.stdout + r.stderr);
        if (v) { pipVersion = v; break; }
      }
    }

    const pythonVersion = parsePythonVersion(pyResult.stdout + pyResult.stderr) ?? "desconhecida";
    const resolvedPipVersion = pipVersion ?? "desconhecida";
    const pipUpgradeAvailable = latestPip != null && pipVersion != null
      ? compareVersions(latestPip, pipVersion) > 0
      : false;

    res.json({
      python: { version: pythonVersion, systemManaged: true },
      pip: { version: resolvedPipVersion, latestVersion: latestPip, upgradeAvailable: pipUpgradeAvailable },
      venvCount,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/settings/pip-upgrade
// Upgrades pip in ALL existing workflow venvs
router.post("/settings/pip-upgrade", async (req, res) => {
  try {
    let entries: string[] = [];
    try { entries = await fs.readdir(VENVS_DIR); } catch {}

    const venvs: string[] = [];
    for (const e of entries) {
      const pipPath = path.join(VENVS_DIR, e, "bin", "pip");
      try { await fs.access(pipPath); venvs.push(e); } catch {}
    }

    const results: Array<{ workflowId: string; success: boolean; version?: string; error?: string }> = [];

    await Promise.all(venvs.map(async (id) => {
      const pipBin = path.join(VENVS_DIR, id, "bin", "pip");
      const r = await runCmd(pipBin, ["install", "--upgrade", "pip"], { ...process.env, PIP_USER: "0" });
      if (r.code === 0) {
        const showR = await runCmd(pipBin, ["--version"]);
        const v = parsePipVersion(showR.stdout) ?? undefined;
        results.push({ workflowId: id, success: true, version: v });
      } else {
        results.push({ workflowId: id, success: false, error: r.stderr.trim() || `exit ${r.code}` });
      }
    }));

    const upgraded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    res.json({ upgraded, failed, results });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
