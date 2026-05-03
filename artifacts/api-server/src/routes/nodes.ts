import { Router } from "express";
import { db, nodesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateId } from "../lib/id";
import { spawn } from "child_process";
import path from "path";
import os from "os";
import fs from "fs/promises";

const router = Router();

// ─── HTTP Request Script Builder ─────────────────────────────────────────────

function buildHttpRequestScript(
  config: Record<string, unknown>,
  pipelineContext: Record<string, unknown> = {}
): string {
  const method = (config.method as string) ?? "GET";
  const url = (config.url as string) ?? "";
  const rawParams = (config.params as Array<{ key: string; value: string; enabled: boolean }>) ?? [];
  const rawHeaders = (config.headers as Array<{ key: string; value: string; enabled: boolean }>) ?? [];
  const bodyType = (config.bodyType as string) ?? "none";
  const bodyJson = (config.bodyJson as string) ?? "";
  const rawBodyForm = (config.bodyForm as Array<{ key: string; value: string; enabled: boolean }>) ?? [];
  const bodyRaw = (config.bodyRaw as string) ?? "";
  const bodyRawContentType = (config.bodyRawContentType as string) ?? "text/plain";
  const authType = (config.authType as string) ?? "none";
  const authBearer = (config.authBearer as string) ?? "";
  const authUsername = (config.authUsername as string) ?? "";
  const authPassword = (config.authPassword as string) ?? "";
  const authApiKeyName = (config.authApiKeyName as string) ?? "";
  const authApiKeyValue = (config.authApiKeyValue as string) ?? "";
  const authApiKeyIn = (config.authApiKeyIn as string) ?? "header";
  const sslVerify = (config.sslVerify as boolean) !== false;
  const certPath = (config.certPath as string) ?? "";
  const timeout = Math.max(1, Number(config.timeout ?? 30));
  const followRedirects = (config.followRedirects as boolean) !== false;

  const paramsObj = Object.fromEntries(rawParams.filter((p) => p.enabled && p.key).map((p) => [p.key, p.value]));
  const headersObj = Object.fromEntries(rawHeaders.filter((h) => h.enabled && h.key).map((h) => [h.key, h.value]));
  const bodyFormObj = Object.fromEntries(rawBodyForm.filter((f) => f.enabled && f.key).map((f) => [f.key, f.value]));

  const sslExpr = certPath
    ? JSON.stringify(certPath)
    : sslVerify
    ? "True"
    : "False";

  return `import requests, json, sys

method = ${JSON.stringify(method)}
url = ${JSON.stringify(url)}
params = ${JSON.stringify(paramsObj)}
headers = ${JSON.stringify(headersObj)}
ssl_verify = ${sslExpr}
timeout = ${timeout}
follow_redirects = ${followRedirects ? "True" : "False"}
_pipeline = ${JSON.stringify(pipelineContext)}

# Auth setup
auth_type = ${JSON.stringify(authType)}
if auth_type == "bearer":
    headers["Authorization"] = "Bearer " + ${JSON.stringify(authBearer)}
elif auth_type == "apikey":
    if ${JSON.stringify(authApiKeyIn)} == "header":
        headers[${JSON.stringify(authApiKeyName)}] = ${JSON.stringify(authApiKeyValue)}
    else:
        params[${JSON.stringify(authApiKeyName)}] = ${JSON.stringify(authApiKeyValue)}

auth = None
if auth_type == "basic":
    auth = (${JSON.stringify(authUsername)}, ${JSON.stringify(authPassword)})

# Build kwargs
kwargs = dict(
    method=method,
    url=url,
    headers=headers,
    params=params,
    verify=ssl_verify,
    timeout=timeout,
    allow_redirects=follow_redirects,
)

body_type = ${JSON.stringify(bodyType)}
if body_type == "json":
    body_raw = ${JSON.stringify(bodyJson)}
    if body_raw.strip():
        try:
            kwargs["json"] = json.loads(body_raw)
        except Exception as e:
            print(f"[WARN] Body JSON inválido: {e}", file=sys.stderr)
            kwargs["data"] = body_raw
            headers.setdefault("Content-Type", "application/json")
elif body_type == "form":
    kwargs["data"] = ${JSON.stringify(bodyFormObj)}
elif body_type == "raw":
    kwargs["data"] = ${JSON.stringify(bodyRaw)}
    headers.setdefault("Content-Type", ${JSON.stringify(bodyRawContentType)})

if auth:
    kwargs["auth"] = auth

try:
    response = requests.request(**kwargs)
    elapsed_ms = int(response.elapsed.total_seconds() * 1000)
    print(f"HTTP {response.status_code} {response.reason}")
    print(f"URL: {response.url}")
    print(f"Tempo: {elapsed_ms}ms")
    print(f"Content-Type: {response.headers.get('content-type', 'desconhecido')}")
    print()
    try:
        data = response.json()
        print(json.dumps(data, ensure_ascii=False, indent=2))
    except Exception:
        text = response.text
        if len(text) > 5000:
            text = text[:5000] + "\\n...(truncado)"
        print(text)
except requests.exceptions.SSLError as e:
    print(f"Erro SSL: {e}", file=sys.stderr)
    sys.exit(1)
except requests.exceptions.ConnectionError as e:
    print(f"Erro de conexão: {e}", file=sys.stderr)
    sys.exit(1)
except requests.exceptions.Timeout:
    print(f"Timeout após {timeout}s", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"Erro: {e}", file=sys.stderr)
    sys.exit(1)
`;
}

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

    if (node.type !== "code" && node.type !== "http_request") {
      return res.json({
        success: true,
        output: `Node type '${node.type}' executed (no runner available for isolated test).`,
        returnValue: null,
        durationMs: 0,
        error: null,
      });
    }

    // Write a temp python script
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "npython-"));
    const scriptPath = path.join(tmpDir, "script.py");

    let scriptContent: string;
    if (node.type === "http_request") {
      scriptContent = buildHttpRequestScript(config, inputData as Record<string, unknown>);
    } else {
      const code = (config.code as string) ?? "";
      const pipelineData = (inputData as any)?.pipeline ?? inputData ?? {};
      const workflowData = (inputData as any)?.workflow ?? {};
      const pipelineFile = path.join(tmpDir, "pipeline.json");
      const workflowFile = path.join(tmpDir, "workflow.json");
      await fs.writeFile(pipelineFile, JSON.stringify(pipelineData), "utf8");
      await fs.writeFile(workflowFile, JSON.stringify(workflowData), "utf8");
      // Wrap user code in a function so `return` works at the top level
      const _indented = code.trim() === ""
        ? "    pass"
        : code.split("\n").map((l) => "    " + l).join("\n");
      scriptContent = [
        "import json as _json",
        `with open(${JSON.stringify(pipelineFile)}) as _f: pipeline = _json.load(_f)`,
        `with open(${JSON.stringify(workflowFile)}) as _f: workflow = _json.load(_f)`,
        "",
        "def _node_code(pipeline, workflow):",
        _indented,
        "",
        "_node_result = _node_code(pipeline, workflow)",
        "if isinstance(_node_result, dict):",
        "    pipeline.update(_node_result)",
        "elif isinstance(_node_result, (set, frozenset)):",
        "    import sys as _sys",
        "    print(f'[aviso] return retornou um set {_node_result!r}. Use return {{\"chave\": valor}} para retornar um dict.', file=_sys.stderr)",
        "    pipeline['output'] = sorted(list(_node_result), key=str)",
        "elif _node_result is not None:",
        "    pipeline['output'] = _node_result",
        "",
        "def _to_json_safe(v):",
        "    if isinstance(v, dict): return {str(k): _to_json_safe(u) for k, u in v.items()}",
        "    if isinstance(v, (set, frozenset)): return sorted([_to_json_safe(i) for i in v], key=str)",
        "    if isinstance(v, (list, tuple)): return [_to_json_safe(i) for i in v]",
        "    try: _json.dumps(v); return v",
        "    except Exception: return repr(v)",
        "try:",
        `    with open(${JSON.stringify(path.join(tmpDir, "ctx_out.json"))}, 'w') as _f: _json.dump({'pipeline': _to_json_safe(pipeline), 'workflow': _to_json_safe(workflow)}, _f)`,
        "except Exception as _save_err:",
        "    import sys as _sys; print(f'[aviso] erro ao salvar contexto: {_save_err}', file=_sys.stderr)",
      ].join("\n");
    }
    await fs.writeFile(scriptPath, scriptContent, "utf8");

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

    // Read pipeline output written by the wrapper
    let pipelineOut: Record<string, unknown> | null = null;
    try {
      const outRaw = await fs.readFile(path.join(tmpDir, "ctx_out.json"), "utf8");
      const outData = JSON.parse(outRaw) as { pipeline?: Record<string, unknown> };
      pipelineOut = outData.pipeline ?? null;
    } catch {}

    await fs.rm(tmpDir, { recursive: true, force: true });

    const durationMs = Date.now() - start;

    res.json({
      success: result.success,
      output: result.output || result.error || "",
      returnValue: pipelineOut,
      durationMs,
      error: result.error,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
