import { useState, useCallback, useEffect, useRef, useMemo, createContext, useContext } from "react";
import { Node as ReactFlowNode, Edge as ReactFlowEdge } from "reactflow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Trash2, Plus, Package, Eye, EyeOff, ShieldOff, Shield, Database,
  ChevronDown, ChevronRight, Network, Copy, Zap, Download, PackageCheck,
  Bot, Wand2, Sparkles, MoveRight, Share2, Loader2, FlaskConical, Pin, PinOff,
  CheckCircle2, XCircle, X,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { autocompletion } from "@codemirror/autocomplete";
import { isTriggerType, isDatabaseNodeType, parseDbNodeType, DB_META, DB_OP_META, VARIABLE_SCOPES } from "@/lib/node-definitions";
import { pythonLibraryCompletionSource } from "@/lib/python-completions";
import { copilotExtension } from "@/lib/copilot-extension";
import { useListVariables, useListWorkflows } from "@workspace/api-client-react";

// ─── Variable Color System ────────────────────────────────────────────────────

const NODE_PALETTE = [
  "#14b8a6",
  "#f97316",
  "#06b6d4",
  "#f43f5e",
  "#84cc16",
  "#eab308",
  "#8b5cf6",
  "#10b981",
  "#3b82f6",
  "#ec4899",
];
export function nodeColorFromId(nodeId: string): string {
  let h = 0;
  for (let i = 0; i < nodeId.length; i++) h = (h * 31 + nodeId.charCodeAt(i)) & 0xffff;
  return NODE_PALETTE[h % NODE_PALETTE.length];
}

export type VarColorInfo = { color: string; nodeLabel: string; nodeId: string };
export const VarColorCtx = createContext<Record<string, VarColorInfo>>({});

// Extension that makes CodeMirror editors accept variable chip drops
const varDropExtension = EditorView.domEventHandlers({
  dragover(event) {
    if (event.dataTransfer?.types.includes("application/flowpython-var")) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }
  },
  drop(event, view) {
    const ref = event.dataTransfer?.getData("application/flowpython-var");
    if (ref) {
      event.preventDefault();
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.doc.length;
      view.dispatch({
        changes: { from: pos, insert: ref },
        selection: { anchor: pos + ref.length },
      });
    }
  },
});

// Parse a string into text segments and pipeline variable references
type VarSegment = { isVar: true; varName: string } | { isVar: false; text: string };
function parseVarRefs(value: string): VarSegment[] {
  const pattern = /pipeline\["([^"]+)"\]/g;
  const segments: VarSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) segments.push({ isVar: false, text: value.slice(lastIndex, match.index) });
    segments.push({ isVar: true, varName: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) segments.push({ isVar: false, text: value.slice(lastIndex) });
  return segments;
}

// Input field that renders pipeline["x"] variable references as colored visual chips when blurred
export function VarTokenInput({
  value, onChange, placeholder, style,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; style?: React.CSSProperties;
}) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const segments = useMemo(() => parseVarRefs(value ?? ""), [value]);
  const showTokenView = !focused && segments.some((s) => s.isVar);
  const varColorMap = useContext(VarColorCtx);

  const handleDrop = (e: React.DragEvent) => {
    const ref = e.dataTransfer.getData("application/flowpython-var");
    if (!ref) return;
    e.preventDefault();
    const el = inputRef.current;
    if (el && focused) {
      const start = el.selectionStart ?? (value ?? "").length;
      const end = el.selectionEnd ?? start;
      const newVal = (value ?? "").slice(0, start) + ref + (value ?? "").slice(end);
      onChange(newVal);
      requestAnimationFrame(() => el.setSelectionRange(start + ref.length, start + ref.length));
    } else {
      onChange((value ?? "") + ref);
    }
  };

  const borderStyle = focused
    ? "1px solid hsl(var(--ring))"
    : "1px solid hsl(var(--border))";

  return (
    <div
      style={{ position: "relative", ...style }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("application/flowpython-var")) e.preventDefault(); }}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setTimeout(() => setFocused(false), 80); }}
        placeholder={showTokenView ? "" : placeholder}
        style={{
          display: showTokenView ? "none" : "block",
          width: "100%", height: 36, padding: "0 10px",
          background: "hsl(var(--background))",
          border: borderStyle,
          borderRadius: 6, color: "hsl(var(--foreground))",
          fontSize: 12, fontFamily: "monospace", outline: "none",
          boxSizing: "border-box",
        }}
      />
      {showTokenView && (
        <div
          onClick={() => { setFocused(true); requestAnimationFrame(() => inputRef.current?.focus()); }}
          title="Clique para editar"
          style={{
            minHeight: 36, padding: "5px 10px",
            background: "hsl(var(--background))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 6,
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 3,
            cursor: "text",
          }}
        >
          {segments.map((seg, i) => {
            if (!seg.isVar) {
              return seg.text
                ? <span key={i} style={{ fontSize: 12, fontFamily: "monospace", color: "hsl(var(--foreground))" }}>{seg.text}</span>
                : null;
            }
            const meta = varColorMap[seg.varName];
            const chipColor = meta?.color ?? "#a78bfa";
            const chipLabel = meta?.nodeLabel;
            const truncChipLabel = chipLabel && chipLabel.length > 14 ? chipLabel.slice(0, 13) + "…" : chipLabel;
            return (
              <span key={i} style={{
                display: "inline-flex", flexDirection: "column", gap: 0,
                padding: "2px 8px 2px 6px", borderRadius: 4,
                background: `${chipColor}12`, border: `1px solid ${chipColor}40`,
                borderLeft: `3px solid ${chipColor}`,
                fontFamily: "monospace",
              }}>
                {truncChipLabel && (
                  <span style={{ fontSize: 8, fontWeight: 700, color: chipColor, textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1, opacity: 0.85 }}>
                    {truncChipLabel}
                  </span>
                )}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color: chipColor }}>
                  <Network size={9} /> {seg.varName}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function insertVarRef(ref: string, toast: ReturnType<typeof useToast>["toast"]) {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA") && !el.readOnly) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const newVal = el.value.slice(0, start) + ref + el.value.slice(end);
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) {
      setter.call(el, newVal);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.setSelectionRange(start + ref.length, start + ref.length);
      return;
    }
  }
  navigator.clipboard?.writeText(ref).catch(() => {});
  toast({ title: "Variável copiada!", description: ref, duration: 2000 });
}

function getVarMeta(value: unknown): { type: string; color: string; preview: string } {
  if (value === null || value === undefined) return { type: "null", color: "#94a3b8", preview: "null" };
  if (Array.isArray(value)) return { type: "lista", color: "#f59e0b", preview: `[${value.length} item(s)]` };
  const t = typeof value;
  if (t === "boolean") return { type: "bool", color: "#f472b6", preview: String(value) };
  if (t === "number") return { type: "num", color: "#60a5fa", preview: String(value) };
  if (t === "object") return {
    type: "dict", color: "#a78bfa",
    preview: `{${Object.keys(value as object).length} chave(s)}`,
  };
  const s = String(value);
  return { type: "str", color: "#34d399", preview: s.length > 38 ? s.slice(0, 38) + "…" : s };
}

function VarChip({
  varName, value, onInsert, nodeColor, nodeLabel,
}: {
  varName: string; value: unknown; onInsert: (ref: string) => void;
  nodeColor?: string; nodeLabel?: string;
}) {
  const ref = `pipeline["${varName}"]`;
  const { type, color: typeColor, preview } = getVarMeta(value);
  const accent = nodeColor ?? typeColor;
  const truncLabel = nodeLabel && nodeLabel.length > 16 ? nodeLabel.slice(0, 15) + "…" : nodeLabel;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/flowpython-var", ref);
        e.dataTransfer.setData("text/plain", ref);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onInsert(ref)}
      title={`${ref}${nodeLabel ? `  ←  ${nodeLabel}` : ""}`}
      style={{
        display: "inline-flex", flexDirection: "column", gap: 1,
        padding: "3px 8px 3px 6px", borderRadius: 6, marginBottom: 4, marginRight: 4,
        border: `1px solid ${accent}40`, background: `${accent}10`,
        borderLeft: `3px solid ${accent}`,
        cursor: "grab", userSelect: "none", maxWidth: "100%",
        transition: "background 0.12s",
      }}
    >
      {truncLabel && (
        <span style={{
          fontSize: 8, fontWeight: 700, color: accent, textTransform: "uppercase",
          letterSpacing: "0.06em", lineHeight: 1, opacity: 0.85,
        }}>
          {truncLabel}
        </span>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, color: accent, flexShrink: 0 }}>{varName}</span>
        <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3, background: `${typeColor}25`, color: typeColor, fontWeight: 700, flexShrink: 0 }}>{type}</span>
        <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 88 }}>{preview}</span>
      </div>
    </div>
  );
}

function JsonVarRow({ name, value }: { name: string; value: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const { type, color, preview } = getVarMeta(value);
  const isExpandable = typeof value === "object" && value !== null;
  return (
    <div style={{ marginBottom: 6 }}>
      <div
        style={{ display: "flex", alignItems: "baseline", gap: 6, cursor: isExpandable ? "pointer" : "default" }}
        onClick={() => isExpandable && setExpanded((e) => !e)}
      >
        <span style={{ width: 10, flexShrink: 0, color: "hsl(var(--muted-foreground))", fontSize: 10 }}>
          {isExpandable ? (expanded ? "▼" : "▶") : ""}
        </span>
        <span style={{ fontFamily: "monospace", fontSize: 11, color, fontWeight: 600 }}>{name}</span>
        <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", padding: "1px 3px", background: `${color}15`, borderRadius: 3 }}>{type}</span>
        {!expanded && (
          <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontFamily: "monospace", wordBreak: "break-all", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {preview}
          </span>
        )}
      </div>
      {expanded && isExpandable && (
        <pre style={{
          fontSize: 10, color: "hsl(var(--muted-foreground))", fontFamily: "monospace",
          whiteSpace: "pre-wrap", wordBreak: "break-all", margin: "4px 0 0 16px",
          maxHeight: 220, overflowY: "auto",
        }}>
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── Node Output Preview ──────────────────────────────────────────────────────

export type NodeOutputMap = Record<string, {
  pipeline: Record<string, unknown>; label: string; status: string; rawOutput: string | null;
}>;

export function NodeOutputPreview({
  nodeId, lastRunOutputs, onInsert,
}: {
  nodeId: string; lastRunOutputs: NodeOutputMap; onInsert: (ref: string) => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const out = lastRunOutputs[nodeId];

  if (!out) {
    return (
      <div style={{ padding: "32px 16px", textAlign: "center", color: "hsl(var(--muted-foreground))" }}>
        <Zap size={28} style={{ margin: "0 auto 10px", opacity: 0.3 }} />
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Nenhuma execução registrada</div>
        <div style={{ fontSize: 11 }}>Execute o workflow para ver a saída deste nodo.</div>
      </div>
    );
  }

  const vars = Object.entries(out.pipeline);
  const statusColor = out.status === "success" ? "#10b981" : out.status === "failed" ? "#ef4444" : "#94a3b8";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px",
          borderRadius: 12, background: `${statusColor}20`, border: `1px solid ${statusColor}44`,
          fontSize: 11, fontWeight: 600, color: statusColor,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }} />
          {out.status === "success" ? "Sucesso" : out.status === "failed" ? "Falhou" : out.status}
        </span>
        <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
          {vars.length} variável(is)
        </span>
      </div>

      {vars.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Clique ou arraste para inserir no campo focado
          </div>
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {vars.map(([k, v]) => <VarChip key={k} varName={k} value={v} onInsert={onInsert} nodeColor={nodeColorFromId(nodeId)} nodeLabel={out.label} />)}
          </div>
        </div>
      )}

      {vars.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            Valores
          </div>
          <div style={{
            background: "rgba(0,0,0,0.25)", border: "1px solid hsl(var(--border))",
            borderRadius: 8, padding: "10px 12px", maxHeight: 300, overflowY: "auto",
          }}>
            {vars.map(([k, v]) => <JsonVarRow key={k} name={k} value={v} />)}
          </div>
        </div>
      )}

      {vars.length > 1 && (
        <button
          onClick={() => {
            const allRefs = vars.map(([k]) => `pipeline["${k}"]`).join(", ");
            navigator.clipboard?.writeText(allRefs).catch(() => {});
            onInsert(allRefs);
          }}
          style={{
            display: "flex", alignItems: "center", gap: 6, fontSize: 11,
            color: "#a78bfa", background: "rgba(167,139,250,0.08)",
            border: "1px solid rgba(167,139,250,0.25)", borderRadius: 6,
            padding: "6px 12px", cursor: "pointer", width: "100%", justifyContent: "center",
          }}
        >
          <Copy size={11} /> Copiar todas as referências
        </button>
      )}

      {out.rawOutput && (
        <div>
          <button
            onClick={() => setShowRaw((r) => !r)}
            style={{
              display: "flex", alignItems: "center", gap: 5, background: "none", border: "none",
              cursor: "pointer", color: "hsl(var(--muted-foreground))", fontSize: 11, padding: 0, marginBottom: showRaw ? 6 : 0,
            }}
          >
            {showRaw ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Saída bruta (stdout)
          </button>
          {showRaw && (
            <pre style={{
              fontSize: 10, background: "rgba(0,0,0,0.35)", border: "1px solid hsl(var(--border))",
              borderRadius: 6, padding: "8px 10px", maxHeight: 200, overflowY: "auto",
              margin: 0, color: "#a3e635", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all",
            }}>
              {out.rawOutput}
            </pre>
          )}
        </div>
      )}

      {vars.length === 0 && !out.rawOutput && (
        <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "10px 0" }}>
          Nenhuma variável no pipeline após esta execução.
        </div>
      )}
    </div>
  );
}

