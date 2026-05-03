import { Router } from "express";
import { spawn } from "child_process";
import path from "path";
import os from "os";
import fs from "fs/promises";

const router = Router();

function buildColumnsScript(body: {
  dbType: string;
  connectionString?: string;
  host?: string;
  port?: number;
  dbName?: string;
  user?: string;
  password?: string;
  table: string;
  supabaseUrl?: string;
  supabaseKey?: string;
}): string {
  const { dbType, table } = body;
  const cs = (body.connectionString || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const host = (body.host || "localhost").replace(/"/g, '\\"');
  const port = body.port || 5432;
  const dbName = (body.dbName || "").replace(/"/g, '\\"');
  const user = (body.user || "").replace(/"/g, '\\"');
  const pass = (body.password || "").replace(/"/g, '\\"');
  const tbl = table.replace(/'/g, "\\'");

  if (dbType === "pg" || dbType === "supabase_pg") {
    const connExpr = cs
      ? `"${cs}"`
      : `host="${host}", port=${port}, dbname="${dbName}", user="${user}", password="${pass}"`;
    return `import psycopg2, json, sys
try:
    conn = psycopg2.connect(${connExpr})
    cur = conn.cursor()
    cur.execute("""SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=%s ORDER BY ordinal_position""", ['${tbl}'])
    cols = [{"name": r[0], "type": r[1]} for r in cur.fetchall()]
    conn.close()
    print(json.dumps(cols))
except ImportError:
    print("psycopg2 nao instalado", file=sys.stderr); sys.exit(1)
except Exception as e:
    print(str(e), file=sys.stderr); sys.exit(1)
`;
  }

  if (dbType === "mysql") {
    const connExpr = cs
      ? `"${cs}"`
      : `host="${host}", port=${port}, db="${dbName}", user="${user}", password="${pass}"`;
    return `import pymysql, json, sys
try:
    conn = pymysql.connect(${connExpr})
    cur = conn.cursor()
    cur.execute("""SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s ORDER BY ORDINAL_POSITION""", ['${dbName}', '${tbl}'])
    cols = [{"name": r[0], "type": r[1]} for r in cur.fetchall()]
    conn.close()
    print(json.dumps(cols))
except ImportError:
    print("pymysql nao instalado", file=sys.stderr); sys.exit(1)
except Exception as e:
    print(str(e), file=sys.stderr); sys.exit(1)
`;
  }

  if (dbType === "mssql") {
    const connStr = cs || `DRIVER={ODBC Driver 17 for SQL Server};SERVER=${host},${port};DATABASE=${dbName};UID=${user};PWD=${pass}`;
    return `import pyodbc, json, sys
try:
    conn = pyodbc.connect("${connStr.replace(/"/g, '\\"')}")
    cur = conn.cursor()
    cur.execute("""SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=? ORDER BY ORDINAL_POSITION""", '${tbl}')
    cols = [{"name": r[0], "type": r[1]} for r in cur.fetchall()]
    conn.close()
    print(json.dumps(cols))
except ImportError:
    print("pyodbc nao instalado. Instale 'pyodbc' e configure o driver ODBC.", file=sys.stderr); sys.exit(1)
except Exception as e:
    print(str(e), file=sys.stderr); sys.exit(1)
`;
  }

  if (dbType === "oracle") {
    const connExpr = cs
      ? `"${cs}"`
      : `user="${user}", password="${pass}", dsn="${host}:${port}/${dbName}"`;
    return `import oracledb, json, sys
try:
    conn = oracledb.connect(${connExpr})
    cur = conn.cursor()
    cur.execute("""SELECT COLUMN_NAME, DATA_TYPE FROM USER_TAB_COLUMNS WHERE TABLE_NAME=UPPER(:1) ORDER BY COLUMN_ID""", ['${tbl}'])
    cols = [{"name": r[0], "type": r[1]} for r in cur.fetchall()]
    conn.close()
    print(json.dumps(cols))
except ImportError:
    print("oracledb nao instalado. Instale 'oracledb'.", file=sys.stderr); sys.exit(1)
except Exception as e:
    print(str(e), file=sys.stderr); sys.exit(1)
`;
  }

  if (dbType === "supabase") {
    const url = (body.supabaseUrl || "").replace(/"/g, '\\"');
    const key = (body.supabaseKey || "").replace(/"/g, '\\"');
    return `import requests, json, sys
try:
    headers = {"apikey": "${key}", "Authorization": f"Bearer ${key}", "Accept": "application/json"}
    resp = requests.get(f"${url}/rest/v1/${tbl}", headers=headers, params={"limit": "1"})
    resp.raise_for_status()
    rows = resp.json()
    if rows:
        cols = [{"name": k, "type": "text"} for k in rows[0].keys()]
    else:
        cols = []
    print(json.dumps(cols))
except Exception as e:
    print(str(e), file=sys.stderr); sys.exit(1)
`;
  }

  return `import sys; print("[]")`;
}

router.post("/db/columns", async (req, res) => {
  const { dbType, table } = req.body as { dbType: string; table: string };
  if (!dbType || !table) {
    return res.status(400).json({ error: "dbType e table são obrigatórios" });
  }

  const script = buildColumnsScript(req.body);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "npython-db-"));
  const scriptPath = path.join(tmpDir, "columns.py");
  await fs.writeFile(scriptPath, script);

  const result = await new Promise<{ ok: boolean; out: string; err: string }>((resolve) => {
    const proc = spawn("python3", [scriptPath]);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.stderr.on("data", (d) => { err += d.toString(); });
    proc.on("close", (code) => resolve({ ok: code === 0, out, err }));
    proc.on("error", (e) => resolve({ ok: false, out: "", err: e.message }));
    setTimeout(() => { proc.kill(); resolve({ ok: false, out: "", err: "Timeout (15s)" }); }, 15000);
  });

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  if (!result.ok) {
    return res.status(400).json({ error: result.err || "Falha ao buscar colunas" });
  }

  try {
    const cols: { name: string; type: string }[] = JSON.parse(result.out);
    return res.json({ columns: cols.map((c) => c.name), columnsWithType: cols });
  } catch {
    return res.status(500).json({ error: "Falha ao parsear resultado: " + result.out.slice(0, 200) });
  }
});

export default router;
