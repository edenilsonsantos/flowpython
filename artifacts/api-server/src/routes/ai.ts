import { Router } from "express";
import { db, aiProvidersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const SYSTEM_PROMPT = `You are a Python code generator for flowpython, a visual automation platform.
Context variables always available in your generated code:
- pipeline: dict — data flowing from upstream nodes (can be read and written)
- workflow: dict — workflow-scoped variables

Rules:
- Output ONLY valid Python code, no markdown fences, no explanations, no comments unless essential.
- Use pipeline and workflow dicts to read inputs and write outputs.
- Assign results to pipeline keys so downstream nodes can access them.
- Keep code concise and production-ready.
- Never import packages that require installation beyond common stdlib + requests (unless user asks).`;

export const AI_PROVIDER_META: Record<string, { name: string; color: string; models: string[] }> = {
  openai: {
    name: "OpenAI",
    color: "#74AA9C",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4-turbo", "gpt-3.5-turbo"],
  },
  gemini: {
    name: "Google Gemini",
    color: "#4285F4",
    models: ["gemini-2.5-flash-preview-05-20", "gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  },
  anthropic: {
    name: "Anthropic",
    color: "#D4A574",
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-3-5", "claude-3-5-sonnet-20241022"],
  },
};

async function ensureProviders() {
  for (const id of Object.keys(AI_PROVIDER_META)) {
    const existing = await db.select().from(aiProvidersTable).where(eq(aiProvidersTable.id, id)).limit(1);
    if (existing.length === 0) {
      await db.insert(aiProvidersTable).values({ id, apiKey: "", model: "", enabled: false });
    }
  }
}

// GET /api/settings/ai-providers
router.get("/settings/ai-providers", async (req, res) => {
  try {
    await ensureProviders();
    const rows = await db.select().from(aiProvidersTable);
    const result = rows.map((r) => ({
      id: r.id,
      name: AI_PROVIDER_META[r.id]?.name ?? r.id,
      color: AI_PROVIDER_META[r.id]?.color ?? "#888",
      models: AI_PROVIDER_META[r.id]?.models ?? [],
      model: r.model,
      enabled: r.enabled,
      hasKey: r.apiKey !== "",
    }));
    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/settings/ai-providers/:provider
router.put("/settings/ai-providers/:provider", async (req, res) => {
  const { provider } = req.params;
  if (!AI_PROVIDER_META[provider]) return res.status(404).json({ error: "Unknown provider" });

  const { apiKey, model, enabled } = req.body as { apiKey?: string; model?: string; enabled?: boolean };

  try {
    await ensureProviders();
    const update: Partial<{ apiKey: string; model: string; enabled: boolean }> = {};
    if (typeof enabled === "boolean") update.enabled = enabled;
    if (typeof model === "string") update.model = model;
    if (typeof apiKey === "string" && apiKey !== "") update.apiKey = apiKey;
    if (typeof apiKey === "string" && apiKey === "CLEAR") update.apiKey = "";

    await db.update(aiProvidersTable).set(update).where(eq(aiProvidersTable.id, provider));
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/ai/generate-code
router.post("/ai/generate-code", async (req, res) => {
  const { provider, model, prompt } = req.body as { provider: string; model: string; prompt: string };

  if (!provider || !model || !prompt) {
    return res.status(400).json({ error: "provider, model e prompt são obrigatórios" });
  }

  try {
    const [row] = await db.select().from(aiProvidersTable).where(eq(aiProvidersTable.id, provider)).limit(1);
    if (!row || !row.enabled || !row.apiKey) {
      return res.status(400).json({ error: "Provedor não configurado ou desativado" });
    }

    const apiKey = row.apiKey;
    let code = "";

    if (provider === "openai") {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as Record<string, unknown>;
        return res.status(502).json({ error: (err as any)?.error?.message ?? `OpenAI error ${resp.status}` });
      }
      const data = await resp.json() as any;
      code = data.choices?.[0]?.message?.content ?? "";

    } else if (provider === "gemini") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 },
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as any;
        return res.status(502).json({ error: err?.error?.message ?? `Gemini error ${resp.status}` });
      }
      const data = await resp.json() as any;
      code = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    } else if (provider === "anthropic") {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as any;
        return res.status(502).json({ error: err?.error?.message ?? `Anthropic error ${resp.status}` });
      }
      const data = await resp.json() as any;
      code = data.content?.[0]?.text ?? "";
    } else {
      return res.status(400).json({ error: "Provedor desconhecido" });
    }

    // Strip markdown code fences if present
    code = code.replace(/^```python\n?/i, "").replace(/^```\n?/i, "").replace(/\n?```$/i, "").trim();
    res.json({ code });
  } catch (err: any) {
    req.log.error(err);
    res.status(500).json({ error: err?.message ?? "Internal server error" });
  }
});

export default router;