// ─── Upstream Var Picker ──────────────────────────────────────────────────────

export function UpstreamVarPicker({
  nodeId, nodes, edges, lastRunOutputs, onInsert, onConnect,
}: {
  nodeId: string;
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];
  lastRunOutputs: NodeOutputMap;
  onInsert: (ref: string) => void;
  onConnect: (sourceId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [openNodes, setOpenNodes] = useState<Record<string, boolean>>({});

  const allOtherNodesWithOutput = useMemo(() => {
    const ancestors = new Set<string>();
    const queue = [nodeId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of edges) {
        if (e.target === cur && !ancestors.has(e.source)) {
          ancestors.add(e.source);
          queue.push(e.source);
        }
      }
    }
    const directlyConnected = new Set(edges.filter((e) => e.target === nodeId).map((e) => e.source));

    return Object.entries(lastRunOutputs)
      .filter(([id]) => id !== nodeId)
      .map(([id, out]) => ({
        id,
        label: out.label,
        pipeline: out.pipeline,
        status: out.status,
        rawOutput: out.rawOutput,
        isAncestor: ancestors.has(id),
        isDirectlyConnected: directlyConnected.has(id),
      }))
      .sort((a, b) => (b.isAncestor ? 1 : 0) - (a.isAncestor ? 1 : 0));
  }, [nodeId, edges, lastRunOutputs]);

  if (allOtherNodesWithOutput.length === 0) return null;

  return (
    <div style={{
      border: "1px solid rgba(167,139,250,0.25)", borderRadius: 8,
      background: "rgba(167,139,250,0.04)", marginBottom: 14, overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 6,
          padding: "8px 12px", background: "transparent", border: "none",
          cursor: "pointer", color: "#a78bfa", fontSize: 12, fontWeight: 600,
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Network size={12} />
        Variáveis de outros nodos
        <span style={{
          marginLeft: "auto", fontSize: 10, padding: "1px 7px",
          background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)",
          borderRadius: 10, color: "#a78bfa",
        }}>
          {allOtherNodesWithOutput.length}
        </span>
      </button>

      {open && (
        <div style={{ borderTop: "1px solid rgba(167,139,250,0.15)" }}>
          {allOtherNodesWithOutput.map(({ id, label, pipeline, status, isAncestor, isDirectlyConnected }) => {
            const isNodeOpen = openNodes[id] !== false;
            const vars = Object.entries(pipeline);
            const statusColor = status === "success" ? "#10b981" : status === "failed" ? "#ef4444" : "#94a3b8";
            return (
              <div key={id} style={{ borderBottom: "1px solid rgba(167,139,250,0.1)" }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
                  background: isAncestor ? "rgba(167,139,250,0.06)" : "transparent",
                }}>
                  <button
                    onClick={() => setOpenNodes((prev) => ({ ...prev, [id]: !isNodeOpen }))}
                    style={{
                      display: "flex", alignItems: "center", gap: 5, flex: 1,
                      background: "none", border: "none", cursor: "pointer",
                      color: isAncestor ? "#a78bfa" : "hsl(var(--foreground))",
                      textAlign: "left", padding: 0, minWidth: 0,
                    }}
                  >
                    {isNodeOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    <span style={{
                      fontSize: 11, fontWeight: 600, overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                    }}>
                      {label}
                    </span>
                    {isAncestor && (
                      <span style={{
                        fontSize: 9, padding: "1px 5px", borderRadius: 4, flexShrink: 0,
                        background: "rgba(167,139,250,0.2)", color: "#a78bfa", fontWeight: 600,
                      }}>upstream</span>
                    )}
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
                    <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", flexShrink: 0 }}>
                      {vars.length}v
                    </span>
                  </button>

                  {isDirectlyConnected ? (
                    <span style={{ fontSize: 9, color: "#10b981", fontWeight: 700, flexShrink: 0 }}>✓</span>
                  ) : (
                    <button
                      onClick={() => onConnect(id)}
                      title={`Conectar ${label} → este nodo`}
                      style={{
                        flexShrink: 0, fontSize: 10, padding: "2px 7px",
                        background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.35)",
                        borderRadius: 4, color: "#a78bfa", cursor: "pointer", fontWeight: 600,
                      }}
                    >
                      + Ligar
                    </button>
                  )}
                </div>

                {isNodeOpen && (
                  <div style={{ padding: "4px 12px 8px", display: "flex", flexWrap: "wrap" }}>
                    {vars.length > 0 ? (
                      vars.map(([k, v]) => <VarChip key={k} varName={k} value={v} onInsert={onInsert} nodeColor={nodeColorFromId(id)} nodeLabel={label} />)
                    ) : (
                      <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>sem variáveis</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── AI Code Assistant ────────────────────────────────────────────────────────

interface AiProviderInfo {
  id: string;
  name: string;
  color: string;
  models: string[];
  model: string;
  enabled: boolean;
  hasKey: boolean;
}

function AiCodeAssistant({ onCodeGenerated }: { onCodeGenerated: (code: string) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<AiProviderInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);

  const activeProviders = providers.filter((p) => p.enabled && p.hasKey);

  const fetchProviders = useCallback(async () => {
    setLoadingProviders(true);
    try {
      const res = await fetch("/api/settings/ai-providers");
      if (!res.ok) return;
      const data: AiProviderInfo[] = await res.json();
      setProviders(data);
      const active = data.filter((p) => p.enabled && p.hasKey);
      if (active.length > 0 && !selectedProvider) {
        setSelectedProvider(active[0].id);
        setSelectedModel(active[0].model || active[0].models[0] || "");
      }
    } catch {
    } finally {
      setLoadingProviders(false);
    }
  }, [selectedProvider]);

  useEffect(() => {
    if (open && providers.length === 0) fetchProviders();
  }, [open, providers.length, fetchProviders]);

  const handleProviderChange = (id: string) => {
    setSelectedProvider(id);
    const p = activeProviders.find((p) => p.id === id);
    setSelectedModel(p?.model || p?.models[0] || "");
  };

  const generate = async () => {
    if (!prompt.trim()) {
      toast({ title: "Descreva o que deseja gerar", variant: "destructive" });
      return;
    }
    if (!selectedProvider || !selectedModel) {
      toast({ title: "Selecione um provedor e modelo", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/ai/generate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: selectedProvider, model: selectedModel, prompt: prompt.trim() }),
      });
      const data = await res.json() as { code?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao gerar código");
      if (data.code) {
        onCodeGenerated(data.code);
        toast({ title: "Código gerado!", description: "O código foi inserido no editor. Revise antes de executar." });
      }
    } catch (err: any) {
      toast({ title: "Erro", description: err.message ?? "Falha ao gerar código", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const providerColor = activeProviders.find((p) => p.id === selectedProvider)?.color ?? "#a78bfa";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          display: "flex", alignItems: "center", gap: 7, padding: "7px 12px",
          borderRadius: 8, border: "1px dashed rgba(167,139,250,0.4)",
          background: "rgba(167,139,250,0.05)", cursor: "pointer", width: "100%",
          color: "#a78bfa", fontSize: 12, fontWeight: 600, transition: "all 0.15s",
        }}
      >
        <Sparkles size={13} />
        Assistente IA — gerar código
        <span style={{ marginLeft: "auto", opacity: 0.6, fontSize: 11 }}>clique para abrir</span>
      </button>
    );
  }

  return (
    <div style={{
      border: `1px solid ${providerColor}40`,
      borderRadius: 10,
      background: "rgba(0,0,0,0.25)",
      overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px",
        borderBottom: `1px solid ${providerColor}25`,
        background: `${providerColor}10`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: providerColor }}>
          <Bot size={15} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>Assistente IA</span>
        </div>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", padding: 2 }}>
          <X size={14} />
        </button>
      </div>

      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {loadingProviders ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "hsl(var(--muted-foreground))", fontSize: 12 }}>
            <Loader2 size={13} className="animate-spin" /> Carregando provedores...
          </div>
        ) : activeProviders.length === 0 ? (
          <div style={{
            padding: "10px 12px", borderRadius: 7, background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)", fontSize: 12, color: "#f87171",
          }}>
            Nenhum provedor de IA ativo. Configure em{" "}
            <a href="/settings" style={{ textDecoration: "underline", cursor: "pointer" }}>Settings → Integrações de IA</a>.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 5 }}>Provedor</div>
                <Select value={selectedProvider} onValueChange={handleProviderChange}>
                  <SelectTrigger style={{ fontSize: 12, height: 32 }}>
                    <SelectValue placeholder="Provedor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeProviders.map((p) => (
                      <SelectItem key={p.id} value={p.id} style={{ fontSize: 12 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, display: "inline-block", flexShrink: 0 }} />
                          {p.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 5 }}>Modelo</div>
                <Select value={selectedModel} onValueChange={setSelectedModel}>
                  <SelectTrigger style={{ fontSize: 12, height: 32 }}>
                    <SelectValue placeholder="Modelo..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(activeProviders.find((p) => p.id === selectedProvider)?.models ?? []).map((m) => (
                      <SelectItem key={m} value={m} style={{ fontSize: 11, fontFamily: "monospace" }}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 5 }}>
                Descreva o que o código deve fazer
              </div>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={`Ex: "Receba uma lista de emails de pipeline['emails'], filtre apenas os válidos e salve em pipeline['valid_emails']"`}
                rows={4}
                style={{ fontSize: 12, resize: "vertical", minHeight: 80 }}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); }}
              />
              <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 3 }}>
                Dica: Ctrl+Enter para gerar
              </div>
            </div>

            <Button
              size="sm"
              onClick={generate}
              disabled={generating || !prompt.trim()}
              style={{ gap: 7, background: providerColor, color: "#fff", border: "none", fontWeight: 700 }}
            >
              {generating
                ? <><Loader2 size={13} className="animate-spin" /> Gerando...</>
                : <><Wand2 size={13} /> Gerar código</>
              }
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Pip Install Config ───────────────────────────────────────────────────────

interface PipPackage { name: string; version: string; }

function PipInstallConfig({
  cfg,
  onUpdateConfig,
}: {
  cfg: Record<string, unknown>;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const action = (cfg.action as string) ?? "install";
  const mode = (cfg.mode as string) ?? "single";
  const packages = (cfg.packages as PipPackage[]) ?? [];

  const updatePackage = (idx: number, field: "name" | "version", val: string) => {
    const next = packages.map((p, i) => i === idx ? { ...p, [field]: val } : p);
    onUpdateConfig("packages", next);
  };
  const addPackage = () => onUpdateConfig("packages", [...packages, { name: "", version: "" }]);
  const removePackage = (idx: number) => onUpdateConfig("packages", packages.filter((_, i) => i !== idx));

  const MODES = [
    { value: "single",       label: "Lib única",       desc: "Uma biblioteca com nome e versão" },
    { value: "multiple",     label: "Múltiplas libs",  desc: "Lista de bibliotecas com versões exatas" },
    { value: "requirements", label: "requirements.txt", desc: "Cole o conteúdo do arquivo diretamente" },
  ] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))", display: "block", marginBottom: 6 }}>
          Ação
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          {(["install", "uninstall"] as const).map((a) => (
            <button
              key={a}
              onClick={() => onUpdateConfig("action", a)}
              style={{
                flex: 1, padding: "8px 0", borderRadius: 8, border: "1.5px solid",
                borderColor: action === a ? (a === "uninstall" ? "#ef4444" : "#34d399") : "hsl(var(--border))",
                background: action === a ? (a === "uninstall" ? "rgba(239,68,68,0.1)" : "rgba(52,211,153,0.1)") : "transparent",
                color: action === a ? (a === "uninstall" ? "#ef4444" : "#34d399") : "hsl(var(--muted-foreground))",
                fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <Package size={13} />
              {a === "install" ? "Instalar" : "Remover"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))", display: "block", marginBottom: 6 }}>
          Modo
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {MODES.filter((m) => !(action === "uninstall" && m.value === "requirements")).map((m) => (
            <button
              key={m.value}
              onClick={() => onUpdateConfig("mode", m.value)}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 11px",
                borderRadius: 7, border: `1.5px solid ${mode === m.value ? "#f472b6" : "hsl(var(--border))"}`,
                background: mode === m.value ? "rgba(244,114,182,0.08)" : "transparent",
                cursor: "pointer", textAlign: "left", width: "100%",
              }}
            >
              <div style={{
                width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
                background: mode === m.value ? "#f472b6" : "hsl(var(--muted-foreground))",
              }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: mode === m.value ? "#f472b6" : "hsl(var(--foreground))" }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 1 }}>{m.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {mode === "single" && <>
        <Field label="Nome exato da biblioteca">
          <Input
            value={(cfg.packageName as string) ?? ""}
            onChange={(e) => onUpdateConfig("packageName", e.target.value)}
            placeholder="requests"
            style={{ fontFamily: "monospace" }}
          />
        </Field>
        <Field label={`Versão exata ${action === "uninstall" ? "(ignorada ao remover)" : "(opcional)"}`}>
          <Input
            value={(cfg.packageVersion as string) ?? ""}
            onChange={(e) => onUpdateConfig("packageVersion", e.target.value)}
            placeholder="2.31.0"
            disabled={action === "uninstall"}
            style={{ fontFamily: "monospace", opacity: action === "uninstall" ? 0.4 : 1 }}
          />
        </Field>
      </>}

      {mode === "multiple" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))" }}>
              Bibliotecas ({packages.length})
            </label>
            <Button size="sm" variant="outline" onClick={addPackage} style={{ height: 26, fontSize: 11, padding: "0 10px" }}>
              <Plus size={11} className="mr-1" /> Adicionar
            </Button>
          </div>

          {packages.length === 0 && (
            <div style={{
              padding: "12px", borderRadius: 7, border: "1px dashed hsl(var(--border))",
              textAlign: "center", fontSize: 12, color: "hsl(var(--muted-foreground))",
            }}>
              Clique em Adicionar para incluir bibliotecas
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {packages.map((pkg, idx) => (
              <div key={idx} style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <Input
                  value={pkg.name}
                  onChange={(e) => updatePackage(idx, "name", e.target.value)}
                  placeholder="numpy"
                  style={{ fontFamily: "monospace", fontSize: 12, flex: 2 }}
                />
                <Input
                  value={pkg.version}
                  onChange={(e) => updatePackage(idx, "version", e.target.value)}
                  placeholder="1.26.0"
                  disabled={action === "uninstall"}
                  style={{ fontFamily: "monospace", fontSize: 12, flex: 1, opacity: action === "uninstall" ? 0.4 : 1 }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => removePackage(idx)}
                  style={{ width: 28, height: 28, flexShrink: 0 }}
                >
                  <Trash2 size={12} className="text-destructive" />
                </Button>
              </div>
            ))}
          </div>

          {packages.length > 0 && (
            <div style={{ marginTop: 6, padding: "7px 10px", borderRadius: 6, background: "rgba(244,114,182,0.06)", border: "1px solid rgba(244,114,182,0.2)", fontSize: 11, fontFamily: "monospace", color: "hsl(var(--muted-foreground))" }}>
              pip {action} {packages.map((p) => action === "uninstall" ? p.name : (p.version ? `${p.name}==${p.version}` : p.name)).filter(Boolean).join(" ")}
            </div>
          )}
        </div>
      )}

      {mode === "requirements" && (
        <Field label="Conteúdo do requirements.txt">
          <Textarea
            value={(cfg.requirementsTxt as string) ?? ""}
            onChange={(e) => onUpdateConfig("requirementsTxt", e.target.value)}
            placeholder={"requests==2.31.0\nnumpy>=1.26.0\npandas\nfastapi==0.104.1"}
            rows={8}
            style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }}
          />
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
            Suporta todos os formatos de pinning do pip: <code>==</code>, <code>&gt;=</code>, <code>~=</code>, etc.
          </div>
        </Field>
      )}
    </div>
  );
}

