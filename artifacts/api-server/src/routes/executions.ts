import { Router } from "express";
import { db, workflowsTable, nodesTable, edgesTable, executionsTable, logLinesTable, variablesTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { generateId } from "../lib/id";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import os from "os";
import fs from "fs/promises";

const router = Router();

// ─── Database Script Builder ──────────────────────────────────────────────────

function buildDbScript(
  dbType: string,
  operation: string,
  config: Record<string, unknown>,
  pipelineCtx: Record<string, unknown>,
  workflowCtx: Record<string, unknown>
): string {
  const ctx = { ...workflowCtx, ...pipelineCtx };
  const ctxJson = JSON.stringify(ctx);

  type DbField = { column: string; value: string; enabled: boolean };
  const getFields = (key: string): DbField[] =>
    ((config[key] ?? []) as DbField[]).filter(
      (f) => f.enabled !== false && String(f.column ?? "").trim() !== ""
    );

  const S = (k: string, def = "") => String(config[k] ?? def).replace(/\\/g, "\\\\").replace(/\n/g, " ").replace(/\r/g, "");
  const N = (k: string, def: number) => Number(config[k] ?? def);
  const B = (k: string) => config[k] === true;

  const table    = S("table", "table");
  const useConnStr = B("useConnectionString");
  const connStr  = S("connectionString");
  const host     = S("host", "localhost");
  const port     = N("port", dbType === "pg" ? 5432 : dbType === "mysql" ? 3306 : dbType === "mssql" ? 1433 : 1521);
  const dbName   = S("dbName");
  const user     = S("user");
  const pass     = String(config.password ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "").replace(/"/g, '\\"');

  const selectCols = S("selectColumns", "*");
  const whereClause = S("whereClause");
  const orderBy  = S("orderBy");
  const limit    = N("limit", 100);
  const whereCol = S("whereColumn");
  const whereVal = S("whereValue");
  const checkCol = S("checkColumn");
  const checkVal = S("checkValue");

  const fields       = getFields("fields");
  const insertFields = getFields("insertFields");
  const updateFields = getFields("updateFields");

  const pyCol = (c: string) => c.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  // Field dict builder (Python dict literal)
  const fd = (flds: DbField[]) => {
    if (flds.length === 0) return "{}";
    return `{\n${flds.map(f => `        "${pyCol(f.column)}": _r(${JSON.stringify(f.value)})`).join(",\n")}\n    }`;
  };

  // Placeholder helpers
  const phs = (n: number): string => {
    if (dbType === "mssql")  return Array(n).fill("?").join(", ");
    if (dbType === "oracle") return Array.from({ length: n }, (_, i) => `:${i + 1}`).join(", ");
    return Array(n).fill("%s").join(", ");
  };
  const setPhs = (flds: DbField[]) =>
    flds.map((f, i) => {
      const ph = dbType === "mssql" ? "?" : dbType === "oracle" ? `:${i + 1}` : "%s";
      return `"${pyCol(f.column)}" = ${ph}`;
    }).join(", ");
  const wherePh = (offset = 0) =>
    dbType === "mssql" ? "?" : dbType === "oracle" ? `:${offset + 1}` : "%s";

  const preamble = `import json as _j, sys as _sys
_pipeline = _j.loads(${JSON.stringify(ctxJson)})

def _r(v):
    s = str(v) if v is not None else ""
    try: return _j.loads(s)
    except Exception: pass
    try:
        _ctx = {"pipeline": _pipeline}; _ctx.update(_pipeline)
        _b = {"True": True, "False": False, "None": None, "str": str, "int": int, "float": float, "bool": bool, "len": len}
        return eval(s, {"__builtins__": _b}, _ctx)
    except Exception: return v
`;

  // ── Supabase (REST API via requests) ──────────────────────────
  if (dbType === "supabase") {
    const url = S("supabaseUrl");
    const key = String(config.supabaseKey ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    let body = "";

    if (operation === "select") {
      body = `    _p = {"select": "${selectCols}", "limit": "${limit}"}
    _res = _ses.get("${url}/rest/v1/${table}", params=_p); _res.raise_for_status()
    _d = _res.json()
    print(f"Encontrados {len(_d)} registro(s) em '${table}'")\n    print(_j.dumps(_d, ensure_ascii=False, default=str))`;
    } else if (operation === "insert") {
      body = `    _fd = ${fd(fields)}\n    _res = _ses.post("${url}/rest/v1/${table}", json=_fd, headers={"Prefer": "return=representation"}); _res.raise_for_status()\n    print(_j.dumps({"inserted": _res.json(), "success": True}))`;
    } else if (operation === "update") {
      body = `    _fd = ${fd(fields)}; _wv = _r(${JSON.stringify(whereVal)})\n    _res = _ses.patch("${url}/rest/v1/${table}", json=_fd, params={"${whereCol}": f"eq.{_wv}"}, headers={"Prefer": "return=representation"}); _res.raise_for_status()\n    print(_j.dumps({"updated": _res.json(), "success": True}))`;
    } else if (operation === "delete") {
      body = `    _wv = _r(${JSON.stringify(whereVal)})\n    _res = _ses.delete("${url}/rest/v1/${table}", params={"${whereCol}": f"eq.{_wv}"}, headers={"Prefer": "return=representation"}); _res.raise_for_status()\n    print(_j.dumps({"deleted": _res.json(), "success": True}))`;
    } else if (operation === "upsert") {
      body = `    _cv = _r(${JSON.stringify(checkVal)})
    _chk = _ses.get("${url}/rest/v1/${table}", params={"${checkCol}": f"eq.{_cv}", "limit": "1"}); _chk.raise_for_status()
    if _chk.json():
        _fd = ${fd(updateFields)}
        _res = _ses.patch("${url}/rest/v1/${table}", json=_fd, params={"${checkCol}": f"eq.{_cv}"}, headers={"Prefer": "return=representation"}); _res.raise_for_status()
        print(_j.dumps({"action": "update", "result": _res.json(), "success": True}))
    else:
        _fd = ${fd(insertFields)}
        _res = _ses.post("${url}/rest/v1/${table}", json=_fd, headers={"Prefer": "return=representation"}); _res.raise_for_status()
        print(_j.dumps({"action": "insert", "result": _res.json(), "success": True}))`;
    }

    return `import requests as _rq, json as _j, sys as _sys\n${preamble}\ntry:\n    _ses = _rq.Session()\n    _ses.headers.update({"apikey": "${key}", "Authorization": "Bearer ${key}", "Content-Type": "application/json", "Accept": "application/json"})\n${body}\nexcept Exception as _e:\n    print(str(_e), file=_sys.stderr); _sys.exit(1)\n`;
  }

  // ── SQL-based DBs ────────────────────────────────────────────
  let importLine = "";
  let connCode = "";

  if (dbType === "pg") {
    importLine = "import psycopg2 as _db, json as _j, sys as _sys";
    connCode = useConnStr && connStr
      ? `    _conn = _db.connect("${connStr.replace(/"/g, '\\"')}")`
      : `    _conn = _db.connect(host="${host}", port=${port}, dbname="${dbName}", user="${user}", password="${pass}")`;
  } else if (dbType === "mysql") {
    importLine = "import pymysql as _db, json as _j, sys as _sys";
    if (useConnStr && connStr) {
      connCode = `    from urllib.parse import urlparse as _up\n    _pu = _up("${connStr.replace(/"/g, '\\"')}")\n    _conn = _db.connect(host=_pu.hostname or "localhost", port=_pu.port or 3306, database=(_pu.path or "/").lstrip("/"), user=_pu.username or "", password=_pu.password or "", charset="utf8mb4")`;
    } else {
      connCode = `    _conn = _db.connect(host="${host}", port=${port}, database="${dbName}", user="${user}", password="${pass}", charset="utf8mb4")`;
    }
  } else if (dbType === "mssql") {
    importLine = "import pyodbc as _db, json as _j, sys as _sys";
    const cs = connStr || `DRIVER={ODBC Driver 17 for SQL Server};SERVER=${host},${port};DATABASE=${dbName};UID=${user};PWD=${pass}`;
    connCode = `    _conn = _db.connect("${cs.replace(/"/g, '\\"')}")`;
  } else if (dbType === "oracle") {
    importLine = "import oracledb as _db, json as _j, sys as _sys";
    connCode = useConnStr && connStr
      ? `    _conn = _db.connect(dsn="${connStr.replace(/"/g, '\\"')}")`
      : `    _conn = _db.connect(user="${user}", password="${pass}", dsn="${host}:${port}/${dbName}")`;
  }

  let opBody = "";

  if (operation === "select") {
    const w = whereClause ? ` WHERE ${whereClause}` : "";
    const o = orderBy ? ` ORDER BY ${orderBy}` : "";
    opBody = `    _sql = "SELECT ${selectCols} FROM ${table}${w}${o} LIMIT ${limit}"
    _cur.execute(_sql)
    _cols = [d[0] for d in _cur.description]
    _rows = _cur.fetchall()
    _result = [dict(zip(_cols, row)) for row in _rows]
    _conn.close()
    print(f"Encontrados {len(_result)} registro(s) em '${table}'")
    print(_j.dumps(_result, ensure_ascii=False, default=str))`;

  } else if (operation === "insert") {
    if (fields.length === 0) {
      opBody = `    raise ValueError("Nenhum campo definido para INSERT. Adicione campos no painel do nodo.")`;
    } else {
      opBody = `    _fd = ${fd(fields)}
    _cols = list(_fd.keys()); _vals = list(_fd.values())
    _sql = f"INSERT INTO ${table} ({{', '.join(_cols)}}) VALUES (${phs(fields.length)})"
    _cur.execute(_sql, _vals)
    _rc = _cur.rowcount; _conn.commit(); _conn.close()
    print(f"Inserido {_rc} registro(s) em '${table}'")\n    print(_j.dumps({"inserted": _rc, "success": True}))`;
    }

  } else if (operation === "update") {
    if (fields.length === 0) {
      opBody = `    raise ValueError("Nenhum campo definido para UPDATE. Adicione campos no painel do nodo.")`;
    } else {
      opBody = `    _fd = ${fd(fields)}
    _wv = _r(${JSON.stringify(whereVal)})
    _vals = list(_fd.values()) + [_wv]
    _sql = "UPDATE ${table} SET ${setPhs(fields)} WHERE ${whereCol} = ${wherePh(fields.length)}"
    _cur.execute(_sql, _vals)
    _rc = _cur.rowcount; _conn.commit(); _conn.close()
    print(f"Atualizado {_rc} registro(s) em '${table}'")\n    print(_j.dumps({"updated": _rc, "success": True}))`;
    }

  } else if (operation === "delete") {
    opBody = `    _wv = _r(${JSON.stringify(whereVal)})
    _sql = "DELETE FROM ${table} WHERE ${whereCol} = ${wherePh(0)}"
    _cur.execute(_sql, [_wv])
    _rc = _cur.rowcount; _conn.commit(); _conn.close()
    print(f"Removido {_rc} registro(s) de '${table}'")\n    print(_j.dumps({"deleted": _rc, "success": True}))`;

  } else if (operation === "upsert") {
    const chkPh = wherePh(0);
    const updPh = wherePh(updateFields.length);
    opBody = `    _cv = _r(${JSON.stringify(checkVal)})
    _cur.execute("SELECT 1 FROM ${table} WHERE ${checkCol} = ${chkPh}", [_cv])
    _exists = _cur.fetchone() is not None
    if _exists:
        _fd = ${fd(updateFields)}
        if not _fd: raise ValueError("Nenhum campo para atualizar definido no upsert.")
        _vals = list(_fd.values()) + [_cv]
        _sql = "UPDATE ${table} SET ${setPhs(updateFields)} WHERE ${checkCol} = ${updPh}"
        _cur.execute(_sql, _vals); _rc = _cur.rowcount; _conn.commit(); _conn.close()
        print(f"Insert or Update → Update: {_rc} registro(s) em '${table}'")\n        print(_j.dumps({"action": "update", "updated": _rc, "success": True}))
    else:
        _fd = ${fd(insertFields)}
        if not _fd: raise ValueError("Nenhum campo para inserir definido no upsert.")
        _cols = list(_fd.keys()); _vals = list(_fd.values())
        _sql = f"INSERT INTO ${table} ({{', '.join(_cols)}}) VALUES (${phs(insertFields.length)})"
        _cur.execute(_sql, _vals); _rc = _cur.rowcount; _conn.commit(); _conn.close()
        print(f"Insert or Update → Insert: {_rc} registro(s) em '${table}'")\n        print(_j.dumps({"action": "insert", "inserted": _rc, "success": True}))`;
  }

  const errPkg = dbType === "pg" ? "psycopg2-binary" : dbType === "mysql" ? "pymysql" : dbType === "mssql" ? "pyodbc" : "oracledb";

  return `${importLine}
${preamble}
try:
${connCode}
    _cur = _conn.cursor()
    ${opBody}
except ImportError as _ie:
    print(f"Biblioteca não instalada: {_ie}. Use Pip Packages para instalar '${errPkg}'.", file=_sys.stderr); _sys.exit(1)
except Exception as _e:
    print(str(_e), file=_sys.stderr); _sys.exit(1)
`;
}

// ─── Output type coercion (applied after every node run) ─────────────────────

function castOutputType(value: unknown, targetType: string): unknown {
  switch (targetType) {
    case "str":
      return typeof value === "string" ? value : JSON.stringify(value);

    case "int": {
      const n = Number(value);
      if (Number.isFinite(n)) return Math.trunc(n);
      const parsed = parseInt(String(value).trim(), 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    }

    case "float": {
      const n = parseFloat(String(value));
      return Number.isNaN(n) ? 0.0 : n;
    }

    case "list":
      if (Array.isArray(value)) return value;
      if (typeof value === "string") {
        try { const p = JSON.parse(value); if (Array.isArray(p)) return p; } catch {}
      }
      if (value !== null && typeof value === "object") return Object.values(value as object);
      return value === null || value === undefined ? [] : [value];

    case "dict":
      if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
      if (typeof value === "string") {
        try { const p = JSON.parse(value); if (p !== null && typeof p === "object" && !Array.isArray(p)) return p; } catch {}
      }
      if (Array.isArray(value)) return Object.fromEntries((value as unknown[]).map((v, i) => [String(i), v]));
      return { value };

    case "dataframe":
      // Always produce list-of-records (JSON-serializable DataFrame)
      if (Array.isArray(value)) {
        if (value.length === 0) return [];
        // array of arrays (matrix) → convert to records with index keys
        if (Array.isArray(value[0])) {
          return (value as unknown[][]).map((row) =>
            Object.fromEntries(row.map((v, i) => [String(i), v]))
          );
        }
        // array of primitives → wrap each
        if (typeof value[0] !== "object" || value[0] === null) {
          return (value as unknown[]).map((v, i) => ({ index: i, value: v }));
        }
        return value; // already list of records
      }
      if (typeof value === "string") {
        try { const p = JSON.parse(value); return castOutputType(p, "dataframe"); } catch {}
      }
      if (value !== null && typeof value === "object") return [value];
      return [{ value }];

    default:
      return value;
  }
}

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
  const responseType = (config.responseType as string) ?? "auto";

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

response_type = ${JSON.stringify(responseType)}

try:
    response = requests.request(**kwargs)
    elapsed_ms = int(response.elapsed.total_seconds() * 1000)
    print(f"HTTP {response.status_code} {response.reason}")
    print(f"URL: {response.url}")
    print(f"Tempo: {elapsed_ms}ms")
    content_type = response.headers.get("content-type", "desconhecido")
    print(f"Content-Type: {content_type}")
    print(f"Tamanho: {len(response.content)} bytes")
    print()
    if response_type == "binary":
        import base64
        b64 = base64.b64encode(response.content).decode("utf-8")
        print(json.dumps({"__binary__": True, "base64": b64, "content_type": content_type, "size": len(response.content)}, ensure_ascii=False))
    elif response_type == "text":
        text = response.text
        if len(text) > 5000:
            text = text[:5000] + "\\n...(truncado)"
        print(json.dumps({"text": text, "status_code": response.status_code}, ensure_ascii=False))
    else:
        # auto: try JSON, fallback to text
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

// GET /executions/workflow/:workflowId/last-outputs — per-node pipeline snapshots from latest run
router.get("/executions/workflow/:workflowId/last-outputs", async (req, res) => {
  try {
    const { workflowId } = req.params;
    const [exec] = await db
      .select()
      .from(executionsTable)
      .where(eq(executionsTable.workflowId, workflowId))
      .orderBy(desc(executionsTable.startedAt))
      .limit(1);

    if (!exec) return res.json({ nodeOutputs: {}, executionId: null });

    const nodeResults = (exec.nodeResults as any[]) ?? [];
    const dbNodes = await db.select().from(nodesTable).where(eq(nodesTable.workflowId, workflowId));
    const nodeMap = new Map(dbNodes.map((n) => [n.id, n]));

    const nodeOutputs: Record<string, {
      pipeline: Record<string, unknown>;
      label: string;
      status: string;
      rawOutput: string | null;
    }> = {};

    for (const nr of nodeResults) {
      const pipeline = (nr as any)?.outputSnapshot?.pipeline as Record<string, unknown> | undefined;
      if (pipeline && typeof pipeline === "object") {
        const node = nodeMap.get((nr as any).nodeId as string);
        nodeOutputs[(nr as any).nodeId as string] = {
          pipeline,
          label: node?.label ?? ((nr as any).nodeId as string),
          status: ((nr as any).status as string) ?? "unknown",
          rawOutput: ((nr as any).output as string | null) ?? null,
        };
      }
    }

    res.json({
      nodeOutputs,
      executionId: exec.id,
      executionStatus: exec.status,
      executedAt: exec.startedAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /executions/:id/debug — full debug payload (nodes + edges + logs + I/O snapshots)
router.get("/executions/:id/debug", async (req, res) => {
  try {
    const { id } = req.params;
    const [row] = await db
      .select({ exec: executionsTable, workflowName: workflowsTable.name })
      .from(executionsTable)
      .innerJoin(workflowsTable, eq(executionsTable.workflowId, workflowsTable.id))
      .where(eq(executionsTable.id, id));

    if (!row) return res.status(404).json({ error: "Execution not found" });

    const nodes = await db.select().from(nodesTable).where(eq(nodesTable.workflowId, row.exec.workflowId));
    const edges = await db.select().from(edgesTable).where(eq(edgesTable.workflowId, row.exec.workflowId));
    const logs = await db
      .select()
      .from(logLinesTable)
      .where(eq(logLinesTable.executionId, id))
      .orderBy(logLinesTable.timestamp);

    res.json({
      id: row.exec.id,
      workflowId: row.exec.workflowId,
      workflowName: row.workflowName,
      status: row.exec.status,
      startedAt: row.exec.startedAt.toISOString(),
      finishedAt: row.exec.finishedAt?.toISOString() ?? null,
      durationMs: row.exec.durationMs ?? null,
      errorMessage: row.exec.errorMessage ?? null,
      nodeResults: (row.exec.nodeResults as any[]) ?? [],
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        label: n.label,
        positionX: n.positionX,
        positionY: n.positionY,
        config: n.config,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        label: e.label,
        condition: e.condition,
      })),
      logs: logs.map((l) => ({
        id: l.id,
        nodeId: l.nodeId ?? null,
        level: l.level,
        message: l.message,
        timestamp: l.timestamp.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /executions/:id/apply-fixes — save corrected node configs back to workflow
router.post("/executions/:id/apply-fixes", async (req, res) => {
  try {
    const { id } = req.params;
    const { nodes: nodeUpdates } = req.body as {
      nodes: Array<{ id: string; config: Record<string, unknown>; label?: string }>;
    };

    const [exec] = await db.select().from(executionsTable).where(eq(executionsTable.id, id));
    if (!exec) return res.status(404).json({ error: "Execution not found" });

    for (const update of nodeUpdates ?? []) {
      const updateSet: Record<string, unknown> = { config: update.config };
      if (update.label) updateSet.label = update.label;
      await db
        .update(nodesTable)
        .set(updateSet as any)
        .where(and(eq(nodesTable.id, update.id), eq(nodesTable.workflowId, exec.workflowId)));
    }

    res.json({ success: true, applied: (nodeUpdates ?? []).length });
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

// ─── Sub-workflow inline executor ─────────────────────────────────────────────

async function runSubWorkflowInline({
  workflowId,
  nodes,
  edges,
  initialPipeline,
  initialWorkflow,
  parentExecutionId,
  parentNodeLabel,
  venovsDir,
  depth = 0,
}: {
  workflowId: string;
  nodes: any[];
  edges: any[];
  initialPipeline: Record<string, unknown>;
  initialWorkflow: Record<string, unknown>;
  parentExecutionId: string;
  parentNodeLabel: string;
  venovsDir: string;
  depth?: number;
}): Promise<{ success: boolean; finalPipeline: Record<string, unknown>; error?: string }> {
  if (depth > 10) {
    return { success: false, finalPipeline: { ...initialPipeline }, error: "Profundidade máxima de sub-flow (10) atingida" };
  }

  const pipelineCtx: Record<string, unknown> = { ...initialPipeline };
  const workflowCtx: Record<string, unknown> = { ...initialWorkflow };

  // Entry points: trigger_subflow nodes, or nodes with no incoming edges
  const triggerNodes = nodes.filter((n) => n.type === "trigger_subflow");
  const startNodes = triggerNodes.length > 0
    ? triggerNodes
    : nodes.filter((n) => !edges.some((e: any) => e.targetNodeId === n.id));

  if (startNodes.length === 0) {
    return { success: false, finalPipeline: pipelineCtx, error: "Nenhum ponto de entrada encontrado no sub-flow" };
  }

  // BFS
  const childrenMap = new Map<string, string[]>();
  for (const node of nodes) childrenMap.set(node.id, []);
  for (const edge of edges) {
    const arr = childrenMap.get(edge.sourceNodeId) ?? [];
    arr.push(edge.targetNodeId);
    childrenMap.set(edge.sourceNodeId, arr);
  }
  const reachable = new Set<string>(startNodes.map((n: any) => n.id));
  const bfsQ = [...startNodes.map((n: any) => n.id)];
  let bi = 0;
  while (bi < bfsQ.length) {
    const cur = bfsQ[bi++];
    for (const ch of childrenMap.get(cur) ?? []) {
      if (!reachable.has(ch)) { reachable.add(ch); bfsQ.push(ch); }
    }
  }
  const reachableNodes = nodes.filter((n: any) => reachable.has(n.id));

  // Topological sort (DFS)
  const inMap = new Map<string, string[]>();
  for (const node of reachableNodes) inMap.set(node.id, []);
  for (const edge of edges) {
    if (reachable.has(edge.sourceNodeId) && reachable.has(edge.targetNodeId)) {
      const arr = inMap.get(edge.targetNodeId) ?? [];
      arr.push(edge.sourceNodeId);
      inMap.set(edge.targetNodeId, arr);
    }
  }
  const sorted: any[] = [];
  const vis = new Set<string>();
  function visitSub(nid: string) {
    if (vis.has(nid)) return; vis.add(nid);
    for (const dep of inMap.get(nid) ?? []) visitSub(dep);
    const node = reachableNodes.find((n: any) => n.id === nid);
    if (node) sorted.push(node);
  }
  for (const node of reachableNodes) visitSub(node.id);

  await addLog(parentExecutionId, null, "info",
    `[sub-flow] "${parentNodeLabel}" → ${sorted.length} nodo(s) em "${workflowId}"`);

  for (const node of sorted) {
    // Trigger nodes are entry points — skip actual execution
    if (String(node.type).startsWith("trigger_")) continue;

    const cfg = node.config as Record<string, unknown>;
    let ok = false;
    let out = "";
    let err: string | null = null;

    try {
      const venvPy = path.join(venovsDir, workflowId, "bin", "python3");
      let pyBin = "python3";
      try { await fs.access(venvPy); pyBin = venvPy; } catch {}

      if (cfg.pinned === true) {
        out = String(cfg.mockOutput ?? "(pinned)"); ok = true;

      } else if (node.type === "code") {
        const userCode = (cfg.code as string) ?? "";
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "npy-sub-"));
        const pf = path.join(tmp, "p.json"), wf = path.join(tmp, "w.json"), of2 = path.join(tmp, "o.json"), sf = path.join(tmp, "s.py");
        await fs.writeFile(pf, JSON.stringify(pipelineCtx), "utf8");
        await fs.writeFile(wf, JSON.stringify(workflowCtx), "utf8");
        const ind = userCode.trim() === "" ? "    pass" : userCode.split("\n").map((l) => "    " + l).join("\n");
        await fs.writeFile(sf, [
          "import json as _j",
          `with open(${JSON.stringify(pf)}) as _f: pipeline = _j.load(_f)`,
          `with open(${JSON.stringify(wf)}) as _f: workflow = _j.load(_f)`,
          "def _run(pipeline, workflow):", ind, "",
          "_r = _run(pipeline, workflow)",
          "if isinstance(_r, dict): pipeline.update(_r)",
          "elif _r is not None: pipeline['output'] = _r",
          "def _s(v):",
          "    if isinstance(v, dict): return {str(k): _s(u) for k,u in v.items()}",
          "    if isinstance(v, (set,frozenset)): return sorted([_s(i) for i in v],key=str)",
          "    if isinstance(v, (list,tuple)): return [_s(i) for i in v]",
          "    try: _j.dumps(v); return v",
          "    except: return repr(v)",
          `with open(${JSON.stringify(of2)},'w') as _f: _j.dump({'pipeline':_s(pipeline),'workflow':_s(workflow)},_f)`,
        ].join("\n"), "utf8");
        const r = await new Promise<{ ok: boolean; out: string; err: string | null }>((res) => {
          const p = spawn(pyBin, [sf], { timeout: 60000 });
          let so = "", se = "";
          p.stdout.on("data", (d: Buffer) => { so += d; });
          p.stderr.on("data", (d: Buffer) => { se += d; });
          p.on("close", (c) => res(c === 0 ? { ok: true, out: so, err: null } : { ok: false, out: so, err: se || `Exit ${c}` }));
          p.on("error", (e) => res({ ok: false, out: "", err: e.message }));
        });
        try {
          const od = JSON.parse(await fs.readFile(of2, "utf8")) as { pipeline?: Record<string, unknown>; workflow?: Record<string, unknown> };
          if (od.pipeline) Object.assign(pipelineCtx, od.pipeline);
          if (od.workflow) Object.assign(workflowCtx, od.workflow);
        } catch {}
        await fs.rm(tmp, { recursive: true, force: true });
        ok = r.ok; out = r.out; err = r.err;

      } else if (node.type === "call_subflow") {
        const subWfId = (cfg.workflowId as string) ?? "";
        if (!subWfId) { ok = false; err = "Nenhum sub-workflow selecionado"; }
        else {
          const subN = await db.select().from(nodesTable).where(eq(nodesTable.workflowId, subWfId));
          const subE = await db.select().from(edgesTable).where(eq(edgesTable.workflowId, subWfId));
          const subParams = ((cfg.inputParams as { key: string; value: string }[]) ?? []).filter((p) => p.key?.trim());
          const subInit: Record<string, unknown> = { ...pipelineCtx };
          for (const p of subParams) {
            try { subInit[p.key] = JSON.parse(p.value); } catch { subInit[p.key] = pipelineCtx[p.value] ?? p.value; }
          }
          const sr = await runSubWorkflowInline({
            workflowId: subWfId, nodes: subN, edges: subE,
            initialPipeline: subInit, initialWorkflow: { ...workflowCtx },
            parentExecutionId, parentNodeLabel: node.label, venovsDir, depth: depth + 1,
          });
          const ov = (cfg.outputVar as string)?.trim() ?? "";
          if (sr.success) {
            if (ov) pipelineCtx[ov] = sr.finalPipeline; else Object.assign(pipelineCtx, sr.finalPipeline);
            ok = true; out = `Sub-flow concluído → ${ov ? `"${ov}"` : "merged"}`;
          } else { ok = false; err = sr.error ?? "Sub-flow falhou"; }
        }
      } else {
        out = `[sub-flow] Nodo "${node.type}" (${node.label}) executado`; ok = true;
      }
    } catch (e: any) { ok = false; err = e?.message ?? String(e); }

    if (out) await addLog(parentExecutionId, null, "info", `  [${node.label}] ${out.trim()}`);
    if (err) await addLog(parentExecutionId, null, "error", `  [${node.label}] ${err.trim()}`);

    if (!ok && node.stopOnError && !node.continueOnError) {
      return { success: false, finalPipeline: pipelineCtx, error: err ?? "Node failed" };
    }
  }

  return { success: true, finalPipeline: pipelineCtx };
}

// ─────────────────────────────────────────────────────────────────────────────

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
      const inputSnapshot = JSON.parse(JSON.stringify({
        pipeline: pipelineContext,
        workflow: workflowContext,
      }));

      const nodeConfig = node.config as Record<string, unknown>;

      try {
        // ── Pinned: return mock output without executing ────────────
        if (nodeConfig.pinned === true) {
          output = String(nodeConfig.mockOutput ?? "(pinned — sem output definido)");
          success = true;
          await addLog(executionId, node.id, "info", `[PINNED] ${output}`);
        } else if (node.type === "code") {
          const config = node.config as Record<string, unknown>;
          const userCode = (config.code as string) ?? "";

          const tmpDir      = await fs.mkdtemp(path.join(os.tmpdir(), "npython-"));
          const pipelineFile = path.join(tmpDir, "pipeline.json");
          const workflowFile = path.join(tmpDir, "workflow.json");
          const outputFile   = path.join(tmpDir, "ctx_out.json");
          const scriptPath   = path.join(tmpDir, "script.py");

          await fs.writeFile(pipelineFile, JSON.stringify(pipelineContext), "utf8");
          await fs.writeFile(workflowFile, JSON.stringify(workflowContext), "utf8");

          // ── n8n-style $('Label').json.path → _node_outputs['Label'].path ──
          // Build a label-keyed map of pipeline snapshots from previously executed nodes.
          const nodeOutputsByLabel: Record<string, Record<string, unknown>> = {};
          for (const completedId of Object.keys(nodeResults)) {
            const nr = nodeResults[completedId];
            if (!nr || (nr.status !== "success" && nr.status !== "failed")) continue;
            const snap = nr.outputSnapshot?.pipeline as Record<string, unknown> | undefined;
            if (snap && typeof snap === "object") {
              nodeOutputsByLabel[nr.nodeLabel] = snap;
            }
          }
          const nodeOutputsFile = path.join(tmpDir, "node_outputs.json");
          await fs.writeFile(nodeOutputsFile, JSON.stringify(nodeOutputsByLabel), "utf8");

          // Pre-process user code: $('Label').json → _node_outputs['Label']
          // Subsequent .foo.bar['k'] just falls through as natural Python on _NodeOut.
          const preprocessed = userCode.replace(
            /\$\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*\)\s*\.\s*json/g,
            (_m, _q, label: string) => `_node_outputs[${JSON.stringify(label)}]`,
          );

          // Wrap user code in a function so `return` works at the top level
          const _indented = preprocessed.trim() === ""
            ? "    pass"
            : preprocessed.split("\n").map((l) => "    " + l).join("\n");
          const codeOutputType = (nodeConfig.outputType as string | undefined) ?? "auto";
          const wrappedCode = [
            "import json as _json",
            `with open(${JSON.stringify(pipelineFile)}) as _f: pipeline = _json.load(_f)`,
            `with open(${JSON.stringify(workflowFile)}) as _f: workflow = _json.load(_f)`,
            `with open(${JSON.stringify(nodeOutputsFile)}) as _f: _raw_node_outputs = _json.load(_f)`,
            "",
            "class _NodeOut:",
            "    \"\"\"Wraps node output dicts to allow attribute access ($('x').json.foo).\"\"\"",
            "    __slots__ = ('_d',)",
            "    def __init__(self, d): self._d = d",
            "    def __getattr__(self, name):",
            "        if isinstance(self._d, dict) and name in self._d:",
            "            v = self._d[name]; return _NodeOut(v) if isinstance(v, (dict, list)) else v",
            "        raise AttributeError(f\"node output has no attribute {name!r}\")",
            "    def __getitem__(self, key):",
            "        v = self._d[key] if isinstance(self._d, (dict, list)) else None",
            "        return _NodeOut(v) if isinstance(v, (dict, list)) else v",
            "    def __iter__(self): return iter(self._d) if hasattr(self._d, '__iter__') else iter([])",
            "    def __len__(self): return len(self._d) if hasattr(self._d, '__len__') else 0",
            "    def __contains__(self, k): return (k in self._d) if hasattr(self._d, '__contains__') else False",
            "    def __repr__(self): return repr(self._d)",
            "    def __str__(self): return str(self._d)",
            "    def __bool__(self): return bool(self._d)",
            "    def __eq__(self, other):",
            "        if isinstance(other, _NodeOut): return self._d == other._d",
            "        return self._d == other",
            "    def get(self, key, default=None):",
            "        if isinstance(self._d, dict):",
            "            v = self._d.get(key, default)",
            "            return _NodeOut(v) if isinstance(v, (dict, list)) else v",
            "        return default",
            "    def keys(self): return self._d.keys() if isinstance(self._d, dict) else []",
            "    def values(self):",
            "        if not isinstance(self._d, dict): return []",
            "        return [_NodeOut(v) if isinstance(v, (dict, list)) else v for v in self._d.values()]",
            "    def items(self):",
            "        if not isinstance(self._d, dict): return []",
            "        return [(k, _NodeOut(v) if isinstance(v, (dict, list)) else v) for k, v in self._d.items()]",
            "    def _unwrap(self): return self._d",
            "_node_outputs = {k: _NodeOut(v) for k, v in _raw_node_outputs.items()}",
            "",
            "def _node_code(pipeline, workflow):",
            _indented,
            "",
            "def _cast_output(val, target):",
            "    if target == 'auto': return val",
            "    if target == 'str': return str(val)",
            "    if target == 'int':",
            "        try: return int(val)",
            "        except: return 0",
            "    if target == 'float':",
            "        try: return float(val)",
            "        except: return 0.0",
            "    if target == 'list':",
            "        if isinstance(val, list): return val",
            "        if isinstance(val, (tuple, set, frozenset)): return list(val)",
            "        if isinstance(val, str):",
            "            try:",
            "                p = _json.loads(val)",
            "                return p if isinstance(p, list) else [p]",
            "            except: pass",
            "        if isinstance(val, dict): return list(val.values())",
            "        return [val]",
            "    if target == 'dict':",
            "        if isinstance(val, dict): return val",
            "        if isinstance(val, str):",
            "            try:",
            "                p = _json.loads(val)",
            "                return p if isinstance(p, dict) else {'value': p}",
            "            except: pass",
            "        if isinstance(val, (list, tuple)): return {str(i): v for i, v in enumerate(val)}",
            "        return {'value': val}",
            "    if target == 'dataframe':",
            "        try:",
            "            import pandas as _pd",
            "            if isinstance(val, _pd.DataFrame): return val.to_dict(orient='records')",
            "            if isinstance(val, _pd.Series): return val.reset_index().to_dict(orient='records')",
            "        except ImportError: pass",
            "        if isinstance(val, list):",
            "            if val and isinstance(val[0], (list, tuple)):",
            "                return [{str(i): v for i, v in enumerate(row)} for row in val]",
            "            return val",
            "        if isinstance(val, dict): return [val]",
            "        return [{'value': val}]",
            "    return val",
            "",
            `_output_type = ${JSON.stringify(codeOutputType)}`,
            "_node_result = _node_code(pipeline, workflow)",
            "if isinstance(_node_result, dict):",
            "    for _k, _v in _node_result.items():",
            "        pipeline[_k] = _cast_output(_v, _output_type) if _output_type != 'auto' else _v",
            "elif isinstance(_node_result, (set, frozenset)):",
            "    import sys as _sys",
            "    print(f'[aviso] return retornou um set {_node_result!r}. Use return {{\"chave\": valor}} para retornar um dict.', file=_sys.stderr)",
            "    pipeline['output'] = sorted(list(_node_result), key=str)",
            "elif _node_result is not None:",
            "    pipeline['output'] = _cast_output(_node_result, _output_type)",
            "",
            "def _to_json_safe(v):",
            "    if isinstance(v, dict): return {str(k): _to_json_safe(u) for k, u in v.items()}",
            "    if isinstance(v, (set, frozenset)): return sorted([_to_json_safe(i) for i in v], key=str)",
            "    if isinstance(v, (list, tuple)): return [_to_json_safe(i) for i in v]",
            "    try: _json.dumps(v); return v",
            "    except Exception: return repr(v)",
            "try:",
            `    with open(${JSON.stringify(outputFile)}, 'w') as _f: _json.dump({'pipeline': _to_json_safe(pipeline), 'workflow': _to_json_safe(workflow)}, _f)`,
            "except Exception as _save_err:",
            "    import sys as _sys; print(f'[aviso] erro ao salvar contexto: {_save_err}', file=_sys.stderr)",
          ].join("\n");

          await fs.writeFile(scriptPath, wrappedCode, "utf8");

          const venvPython = path.join(venovsDir, workflowId, "bin", "python3");
          let pythonBin = "python3";
          try { await fs.access(venvPython); pythonBin = venvPython; } catch {}

          const result = await new Promise<{ success: boolean; output: string; error: string | null }>(
            (resolve) => {
              const proc = spawn(pythonBin, [scriptPath], { timeout: 60000 });
              runningProcesses.set(executionId, proc);
              let stdout = ""; let stderr = "";
              proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
              proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
              proc.on("close", (code) => {
                runningProcesses.delete(executionId);
                if (code === 0) resolve({ success: true, output: stdout, error: null });
                else resolve({ success: false, output: stdout, error: stderr || `Exit code ${code}` });
              });
              proc.on("error", (err) => {
                runningProcesses.delete(executionId);
                resolve({ success: false, output: "", error: err.message });
              });
            }
          );

          // Merge pipeline/workflow changes back from user code
          try {
            const outData = JSON.parse(await fs.readFile(outputFile, "utf8")) as {
              pipeline?: Record<string, unknown>; workflow?: Record<string, unknown>;
            };
            if (outData.pipeline) Object.assign(pipelineContext, outData.pipeline);
            if (outData.workflow) Object.assign(workflowContext, outData.workflow);
          } catch {}

          await fs.rm(tmpDir, { recursive: true, force: true });

          success = result.success;
          output = result.output;
          error = result.error;

          if (output) await addLog(executionId, node.id, "info", output.trim());
          if (error) await addLog(executionId, node.id, "error", error.trim());

        } else if (node.type === "condition") {
          // ── Condition: eval Python expression with full pipeline/workflow context ──
          const config = node.config as Record<string, unknown>;
          const expression = (config.expression as string) ?? "True";
          const tmpDir      = await fs.mkdtemp(path.join(os.tmpdir(), "npython-cond-"));
          const pipelineFile = path.join(tmpDir, "pipeline.json");
          const workflowFile = path.join(tmpDir, "workflow.json");
          const scriptPath   = path.join(tmpDir, "cond.py");
          await fs.writeFile(pipelineFile, JSON.stringify(pipelineContext), "utf8");
          await fs.writeFile(workflowFile, JSON.stringify(workflowContext), "utf8");
          const condScript = [
            "import json, sys",
            `with open(${JSON.stringify(pipelineFile)}) as f: pipeline = json.load(f)`,
            `with open(${JSON.stringify(workflowFile)}) as f: workflow = json.load(f)`,
            "ctx = {**workflow, **pipeline}",
            "try:",
            `    result = bool(eval(${JSON.stringify(expression)}, {"__builtins__": __builtins__}, ctx))`,
            "except Exception as e:",
            "    print(f'Condition error: {e}', file=sys.stderr)",
            "    result = False",
            "print(json.dumps(result))",
          ].join("\n");
          await fs.writeFile(scriptPath, condScript, "utf8");
          const venvPyCond = path.join(venovsDir, workflowId, "bin", "python3");
          let pyBinCond = "python3";
          try { await fs.access(venvPyCond); pyBinCond = venvPyCond; } catch {}
          const condResult = await new Promise<{ result: boolean; err: string | null }>((resolve) => {
            const proc = spawn(pyBinCond, [scriptPath], { timeout: 10000 });
            let out = ""; let err = "";
            proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
            proc.stderr.on("data", (d: Buffer) => { err += d.toString(); });
            proc.on("close", () => {
              try { resolve({ result: JSON.parse(out.trim()), err: err.trim() || null }); }
              catch { resolve({ result: false, err: err.trim() || "parse error" }); }
            });
            proc.on("error", (e) => resolve({ result: false, err: e.message }));
          });
          await fs.rm(tmpDir, { recursive: true, force: true });
          pipelineContext["_condition_result"] = condResult.result;
          success = true;
          output = `Condition "${expression}" → ${condResult.result}`;
          if (condResult.err) output += ` ⚠ ${condResult.err}`;
          await addLog(executionId, node.id, "info", output);

        } else if (node.type === "if_and") {
          // ── If AND/OR: evaluate multiple conditions combined with AND or OR ──
          const config = node.config as Record<string, unknown>;
          const mode = (config.mode as string) ?? "and";
          const conditions = (config.conditions as Array<{ expression: string }>) ?? [];
          const tmpDir       = await fs.mkdtemp(path.join(os.tmpdir(), "npython-ifand-"));
          const pipelineFile = path.join(tmpDir, "pipeline.json");
          const workflowFile = path.join(tmpDir, "workflow.json");
          const scriptPath   = path.join(tmpDir, "ifand.py");
          await fs.writeFile(pipelineFile, JSON.stringify(pipelineContext), "utf8");
          await fs.writeFile(workflowFile, JSON.stringify(workflowContext), "utf8");
          const exprsJson = JSON.stringify(conditions.map((c) => c.expression));
          const ifAndScript = [
            "import json, sys",
            `with open(${JSON.stringify(pipelineFile)}) as f: pipeline = json.load(f)`,
            `with open(${JSON.stringify(workflowFile)}) as f: workflow = json.load(f)`,
            "ctx = {**workflow, **pipeline}",
            `expressions = json.loads(${JSON.stringify(exprsJson)})`,
            `mode = ${JSON.stringify(mode)}`,
            "results = []",
            "errors = []",
            "for expr in expressions:",
            "    try:",
            "        results.append(bool(eval(expr, {'__builtins__': __builtins__}, ctx)))",
            "    except Exception as e:",
            "        errors.append(str(e))",
            "        results.append(False)",
            "final = any(results) if mode == 'or' else all(results)",
            "print(json.dumps({'result': final, 'results': results, 'errors': errors}))",
          ].join("\n");
          await fs.writeFile(scriptPath, ifAndScript, "utf8");
          const venvPyIfAnd = path.join(venovsDir, workflowId, "bin", "python3");
          let pyBinIfAnd = "python3";
          try { await fs.access(venvPyIfAnd); pyBinIfAnd = venvPyIfAnd; } catch {}
          const ifAndResult = await new Promise<{ result: boolean; results: boolean[]; errors: string[] }>((resolve) => {
            const proc = spawn(pyBinIfAnd, [scriptPath], { timeout: 10000 });
            let out = ""; let err = "";
            proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
            proc.stderr.on("data", (d: Buffer) => { err += d.toString(); });
            proc.on("close", () => {
              try { resolve(JSON.parse(out.trim())); }
              catch { resolve({ result: false, results: [], errors: [err.trim() || "parse error"] }); }
            });
            proc.on("error", (e) => resolve({ result: false, results: [], errors: [e.message] }));
          });
          await fs.rm(tmpDir, { recursive: true, force: true });
          pipelineContext["_condition_result"] = ifAndResult.result;
          success = true;
          const modeLabel = mode === "or" ? "OR" : "AND";
          output = `[if_${modeLabel}] ${conditions.length} condições → ${ifAndResult.result} (${ifAndResult.results.map(String).join(`, ${modeLabel} `)})`;
          if (ifAndResult.errors.length > 0) output += ` ⚠ ${ifAndResult.errors.join("; ")}`;
          await addLog(executionId, node.id, "info", output);

        } else if (node.type === "if_else") {
          // ── If / Else If: evaluate if/elif/else chain, store branch name ──
          const config = node.config as Record<string, unknown>;
          const ifExpression = (config.ifExpression as string) ?? "True";
          const elifClauses  = (config.elifClauses as Array<{ expression: string; branch: string }>) ?? [];
          const elseBranch   = (config.elseBranch as string) ?? "else";
          const tmpDir       = await fs.mkdtemp(path.join(os.tmpdir(), "npython-ifelse-"));
          const pipelineFile = path.join(tmpDir, "pipeline.json");
          const workflowFile = path.join(tmpDir, "workflow.json");
          const scriptPath   = path.join(tmpDir, "ifelse.py");
          await fs.writeFile(pipelineFile, JSON.stringify(pipelineContext), "utf8");
          await fs.writeFile(workflowFile, JSON.stringify(workflowContext), "utf8");
          const elifJson = JSON.stringify(elifClauses);
          const ifElseScript = [
            "import json, sys",
            `with open(${JSON.stringify(pipelineFile)}) as f: pipeline = json.load(f)`,
            `with open(${JSON.stringify(workflowFile)}) as f: workflow = json.load(f)`,
            "ctx = {**workflow, **pipeline}",
            `elif_clauses = json.loads(${JSON.stringify(elifJson)})`,
            `else_branch = ${JSON.stringify(elseBranch)}`,
            "matched = else_branch",
            "try:",
            `    if bool(eval(${JSON.stringify(ifExpression)}, {'__builtins__': __builtins__}, ctx)):`,
            "        matched = 'if'",
            "    else:",
            "        for clause in elif_clauses:",
            "            try:",
            "                if bool(eval(clause['expression'], {'__builtins__': __builtins__}, ctx)):",
            "                    matched = clause['branch']",
            "                    break",
            "            except: pass",
            "except Exception as e:",
            "    print(f'if_else error: {e}', file=__import__('sys').stderr)",
            "print(json.dumps(matched))",
          ].join("\n");
          await fs.writeFile(scriptPath, ifElseScript, "utf8");
          const venvPyIfElse = path.join(venovsDir, workflowId, "bin", "python3");
          let pyBinIfElse = "python3";
          try { await fs.access(venvPyIfElse); pyBinIfElse = venvPyIfElse; } catch {}
          const ifElseResult = await new Promise<{ branch: string; err: string | null }>((resolve) => {
            const proc = spawn(pyBinIfElse, [scriptPath], { timeout: 10000 });
            let out = ""; let err = "";
            proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
            proc.stderr.on("data", (d: Buffer) => { err += d.toString(); });
            proc.on("close", () => {
              try { resolve({ branch: JSON.parse(out.trim()), err: err.trim() || null }); }
              catch { resolve({ branch: elseBranch, err: err.trim() || "parse error" }); }
            });
            proc.on("error", (e) => resolve({ branch: elseBranch, err: e.message }));
          });
          await fs.rm(tmpDir, { recursive: true, force: true });
          pipelineContext["_branch"] = ifElseResult.branch;
          success = true;
          output = `[if_else] → branch "${ifElseResult.branch}"`;
          if (ifElseResult.err) output += ` ⚠ ${ifElseResult.err}`;
          await addLog(executionId, node.id, "info", output);

        } else if (node.type === "case") {
          // ── Case/Match: equality-based routing (like switch but literal values) ──
          const config = node.config as Record<string, unknown>;
          const inputVar = (config.inputVar as string) ?? "";
          const cases    = (config.cases as Array<{ value: string; label: string }>) ?? [];
          const fallback = (config.fallback as string) ?? "default";
          const rawValue = inputVar ? (pipelineContext[inputVar] ?? workflowContext[inputVar] ?? null) : null;
          const valueJson = JSON.stringify(rawValue);
          const casesJson = JSON.stringify(cases);
          const caseScript = [
            "import json, sys",
            `raw = json.loads(${JSON.stringify(valueJson)})`,
            `cases = json.loads(${JSON.stringify(casesJson)})`,
            `fallback = ${JSON.stringify(fallback)}`,
            "matched = fallback",
            "for c in cases:",
            "    cv = c['value']",
            "    try:",
            "        parsed = json.loads(cv)",
            "        if raw == parsed or str(raw) == str(cv):",
            "            matched = c['label']; break",
            "    except:",
            "        if str(raw) == str(cv):",
            "            matched = c['label']; break",
            "print(json.dumps(matched))",
          ].join("\n");
          const tmpScript = path.join(os.tmpdir(), `case_${executionId}.py`);
          await fs.writeFile(tmpScript, caseScript, "utf8");
          const caseResult = await new Promise<string>((resolve) => {
            const proc = spawn("python3", [tmpScript], { timeout: 10000 });
            let out = ""; proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
            proc.on("close", () => { try { resolve(JSON.parse(out.trim())); } catch { resolve(fallback); } });
            proc.on("error", () => resolve(fallback));
          });
          await fs.unlink(tmpScript).catch(() => {});
          pipelineContext["_switch_result"] = caseResult;
          success = true;
          output = `[case] "${inputVar}" = ${valueJson} → "${caseResult}"`;
          await addLog(executionId, node.id, "info", output);

        } else if (node.type === "loop") {
          // ── Loop: evaluate itemsExpression and store items in pipeline ──
          const config = node.config as Record<string, unknown>;
          const itemsExpression = (config.itemsExpression as string) ?? "[]";
          const outputVar = (config.outputVar as string) ?? "loop_items";
          const tmpDir      = await fs.mkdtemp(path.join(os.tmpdir(), "npython-loop-"));
          const pipelineFile = path.join(tmpDir, "pipeline.json");
          const workflowFile = path.join(tmpDir, "workflow.json");
          const scriptPath   = path.join(tmpDir, "loop.py");
          await fs.writeFile(pipelineFile, JSON.stringify(pipelineContext), "utf8");
          await fs.writeFile(workflowFile, JSON.stringify(workflowContext), "utf8");
          const loopScript = [
            "import json, sys",
            `with open(${JSON.stringify(pipelineFile)}) as f: pipeline = json.load(f)`,
            `with open(${JSON.stringify(workflowFile)}) as f: workflow = json.load(f)`,
            "ctx = {**workflow, **pipeline}",
            "try:",
            `    items = eval(${JSON.stringify(itemsExpression)}, {"__builtins__": __builtins__}, ctx)`,
            "    if not isinstance(items, list): items = list(items)",
            "except Exception as e:",
            "    print(f'Loop error: {e}', file=sys.stderr)",
            "    items = []",
            "print(json.dumps(items))",
          ].join("\n");
          await fs.writeFile(scriptPath, loopScript, "utf8");
          const venvPyLoop = path.join(venovsDir, workflowId, "bin", "python3");
          let pyBinLoop = "python3";
          try { await fs.access(venvPyLoop); pyBinLoop = venvPyLoop; } catch {}
          const loopResult = await new Promise<{ items: unknown[]; err: string | null }>((resolve) => {
            const proc = spawn(pyBinLoop, [scriptPath], { timeout: 15000 });
            let out = ""; let err = "";
            proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
            proc.stderr.on("data", (d: Buffer) => { err += d.toString(); });
            proc.on("close", () => {
              try { resolve({ items: JSON.parse(out.trim()), err: err.trim() || null }); }
              catch { resolve({ items: [], err: err.trim() || "parse error" }); }
            });
            proc.on("error", (e) => resolve({ items: [], err: e.message }));
          });
          await fs.rm(tmpDir, { recursive: true, force: true });
          pipelineContext[outputVar] = loopResult.items;
          success = true;
          output = `Loop "${itemsExpression}" → ${loopResult.items.length} itens → "${outputVar}"`;
          if (loopResult.err) output += ` ⚠ ${loopResult.err}`;
          await addLog(executionId, node.id, "info", output);

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
          const key = (config.key ?? "").trim();
          const value = config.value ?? "";
          if (key) pipelineContext[key] = value;
          output = `Set "${key}" = ${JSON.stringify(value)}`;
          success = true;
          await addLog(executionId, node.id, "info", output);
        } else if (node.type === "get_variable") {
          const config = node.config as Record<string, string>;
          const key = (config.key ?? "").trim();
          const val = key ? (pipelineContext[key] ?? workflowContext[key] ?? null) : null;
          if (key) pipelineContext[key] = val;
          output = `Get "${key}" = ${JSON.stringify(val)}`;
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
              // Pre-install requests so http_request nodes work without explicit pip_install
              await new Promise<void>((resolve) => {
                const pip = path.join(venvDir, "bin", "pip");
                const proc = spawn(pip, ["install", "requests"], { timeout: 60000, env: { ...process.env, PIP_USER: "0" } });
                proc.on("close", () => resolve());
                proc.on("error", () => resolve());
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
              const proc = spawn(pipBin, pipArgs, { timeout: 120000, env: { ...process.env, PIP_USER: "0" } });
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

        } else if (node.type === "http_request") {
          // ── HTTP Request ─────────────────────────────────────────
          const config = node.config as Record<string, unknown>;
          const script = buildHttpRequestScript(config, pipelineContext);

          const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "npython-http-"));
          const scriptPath = path.join(tmpDir, "script.py");
          await fs.writeFile(scriptPath, script, "utf8");

          const venvPython = path.join(venovsDir, workflowId, "bin", "python3");
          let pythonBin = "python3";
          try { await fs.access(venvPython); pythonBin = venvPython; } catch {}

          const timeoutMs = Math.min(Number(config.timeout ?? 30) * 1000 + 5000, 300000);

          const result = await new Promise<{ success: boolean; output: string; error: string | null }>(
            (resolve) => {
              const proc = spawn(pythonBin, [scriptPath], { timeout: timeoutMs });
              runningProcesses.set(executionId, proc);
              let stdout = "";
              let stderr = "";
              proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
              proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
              proc.on("close", (code) => {
                runningProcesses.delete(executionId);
                if (code === 0) resolve({ success: true, output: stdout, error: null });
                else resolve({ success: false, output: stdout, error: stderr || `Exit code ${code}` });
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

          if (result.success) {
            // Try to store the response JSON in pipelineContext
            const outputVar = (config.outputVar as string) || "response";
            try {
              const lines = result.output.split("\n");
              // Find the first line that looks like JSON
              const jsonLine = lines.find((l) => l.trim().startsWith("{") || l.trim().startsWith("["));
              if (jsonLine) {
                // Try to parse everything from that line onward
                const jsonStart = result.output.indexOf(jsonLine);
                pipelineContext[outputVar] = JSON.parse(result.output.slice(jsonStart));
              }
            } catch { /* not JSON, that's fine */ }
          }

          if (output) await addLog(executionId, node.id, "info", output.trim());
          if (error) await addLog(executionId, node.id, "error", error.trim());

        } else if (node.type === "file_to_base64" || node.type === "base64_to_file" || node.type === "binary_to_base64" || node.type === "binary_to_file") {
          // ── File / Binary conversion nodes ───────────────────────
          const config = node.config as Record<string, unknown>;
          let script = "";

          if (node.type === "file_to_base64") {
            const filePath = (config.filePath as string) ?? "";
            const outVar = (config.outputVar as string) || "file_b64";
            script = `import base64, json, os, sys
file_path = ${JSON.stringify(filePath)}
_pipeline = ${JSON.stringify(pipelineContext)}
# Allow filePath to reference pipeline key
if file_path in _pipeline:
    file_path = str(_pipeline[file_path])
try:
    with open(file_path, "rb") as f:
        raw = f.read()
    b64 = base64.b64encode(raw).decode("utf-8")
    size = len(raw)
    mime = "application/octet-stream"
    try:
        import mimetypes
        mime = mimetypes.guess_type(file_path)[0] or mime
    except: pass
    print(f"Lido: {file_path} ({size} bytes, {mime})")
    print(json.dumps({"${outVar}": b64, "${outVar}_size": size, "${outVar}_content_type": mime}))
except FileNotFoundError:
    print(f"Arquivo não encontrado: {file_path}", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"Erro: {e}", file=sys.stderr)
    sys.exit(1)
`;
          } else if (node.type === "base64_to_file" || node.type === "binary_to_file") {
            const inVar = (config.inputVar as string) || "response";
            const outVar = (config.outputVar as string) || "saved_path";
            const filePath = (config.filePath as string) ?? "/tmp/output";
            script = `import base64, json, os, sys
_pipeline = ${JSON.stringify(pipelineContext)}
input_val = _pipeline.get(${JSON.stringify(inVar)})
file_path = ${JSON.stringify(filePath)}
try:
    if isinstance(input_val, dict) and "__binary__" in input_val:
        raw = base64.b64decode(input_val["base64"])
    elif isinstance(input_val, str):
        try:
            raw = base64.b64decode(input_val)
        except Exception:
            raw = input_val.encode("utf-8")
    elif isinstance(input_val, bytes):
        raw = input_val
    else:
        print(f"Valor inválido para decodificação: {type(input_val)}", file=sys.stderr)
        sys.exit(1)
    os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
    with open(file_path, "wb") as f:
        f.write(raw)
    print(f"Salvo: {file_path} ({len(raw)} bytes)")
    print(json.dumps({"${outVar}": file_path, "${outVar}_size": len(raw)}))
except Exception as e:
    print(f"Erro: {e}", file=sys.stderr)
    sys.exit(1)
`;
          } else if (node.type === "binary_to_base64") {
            const inVar = (config.inputVar as string) || "response";
            const outVar = (config.outputVar as string) || "data_b64";
            script = `import base64, json, sys
_pipeline = ${JSON.stringify(pipelineContext)}
input_val = _pipeline.get(${JSON.stringify(inVar)})
try:
    if isinstance(input_val, dict) and "__binary__" in input_val:
        b64 = input_val["base64"]
        ct = input_val.get("content_type", "application/octet-stream")
        sz = input_val.get("size", 0)
    elif isinstance(input_val, bytes):
        b64 = base64.b64encode(input_val).decode("utf-8")
        ct = "application/octet-stream"
        sz = len(input_val)
    elif isinstance(input_val, str):
        try:
            base64.b64decode(input_val, validate=True)
            b64 = input_val
        except Exception:
            b64 = base64.b64encode(input_val.encode("utf-8")).decode("utf-8")
        ct = "text/plain"
        sz = len(b64)
    else:
        print(f"Tipo não suportado: {type(input_val)}", file=sys.stderr)
        sys.exit(1)
    print(f"Convertido para base64: {sz} bytes, {ct}")
    print(json.dumps({"${outVar}": b64, "${outVar}_content_type": ct, "${outVar}_size": sz}))
except Exception as e:
    print(f"Erro: {e}", file=sys.stderr)
    sys.exit(1)
`;
          }

          const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "npython-file-"));
          const scriptPath = path.join(tmpDir, "script.py");
          await fs.writeFile(scriptPath, script, "utf8");

          const venvPython = path.join(venovsDir, workflowId, "bin", "python3");
          let pythonBin = "python3";
          try { await fs.access(venvPython); pythonBin = venvPython; } catch {}

          const result = await new Promise<{ success: boolean; output: string; error: string | null }>(
            (resolve) => {
              const proc = spawn(pythonBin, [scriptPath], { timeout: 30000 });
              runningProcesses.set(executionId, proc);
              let stdout = "";
              let stderr = "";
              proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
              proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
              proc.on("close", (code) => {
                runningProcesses.delete(executionId);
                if (code === 0) resolve({ success: true, output: stdout, error: null });
                else resolve({ success: false, output: stdout, error: stderr || `Exit code ${code}` });
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

          if (result.success) {
            try {
              const lines = result.output.split("\n");
              const jsonLine = lines.find((l) => l.trim().startsWith("{") || l.trim().startsWith("["));
              if (jsonLine) {
                const parsed = JSON.parse(result.output.slice(result.output.indexOf(jsonLine)));
                Object.assign(pipelineContext, parsed);
              }
            } catch { /* not JSON */ }
          }

          if (output) await addLog(executionId, node.id, "info", output.trim());
          if (error) await addLog(executionId, node.id, "error", error.trim());

        } else if (/^(pg|mysql|mssql|oracle|supabase)_(select|insert|update|delete|upsert)$/.test(node.type as string)) {
          // ── Database Node ─────────────────────────────────────────
          const dbMatch = (node.type as string).match(/^(pg|mysql|mssql|oracle|supabase)_(select|insert|update|delete|upsert)$/)!;
          const dbType = dbMatch[1];
          const dbOp = dbMatch[2];
          const config = node.config as Record<string, unknown>;
          const script = buildDbScript(dbType, dbOp, config, pipelineContext, workflowContext);

          const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "npython-db-"));
          const scriptPath = path.join(tmpDir, "db.py");
          await fs.writeFile(scriptPath, script, "utf8");

          const venvPython = path.join(venovsDir, workflowId, "bin", "python3");
          let pythonBin = "python3";
          try { await fs.access(venvPython); pythonBin = venvPython; } catch {}

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
                if (code === 0) resolve({ success: true, output: stdout, error: null });
                else resolve({ success: false, output: stdout, error: stderr || `Exit code ${code}` });
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

          if (result.success) {
            const outputVar = (config.outputVar as string) || "result";
            try {
              const lines = result.output.split("\n");
              const jsonLine = lines.find((l) => l.trim().startsWith("{") || l.trim().startsWith("["));
              if (jsonLine) {
                const jsonStart = result.output.indexOf(jsonLine);
                pipelineContext[outputVar] = JSON.parse(result.output.slice(jsonStart));
              }
            } catch { /* not JSON */ }
          }

          if (output) await addLog(executionId, node.id, "info", output.trim());
          if (error) await addLog(executionId, node.id, "error", error.trim());

        } else if (node.type === "transform") {
          // ── Transform: code with input/output sugar + full pipeline context ──
          const config = node.config as Record<string, unknown>;
          const userCode  = (config.code as string) ?? "output = input";
          const inputVar  = (config.inputVar as string) ?? "";
          const outputVar = (config.outputVar as string) ?? "transformed";
          const inputValue = inputVar
            ? (pipelineContext[inputVar] ?? workflowContext[inputVar] ?? null)
            : { ...pipelineContext };
          const tmpDir      = await fs.mkdtemp(path.join(os.tmpdir(), "npython-tx-"));
          const pipelineFile = path.join(tmpDir, "pipeline.json");
          const workflowFile = path.join(tmpDir, "workflow.json");
          const inputFile    = path.join(tmpDir, "input.json");
          const outputFile   = path.join(tmpDir, "tx_out.json");
          const scriptPath   = path.join(tmpDir, "transform.py");
          await fs.writeFile(pipelineFile, JSON.stringify(pipelineContext), "utf8");
          await fs.writeFile(workflowFile, JSON.stringify(workflowContext), "utf8");
          await fs.writeFile(inputFile, JSON.stringify(inputValue), "utf8");
          const txCode = [
            "import json as _json",
            `with open(${JSON.stringify(pipelineFile)}) as _f: pipeline = _json.load(_f)`,
            `with open(${JSON.stringify(workflowFile)}) as _f: workflow = _json.load(_f)`,
            `with open(${JSON.stringify(inputFile)}) as _f: input = _json.load(_f)`,
            "output = None",
            userCode,
            "def _to_json_safe(v):",
            "    if isinstance(v, dict): return {str(k): _to_json_safe(u) for k, u in v.items()}",
            "    if isinstance(v, (set, frozenset)): return sorted([_to_json_safe(i) for i in v], key=str)",
            "    if isinstance(v, (list, tuple)): return [_to_json_safe(i) for i in v]",
            "    try: _json.dumps(v); return v",
            "    except Exception: return repr(v)",
            "try:",
            `    with open(${JSON.stringify(outputFile)}, 'w') as _f: _json.dump({'output': _to_json_safe(output), 'pipeline': _to_json_safe(pipeline), 'workflow': _to_json_safe(workflow)}, _f)`,
            "except Exception as _save_err:",
            "    import sys as _sys; print(f'[aviso] erro ao salvar contexto: {_save_err}', file=_sys.stderr)",
          ].join("\n");
          await fs.writeFile(scriptPath, txCode, "utf8");
          const venvPyTx = path.join(venovsDir, workflowId, "bin", "python3");
          let pyBinTx = "python3";
          try { await fs.access(venvPyTx); pyBinTx = venvPyTx; } catch {}
          const txResult = await new Promise<{ success: boolean; stdout: string; stderr: string }>((resolve) => {
            const proc = spawn(pyBinTx, [scriptPath], { timeout: 60000 });
            runningProcesses.set(executionId, proc);
            let out = ""; let err = "";
            proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
            proc.stderr.on("data", (d: Buffer) => { err += d.toString(); });
            proc.on("close", (code) => {
              runningProcesses.delete(executionId);
              resolve({ success: code === 0, stdout: out, stderr: err });
            });
            proc.on("error", (e) => {
              runningProcesses.delete(executionId);
              resolve({ success: false, stdout: "", stderr: e.message });
            });
          });
          try {
            const outData = JSON.parse(await fs.readFile(outputFile, "utf8")) as {
              output?: unknown; pipeline?: Record<string, unknown>; workflow?: Record<string, unknown>;
            };
            if (outData.output !== undefined) pipelineContext[outputVar] = outData.output;
            if (outData.pipeline) Object.assign(pipelineContext, outData.pipeline);
            if (outData.workflow) Object.assign(workflowContext, outData.workflow);
          } catch {}
          await fs.rm(tmpDir, { recursive: true, force: true });
          success = txResult.success;
          output = txResult.stdout.trim() || `[transform] → "${outputVar}"`;
          error  = txResult.stderr.trim() || null;
          if (output) await addLog(executionId, node.id, "info", output);
          if (error)  await addLog(executionId, node.id, "error", error);

        } else if (node.type === "call_subflow") {
          // ── Call sub-flow: run another workflow inline ─────────────
          const config = node.config as Record<string, unknown>;
          const subWorkflowId = (config.workflowId as string)?.trim() ?? "";
          const inputParams = ((config.inputParams as { key: string; value: string }[]) ?? []).filter((p) => p.key?.trim());
          const outputVar = (config.outputVar as string)?.trim() ?? "";

          if (!subWorkflowId) {
            success = false;
            error = "Nenhum sub-workflow selecionado no nodo Call Sub-flow";
            await addLog(executionId, node.id, "error", error);
          } else {
            const subNodes = await db.select().from(nodesTable).where(eq(nodesTable.workflowId, subWorkflowId));
            const subEdges = await db.select().from(edgesTable).where(eq(edgesTable.workflowId, subWorkflowId));

            // Build initial pipeline: copy current + inject inputParams
            const subInitPipeline: Record<string, unknown> = { ...pipelineContext };
            for (const param of inputParams) {
              try { subInitPipeline[param.key] = JSON.parse(param.value); }
              catch { subInitPipeline[param.key] = pipelineContext[param.value] ?? param.value; }
            }

            await addLog(executionId, node.id, "info",
              `Chamando sub-flow "${subWorkflowId}" com ${inputParams.length} parâmetro(s)${outputVar ? ` → "${outputVar}"` : ""}`);

            const subResult = await runSubWorkflowInline({
              workflowId: subWorkflowId,
              nodes: subNodes,
              edges: subEdges,
              initialPipeline: subInitPipeline,
              initialWorkflow: { ...workflowContext },
              parentExecutionId: executionId,
              parentNodeLabel: node.label,
              venovsDir,
              depth: 0,
            });

            if (subResult.success) {
              if (outputVar) {
                pipelineContext[outputVar] = subResult.finalPipeline;
              } else {
                Object.assign(pipelineContext, subResult.finalPipeline);
              }
              success = true;
              output = `Sub-flow concluído → ${outputVar ? `salvo em pipeline["${outputVar}"]` : "mesclado no pipeline"}`;
              await addLog(executionId, node.id, "info", output);
            } else {
              success = false;
              error = subResult.error ?? "Sub-flow falhou";
              await addLog(executionId, node.id, "error", error);
            }
          }

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

      // ── Universal nodeOutputVar: capture pipeline diff at named key ──
      const universalOutputVar = (nodeConfig.nodeOutputVar as string | undefined)?.trim();
      const outputType = ((nodeConfig.outputType as string | undefined) ?? "auto").trim();
      if (universalOutputVar && success) {
        const beforePipeline = inputSnapshot.pipeline as Record<string, unknown>;
        const changedEntries: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(pipelineContext)) {
          if (k === universalOutputVar) continue;
          const prevVal = beforePipeline[k];
          if (!(k in beforePipeline) || JSON.stringify(prevVal) !== JSON.stringify(v)) {
            changedEntries[k] = v;
          }
        }
        let capturedValue: unknown;
        if (Object.keys(changedEntries).length === 1) {
          capturedValue = Object.values(changedEntries)[0];
        } else if (Object.keys(changedEntries).length > 1) {
          capturedValue = changedEntries;
        }
        if (capturedValue !== undefined) {
          pipelineContext[universalOutputVar] = outputType !== "auto"
            ? castOutputType(capturedValue, outputType)
            : capturedValue;
        }
      }

      // ── outputType cast on explicit pipeline key (no universalOutputVar) ──
      if (!universalOutputVar && outputType !== "auto" && success) {
        // Cast all pipeline keys that changed (best-effort for non-code nodes)
        const beforePipeline = inputSnapshot.pipeline as Record<string, unknown>;
        for (const [k, v] of Object.entries(pipelineContext)) {
          const prevVal = beforePipeline[k];
          if (!(k in beforePipeline) || JSON.stringify(prevVal) !== JSON.stringify(v)) {
            pipelineContext[k] = castOutputType(v, outputType);
          }
        }
      }

      const nodeEnd = Date.now();
      nodeResults[node.id].status = success ? "success" : "failed";
      nodeResults[node.id].finishedAt = new Date().toISOString();
      nodeResults[node.id].durationMs = nodeEnd - nodeStart;
      nodeResults[node.id].output = output || null;
      nodeResults[node.id].error = error;
      nodeResults[node.id].inputSnapshot = inputSnapshot;
      nodeResults[node.id].outputSnapshot = JSON.parse(JSON.stringify({
        pipeline: pipelineContext,
        workflow: workflowContext,
      }));
      nodeResults[node.id].nodeConfig = node.config;

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
