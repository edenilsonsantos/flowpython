import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Bot, Key, CheckCircle2, XCircle, Loader2, Eye, EyeOff, Save, RefreshCw,
  Terminal, Package, ArrowUpCircle, AlertTriangle,
} from "lucide-react";

interface AiProviderState {
  id: string;
  name: string;
  color: string;
  models: string[];
  model: string;
  enabled: boolean;
  hasKey: boolean;
}

const PROVIDER_ICONS: Record<string, string> = {
  openai:    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/OpenAI_Logo.svg/512px-OpenAI_Logo.svg.png",
  gemini:    "https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg",
  anthropic: "https://avatars.githubusercontent.com/u/76263028?s=200&v=4",
};

function ProviderCard({
  provider, onSaved,
}: { provider: AiProviderState; onSaved: () => void }) {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(provider.model || provider.models[0] || "");
  const [enabled, setEnabled] = useState(provider.enabled);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setModel(provider.model || provider.models[0] || "");
    setEnabled(provider.enabled);
  }, [provider]);

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { model, enabled };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const res = await fetch(`/api/settings/ai-providers/${provider.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Falha ao salvar");
      toast({ title: "Salvo", description: `${provider.name} atualizado com sucesso.` });
      setApiKey("");
      onSaved();
    } catch {
      toast({ title: "Erro", description: "Não foi possível salvar as configurações.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async () => {
    setSaving(true);
    try {
      await fetch(`/api/settings/ai-providers/${provider.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "CLEAR", enabled: false }),
      });
      setEnabled(false);
      toast({ title: "Chave removida", description: `Chave de API do ${provider.name} removida.` });
      onSaved();
    } catch {
      toast({ title: "Erro", description: "Não foi possível remover a chave.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ border: enabled ? `1px solid ${provider.color}40` : undefined }}>
      <CardHeader style={{ paddingBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8, overflow: "hidden",
              background: "hsl(var(--muted))", display: "flex", alignItems: "center", justifyContent: "center",
              border: "1px solid hsl(var(--border))",
            }}>
              {PROVIDER_ICONS[provider.id]
                ? <img src={PROVIDER_ICONS[provider.id]} alt={provider.name}
                    style={{ width: 22, height: 22, objectFit: "contain" }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                : <Bot size={18} />}
            </div>
            <div>
              <CardTitle style={{ fontSize: 15 }}>{provider.name}</CardTitle>
              <CardDescription style={{ fontSize: 12, marginTop: 2 }}>
                {provider.hasKey
                  ? <span style={{ color: "#34d399", display: "flex", alignItems: "center", gap: 4 }}>
                      <CheckCircle2 size={11} /> Chave configurada
                    </span>
                  : <span style={{ color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center", gap: 4 }}>
                      <XCircle size={11} /> Sem chave de API
                    </span>
                }
              </CardDescription>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {enabled && <Badge style={{ background: `${provider.color}20`, color: provider.color, border: `1px solid ${provider.color}40`, fontSize: 10 }}>Ativo</Badge>}
            <Switch
              checked={enabled}
              disabled={!provider.hasKey && !apiKey.trim()}
              onCheckedChange={(v) => setEnabled(v)}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6, color: "hsl(var(--muted-foreground))" }}>
            Chave de API
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Input
                type={showKey ? "text" : "password"}
                placeholder={provider.hasKey ? "••••••••••••••• (chave salva)" : "sk-... ou AIza..."}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                style={{ paddingRight: 36, fontFamily: "monospace", fontSize: 13 }}
              />
              <button
                onClick={() => setShowKey(!showKey)}
                style={{
                  position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))",
                  padding: 0, display: "flex", alignItems: "center",
                }}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {provider.hasKey && (
              <Button variant="outline" size="sm" onClick={clearKey} disabled={saving} style={{ flexShrink: 0, fontSize: 12 }}>
                Remover
              </Button>
            )}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6, color: "hsl(var(--muted-foreground))" }}>
            Modelo padrão
          </label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger style={{ fontSize: 13 }}>
              <SelectValue placeholder="Selecione um modelo" />
            </SelectTrigger>
            <SelectContent>
              {provider.models.map((m) => (
                <SelectItem key={m} value={m} style={{ fontSize: 13, fontFamily: "monospace" }}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
          <Button size="sm" onClick={save} disabled={saving} style={{ gap: 6 }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface PythonEnvInfo {
  python: { version: string; systemManaged: boolean };
  pip: { version: string; latestVersion: string | null; upgradeAvailable: boolean };
  venvCount: number;
}

function VersionBadge({ current, latest, upgradeAvailable }: { current: string; latest: string | null; upgradeAvailable: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <code style={{
        background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))",
        borderRadius: 6, padding: "3px 10px", fontSize: 13, fontFamily: "monospace", fontWeight: 600,
        color: "hsl(var(--foreground))",
      }}>{current}</code>
      {latest && (
        <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
          última: <code style={{ fontFamily: "monospace" }}>{latest}</code>
        </span>
      )}
      {upgradeAvailable && (
        <Badge style={{ background: "rgba(234,179,8,0.15)", color: "#ca8a04", border: "1px solid rgba(234,179,8,0.3)", fontSize: 10, gap: 4 }}>
          <AlertTriangle size={10} /> Atualização disponível
        </Badge>
      )}
      {!upgradeAvailable && latest && (
        <Badge style={{ background: "rgba(20,184,166,0.1)", color: "#14b8a6", border: "1px solid rgba(20,184,166,0.25)", fontSize: 10, gap: 4 }}>
          <CheckCircle2 size={10} /> Atualizado
        </Badge>
      )}
    </div>
  );
}

function PythonEnvCard() {
  const { toast } = useToast();
  const [info, setInfo] = useState<PythonEnvInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);

  const fetchInfo = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/python-env");
      if (res.ok) setInfo(await res.json());
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  const handleUpgradePip = async () => {
    setUpgrading(true);
    try {
      const res = await fetch("/api/settings/pip-upgrade", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: "pip atualizado",
          description: data.venvCount === 0
            ? "Nenhum ambiente virtual encontrado para atualizar."
            : `pip atualizado em ${data.upgraded} ambiente(s)${data.failed > 0 ? `, ${data.failed} com erro` : ""}.`,
        });
        await fetchInfo();
      } else {
        throw new Error(data.error);
      }
    } catch (e: any) {
      toast({ title: "Erro ao atualizar pip", description: e.message, variant: "destructive" });
    } finally {
      setUpgrading(false);
    }
  };

  return (
    <Card>
      <CardHeader style={{ paddingBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8, background: "rgba(59,130,246,0.1)",
              border: "1px solid rgba(59,130,246,0.25)", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Terminal size={18} style={{ color: "#3b82f6" }} />
            </div>
            <div>
              <CardTitle style={{ fontSize: 15 }}>Ambiente de Execução Python</CardTitle>
              <CardDescription style={{ fontSize: 12, marginTop: 2 }}>
                Versões do interpretador e gerenciador de pacotes
              </CardDescription>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchInfo} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
            <Loader2 size={22} className="animate-spin" style={{ color: "hsl(var(--muted-foreground))" }} />
          </div>
        ) : info ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Python */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 16px", borderRadius: 8,
              background: "hsl(var(--muted)/40%)", border: "1px solid hsl(var(--border))",
              flexWrap: "wrap", gap: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 6, background: "rgba(59,130,246,0.12)",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <Terminal size={15} style={{ color: "#3b82f6" }} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Python</div>
                  <VersionBadge current={info.python.version} latest={null} upgradeAvailable={false} />
                </div>
              </div>
              <Badge style={{
                background: "rgba(99,102,241,0.1)", color: "#818cf8",
                border: "1px solid rgba(99,102,241,0.25)", fontSize: 10,
              }}>
                Gerenciado pelo sistema
              </Badge>
            </div>

            {/* pip */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 16px", borderRadius: 8,
              background: "hsl(var(--muted)/40%)", border: "1px solid hsl(var(--border))",
              flexWrap: "wrap", gap: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 6, background: "rgba(20,184,166,0.12)",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <Package size={15} style={{ color: "#14b8a6" }} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>pip</div>
                  <VersionBadge
                    current={info.pip.version}
                    latest={info.pip.latestVersion}
                    upgradeAvailable={info.pip.upgradeAvailable}
                  />
                </div>
              </div>
              {info.pip.upgradeAvailable && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleUpgradePip}
                  disabled={upgrading}
                  style={{ gap: 6, borderColor: "rgba(234,179,8,0.4)", color: "#ca8a04", flexShrink: 0 }}
                >
                  {upgrading
                    ? <><Loader2 size={13} className="animate-spin" /> Atualizando...</>
                    : <><ArrowUpCircle size={13} /> Atualizar para {info.pip.latestVersion}</>}
                </Button>
              )}
            </div>

            {/* venv info */}
            <div style={{
              fontSize: 12, color: "hsl(var(--muted-foreground))",
              background: "hsl(var(--muted)/30%)", borderRadius: 7,
              padding: "10px 14px", display: "flex", alignItems: "center", gap: 8,
            }}>
              <Package size={13} style={{ flexShrink: 0 }} />
              <span>
                {info.venvCount === 0
                  ? "Nenhum ambiente virtual criado ainda. Eles são criados automaticamente ao instalar pacotes nos workflows."
                  : `${info.venvCount} ambiente${info.venvCount > 1 ? "s virtuais" : " virtual"} ativo${info.venvCount > 1 ? "s" : ""} — cada workflow tem seu próprio ambiente Python isolado.`}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: 24 }}>
            Não foi possível carregar informações do ambiente.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const [providers, setProviders] = useState<AiProviderState[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/ai-providers");
      if (!res.ok) return;
      const data = await res.json();
      setProviders(data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProviders(); }, [fetchProviders]);

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-2">Gerencie as preferências e integrações da plataforma.</p>
      </div>

      {/* AI Integrations */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              <Bot size={20} style={{ color: "#a78bfa" }} />
              Integrações de IA
            </h2>
            <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
              Configure chaves de API para usar assistente de geração de código nos nodos Python.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchProviders} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </Button>
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader2 size={24} className="animate-spin" style={{ color: "hsl(var(--muted-foreground))" }} />
          </div>
        ) : (
          <div className="space-y-4">
            {providers.map((p) => (
              <ProviderCard key={p.id} provider={p} onSaved={fetchProviders} />
            ))}
          </div>
        )}
      </div>

      {/* Python Environment */}
      <div>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Terminal size={20} style={{ color: "#3b82f6" }} />
            Ambiente Python
          </h2>
          <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
            Versões instaladas e gerenciamento do ambiente de execução.
          </p>
        </div>
        <PythonEnvCard />
      </div>
    </div>
  );
}