// ─── If AND / OR Node Config ──────────────────────────────────────────────────

function IfAndNodeConfig({
  cfg,
  onUpdateConfig,
}: {
  cfg: Record<string, unknown>;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const conditions = (cfg.conditions as Array<{ expression: string }>) ?? [];
  const mode = (cfg.mode as string) ?? "and";

  const add = () => onUpdateConfig("conditions", [...conditions, { expression: "True" }]);
  const update = (idx: number, val: string) =>
    onUpdateConfig("conditions", conditions.map((c, i) => (i === idx ? { expression: val } : c)));
  const remove = (idx: number) =>
    onUpdateConfig("conditions", conditions.filter((_, i) => i !== idx));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Field label="Operador lógico">
        <Select value={mode} onValueChange={(v) => onUpdateConfig("mode", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="and">AND — todas devem ser verdadeiras</SelectItem>
            <SelectItem value="or">OR — basta uma ser verdadeira</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 500 }}>Condições ({conditions.length})</label>
          <Button size="sm" variant="outline" onClick={add} style={{ height: 26, fontSize: 11, padding: "0 10px" }}>
            <Plus size={11} className="mr-1" /> Adicionar
          </Button>
        </div>
        {conditions.length === 0 && (
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "10px 0" }}>Nenhuma condição adicionada</div>
        )}
        {conditions.map((cond, idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
            <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", minWidth: 32, textAlign: "right", flexShrink: 0 }}>
              {idx === 0 ? "SE" : mode.toUpperCase()}
            </div>
            <VarTokenInput
              value={cond.expression}
              onChange={(v) => update(idx, v)}
              placeholder="len(lista) > 0"
              style={{ flex: 1 }}
            />
            <Button size="icon" variant="ghost" onClick={() => remove(idx)} style={{ height: 28, width: 28, flexShrink: 0 }}>
              <Trash2 size={12} />
            </Button>
          </div>
        ))}
      </div>
      <InfoBox>O resultado fica em <code>_condition_result</code> (True/False) no pipeline para uso em nodos downstream.</InfoBox>
    </div>
  );
}

// ─── If / Else If Node Config ─────────────────────────────────────────────────

function IfElseNodeConfig({
  cfg,
  onUpdateConfig,
}: {
  cfg: Record<string, unknown>;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const elifClauses = (cfg.elifClauses as Array<{ expression: string; branch: string }>) ?? [];

  const addElif = () =>
    onUpdateConfig("elifClauses", [
      ...elifClauses,
      { expression: "True", branch: `elif_${elifClauses.length + 1}` },
    ]);
  const updateElif = (idx: number, field: "expression" | "branch", val: string) =>
    onUpdateConfig("elifClauses", elifClauses.map((c, i) => (i === idx ? { ...c, [field]: val } : c)));
  const removeElif = (idx: number) =>
    onUpdateConfig("elifClauses", elifClauses.filter((_, i) => i !== idx));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Field label="Condição IF (expressão Python → True/False)">
        <VarTokenInput
          value={(cfg.ifExpression as string) ?? ""}
          onChange={(v) => onUpdateConfig("ifExpression", v)}
          placeholder="x > 0"
        />
      </Field>

      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 500 }}>Cláusulas ELIF ({elifClauses.length})</label>
          <Button size="sm" variant="outline" onClick={addElif} style={{ height: 26, fontSize: 11, padding: "0 10px" }}>
            <Plus size={11} className="mr-1" /> Adicionar
          </Button>
        </div>
        {elifClauses.length === 0 && (
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "8px 0" }}>Nenhuma cláusula elif</div>
        )}
        {elifClauses.map((clause, idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
            <div style={{ fontSize: 10, color: "#a78bfa", minWidth: 30, flexShrink: 0 }}>elif</div>
            <VarTokenInput
              value={clause.expression}
              onChange={(v) => updateElif(idx, "expression", v)}
              placeholder="x == 0"
              style={{ flex: 2 }}
            />
            <Input
              value={clause.branch}
              onChange={(e) => updateElif(idx, "branch", e.target.value)}
              placeholder="branch"
              style={{ fontFamily: "monospace", fontSize: 11, flex: 1 }}
            />
            <Button size="icon" variant="ghost" onClick={() => removeElif(idx)} style={{ height: 28, width: 28, flexShrink: 0 }}>
              <Trash2 size={12} />
            </Button>
          </div>
        ))}
        {elifClauses.length > 0 && (
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
            Colunas: <strong>expressão Python</strong> → <strong>nome da branch</strong>
          </div>
        )}
      </div>

      <Field label="Branch ELSE (fallback se nenhuma condição for verdadeira)">
        <Input
          value={(cfg.elseBranch as string) ?? "else"}
          onChange={(e) => onUpdateConfig("elseBranch", e.target.value)}
          placeholder="else"
          style={{ fontFamily: "monospace" }}
        />
      </Field>
      <InfoBox>O resultado fica em <code>_branch</code> no pipeline: <code>"if"</code>, <code>"elif_N"</code> ou o nome do else.</InfoBox>
    </div>
  );
}

// ─── Case / Match Node Config ─────────────────────────────────────────────────

function CaseNodeConfig({
  cfg,
  onUpdateConfig,
}: {
  cfg: Record<string, unknown>;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const cases = (cfg.cases as Array<{ value: string; label: string }>) ?? [];
  const update = (idx: number, field: "value" | "label", val: string) =>
    onUpdateConfig("cases", cases.map((c, i) => (i === idx ? { ...c, [field]: val } : c)));
  const add = () =>
    onUpdateConfig("cases", [...cases, { value: "", label: `case${cases.length + 1}` }]);
  const remove = (idx: number) =>
    onUpdateConfig("cases", cases.filter((_, i) => i !== idx));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Field label="Variável de entrada (pipeline)">
        <VarTokenInput
          value={(cfg.inputVar as string) ?? ""}
          onChange={(v) => onUpdateConfig("inputVar", v)}
          placeholder='status ou pipeline["status"]'
        />
      </Field>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 500 }}>Casos ({cases.length})</label>
          <Button size="sm" variant="outline" onClick={add} style={{ height: 26, fontSize: 11, padding: "0 10px" }}>
            <Plus size={11} className="mr-1" /> Adicionar
          </Button>
        </div>
        {cases.length === 0 && (
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "10px 0" }}>Nenhum caso adicionado</div>
        )}
        {cases.map((c, idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
            <Input
              value={c.value}
              onChange={(e) => update(idx, "value", e.target.value)}
              placeholder="200"
              style={{ fontFamily: "monospace", fontSize: 11, flex: 1 }}
            />
            <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", flexShrink: 0 }}>→</div>
            <Input
              value={c.label}
              onChange={(e) => update(idx, "label", e.target.value)}
              placeholder="label"
              style={{ fontFamily: "monospace", fontSize: 11, flex: 1 }}
            />
            <Button size="icon" variant="ghost" onClick={() => remove(idx)} style={{ height: 28, width: 28, flexShrink: 0 }}>
              <Trash2 size={12} />
            </Button>
          </div>
        ))}
        {cases.length > 0 && (
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
            Colunas: <strong>valor</strong> (igualdade direta) → <strong>label da branch</strong>
          </div>
        )}
      </div>
      <Field label="Branch fallback (sem match)">
        <Input
          value={(cfg.fallback as string) ?? "default"}
          onChange={(e) => onUpdateConfig("fallback", e.target.value)}
          placeholder="default"
          style={{ fontFamily: "monospace" }}
        />
      </Field>
      <InfoBox>O resultado fica em <code>_switch_result</code> no pipeline. Use igualdade exata (string, número, bool).</InfoBox>
    </div>
  );
}

// ─── Switch Node Config ───────────────────────────────────────────────────────

function SwitchNodeConfig({
  cfg,
  onUpdateConfig,
}: {
  cfg: Record<string, unknown>;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const conditions = (cfg.conditions as Array<{ expression: string; label: string }>) ?? [];
  const update = (idx: number, field: "expression" | "label", val: string) => {
    const next = conditions.map((c, i) => i === idx ? { ...c, [field]: val } : c);
    onUpdateConfig("conditions", next);
  };
  const add = () => onUpdateConfig("conditions", [...conditions, { expression: "value > 0", label: `branch${conditions.length + 1}` }]);
  const remove = (idx: number) => onUpdateConfig("conditions", conditions.filter((_, i) => i !== idx));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Field label="Variável de entrada (pipeline)">
        <VarTokenInput value={(cfg.inputVar as string) ?? ""} onChange={(v) => onUpdateConfig("inputVar", v)} placeholder='myValue ou pipeline["var"]' />
      </Field>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 500 }}>Condições ({conditions.length})</label>
          <Button size="sm" variant="outline" onClick={add} style={{ height: 26, fontSize: 11, padding: "0 10px" }}>
            <Plus size={11} className="mr-1" /> Adicionar
          </Button>
        </div>
        {conditions.length === 0 && (
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "10px 0" }}>Nenhuma condição adicionada</div>
        )}
        {conditions.map((cond, idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
            <VarTokenInput value={cond.expression} onChange={(v) => update(idx, "expression", v)} placeholder="value > 100" style={{ flex: 2 }} />
            <Input value={cond.label} onChange={(e) => update(idx, "label", e.target.value)} placeholder="branch" style={{ fontFamily: "monospace", fontSize: 11, flex: 1 }} />
            <Button size="icon" variant="ghost" onClick={() => remove(idx)} style={{ height: 28, width: 28, flexShrink: 0 }}>
              <Trash2 size={12} />
            </Button>
          </div>
        ))}
        {conditions.length > 0 && (
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
            Colunas: <strong>expressão Python</strong> (usa <code>value</code> ou campos do dict) → <strong>label da branch</strong>
          </div>
        )}
      </div>
      <Field label="Branch fallback (sem match)">
        <Input value={(cfg.fallback as string) ?? "default"} onChange={(e) => onUpdateConfig("fallback", e.target.value)} placeholder="default" style={{ fontFamily: "monospace" }} />
      </Field>
      <InfoBox>O resultado fica em <code>_switch_result</code> no contexto do pipeline para uso em nodos downstream.</InfoBox>
    </div>
  );
}

