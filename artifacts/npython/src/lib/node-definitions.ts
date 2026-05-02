export type NodeCategory = "trigger" | "logic" | "variables" | "data" | "integration" | "utility";

export interface NodeDef {
  type: string;
  label: string;
  description: string;
  category: NodeCategory;
  iconName: string;
  color: string;
  defaultConfig: Record<string, unknown>;
  hasInput: boolean;
  hasOutput: boolean;
}

export const NODE_CATEGORY_META: Record<NodeCategory, { label: string; color: string; bg: string }> = {
  trigger:   { label: "Trigger",   color: "#14b8a6", bg: "rgba(20,184,166,0.12)" },
  logic:     { label: "Logic",     color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  variables: { label: "Variables", color: "#34d399", bg: "rgba(52,211,153,0.12)"  },
  data:      { label: "Data",      color: "#fbbf24", bg: "rgba(251,191,36,0.12)"  },
  integration:{ label: "Integration", color: "#60a5fa", bg: "rgba(96,165,250,0.12)" },
  utility:   { label: "Utility",   color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
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

  // ── Data ──────────────────────────────────────────────────────
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
    defaultConfig: { method: "GET", url: "", headers: {}, body: "" },
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

  // ── Utility ───────────────────────────────────────────────────
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
