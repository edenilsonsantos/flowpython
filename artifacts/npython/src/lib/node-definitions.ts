export type NodeCategory = "trigger" | "logic" | "transform" | "variables" | "data" | "integration" | "utility" | "database";

export interface NodeDef {
  type: string;
  label: string;
  description: string;
  category: NodeCategory;
  subCategory?: string;
  iconName: string;
  color: string;
  defaultConfig: Record<string, unknown>;
  hasInput: boolean;
  hasOutput: boolean;
}

export const NODE_CATEGORY_META: Record<NodeCategory, { label: string; color: string; bg: string }> = {
  trigger:    { label: "Trigger",       color: "#14b8a6", bg: "rgba(20,184,166,0.12)"  },
  logic:      { label: "Logic",         color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  transform:  { label: "Transform",     color: "#fb923c", bg: "rgba(251,146,60,0.12)"  },
  variables:  { label: "Variables",     color: "#34d399", bg: "rgba(52,211,153,0.12)"  },
  data:       { label: "Data",          color: "#fbbf24", bg: "rgba(251,191,36,0.12)"  },
  integration:{ label: "Integration",   color: "#60a5fa", bg: "rgba(96,165,250,0.12)"  },
  utility:    { label: "Utility",       color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
  database:   { label: "Banco de Dados",color: "#10b981", bg: "rgba(16,185,129,0.12)"  },
};

export const NODE_DEFINITIONS: NodeDef[] = [
  // ── Trigger ──────────────────────────────────────────────────
  {
    type: "trigger_manual",
    label: "Manual Start",
    description: "Inicia o workflow manualmente",
    category: "trigger",
    iconName: "Play",
    color: "#14b8a6",
    defaultConfig: {},
    hasInput: false,
    hasOutput: true,
  },
  {
    type: "trigger_webhook",
    label: "Webhook",
    description: "Dispara via requisição HTTP",
    category: "trigger",
    iconName: "Webhook",
    color: "#14b8a6",
    defaultConfig: { method: "POST", path: "/webhook" },
    hasInput: false,
    hasOutput: true,
  },
  {
    type: "trigger_schedule",
    label: "Schedule",
    description: "Executa em intervalo cron",
    category: "trigger",
    iconName: "Clock",
    color: "#14b8a6",
    defaultConfig: { cron: "0 9 * * *" },
    hasInput: false,
    hasOutput: true,
  },
  {
    type: "trigger_subflow",
    label: "Sub-flow",
    description: "Chamado por outro workflow",
    category: "trigger",
    iconName: "GitBranch",
    color: "#14b8a6",
    defaultConfig: {},
    hasInput: false,
    hasOutput: true,
  },

  // ── Logic ─────────────────────────────────────────────────────
  {
    type: "switch",
    label: "Switch",
    description: "Ramifica por múltiplas condições Python",
    category: "logic",
    iconName: "ToggleRight",
    color: "#e879f9",
    defaultConfig: {
      inputVar: "",
      conditions: [{ expression: "value > 0", label: "positivo" }],
      fallback: "default",
    },
    hasInput: true,
    hasOutput: true,
  },
  {
    type: "merge_lists",
    label: "Merge",
    description: "Combina listas do pipeline em uma só",
    category: "logic",
    iconName: "GitMerge",
    color: "#a78bfa",
    defaultConfig: {
      vars: [],
      outputVar: "merged",
      mode: "append",
    },
    hasInput: true,
    hasOutput: true,
  },
  {
    type: "code",
    label: "Python Code",
    description: "Executa código Python",
    category: "logic",
    iconName: "Code2",
    color: "#a78bfa",
    defaultConfig: { code: "# Seu código Python aqui\nprint('Hello, flowpython!')" },
    hasInput: true,
    hasOutput: true,
  },
  {
    type: "condition",
    label: "Condition",
    description: "Ramifica por condição Python",
    category: "logic",
    iconName: "GitFork",
    color: "#a78bfa",
    defaultConfig: { expression: "True" },
    hasInput: true,
    hasOutput: true,
  },
  {
    type: "loop",
    label: "Loop",
    description: "Itera sobre uma lista",
    category: "logic",
    iconName: "RefreshCw",
    color: "#a78bfa",
    defaultConfig: { itemsExpression: "[]" },
    hasInput: true,
    hasOutput: true,
  },

  // ── Variables ─────────────────────────────────────────────────
  {
    type: "variable",
    label: "Variable",
    description: "Lê ou define uma variável com escopo",
    category: "variables",
    iconName: "Braces",
    color: "#34d399",
    defaultConfig: {
      operation: "get",
      key: "",
      value: "",
      scope: "workflow",
    },
    hasInput: true,
    hasOutput: true,
  },
  {
    type: "variable_inject",
    label: "Inject Variables",
    description: "Injeta variáveis no código Python",
    category: "variables",
    iconName: "Syringe",
    color: "#34d399",
    defaultConfig: {
      scope: "workflow",
      keys: [],
    },
    hasInput: true,
    hasOutput: true,
  },

  // ── Transform ─────────────────────────────────────────────────
  {
    type: "filter_list",
    label: "Filter",
    description: "Filtra itens de uma lista por expressão Python",
    category: "transform",
    iconName: "ListFilter",
    color: "#fb923c",
    defaultConfig: { inputVar: "items", outputVar: "filtered", expression: "item['active'] == True" },
    hasInput: true,
    hasOutput: true,
  },
  {
    type: "batch_split",
    label: "Split in Batches",
    description: "Divide lista em lotes de N itens",
    category: "transform",
    iconName: "Layers",
    color: "#fb923c",
    defaultConfig: { inputVar: "items", outputVar: "batches", batchSize: 10 },
    hasInput: true,
    hasOutput: true,
  },
  {
    type: "aggregate",
    label: "Aggregate",
    description: "Reduz lista a um valor: count, sum, avg, min, max, join",
    category: "transform",
    iconName: "Sigma",
    color: "#fb923c",
    defaultConfig: { inputVar: "items", outputVar: "result", operation: "count", field: "", separator: ", " },
    hasInput: true,
    hasOutput: true,
  },
  {
    type: "split_out",
    label: "Split Out",
    description: "Explode campo-lista em itens individuais",
    category: "transform",
    iconName: "Scissors",
    color: "#fb923c",
    defaultConfig: { inputVar: "data", field: "items", outputVar: "split", keepParent: false },
    hasInput: true,
    hasOutput: true,
  },
  {
    type: "sort_list",
    label: "Sort",
    description: "Ordena lista por campo",
    category: "transform",
    iconName: "ArrowUpDown",
    color: "#fb923c",
    defaultConfig: { inputVar: "items", outputVar: "sorted", key: "", order: "asc" },
    hasInput: true,
    hasOutput: true,
  },
  {
    type: "remove_duplicates",
    label: "Remove Duplicates",
    description: "Remove itens duplicados por chave",
    category: "transform",
    iconName: "FilterX",
    color: "#fb923c",
    defaultConfig: { inputVar: "items", outputVar: "unique", key: "id" },
    hasInput: true,
    hasOutput: true,
  },
  {
    type: "limit",
    label: "Limit",
    description: "Limita quantidade de itens da lista",
    category: "transform",
    iconName: "Hash",
    color: "#fb923c",
    defaultConfig: { inputVar: "items", outputVar: "limited", maxItems: 10, keep: "first" },
    hasInput: true,
    hasOutput: true,
  },

  // ── Data (legado) ──────────────────────────────────────────────
  {
    type: "set_variable",
    label: "Set Variable",
    description: "Define uma variável (legado)",
    category: "data",
    iconName: "Variable",
    color: "#fbbf24",
    defaultConfig: { key: "", value: "" },
    hasInput: true,
    hasOutput: true,
  },
  {
    type: "get_variable",
    label: "Get Variable",
    description: "Lê uma variável (legado)",
    category: "data",
    iconName: "Database",
    color: "#fbbf24",
    defaultConfig: { key: "" },
    hasInput: true,
    hasOutput: true,
  },
  {
    type: "transform",
    label: "Transform",
    description: "Transforma dados com Python",
    category: "data",
    iconName: "Shuffle",
    color: "#fbbf24",
    defaultConfig: { code: "output = input" },
    hasInput: true,
    hasOutput: true,
  },

  // ── Integration ───────────────────────────────────────────────
  {
    type: "http_request",
    label: "HTTP Request",
    description: "Chama uma API HTTP externa",
    category: "integration",
    iconName: "Globe",
    color: "#60a5fa",
    defaultConfig: {
      method: "GET",
      url: "",
      params: [],
      headers: [],
      bodyType: "none",
      bodyJson: "",
      bodyForm: [],
      bodyRaw: "",
      bodyRawContentType: "text/plain",
      authType: "none",
      authBearer: "",
      authUsername: "",
      authPassword: "",
      authApiKeyName: "X-API-Key",
      authApiKeyValue: "",
      authApiKeyIn: "header",
      sslVerify: true,
      timeout: 30,
      followRedirects: true,
      outputVar: "response",
    },
    hasInput: true,
    hasOutput: true,
  },
  {
    type: "wait",
    label: "Wait",
    description: "Pausa a execução",
    category: "integration",
    iconName: "Timer",
    color: "#60a5fa",
    defaultConfig: { seconds: 5 },
    hasInput: true,
    hasOutput: true,
  },

  // ── Database ──────────────────────────────────────────────────
  // helpers (IIFE to keep scope clean)
  ...((() => {
    const common = (port: number) => ({
      useConnectionString: false,
      connectionString: "",
      host: "localhost",
      port,
      dbName: "",
      user: "",
      password: "",
      table: "",
      outputVar: "result",
    });
    const selectCfg = { selectColumns: "*", whereClause: "", orderBy: "", limit: 100 };
    const insertCfg = { fields: [] as { column: string; value: string; enabled: boolean }[] };
    const updateCfg = { fields: [] as { column: string; value: string; enabled: boolean }[], whereColumn: "", whereValue: "" };
    const deleteCfg = { whereColumn: "", whereValue: "" };
    const upsertCfg = { checkColumn: "", checkValue: "", insertFields: [] as { column: string; value: string; enabled: boolean }[], updateFields: [] as { column: string; value: string; enabled: boolean }[] };

    const supBase = {
      supabaseUrl: "",
      supabaseKey: "",
      table: "",
      outputVar: "result",
    };

    const mk = (type: string, label: string, desc: string, sub: string, color: string, icon: string, cfg: Record<string, unknown>): NodeDef => ({
      type, label, description: desc, category: "database", subCategory: sub,
      iconName: icon, color, defaultConfig: cfg, hasInput: true, hasOutput: true,
    });

    const PG = "#336791", MY = "#00758F", MS = "#CC2927", OR = "#C74634", SB = "#3ECF8E";
    return [
      // PostgreSQL
      mk("pg_select",  "Select",          "Consulta registros no PostgreSQL",       "PostgreSQL",  PG, "Search",    { ...common(5432), ...selectCfg }),
      mk("pg_insert",  "Insert",          "Insere registro no PostgreSQL",           "PostgreSQL",  PG, "Plus",      { ...common(5432), ...insertCfg }),
      mk("pg_update",  "Update",          "Atualiza registro no PostgreSQL",         "PostgreSQL",  PG, "PenLine",   { ...common(5432), ...updateCfg }),
      mk("pg_delete",  "Delete",          "Remove registro do PostgreSQL",           "PostgreSQL",  PG, "Trash2",    { ...common(5432), ...deleteCfg }),
      mk("pg_upsert",  "Insert or Update","Insere ou atualiza no PostgreSQL",        "PostgreSQL",  PG, "RefreshCw", { ...common(5432), ...upsertCfg }),
      // MySQL
      mk("mysql_select",  "Select",          "Consulta registros no MySQL",          "MySQL",  MY, "Search",    { ...common(3306), ...selectCfg }),
      mk("mysql_insert",  "Insert",          "Insere registro no MySQL",             "MySQL",  MY, "Plus",      { ...common(3306), ...insertCfg }),
      mk("mysql_update",  "Update",          "Atualiza registro no MySQL",           "MySQL",  MY, "PenLine",   { ...common(3306), ...updateCfg }),
      mk("mysql_delete",  "Delete",          "Remove registro do MySQL",             "MySQL",  MY, "Trash2",    { ...common(3306), ...deleteCfg }),
      mk("mysql_upsert",  "Insert or Update","Insere ou atualiza no MySQL",          "MySQL",  MY, "RefreshCw", { ...common(3306), ...upsertCfg }),
      // SQL Server
      mk("mssql_select",  "Select",          "Consulta registros no SQL Server",     "SQL Server", MS, "Search",    { ...common(1433), ...selectCfg }),
      mk("mssql_insert",  "Insert",          "Insere registro no SQL Server",        "SQL Server", MS, "Plus",      { ...common(1433), ...insertCfg }),
      mk("mssql_update",  "Update",          "Atualiza registro no SQL Server",      "SQL Server", MS, "PenLine",   { ...common(1433), ...updateCfg }),
      mk("mssql_delete",  "Delete",          "Remove registro do SQL Server",        "SQL Server", MS, "Trash2",    { ...common(1433), ...deleteCfg }),
      mk("mssql_upsert",  "Insert or Update","Insere ou atualiza no SQL Server",     "SQL Server", MS, "RefreshCw", { ...common(1433), ...upsertCfg }),
      // Oracle
      mk("oracle_select",  "Select",          "Consulta registros no Oracle",        "Oracle", OR, "Search",    { ...common(1521), ...selectCfg }),
      mk("oracle_insert",  "Insert",          "Insere registro no Oracle",           "Oracle", OR, "Plus",      { ...common(1521), ...insertCfg }),
      mk("oracle_update",  "Update",          "Atualiza registro no Oracle",         "Oracle", OR, "PenLine",   { ...common(1521), ...updateCfg }),
      mk("oracle_delete",  "Delete",          "Remove registro do Oracle",           "Oracle", OR, "Trash2",    { ...common(1521), ...deleteCfg }),
      mk("oracle_upsert",  "Insert or Update","Insere ou atualiza no Oracle",        "Oracle", OR, "RefreshCw", { ...common(1521), ...upsertCfg }),
      // Supabase
      mk("supabase_select",  "Select",          "Consulta registros no Supabase",    "Supabase", SB, "Search",    { ...supBase, ...selectCfg }),
      mk("supabase_insert",  "Insert",          "Insere registro no Supabase",       "Supabase", SB, "Plus",      { ...supBase, ...insertCfg }),
      mk("supabase_update",  "Update",          "Atualiza registro no Supabase",     "Supabase", SB, "PenLine",   { ...supBase, ...updateCfg }),
      mk("supabase_delete",  "Delete",          "Remove registro do Supabase",       "Supabase", SB, "Trash2",    { ...supBase, ...deleteCfg }),
      mk("supabase_upsert",  "Insert or Update","Insere ou atualiza no Supabase",    "Supabase", SB, "RefreshCw", { ...supBase, ...upsertCfg }),
    ];
  })()),

  // ── Utility ───────────────────────────────────────────────────
  {
    type: "pip_install",
    label: "Pip Packages",
    description: "Instala ou remove bibliotecas Python",
    category: "utility",
    iconName: "Package",
    color: "#f472b6",
    defaultConfig: {
      action: "install",
      mode: "single",
      packageName: "",
      packageVersion: "",
      packages: [],
      requirementsTxt: "",
    },
    hasInput: true,
    hasOutput: true,
  },
  {
    type: "note",
    label: "Note",
    description: "Comentário no canvas",
    category: "utility",
    iconName: "StickyNote",
    color: "#94a3b8",
    defaultConfig: { text: "Nota..." },
    hasInput: false,
    hasOutput: false,
  },
];

export function getNodeDef(type: string): NodeDef | undefined {
  return NODE_DEFINITIONS.find((n) => n.type === type);
}

export function isTriggerType(type: string): boolean {
  return type.startsWith("trigger_");
}

export function isDatabaseNodeType(type: string): boolean {
  return /^(pg|mysql|mssql|oracle|supabase)_(select|insert|update|delete|upsert)$/.test(type);
}

export function parseDbNodeType(type: string): { dbType: string; operation: string } | null {
  const m = type.match(/^(pg|mysql|mssql|oracle|supabase)_(select|insert|update|delete|upsert)$/);
  return m ? { dbType: m[1], operation: m[2] } : null;
}

export const DB_META: Record<string, { label: string; color: string; defaultPort: number; lib: string; installPkg: string }> = {
  pg:       { label: "PostgreSQL", color: "#336791", defaultPort: 5432, lib: "psycopg2",  installPkg: "psycopg2-binary" },
  mysql:    { label: "MySQL",      color: "#00758F", defaultPort: 3306, lib: "pymysql",   installPkg: "pymysql" },
  mssql:    { label: "SQL Server", color: "#CC2927", defaultPort: 1433, lib: "pyodbc",    installPkg: "pyodbc" },
  oracle:   { label: "Oracle",     color: "#C74634", defaultPort: 1521, lib: "oracledb",  installPkg: "oracledb" },
  supabase: { label: "Supabase",   color: "#3ECF8E", defaultPort: 0,    lib: "requests",  installPkg: "requests" },
};

export const DB_OP_META: Record<string, { label: string; color: string }> = {
  select: { label: "Select",          color: "#60a5fa" },
  insert: { label: "Insert",          color: "#34d399" },
  update: { label: "Update",          color: "#f59e0b" },
  delete: { label: "Delete",          color: "#ef4444" },
  upsert: { label: "Insert or Update",color: "#a78bfa" },
};

export const VARIABLE_SCOPES = [
  {
    value: "global",
    label: "Global",
    color: "#f59e0b",
    description: "Persistida no banco — compartilhada entre todos os workflows e execuções",
  },
  {
    value: "workflow",
    label: "Workflow",
    color: "#60a5fa",
    description: "Vive durante toda a execução do workflow — acessível por qualquer nodo",
  },
  {
    value: "node",
    label: "Node",
    color: "#34d399",
    description: "Flui pelo pipeline — disponível apenas nos nodos downstream do ponto de definição",
  },
] as const;

export type VariableScope = "global" | "workflow" | "node";