// ─── Merge Lists Config ───────────────────────────────────────────────────────

function MergeListsConfig({
  cfg,
  onUpdateConfig,
}: {
  cfg: Record<string, unknown>;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const vars = (cfg.vars as string[]) ?? [];
  const addVar = () => onUpdateConfig("vars", [...vars, ""]);
  const updateVar = (idx: number, val: string) => onUpdateConfig("vars", vars.map((v, i) => i === idx ? val : v));
  const removeVar = (idx: number) => onUpdateConfig("vars", vars.filter((_, i) => i !== idx));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 500 }}>Variáveis para combinar ({vars.length})</label>
          <Button size="sm" variant="outline" onClick={addVar} style={{ height: 26, fontSize: 11, padding: "0 10px" }}>
            <Plus size={11} className="mr-1" /> Adicionar
          </Button>
        </div>
        {vars.length === 0 && (
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "8px 0" }}>Adicione variáveis do pipeline</div>
        )}
        {vars.map((v, idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
            <Input value={v} onChange={(e) => updateVar(idx, e.target.value)} placeholder={`lista${idx + 1}`} style={{ fontFamily: "monospace", fontSize: 11 }} />
            <Button size="icon" variant="ghost" onClick={() => removeVar(idx)} style={{ height: 28, width: 28 }}>
              <Trash2 size={12} />
            </Button>
          </div>
        ))}
      </div>
      <Field label="Modo de combinação">
        <Select value={(cfg.mode as string) ?? "append"} onValueChange={(v) => onUpdateConfig("mode", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="append">Append — concatenar arrays</SelectItem>
            <SelectItem value="zip">Zip — mesclar por posição (objeto por objeto)</SelectItem>
            <SelectItem value="merge_objects">Merge Object — Object.assign no primeiro item</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Variável de saída">
        <Input value={(cfg.outputVar as string) ?? "merged"} onChange={(e) => onUpdateConfig("outputVar", e.target.value)} placeholder="merged" style={{ fontFamily: "monospace" }} />
      </Field>
    </div>
  );
}

// ─── Generic Data Node Config ─────────────────────────────────────────────────

function DataNodeConfig({
  nodeType,
  cfg,
  onUpdateConfig,
}: {
  nodeType: string;
  cfg: Record<string, unknown>;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const inputVarField = (
    <Field label="Variável de entrada (pipeline)">
      <VarTokenInput value={(cfg.inputVar as string) ?? ""} onChange={(v) => onUpdateConfig("inputVar", v)} placeholder='items ou pipeline["var"]' />
    </Field>
  );
  const outputVarField = (
    <Field label="Variável de saída">
      <Input value={(cfg.outputVar as string) ?? ""} onChange={(e) => onUpdateConfig("outputVar", e.target.value)} placeholder="result" style={{ fontFamily: "monospace" }} />
    </Field>
  );

  if (nodeType === "filter_list") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {inputVarField}
      <Field label="Expressão Python por item (variável: item)">
        <VarTokenInput value={(cfg.expression as string) ?? ""} onChange={(v) => onUpdateConfig("expression", v)} placeholder="item['active'] == True" />
      </Field>
      {outputVarField}
      <InfoBox>Equivale a <code>[item for item in lista if (<em>expressão</em>)]</code>. Use <code>item</code> para acessar cada elemento.</InfoBox>
    </div>
  );

  if (nodeType === "batch_split") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {inputVarField}
      <Field label="Tamanho do lote">
        <Input type="number" min={1} value={(cfg.batchSize as number) ?? 10} onChange={(e) => onUpdateConfig("batchSize", Number(e.target.value))} />
      </Field>
      {outputVarField}
      <InfoBox>Saída é uma lista de listas — ex.: 25 itens com tamanho 10 → [[...10], [...10], [...5]]</InfoBox>
    </div>
  );

  if (nodeType === "aggregate") {
    const operation = (cfg.operation as string) ?? "count";
    const needsField = ["sum","avg","min","max","join","list"].includes(operation);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {inputVarField}
        <Field label="Operação">
          <Select value={operation} onValueChange={(v) => onUpdateConfig("operation", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="count">Count — quantidade de itens</SelectItem>
              <SelectItem value="sum">Sum — soma de um campo numérico</SelectItem>
              <SelectItem value="avg">Average — média de um campo numérico</SelectItem>
              <SelectItem value="min">Min — menor valor do campo</SelectItem>
              <SelectItem value="max">Max — maior valor do campo</SelectItem>
              <SelectItem value="first">First — primeiro item da lista</SelectItem>
              <SelectItem value="last">Last — último item da lista</SelectItem>
              <SelectItem value="join">Join — concatenar campo como texto</SelectItem>
              <SelectItem value="list">List — extrair campo em nova lista</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {needsField && (
          <Field label="Campo (deixe vazio para usar o item inteiro)">
            <Input value={(cfg.field as string) ?? ""} onChange={(e) => onUpdateConfig("field", e.target.value)} placeholder="price" style={{ fontFamily: "monospace" }} />
          </Field>
        )}
        {operation === "join" && (
          <Field label="Separador">
            <Input value={(cfg.separator as string) ?? ", "} onChange={(e) => onUpdateConfig("separator", e.target.value)} placeholder=", " />
          </Field>
        )}
        {outputVarField}
      </div>
    );
  }

  if (nodeType === "split_out") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {inputVarField}
      <Field label="Campo que contém a lista aninhada">
        <Input value={(cfg.field as string) ?? "items"} onChange={(e) => onUpdateConfig("field", e.target.value)} placeholder="items" style={{ fontFamily: "monospace" }} />
      </Field>
      <Field label="Manter campos do pai junto com cada item">
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
          <Switch checked={!!(cfg.keepParent)} onCheckedChange={(v) => onUpdateConfig("keepParent", v)} />
          <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
            {cfg.keepParent ? "Sim — inclui campos do objeto pai" : "Não — retorna apenas os itens do campo"}
          </span>
        </div>
      </Field>
      {outputVarField}
      <InfoBox>Ex: lista de pedidos, cada um com campo <code>items</code> → gera uma lista plana de todos os itens individuais.</InfoBox>
    </div>
  );

  if (nodeType === "sort_list") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {inputVarField}
      <Field label="Campo para ordenação (vazio = item inteiro)">
        <Input value={(cfg.key as string) ?? ""} onChange={(e) => onUpdateConfig("key", e.target.value)} placeholder="name" style={{ fontFamily: "monospace" }} />
      </Field>
      <Field label="Ordem">
        <Select value={(cfg.order as string) ?? "asc"} onValueChange={(v) => onUpdateConfig("order", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="asc">Crescente (A → Z, 0 → 9)</SelectItem>
            <SelectItem value="desc">Decrescente (Z → A, 9 → 0)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {outputVarField}
    </div>
  );

  if (nodeType === "remove_duplicates") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {inputVarField}
      <Field label="Chave de deduplicação (vazio = item inteiro como JSON)">
        <Input value={(cfg.key as string) ?? ""} onChange={(e) => onUpdateConfig("key", e.target.value)} placeholder="id" style={{ fontFamily: "monospace" }} />
      </Field>
      {outputVarField}
      <InfoBox>Mantém a primeira ocorrência de cada valor único da chave. Preserva a ordem original.</InfoBox>
    </div>
  );

  if (nodeType === "limit") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {inputVarField}
      <Field label="Máximo de itens">
        <Input type="number" min={1} value={(cfg.maxItems as number) ?? 10} onChange={(e) => onUpdateConfig("maxItems", Number(e.target.value))} />
      </Field>
      <Field label="Quais itens manter">
        <Select value={(cfg.keep as string) ?? "first"} onValueChange={(v) => onUpdateConfig("keep", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="first">Primeiros N (slice do início)</SelectItem>
            <SelectItem value="last">Últimos N (slice do fim)</SelectItem>
            <SelectItem value="random">N aleatórios (shuffle + slice)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {outputVarField}
    </div>
  );

  return null;
}

// ─── HTTP Request Config ──────────────────────────────────────────────────────

interface KVPair { key: string; value: string; enabled: boolean; }

function KeyValueEditor({
  pairs,
  onChange,
  keyPlaceholder = "chave",
  valuePlaceholder = "valor",
  addLabel = "Adicionar linha",
}: {
  pairs: KVPair[];
  onChange: (pairs: KVPair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
}) {
  const add = () => onChange([...pairs, { key: "", value: "", enabled: true }]);
  const remove = (i: number) => onChange(pairs.filter((_, idx) => idx !== i));
  const update = (i: number, field: keyof KVPair, val: string | boolean) =>
    onChange(pairs.map((p, idx) => idx === i ? { ...p, [field]: val } : p));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {pairs.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={p.enabled}
            onChange={(e) => update(i, "enabled", e.target.checked)}
            style={{ cursor: "pointer", accentColor: "#14b8a6", flexShrink: 0, width: 14, height: 14 }}
          />
          <Input
            value={p.key}
            onChange={(e) => update(i, "key", e.target.value)}
            placeholder={keyPlaceholder}
            style={{ fontFamily: "monospace", fontSize: 11, flex: 1, opacity: p.enabled ? 1 : 0.45, height: 30 }}
          />
          <div style={{ flex: 1.5, opacity: p.enabled ? 1 : 0.45 }}>
            <VarTokenInput
              value={p.value}
              onChange={(v) => update(i, "value", v)}
              placeholder={valuePlaceholder}
              style={{ fontSize: 11, height: 30 }}
            />
          </div>
          <Button size="icon" variant="ghost" onClick={() => remove(i)} style={{ height: 28, width: 28, flexShrink: 0 }}>
            <Trash2 size={11} className="text-destructive" />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={add}
        style={{ height: 26, fontSize: 11, padding: "0 10px", alignSelf: "flex-start", marginTop: 2 }}
      >
        <Plus size={10} style={{ marginRight: 4 }} /> {addLabel}
      </Button>
    </div>
  );
}

// ─── Database Node Config ─────────────────────────────────────────────────────

interface DbField { column: string; value: string; enabled: boolean; }

function DatabaseNodeConfig({
  nodeType,
  cfg,
  onUpdateConfig,
}: {
  nodeType: string;
  cfg: Record<string, unknown>;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const parsed = parseDbNodeType(nodeType);
  if (!parsed) return null;
  const { dbType, operation } = parsed;
  const dbMeta = DB_META[dbType];
  const opMeta = DB_OP_META[operation];

  const [fetchedColumns, setFetchedColumns] = useState<string[]>([]);
  const [fetchingCols, setFetchingCols] = useState(false);
  const [fetchColsError, setFetchColsError] = useState("");

  const isSupabase = dbType === "supabase";

  const str = (key: string, def = "") => (cfg[key] as string) ?? def;
  const num = (key: string, def: number) => Number(cfg[key] ?? def);
  const bool = (key: string, def = false) => (cfg[key] as boolean) ?? def;
  const arr = (key: string): DbField[] => (cfg[key] as DbField[]) ?? [];

  const handleFetchColumns = async () => {
    setFetchingCols(true);
    setFetchColsError("");
    try {
      const res = await fetch("/api/db/columns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dbType,
          connectionString: str("connectionString"),
          host: str("host", "localhost"),
          port: num("port", dbMeta.defaultPort),
          dbName: str("dbName"),
          user: str("user"),
          password: str("password"),
          table: str("table"),
          supabaseUrl: str("supabaseUrl"),
          supabaseKey: str("supabaseKey"),
        }),
      });
      const data = await res.json();
      if (data.columns) {
        setFetchedColumns(data.columns as string[]);
      } else {
        setFetchColsError(data.error ?? "Erro desconhecido");
      }
    } catch (e: unknown) {
      setFetchColsError((e as Error).message);
    } finally {
      setFetchingCols(false);
    }
  };

  const updateField = (fieldKey: string, index: number, k: keyof DbField, v: string | boolean) => {
    const fields = arr(fieldKey);
    const updated = [...fields];
    updated[index] = { ...updated[index], [k]: v };
    onUpdateConfig(fieldKey, updated);
  };
  const removeField = (fieldKey: string, index: number) => {
    onUpdateConfig(fieldKey, arr(fieldKey).filter((_, i) => i !== index));
  };
  const addField = (fieldKey: string) => {
    onUpdateConfig(fieldKey, [...arr(fieldKey), { column: "", value: "", enabled: true }]);
  };

  const colInput = (field: DbField, fieldKey: string, index: number) => (
    <>
      <input
        list="db-cols-list"
        value={field.column}
        onChange={(e) => updateField(fieldKey, index, "column", e.target.value)}
        placeholder="coluna"
        style={{ flex: "0 0 38%", fontFamily: "monospace", fontSize: 11, height: 28, padding: "0 6px", background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 5, color: "hsl(var(--foreground))", minWidth: 0 }}
      />
      <input
        value={field.value}
        onChange={(e) => updateField(fieldKey, index, "value", e.target.value)}
        placeholder='valor / pipeline["x"]'
        style={{ flex: 1, fontFamily: "monospace", fontSize: 11, height: 28, padding: "0 6px", background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 5, color: "hsl(var(--foreground))", minWidth: 0 }}
      />
    </>
  );

  const renderFieldRow = (field: DbField, index: number, fieldKey: string) => (
    <div key={index} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
      <input type="checkbox" checked={field.enabled !== false} onChange={(e) => updateField(fieldKey, index, "enabled", e.target.checked)} style={{ width: 13, height: 13, flexShrink: 0, cursor: "pointer" }} />
      {colInput(field, fieldKey, index)}
      <button onClick={() => removeField(fieldKey, index)} style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "#ef4444", fontSize: 16, lineHeight: 1, padding: "0 4px", borderRadius: 4 }}>×</button>
    </div>
  );

  const addBtn = (fieldKey: string, color: string) => (
    <button onClick={() => addField(fieldKey)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, fontSize: 11, color, background: `${color}10`, border: `1px dashed ${color}66`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", width: "100%", marginTop: 4 }}>
      + Adicionar campo
    </button>
  );

  const sectionTitle = (label: string) => (
    <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, marginTop: 12 }}>{label}</div>
  );

  const whereRow = (colKey: string, valKey: string) => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      <input list="db-cols-list" value={str(colKey)} onChange={(e) => onUpdateConfig(colKey, e.target.value)} placeholder="coluna WHERE" style={{ fontFamily: "monospace", fontSize: 11, height: 32, padding: "0 8px", background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 6, color: "hsl(var(--foreground))" }} />
      <Input value={str(valKey)} onChange={(e) => onUpdateConfig(valKey, e.target.value)} placeholder='valor / pipeline["id"]' style={{ fontFamily: "monospace", fontSize: 11 }} />
    </div>
  );

  return (
    <div>
      <datalist id="db-cols-list">
        {fetchedColumns.map((col) => <option key={col} value={col} />)}
      </datalist>

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <span style={{ padding: "2px 10px", borderRadius: 20, background: `${dbMeta.color}22`, border: `1px solid ${dbMeta.color}55`, color: dbMeta.color, fontSize: 11, fontWeight: 600 }}>{dbMeta.label}</span>
        <span style={{ padding: "2px 10px", borderRadius: 20, background: `${opMeta.color}22`, border: `1px solid ${opMeta.color}55`, color: opMeta.color, fontSize: 11, fontWeight: 600 }}>{opMeta.label}</span>
      </div>

      {sectionTitle("Conexão")}
      {isSupabase ? (
        <>
          <Field label="Supabase URL">
            <Input value={str("supabaseUrl")} onChange={(e) => onUpdateConfig("supabaseUrl", e.target.value)} placeholder="https://xxxx.supabase.co" />
          </Field>
          <Field label="API Key">
            <Input type="password" value={str("supabaseKey")} onChange={(e) => onUpdateConfig("supabaseKey", e.target.value)} placeholder="anon/service-role key" />
          </Field>
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Switch checked={bool("useConnectionString")} onCheckedChange={(v) => onUpdateConfig("useConnectionString", v)} />
            <span style={{ fontSize: 12 }}>Usar connection string</span>
          </div>
          {bool("useConnectionString") ? (
            <Field label="Connection String">
              <Input value={str("connectionString")} onChange={(e) => onUpdateConfig("connectionString", e.target.value)} placeholder={`postgresql://user:pass@host:${dbMeta.defaultPort}/db`} style={{ fontFamily: "monospace", fontSize: 12 }} />
            </Field>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 72px", gap: 6, marginBottom: 6 }}>
                <div>
                  <label style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 3 }}>Host</label>
                  <Input value={str("host", "localhost")} onChange={(e) => onUpdateConfig("host", e.target.value)} placeholder="localhost" />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 3 }}>Porta</label>
                  <Input type="number" value={num("port", dbMeta.defaultPort)} onChange={(e) => onUpdateConfig("port", Number(e.target.value))} />
                </div>
              </div>
              <Field label="Database">
                <Input value={str("dbName")} onChange={(e) => onUpdateConfig("dbName", e.target.value)} placeholder="meu_banco" />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
                <div>
                  <label style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 3 }}>Usuário</label>
                  <Input value={str("user")} onChange={(e) => onUpdateConfig("user", e.target.value)} placeholder="postgres" />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 3 }}>Senha</label>
                  <Input type="password" value={str("password")} onChange={(e) => onUpdateConfig("password", e.target.value)} placeholder="••••••" />
                </div>
              </div>
              {(dbType === "mssql" || dbType === "oracle") && (
                <div style={{ padding: "7px 10px", background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.3)", borderRadius: 6, fontSize: 11, color: "#fb923c", marginBottom: 6 }}>
                  Requer <strong>{dbMeta.installPkg}</strong> instalado.
                  Adicione um nodo <strong>Pip Packages</strong> antes e instale <code>{dbMeta.installPkg}</code>.
                </div>
              )}
            </>
          )}
        </>
      )}

      {sectionTitle("Tabela")}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <Input
          value={str("table")}
          onChange={(e) => onUpdateConfig("table", e.target.value)}
          placeholder="nome_da_tabela"
          style={{ flex: 1 }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleFetchColumns}
          disabled={fetchingCols || !str("table")}
          style={{ whiteSpace: "nowrap", fontSize: 11, gap: 4, flexShrink: 0, height: 36 }}
        >
          {fetchingCols
            ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
            : <Database size={12} />}
          Buscar colunas
        </Button>
      </div>
      {fetchColsError && (
        <div style={{ padding: "6px 10px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, fontSize: 11, color: "#ef4444", marginBottom: 6 }}>
          {fetchColsError}
        </div>
      )}
      {fetchedColumns.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 8 }}>
          {fetchedColumns.map((col) => (
            <span key={col} style={{ padding: "1px 7px", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, fontSize: 10, color: "#10b981", fontFamily: "monospace" }}>{col}</span>
          ))}
        </div>
      )}

      <div style={{ borderTop: `2px solid ${opMeta.color}55`, marginBottom: 8, marginTop: 8 }} />
      <div style={{ fontSize: 11, fontWeight: 700, color: opMeta.color, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>{opMeta.label}</div>

      {operation === "select" && (
        <>
          <Field label="Colunas (SELECT)">
            <Input value={str("selectColumns", "*")} onChange={(e) => onUpdateConfig("selectColumns", e.target.value)} placeholder="* ou col1, col2" />
          </Field>
          <Field label="WHERE (cláusula SQL)">
            <Input value={str("whereClause")} onChange={(e) => onUpdateConfig("whereClause", e.target.value)} placeholder="id = 1 ou status = 'ativo'" style={{ fontFamily: "monospace", fontSize: 12 }} />
          </Field>
          <Field label="ORDER BY">
            <Input value={str("orderBy")} onChange={(e) => onUpdateConfig("orderBy", e.target.value)} placeholder="created_at DESC" style={{ fontFamily: "monospace", fontSize: 12 }} />
          </Field>
          <Field label="LIMIT">
            <Input type="number" min={1} value={num("limit", 100)} onChange={(e) => onUpdateConfig("limit", Number(e.target.value))} />
          </Field>
        </>
      )}

      {operation === "insert" && (
        <>
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 8 }}>
            Valor pode ser literal (<code>"texto"</code>, <code>42</code>) ou expressão Python (<code>pipeline["campo"]</code>).
          </div>
          {arr("fields").map((f, i) => renderFieldRow(f, i, "fields"))}
          {addBtn("fields", "#34d399")}
        </>
      )}

      {operation === "update" && (
        <>
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 4 }}>WHERE — coluna e valor de filtro:</div>
          {whereRow("whereColumn", "whereValue")}
          {sectionTitle("Campos para atualizar")}
          {arr("fields").map((f, i) => renderFieldRow(f, i, "fields"))}
          {addBtn("fields", "#f59e0b")}
        </>
      )}

      {operation === "delete" && (
        <>
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 4 }}>WHERE — coluna e valor de filtro:</div>
          {whereRow("whereColumn", "whereValue")}
        </>
      )}

      {operation === "upsert" && (
        <>
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 4 }}>Verificar existência por coluna:</div>
          {whereRow("checkColumn", "checkValue")}
          <div style={{ fontSize: 11, fontWeight: 600, color: "#34d399", marginBottom: 4, marginTop: 10 }}>✦ Se NÃO existir — Inserir:</div>
          {arr("insertFields").map((f, i) => renderFieldRow(f, i, "insertFields"))}
          {addBtn("insertFields", "#34d399")}
          <div style={{ fontSize: 11, fontWeight: 600, color: "#f59e0b", marginBottom: 4, marginTop: 14 }}>✦ Se JÁ existir — Atualizar:</div>
          {arr("updateFields").map((f, i) => renderFieldRow(f, i, "updateFields"))}
          {addBtn("updateFields", "#f59e0b")}
        </>
      )}

      {sectionTitle("Saída")}
      <Field label="Variável de saída">
        <Input value={str("outputVar", "result")} onChange={(e) => onUpdateConfig("outputVar", e.target.value)} placeholder="result" />
      </Field>
      {!isSupabase && (
        <div style={{ padding: "6px 10px", background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.2)", borderRadius: 6, fontSize: 11, color: "#60a5fa" }}>
          Necessário: <strong>{dbMeta.installPkg}</strong>. Use o nodo <strong>Pip Packages</strong> (ação Install) antes deste nodo se não instalado.
        </div>
      )}
    </div>
  );
}

// ─── Output Type Selector ─────────────────────────────────────────────────────

const OUTPUT_TYPES = [
  { value: "auto",      label: "Auto",      desc: "Detecta o tipo automaticamente; usa str como fallback", color: "#94a3b8" },
  { value: "str",       label: "str",       desc: "Converte para string (str)",                            color: "#60a5fa" },
  { value: "int",       label: "int",       desc: "Converte para inteiro (trunca decimais)",               color: "#34d399" },
  { value: "float",     label: "float",     desc: "Converte para número decimal (float)",                  color: "#a78bfa" },
  { value: "list",      label: "list",      desc: "Garante que a saída seja uma lista Python",             color: "#fb923c" },
  { value: "dict",      label: "dict",      desc: "Garante que a saída seja um dicionário",                color: "#f472b6" },
  { value: "dataframe", label: "DataFrame", desc: "Converte para lista de registros (pd.DataFrame → JSON)",color: "#fbbf24" },
] as const;

function OutputTypeSelector({
  value,
  onChange,
  isCodeNode,
}: {
  value: string;
  onChange: (v: string) => void;
  isCodeNode: boolean;
}) {
  const active = value || "auto";
  const activeMeta = OUTPUT_TYPES.find((t) => t.value === active) ?? OUTPUT_TYPES[0];

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 5, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        Tipo de dado de saída
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {OUTPUT_TYPES.map((t) => {
          const isActive = active === t.value;
          return (
            <button
              key={t.value}
              onClick={() => onChange(t.value)}
              title={t.desc}
              style={{
                padding: "3px 9px",
                borderRadius: 20,
                border: `1.5px solid ${isActive ? t.color : "hsl(var(--border))"}`,
                background: isActive ? `${t.color}18` : "transparent",
                color: isActive ? t.color : "hsl(var(--muted-foreground))",
                fontSize: 11, fontWeight: isActive ? 700 : 500,
                cursor: "pointer", transition: "all 0.12s",
                fontFamily: t.value !== "auto" ? "monospace" : undefined,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: activeMeta.color, marginTop: 5, lineHeight: 1.5 }}>
        {activeMeta.desc}
        {active === "dataframe" && isCodeNode && (
          <span style={{ display: "block", color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
            Retorne um <code style={{ color: "#fbbf24" }}>pd.DataFrame</code> ou lista de dicts — convertido automaticamente para JSON records.
          </span>
        )}
        {active === "auto" && (
          <span style={{ display: "block", color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
            Se não identificar, usa <code style={{ color: "#60a5fa" }}>str</code> como fallback.
          </span>
        )}
      </div>
    </div>
  );
}

// ─── File Binary Config ───────────────────────────────────────────────────────

function FileBinaryConfig({
  type,
  cfg,
  onUpdateConfig,
}: {
  type: string;
  cfg: Record<string, unknown>;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const needsInput  = type !== "file_to_base64";
  const needsFile   = type !== "binary_to_base64";
  const isToFile    = type === "base64_to_file" || type === "binary_to_file";
  const isToBase64  = type === "file_to_base64"  || type === "binary_to_base64";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {needsInput && (
        <Field label="Variável de entrada (pipeline)">
          <Input
            value={(cfg.inputVar as string) ?? ""}
            onChange={(e) => onUpdateConfig("inputVar", e.target.value)}
            placeholder="response"
            style={{ fontFamily: "monospace", fontSize: 12 }}
          />
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 3, lineHeight: 1.5 }}>
            {type === "binary_to_base64"
              ? "Chave do pipeline com valor binário (bytes, base64 string, ou objeto __binary__)"
              : "Chave do pipeline com base64 string ou objeto {base64, content_type, size}"}
          </div>
        </Field>
      )}

      {needsFile && (
        <Field label={isToFile ? "Caminho do arquivo de saída" : "Caminho do arquivo"}>
          <Input
            value={(cfg.filePath as string) ?? ""}
            onChange={(e) => onUpdateConfig("filePath", e.target.value)}
            placeholder={isToFile ? "/tmp/resultado.bin" : "/caminho/para/arquivo.pdf"}
            style={{ fontFamily: "monospace", fontSize: 12 }}
          />
          {type === "file_to_base64" && (
            <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 3 }}>
              Pode ser um caminho literal ou uma chave do pipeline que contém o caminho
            </div>
          )}
        </Field>
      )}

      <Field label="Variável de saída (pipeline)">
        <Input
          value={(cfg.outputVar as string) ?? ""}
          onChange={(e) => onUpdateConfig("outputVar", e.target.value)}
          placeholder={isToFile ? "saved_path" : isToBase64 ? "file_b64" : "data_b64"}
          style={{ fontFamily: "monospace", fontSize: 12 }}
        />
        <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 3, lineHeight: 1.5 }}>
          {isToFile
            ? "Caminho do arquivo salvo fica nesta chave do pipeline"
            : "String base64 fica nesta chave — use com nodo Binário→Arquivo para persistir"}
        </div>
      </Field>

      <div style={{
        background: "rgba(251,146,60,0.07)", border: "1px solid rgba(251,146,60,0.2)",
        borderRadius: 8, padding: "8px 10px", fontSize: 10, color: "hsl(var(--muted-foreground))", lineHeight: 1.7,
      }}>
        {type === "file_to_base64" && <>
          <strong style={{ color: "#fb923c" }}>file_to_base64:</strong><br />
          Lê <code style={{ color: "#60a5fa" }}>filePath</code> → base64 string em <code style={{ color: "#34d399" }}>outputVar</code><br />
          Também salva <code style={{ color: "#34d399" }}>outputVar_size</code> e <code style={{ color: "#34d399" }}>outputVar_content_type</code>
        </>}
        {type === "base64_to_file" && <>
          <strong style={{ color: "#fb923c" }}>base64_to_file:</strong><br />
          Decodifica <code style={{ color: "#60a5fa" }}>pipeline[inputVar]</code> → salva em <code style={{ color: "#60a5fa" }}>filePath</code><br />
          Aceita string base64 direta ou objeto <code style={{ color: "#a78bfa" }}>&#123;base64, content_type&#125;</code>
        </>}
        {type === "binary_to_base64" && <>
          <strong style={{ color: "#fb923c" }}>binary_to_base64:</strong><br />
          Converte <code style={{ color: "#60a5fa" }}>pipeline[inputVar]</code> para base64 string limpa<br />
          Útil após HTTP com responseType=binário
        </>}
        {type === "binary_to_file" && <>
          <strong style={{ color: "#fb923c" }}>binary_to_file:</strong><br />
          Salva <code style={{ color: "#60a5fa" }}>pipeline[inputVar]</code> (bytes/base64) diretamente em <code style={{ color: "#60a5fa" }}>filePath</code><br />
          Equivalente ao base64_to_file com suporte a bytes Python
        </>}
      </div>
    </div>
  );
}

// ─── Call Subflow Config ──────────────────────────────────────────────────────

function CallSubflowConfig({
  cfg,
  onUpdateConfig,
  currentWorkflowId,
}: {
  cfg: Record<string, unknown>;
  onUpdateConfig: (k: string, v: unknown) => void;
  currentWorkflowId: string;
}) {
  const { data: allWorkflows } = useListWorkflows();
  type InputParam = { key: string; value: string };
  const inputParams = ((cfg.inputParams as InputParam[]) ?? []);
  const outputVar = (cfg.outputVar as string) ?? "";
  const selectedId = (cfg.workflowId as string) ?? "";

  const workflows = (allWorkflows ?? []).filter((w: any) => w.id !== currentWorkflowId);

  const addParam = () => onUpdateConfig("inputParams", [...inputParams, { key: "", value: "" }]);
  const updateParam = (i: number, field: "key" | "value", val: string) => {
    const next = inputParams.map((p, idx) => idx === i ? { ...p, [field]: val } : p);
    onUpdateConfig("inputParams", next);
  };
  const removeParam = (i: number) => onUpdateConfig("inputParams", inputParams.filter((_, idx) => idx !== i));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label="Sub-workflow a chamar">
        <Select value={selectedId} onValueChange={(v) => onUpdateConfig("workflowId", v)}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione um workflow..." />
          </SelectTrigger>
          <SelectContent>
            {workflows.length === 0 ? (
              <SelectItem value="__none" disabled>Nenhum outro workflow encontrado</SelectItem>
            ) : (
              workflows.map((w: any) => (
                <SelectItem key={w.id} value={w.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Share2 size={11} style={{ opacity: 0.6 }} />
                    {w.name}
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        {selectedId && (
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 3 }}>
            O sub-workflow deve ter um nodo <strong>Sub-flow Trigger</strong> como ponto de entrada.
          </div>
        )}
      </Field>

      <Field label="Parâmetros de entrada (opcional)">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {inputParams.map((param, i) => (
            <div key={i} style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <Input
                value={param.key}
                onChange={(e) => updateParam(i, "key", e.target.value)}
                placeholder="chave"
                style={{ flex: 1, fontSize: 12, fontFamily: "monospace" }}
              />
              <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>:</span>
              <Input
                value={param.value}
                onChange={(e) => updateParam(i, "value", e.target.value)}
                placeholder='valor ou pipeline["key"]'
                style={{ flex: 2, fontSize: 12, fontFamily: "monospace" }}
              />
              <button
                onClick={() => removeParam(i)}
                style={{
                  background: "none", border: "none", cursor: "pointer", padding: 4,
                  color: "hsl(var(--muted-foreground))", flexShrink: 0,
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addParam} style={{ alignSelf: "flex-start" }}>
            <Plus size={12} style={{ marginRight: 4 }} /> Adicionar parâmetro
          </Button>
          {inputParams.length > 0 && (
            <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", lineHeight: 1.5 }}>
              Os parâmetros ficam disponíveis em <code style={{ color: "#a78bfa", background: "rgba(167,139,250,0.1)", padding: "1px 4px", borderRadius: 3 }}>pipeline</code> dentro do sub-workflow.
            </div>
          )}
        </div>
      </Field>

      <Field label="Variável de saída (opcional)">
        <Input
          value={outputVar}
          onChange={(e) => onUpdateConfig("outputVar", e.target.value)}
          placeholder="Ex: resultado_subflow"
          style={{ fontSize: 12, fontFamily: "monospace" }}
        />
        {outputVar.trim() ? (
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4, lineHeight: 1.5 }}>
            O pipeline final do sub-workflow será salvo em{" "}
            <code style={{ color: "#34d399", background: "rgba(52,211,153,0.1)", padding: "1px 4px", borderRadius: 3 }}>
              pipeline["{outputVar.trim()}"]
            </code>
            . Deixe em branco para mesclar diretamente no pipeline atual.
          </div>
        ) : (
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
            Sem variável: o pipeline do sub-workflow é mesclado no pipeline do workflow pai.
          </div>
        )}
      </Field>
    </div>
  );
}

// ─── HTTP Request Config ──────────────────────────────────────────────────────

function HttpRequestConfig({
  cfg,
  onUpdateConfig,
}: {
  cfg: Record<string, unknown>;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showBearer, setShowBearer] = useState(false);

  const method = (cfg.method as string) ?? "GET";
  const bodyType = (cfg.bodyType as string) ?? "none";
  const authType = (cfg.authType as string) ?? "none";
  const params = (cfg.params as KVPair[]) ?? [];
  const headers = (cfg.headers as KVPair[]) ?? [];
  const bodyForm = (cfg.bodyForm as KVPair[]) ?? [];
  const sslVerify = (cfg.sslVerify as boolean) !== false;

  const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
  const BODY_TYPES = [
    { value: "none", label: "Sem body" },
    { value: "json", label: "JSON" },
    { value: "form", label: "Form Data" },
    { value: "raw", label: "Raw Text" },
  ];
  const AUTH_TYPES = [
    { value: "none", label: "Sem auth" },
    { value: "bearer", label: "Bearer Token" },
    { value: "basic", label: "Basic Auth" },
    { value: "apikey", label: "API Key" },
  ];

  const tabLabel = (label: string, count?: number) =>
    count !== undefined && count > 0 ? `${label} (${count})` : label;

  const activeParams = params.filter((p) => p.enabled && p.key).length;
  const activeHeaders = headers.filter((h) => h.enabled && h.key).length;

  const sectionStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 10, paddingTop: 10 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 7, alignItems: "flex-end" }}>
        <div style={{ flexShrink: 0, width: 110 }}>
          <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Método</label>
          <Select value={method} onValueChange={(v) => onUpdateConfig("method", v)}>
            <SelectTrigger style={{ height: 32, fontSize: 12, fontWeight: 700 }}><SelectValue /></SelectTrigger>
            <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>URL</label>
          <VarTokenInput
            value={(cfg.url as string) ?? ""}
            onChange={(v) => onUpdateConfig("url", v)}
            placeholder="https://api.example.com/v1/resource"
            style={{ fontSize: 12 }}
          />
        </div>
      </div>

      <Tabs defaultValue="params">
        <TabsList style={{ width: "100%", height: 32 }}>
          <TabsTrigger value="params" style={{ flex: 1, fontSize: 11 }}>{tabLabel("Params", activeParams)}</TabsTrigger>
          <TabsTrigger value="headers" style={{ flex: 1, fontSize: 11 }}>{tabLabel("Headers", activeHeaders)}</TabsTrigger>
          <TabsTrigger value="body" style={{ flex: 1, fontSize: 11 }}>Body</TabsTrigger>
          <TabsTrigger value="auth" style={{ flex: 1, fontSize: 11 }}>Auth</TabsTrigger>
          <TabsTrigger value="options" style={{ flex: 1, fontSize: 11 }}>Opções</TabsTrigger>
        </TabsList>

        <TabsContent value="params">
          <div style={sectionStyle}>
            {params.length === 0 && (
              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "8px 0" }}>
                Nenhum query param — aparecem após ? na URL
              </div>
            )}
            <KeyValueEditor pairs={params} onChange={(v) => onUpdateConfig("params", v)} keyPlaceholder="param" valuePlaceholder="valor" />
          </div>
        </TabsContent>

        <TabsContent value="headers">
          <div style={sectionStyle}>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {[
                ["Content-Type", "application/json"],
                ["Accept", "application/json"],
                ["Authorization", "Bearer ..."],
                ["User-Agent", "flowpython/1.0"],
              ].map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => {
                    if (!headers.find((h) => h.key === k)) {
                      onUpdateConfig("headers", [...headers, { key: k, value: v, enabled: true }]);
                    }
                  }}
                  style={{
                    fontSize: 10, padding: "3px 8px", borderRadius: 5,
                    border: "1px solid hsl(var(--border))",
                    background: "rgba(255,255,255,0.04)", cursor: "pointer",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  + {k}
                </button>
              ))}
            </div>
            <KeyValueEditor pairs={headers} onChange={(v) => onUpdateConfig("headers", v)} keyPlaceholder="Header-Name" valuePlaceholder="valor" />
          </div>
        </TabsContent>

        <TabsContent value="body">
          <div style={sectionStyle}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 6 }}>Tipo de body</label>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {BODY_TYPES.map((bt) => (
                  <button
                    key={bt.value}
                    onClick={() => onUpdateConfig("bodyType", bt.value)}
                    style={{
                      padding: "4px 11px", borderRadius: 6, fontSize: 11, cursor: "pointer",
                      border: `1.5px solid ${bodyType === bt.value ? "#60a5fa" : "hsl(var(--border))"}`,
                      background: bodyType === bt.value ? "rgba(96,165,250,0.12)" : "transparent",
                      color: bodyType === bt.value ? "#60a5fa" : "hsl(var(--muted-foreground))",
                      fontWeight: bodyType === bt.value ? 700 : 400,
                    }}
                  >
                    {bt.label}
                  </button>
                ))}
              </div>
            </div>

            {bodyType === "json" && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>JSON Body</label>
                <Textarea
                  value={(cfg.bodyJson as string) ?? ""}
                  onChange={(e) => onUpdateConfig("bodyJson", e.target.value)}
                  placeholder={'{\n  "key": "value"\n}'}
                  rows={5}
                  style={{ fontFamily: "monospace", fontSize: 11, lineHeight: 1.5 }}
                />
              </div>
            )}

            {bodyType === "form" && (
              <KeyValueEditor pairs={bodyForm} onChange={(v) => onUpdateConfig("bodyForm", v)} keyPlaceholder="campo" valuePlaceholder="valor" addLabel="Adicionar campo" />
            )}

            {bodyType === "raw" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Content-Type</label>
                  <Select value={(cfg.bodyRawContentType as string) ?? "text/plain"} onValueChange={(v) => onUpdateConfig("bodyRawContentType", v)}>
                    <SelectTrigger style={{ height: 30, fontSize: 11 }}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["text/plain","text/html","application/xml","text/xml","application/javascript","text/css"].map((ct) => (
                        <SelectItem key={ct} value={ct} style={{ fontSize: 12 }}>{ct}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Textarea
                  value={(cfg.bodyRaw as string) ?? ""}
                  onChange={(e) => onUpdateConfig("bodyRaw", e.target.value)}
                  placeholder="Raw text body..."
                  rows={5}
                  style={{ fontFamily: "monospace", fontSize: 11 }}
                />
              </div>
            )}

            {bodyType === "none" && (
              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "4px 0" }}>
                Nenhum body será enviado
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="auth">
          <div style={sectionStyle}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 6 }}>Tipo de autenticação</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {AUTH_TYPES.map((at) => (
                  <button
                    key={at.value}
                    onClick={() => onUpdateConfig("authType", at.value)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "7px 10px", borderRadius: 7, cursor: "pointer", textAlign: "left",
                      border: `1.5px solid ${authType === at.value ? "#f472b6" : "hsl(var(--border))"}`,
                      background: authType === at.value ? "rgba(244,114,182,0.08)" : "transparent",
                    }}
                  >
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                      background: authType === at.value ? "#f472b6" : "hsl(var(--muted-foreground))",
                    }} />
                    <span style={{ fontSize: 12, fontWeight: authType === at.value ? 600 : 400, color: authType === at.value ? "#f472b6" : "hsl(var(--foreground))" }}>
                      {at.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {authType === "bearer" && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Token</label>
                <div style={{ position: "relative" }}>
                  <Input
                    type={showBearer ? "text" : "password"}
                    value={(cfg.authBearer as string) ?? ""}
                    onChange={(e) => onUpdateConfig("authBearer", e.target.value)}
                    placeholder="eyJhbGciOi..."
                    style={{ fontFamily: "monospace", fontSize: 11, paddingRight: 32 }}
                  />
                  <button
                    onClick={() => setShowBearer(!showBearer)}
                    style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", padding: 0 }}
                  >
                    {showBearer ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>Adicionado como <code>Authorization: Bearer &lt;token&gt;</code></div>
              </div>
            )}

            {authType === "basic" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Usuário</label>
                  <Input value={(cfg.authUsername as string) ?? ""} onChange={(e) => onUpdateConfig("authUsername", e.target.value)} placeholder="username" style={{ fontSize: 12 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Senha</label>
                  <div style={{ position: "relative" }}>
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={(cfg.authPassword as string) ?? ""}
                      onChange={(e) => onUpdateConfig("authPassword", e.target.value)}
                      placeholder="••••••••"
                      style={{ paddingRight: 32, fontSize: 12 }}
                    />
                    <button
                      onClick={() => setShowPassword(!showPassword)}
                      style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", padding: 0 }}
                    >
                      {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {authType === "apikey" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Nome da chave</label>
                  <Input value={(cfg.authApiKeyName as string) ?? "X-API-Key"} onChange={(e) => onUpdateConfig("authApiKeyName", e.target.value)} placeholder="X-API-Key" style={{ fontFamily: "monospace", fontSize: 12 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Valor</label>
                  <Input value={(cfg.authApiKeyValue as string) ?? ""} onChange={(e) => onUpdateConfig("authApiKeyValue", e.target.value)} placeholder="sk-..." style={{ fontFamily: "monospace", fontSize: 12 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Enviar como</label>
                  <Select value={(cfg.authApiKeyIn as string) ?? "header"} onValueChange={(v) => onUpdateConfig("authApiKeyIn", v)}>
                    <SelectTrigger style={{ height: 30, fontSize: 11 }}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="header">Header HTTP</SelectItem>
                      <SelectItem value="query">Query string</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="options">
          <div style={sectionStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                {sslVerify
                  ? <Shield size={13} color="#22c55e" />
                  : <ShieldOff size={13} color="#f59e0b" />}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>Verificar SSL</div>
                  <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
                    {sslVerify ? "Certificados SSL validados" : "SSL ignorado (inseguro)"}
                  </div>
                </div>
              </div>
              <Switch checked={sslVerify} onCheckedChange={(v) => onUpdateConfig("sslVerify", v)} />
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500 }}>Seguir redirecionamentos</div>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>Segue automaticamente 3xx</div>
              </div>
              <Switch
                checked={(cfg.followRedirects as boolean) !== false}
                onCheckedChange={(v) => onUpdateConfig("followRedirects", v)}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Timeout (segundos)</label>
              <Input type="number" min={1} max={300} value={(cfg.timeout as number) ?? 30} onChange={(e) => onUpdateConfig("timeout", Number(e.target.value))} style={{ fontSize: 12 }} />
            </div>

            {!sslVerify && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>
                  Caminho do certificado CA (opcional)
                </label>
                <Input value={(cfg.certPath as string) ?? ""} onChange={(e) => onUpdateConfig("certPath", e.target.value)} placeholder="/path/to/ca-bundle.crt" style={{ fontFamily: "monospace", fontSize: 11 }} />
                <div style={{ fontSize: 10, color: "#f59e0b", marginTop: 4 }}>
                  ⚠️ Desativar SSL pode expor dados sensíveis
                </div>
              </div>
            )}

            {sslVerify && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>
                  Certificado cliente (opcional, .pem)
                </label>
                <Input value={(cfg.certPath as string) ?? ""} onChange={(e) => onUpdateConfig("certPath", e.target.value)} placeholder="/path/to/client.pem" style={{ fontFamily: "monospace", fontSize: 11 }} />
              </div>
            )}

            <div>
              <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 6 }}>
                Tipo de resposta
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {([
                  { value: "auto",   label: "Auto (JSON → texto)",  desc: "Tenta JSON, usa texto como fallback" },
                  { value: "binary", label: "Binário (arquivo, imagem…)", desc: "Baixa como bytes → armazena em base64 no pipeline" },
                  { value: "text",   label: "Texto forçado",         desc: "Sempre usa response.text (sem parse JSON)" },
                ] as { value: string; label: string; desc: string }[]).map((rt) => {
                  const isActive = ((cfg.responseType as string) ?? "auto") === rt.value;
                  return (
                    <button
                      key={rt.value}
                      onClick={() => onUpdateConfig("responseType", rt.value)}
                      style={{
                        display: "flex", alignItems: "flex-start", gap: 8,
                        padding: "7px 10px", borderRadius: 7, cursor: "pointer", textAlign: "left",
                        border: `1.5px solid ${isActive ? "#60a5fa" : "hsl(var(--border))"}`,
                        background: isActive ? "rgba(96,165,250,0.08)" : "transparent",
                      }}
                    >
                      <div style={{
                        width: 8, height: 8, borderRadius: "50%", flexShrink: 0, marginTop: 3,
                        background: isActive ? "#60a5fa" : "hsl(var(--muted-foreground))",
                      }} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? "#60a5fa" : "hsl(var(--foreground))" }}>
                          {rt.label}
                        </div>
                        <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 1 }}>
                          {rt.desc}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {((cfg.responseType as string) ?? "auto") === "binary" && (
                <div style={{ marginTop: 6, fontSize: 10, color: "#60a5fa", background: "rgba(96,165,250,0.07)", padding: "6px 8px", borderRadius: 6, lineHeight: 1.5 }}>
                  A resposta binária fica em <code style={{ color: "#34d399" }}>pipeline[outputVar]</code> como objeto{" "}
                  <code style={{ color: "#a78bfa" }}>&#123;base64, content_type, size&#125;</code>.<br />
                  Use o nodo <strong>Binário → Arquivo</strong> para salvar no disco.
                </div>
              )}
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 500, color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 4 }}>Variável de saída</label>
              <Input
                value={(cfg.outputVar as string) ?? "response"}
                onChange={(e) => onUpdateConfig("outputVar", e.target.value)}
                placeholder="response"
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
              <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
                {((cfg.responseType as string) ?? "auto") === "binary"
                  ? "Objeto binário {base64, content_type, size} salvo com esta chave"
                  : "Resposta JSON salva no contexto como esta variável"}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Variable Node Config ─────────────────────────────────────────────────────

function VariableNodeConfig({
  cfg,
  type,
  onUpdateConfig,
}: {
  cfg: Record<string, unknown>;
  type: string;
  onUpdateConfig: (k: string, v: unknown) => void;
}) {
  const { data: variablesData } = useListVariables({});
  const globalVars = variablesData ?? [];

  const scope = (cfg.scope as string) ?? "workflow";
  const operation = (cfg.operation as string) ?? "get";
  const isInject = type === "variable_inject";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))", display: "block", marginBottom: 8 }}>
          Escopo
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {VARIABLE_SCOPES.map((s) => (
            <button
              key={s.value}
              onClick={() => onUpdateConfig("scope", s.value)}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 11px",
                borderRadius: 8, border: `1.5px solid ${scope === s.value ? s.color : "hsl(var(--border))"}`,
                background: scope === s.value ? `${s.color}10` : "transparent",
                cursor: "pointer", textAlign: "left", transition: "border-color 0.12s, background 0.12s",
                width: "100%",
              }}
            >
              <div style={{
                width: 10, height: 10, borderRadius: "50%", background: s.color,
                flexShrink: 0, marginTop: 3, boxShadow: scope === s.value ? `0 0 6px ${s.color}` : "none",
              }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: scope === s.value ? s.color : "hsl(var(--foreground))" }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", lineHeight: 1.5, marginTop: 1 }}>
                  {s.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {!isInject && (
        <>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))", display: "block", marginBottom: 6 }}>
              Operação
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              {(["get", "set"] as const).map((op) => (
                <button
                  key={op}
                  onClick={() => onUpdateConfig("operation", op)}
                  style={{
                    flex: 1, padding: "7px 0", borderRadius: 7, border: `1.5px solid`,
                    borderColor: operation === op ? (op === "set" ? "#f59e0b" : "#60a5fa") : "hsl(var(--border))",
                    background: operation === op ? (op === "set" ? "rgba(245,158,11,0.1)" : "rgba(96,165,250,0.1)") : "transparent",
                    color: operation === op ? (op === "set" ? "#f59e0b" : "#60a5fa") : "hsl(var(--muted-foreground))",
                    fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em",
                    cursor: "pointer", transition: "all 0.12s",
                  }}
                >
                  {op === "get" ? "Ler" : "Definir"}
                </button>
              ))}
            </div>
          </div>

          <Field label="Chave (nome da variável)">
            {scope === "global" && globalVars.length > 0 ? (
              <Select value={(cfg.key as string) ?? ""} onValueChange={(v) => onUpdateConfig("key", v)}>
                <SelectTrigger><SelectValue placeholder="Selecionar variável global..." /></SelectTrigger>
                <SelectContent>
                  {globalVars.map((v: any) => (
                    <SelectItem key={v.id} value={v.key}>
                      <span style={{ fontFamily: "monospace" }}>{v.key}</span>
                      {v.value && <span style={{ color: "hsl(var(--muted-foreground))", marginLeft: 8, fontSize: 11 }}>= {String(v.value).slice(0, 20)}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={(cfg.key as string) ?? ""}
                onChange={(e) => onUpdateConfig("key", e.target.value)}
                placeholder="NOME_DA_VARIAVEL"
                style={{ fontFamily: "monospace" }}
              />
            )}
          </Field>

          {operation === "set" && (
            <Field label="Valor">
              <Textarea
                value={(cfg.value as string) ?? ""}
                onChange={(e) => onUpdateConfig("value", e.target.value)}
                placeholder="Valor a definir..."
                rows={3}
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </Field>
          )}
        </>
      )}

      {isInject && (
        <>
          <Field label="Chaves a injetar (uma por linha, vazio = todas)">
            <Textarea
              value={((cfg.keys as string[]) ?? []).join("\n")}
              onChange={(e) => onUpdateConfig("keys", e.target.value.split("\n").filter(Boolean))}
              placeholder={"API_KEY\nDB_URL"}
              rows={4}
              style={{ fontFamily: "monospace", fontSize: 12 }}
            />
          </Field>
          <div style={{
            background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.2)",
            borderRadius: 7, padding: "9px 11px", fontSize: 11,
            color: "hsl(var(--muted-foreground))", lineHeight: 1.6,
          }}>
            As variáveis injetadas ficam disponíveis para nodos downstream via pipeline scope.
          </div>
        </>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))" }}>{label}</label>
      {children}
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)", border: "1px solid hsl(var(--border))",
      borderRadius: 7, padding: "10px 12px", fontSize: 12,
      color: "hsl(var(--muted-foreground))", lineHeight: 1.6,
    }}>
      {children}
    </div>
  );
}

// ─── Main NodeConfigPanel ─────────────────────────────────────────────────────

export function NodeConfigPanel({
  node,
  workflowId,
  onUpdateData,
  onUpdateConfig,
  onTestNode,
  testLoading,
  testResult,
}: {
  node: ReactFlowNode;
  workflowId: string;
  onUpdateData: (k: string, v: unknown) => void;
  onUpdateConfig: (k: string, v: unknown) => void;
  onTestNode: () => void;
  testLoading: boolean;
  testResult: { output: string; success: boolean; durationMs: number; pipeline?: Record<string, unknown> | null } | null;
}) {
  const cfg = (node.data.config as Record<string, unknown>) ?? {};
  const type = node.data.type as string;
  const isPinned = !!cfg.pinned;
  const isNote = type === "note";
  const isTrigger = isTriggerType(type);

  const [copilotEnabled, setCopilotEnabled] = useState(false);
  const [copilotProvider, setCopilotProvider] = useState("");
  const [copilotModel, setCopilotModel] = useState("");

  useEffect(() => {
    if (type !== "code") return;
    fetch("/api/settings/ai-providers")
      .then((r) => r.ok ? r.json() : [])
      .then((providers: AiProviderInfo[]) => {
        const active = providers.filter((p) => p.enabled && p.hasKey);
        if (active.length > 0 && !copilotProvider) {
          setCopilotProvider(active[0].id);
          setCopilotModel(active[0].model || active[0].models[0] || "");
        }
      })
      .catch(() => {});
  }, [type]);

  const copilotExt = useMemo((): import("@codemirror/state").Extension[] => {
    if (type !== "code") return [];
    return [copilotExtension({
      enabled: () => copilotEnabled,
      onSuggest: async (code, cursorPos, cursorLine) => {
        if (!copilotProvider || !copilotModel) return null;
        try {
          const res = await fetch("/api/ai/copilot-suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, cursorPos, cursorLine, provider: copilotProvider, model: copilotModel }),
          });
          if (!res.ok) return null;
          const data = await res.json() as { suggestion?: string };
          return data.suggestion || null;
        } catch { return null; }
      },
    })];
  }, [type, copilotEnabled, copilotProvider, copilotModel]);

  const intellisenseExt = useMemo(() =>
    autocompletion({ override: [pythonLibraryCompletionSource] }),
  []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      <Field label="Label">
        <Input value={(node.data.label as string) ?? ""} onChange={(e) => onUpdateData("label", e.target.value)} />
      </Field>

      {type === "trigger_manual" && <InfoBox>O workflow inicia manualmente via botão ou API.</InfoBox>}

      {type === "trigger_webhook" && <>
        <Field label="Método HTTP">
          <Select value={(cfg.method as string) ?? "POST"} onValueChange={(v) => onUpdateConfig("method", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["GET","POST","PUT","PATCH","DELETE"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Path">
          <Input value={(cfg.path as string) ?? "/webhook"} onChange={(e) => onUpdateConfig("path", e.target.value)} placeholder="/webhook" />
        </Field>
      </>}

      {type === "trigger_schedule" && <>
        <Field label="Cron Expression">
          <Input value={(cfg.cron as string) ?? "0 9 * * *"} onChange={(e) => onUpdateConfig("cron", e.target.value)} placeholder="0 9 * * *" style={{ fontFamily: "monospace" }} />
        </Field>
        <InfoBox>Ex: <code style={{ color: "#14b8a6" }}>0 9 * * *</code> = todo dia às 09:00</InfoBox>
      </>}

      {type === "trigger_subflow" && <InfoBox>Este workflow é chamado como sub-flow por outro workflow.</InfoBox>}

      {type === "code" && (
        <>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "6px 10px", borderRadius: 7,
            background: copilotEnabled ? "rgba(167,139,250,0.08)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${copilotEnabled ? "rgba(167,139,250,0.3)" : "hsl(var(--border))"}`,
            transition: "all 0.15s",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <Bot size={13} color={copilotEnabled ? "#a78bfa" : "hsl(var(--muted-foreground))"} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: copilotEnabled ? "#a78bfa" : "hsl(var(--foreground))" }}>
                  Copilot IA
                </div>
                <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>
                  {copilotEnabled ? "Tab para aceitar sugestão" : "Sugestões inline de código"}
                </div>
              </div>
            </div>
            <Switch checked={copilotEnabled} onCheckedChange={setCopilotEnabled} />
          </div>

          <Field label="Código Python">
            <div style={{
              border: `1px solid ${copilotEnabled ? "rgba(167,139,250,0.4)" : "hsl(var(--border))"}`,
              borderRadius: 6, overflow: "hidden",
              transition: "border-color 0.15s",
              boxShadow: copilotEnabled ? "0 0 0 2px rgba(167,139,250,0.1)" : "none",
            }}>
              <CodeMirror
                value={(cfg.code as string) ?? ""}
                height="220px"
                theme="dark"
                extensions={[python(), varDropExtension, intellisenseExt, ...copilotExt]}
                onChange={(val) => onUpdateConfig("code", val)}
              />
            </div>
            <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 4, lineHeight: 1.5 }}>
              Use <code style={{ color: "#a78bfa", background: "rgba(167,139,250,0.1)", padding: "1px 4px", borderRadius: 3 }}>pipeline</code> para ler/escrever dados entre nodos.
              Retorne um dict com <code style={{ color: "#14b8a6", background: "rgba(20,184,166,0.1)", padding: "1px 4px", borderRadius: 3 }}>return {"{"}chave: valor{"}"}</code> para definir a saída do nodo.
              {copilotEnabled && <span style={{ color: "#a78bfa", marginLeft: 6 }}>• Copilot ativo — pressione <strong>Tab</strong> para aceitar</span>}
            </div>
          </Field>
          <AiCodeAssistant onCodeGenerated={(code) => onUpdateConfig("code", code)} />
        </>
      )}

      {type === "condition" && (
        <Field label="Expressão Python (True/False)">
          <VarTokenInput value={(cfg.expression as string) ?? ""} onChange={(v) => onUpdateConfig("expression", v)} placeholder="len(result) > 0" />
        </Field>
      )}

      {type === "loop" && (
        <Field label="Lista de itens (Python)">
          <VarTokenInput value={(cfg.itemsExpression as string) ?? ""} onChange={(v) => onUpdateConfig("itemsExpression", v)} placeholder="[1, 2, 3]" />
        </Field>
      )}

      {type === "call_subflow" && (
        <CallSubflowConfig cfg={cfg} onUpdateConfig={onUpdateConfig} currentWorkflowId={workflowId} />
      )}

      {(type === "file_to_base64" || type === "base64_to_file" || type === "binary_to_base64" || type === "binary_to_file") && (
        <FileBinaryConfig type={type} cfg={cfg} onUpdateConfig={onUpdateConfig} />
      )}

      {type === "set_variable" && <>
        <Field label="Chave"><Input value={(cfg.key as string) ?? ""} onChange={(e) => onUpdateConfig("key", e.target.value)} placeholder="MY_VAR" /></Field>
        <Field label="Valor"><VarTokenInput value={(cfg.value as string) ?? ""} onChange={(v) => onUpdateConfig("value", v)} placeholder='valor ou pipeline["var"]' /></Field>
      </>}

      {type === "get_variable" && (
        <Field label="Chave"><Input value={(cfg.key as string) ?? ""} onChange={(e) => onUpdateConfig("key", e.target.value)} placeholder="MY_VAR" /></Field>
      )}

      {type === "transform" && (
        <Field label="Código Python (variável `input`)">
          <div style={{ border: "1px solid hsl(var(--border))", borderRadius: 6, overflow: "hidden" }}>
            <CodeMirror value={(cfg.code as string) ?? "output = input"} height="160px" theme="dark" extensions={[python(), varDropExtension, intellisenseExt]} onChange={(val) => onUpdateConfig("code", val)} />
          </div>
        </Field>
      )}

      {type === "http_request" && (
        <HttpRequestConfig cfg={cfg} onUpdateConfig={onUpdateConfig} />
      )}

      {type === "wait" && (
        <Field label="Segundos">
          <Input type="number" min={1} value={(cfg.seconds as number) ?? 5} onChange={(e) => onUpdateConfig("seconds", Number(e.target.value))} />
        </Field>
      )}

      {isNote && (
        <Field label="Texto"><Textarea value={(cfg.text as string) ?? ""} onChange={(e) => onUpdateConfig("text", e.target.value)} rows={4} /></Field>
      )}

      {(type === "variable" || type === "variable_inject") && (
        <VariableNodeConfig cfg={cfg} type={type} onUpdateConfig={onUpdateConfig} />
      )}

      {type === "pip_install" && (
        <PipInstallConfig cfg={cfg} onUpdateConfig={onUpdateConfig} />
      )}

      {type === "if_and" && (
        <IfAndNodeConfig cfg={cfg} onUpdateConfig={onUpdateConfig} />
      )}

      {type === "if_else" && (
        <IfElseNodeConfig cfg={cfg} onUpdateConfig={onUpdateConfig} />
      )}

      {type === "case" && (
        <CaseNodeConfig cfg={cfg} onUpdateConfig={onUpdateConfig} />
      )}

      {type === "switch" && (
        <SwitchNodeConfig cfg={cfg} onUpdateConfig={onUpdateConfig} />
      )}

      {type === "merge_lists" && (
        <MergeListsConfig cfg={cfg} onUpdateConfig={onUpdateConfig} />
      )}

      {(type === "filter_list" || type === "batch_split" || type === "aggregate" ||
        type === "split_out" || type === "sort_list" || type === "remove_duplicates" ||
        type === "limit") && (
        <DataNodeConfig nodeType={type} cfg={cfg} onUpdateConfig={onUpdateConfig} />
      )}

      {isDatabaseNodeType(type) && (
        <DatabaseNodeConfig nodeType={type} cfg={cfg} onUpdateConfig={onUpdateConfig} />
      )}

      {!isNote && !isTrigger && type !== "call_subflow" && (
        <div style={{ borderTop: "1px solid hsl(var(--border))", paddingTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 6,
              background: (cfg.nodeOutputVar as string)?.trim() ? "rgba(52,211,153,0.15)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${(cfg.nodeOutputVar as string)?.trim() ? "rgba(52,211,153,0.35)" : "hsl(var(--border))"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <MoveRight size={11} color={(cfg.nodeOutputVar as string)?.trim() ? "#34d399" : "hsl(var(--muted-foreground))"} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "hsl(var(--foreground))" }}>Variável de saída</div>
              <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>Salva o resultado deste nodo no pipeline</div>
            </div>
          </div>
          <Input
            value={(cfg.nodeOutputVar as string) ?? ""}
            onChange={(e) => onUpdateConfig("nodeOutputVar", e.target.value)}
            placeholder="Ex: meu_resultado  (opcional)"
            style={{ fontSize: 12, fontFamily: "monospace" }}
          />

          {(cfg.nodeOutputVar as string)?.trim() && (
            <OutputTypeSelector
              value={(cfg.outputType as string) ?? "auto"}
              onChange={(v) => onUpdateConfig("outputType", v)}
              isCodeNode={type === "code"}
            />
          )}

          {(cfg.nodeOutputVar as string)?.trim() && (
            <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 5, lineHeight: 1.5 }}>
              Após execução: <code style={{ color: "#34d399", background: "rgba(52,211,153,0.1)", padding: "1px 5px", borderRadius: 3 }}>
                pipeline["{(cfg.nodeOutputVar as string).trim()}"]
              </code> conterá o resultado deste nodo.
              {type === "code" && (
                <span style={{ display: "block", marginTop: 3 }}>
                  No código, use{" "}
                  <code style={{ color: "#a78bfa", background: "rgba(167,139,250,0.1)", padding: "1px 5px", borderRadius: 3 }}>
                    return &#123;"{(cfg.nodeOutputVar as string).trim()}": resultado&#125;
                  </code>{" "}para definir explicitamente.
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {!isNote && (
        <div style={{ borderTop: "1px solid hsl(var(--border))", paddingTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{
                width: 24, height: 24, borderRadius: 6,
                background: isPinned ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${isPinned ? "rgba(245,158,11,0.4)" : "hsl(var(--border))"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Pin size={12} color={isPinned ? "#f59e0b" : "hsl(var(--muted-foreground))"} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Mock Data (Pin)</div>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
                  {isPinned ? "Usando dados mockados — nodo não executa" : "Desativado — nodo executa normalmente"}
                </div>
              </div>
            </div>
            <Switch checked={isPinned} onCheckedChange={(v) => {
              onUpdateConfig("pinned", v);
              if (!v) onUpdateConfig("mockOutput", "");
            }} />
          </div>

          {isPinned && (
            <Field label="Output mockado (retornado sem executar)">
              <Textarea
                value={(cfg.mockOutput as string) ?? ""}
                onChange={(e) => onUpdateConfig("mockOutput", e.target.value)}
                placeholder='{"result": "valor mockado"}'
                rows={4}
                style={{ fontFamily: "monospace", fontSize: 12, borderColor: "rgba(245,158,11,0.4)" }}
              />
            </Field>
          )}
        </div>
      )}

      {!isNote && (
        <div style={{ borderTop: "1px solid hsl(var(--border))", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.07em",
            textTransform: "uppercase", color: "hsl(var(--muted-foreground))",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <FlaskConical size={12} /> Teste individual
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={onTestNode}
            disabled={testLoading}
            style={{ width: "100%", justifyContent: "center", gap: 7 }}
          >
            {testLoading
              ? <><Loader2 size={13} className="animate-spin" /> Executando...</>
              : <><FlaskConical size={13} /> Testar este nodo</>
            }
          </Button>

          {testResult && (
            <div style={{
              borderRadius: 8, overflow: "hidden",
              border: `1px solid ${testResult.success ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
            }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 7, padding: "8px 12px",
                background: testResult.success ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
              }}>
                {testResult.success
                  ? <CheckCircle2 size={14} color="#10b981" />
                  : <XCircle size={14} color="#ef4444" />}
                <span style={{ fontSize: 12, fontWeight: 600, color: testResult.success ? "#10b981" : "#ef4444" }}>
                  {testResult.success ? "Sucesso" : "Falhou"}
                </span>
                <span style={{ marginLeft: "auto", fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
                  {testResult.durationMs}ms
                </span>
              </div>
              <pre style={{
                margin: 0, padding: "10px 12px",
                fontSize: 11, fontFamily: "monospace",
                background: "rgba(0,0,0,0.3)",
                color: testResult.success ? "#a3e635" : "#fca5a5",
                whiteSpace: "pre-wrap", wordBreak: "break-all",
                maxHeight: 200, overflowY: "auto",
              }}>
                {testResult.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
