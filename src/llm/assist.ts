import {
  DesignFamilyJsonSchema,
  MaterialDefinitionJsonSchema,
  type DesignFamilyJson,
  type MaterialDefinitionJson,
  type StockStateJson,
  type TileDefinitionJson,
} from '@/domain/project';
import { coerceMat3Json } from '@/domain/mat3';
import {
  getProvider,
  providerRequiresApiKey,
  resolveModelForProvider,
  type LlmProvider,
} from '@/llm/providers';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRYABLE_STATUS = new Set([429, 503]);
const MAX_ATTEMPTS = 3;

export type LlmAssistRequest = {
  prompt: string;
  tileDefinitions: TileDefinitionJson[];
  stock?: StockStateJson;
  currentFamily?: DesignFamilyJson;
};

const SCHEMA_HINT = `{
  "type": "DesignFamily",
  "id": "string",
  "name": "string",
  "modules": [
    {
      "type": "DesignModule",
      "id": "string",
      "name": "string",
      "placements": [
        {
          "id": "string",
          "tileDefinitionId": "string (must match an available tile id)",
          "localMat3": { "type": "Mat3", "elements": [1, 0, 0, 0, 1, 0, "x", "y", 1] },
          "role": "optional string"
        }
      ],
      "children": [
        {
          "moduleId": "string",
          "localMat3": { "type": "Mat3", "elements": [1, 0, 0, 0, 1, 0, 0, 0, 1] }
        }
      ],
      "repeat": {
        "count": 2,
        "offsetMat3": { "type": "Mat3", "elements": [1, 0, 0, 0, 1, 0, "dx", "dy", 1] }
      },
      "anchor": "origin" | "centroid" | "bboxMin"
    }
  ],
  "primaryModuleIds": ["module id"],
  "constraints": [
    {
      "id": "string",
      "kind": "rhythmMatch" | "adjacencyPrefer" | "materialAlternate" | "gapTolerance",
      "weight": 1,
      "params": {}
    }
  ]
}`;

function unwrapFamily(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const obj = data as Record<string, unknown>;
  if (obj.type === 'DesignFamily') return obj;
  if (obj.family) return obj.family;
  if (obj.designFamily) return obj.designFamily;
  if (typeof obj.content === 'string') {
    try {
      return unwrapFamily(JSON.parse(obj.content) as unknown);
    } catch {
      return data;
    }
  }
  return data;
}

/** Coerce bare Mat3 arrays inside a DesignFamily-shaped object. */
function normalizeFamilyMat3s(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const family = data as Record<string, unknown>;
  const modules = family.modules;
  if (!Array.isArray(modules)) return data;

  return {
    ...family,
    modules: modules.map((mod) => {
      if (typeof mod !== 'object' || mod === null) return mod;
      const m = mod as Record<string, unknown>;
      const placements = Array.isArray(m.placements)
        ? m.placements.map((pl) => {
            if (typeof pl !== 'object' || pl === null) return pl;
            const p = pl as Record<string, unknown>;
            return { ...p, localMat3: coerceMat3Json(p.localMat3) };
          })
        : m.placements;
      const children = Array.isArray(m.children)
        ? m.children.map((ch) => {
            if (typeof ch !== 'object' || ch === null) return ch;
            const c = ch as Record<string, unknown>;
            return { ...c, localMat3: coerceMat3Json(c.localMat3) };
          })
        : m.children;
      let repeat = m.repeat;
      if (typeof repeat === 'object' && repeat !== null) {
        const r = repeat as Record<string, unknown>;
        repeat = { ...r, offsetMat3: coerceMat3Json(r.offsetMat3) };
      }
      return { ...m, placements, children, repeat };
    }),
  };
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function buildUserPrompt(request: LlmAssistRequest): string {
  const parts = [
    'You are assisting a reused-tile design tool.',
    'Return ONLY a single DesignFamily JSON object matching this schema (no markdown, no commentary):',
    SCHEMA_HINT,
    '',
    'Designer request:',
    request.prompt.trim(),
    '',
    'Available tile definitions (JSON):',
    JSON.stringify(request.tileDefinitions),
  ];
  if (request.stock) {
    parts.push('', 'Stock hints (JSON):', JSON.stringify(request.stock));
  }
  if (request.currentFamily) {
    parts.push('', 'Current design family to revise (JSON):', JSON.stringify(request.currentFamily));
  }
  parts.push(
    '',
    'Rules: use only tileDefinitionId values from the tile definitions; every Mat3 must be {"type":"Mat3","elements":[9 numbers]} (column-major; translation in elements[6] and elements[7]); invent new uuids for new ids.',
  );
  return parts.join('\n');
}

function parseFamilyJson(text: string): DesignFamilyJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(text)) as unknown;
  } catch {
    throw new Error('LLM assist failed: model reply was not valid JSON');
  }
  return DesignFamilyJsonSchema.parse(normalizeFamilyMat3s(unwrapFamily(parsed)));
}

function extractGeminiText(json: unknown): string {
  if (typeof json !== 'object' || json === null) {
    throw new Error('LLM assist failed: unexpected response shape');
  }
  const root = json as Record<string, unknown>;
  const candidates = root.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    const block = root.promptFeedback ?? root.error;
    throw new Error(
      `LLM assist failed: no candidates${block ? ` (${JSON.stringify(block)})` : ''}`,
    );
  }
  const first = candidates[0] as Record<string, unknown>;
  const content = first.content as Record<string, unknown> | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('LLM assist failed: empty candidate content');
  }
  const text = parts
    .map((p) => (typeof p === 'object' && p && 'text' in p ? String((p as { text: unknown }).text) : ''))
    .join('');
  if (!text.trim()) {
    throw new Error('LLM assist failed: candidate text was empty');
  }
  return text;
}

function extractOpenAiText(json: unknown): string {
  if (typeof json !== 'object' || json === null) {
    throw new Error('LLM assist failed: unexpected response shape');
  }
  const root = json as Record<string, unknown>;
  const choices = root.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error(`LLM assist failed: no choices (${JSON.stringify(root.error ?? root)})`);
  }
  const first = choices[0] as Record<string, unknown>;
  const message = first.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        typeof part === 'object' && part && 'text' in part
          ? String((part as { text: unknown }).text)
          : typeof part === 'string'
            ? part
            : '',
      )
      .join('');
    if (text.trim()) return text;
  }
  throw new Error('LLM assist failed: empty completion content');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusHint(status: number): string {
  if (status === 503) {
    return ' Model is overloaded — try again shortly, or pick another provider/model in Settings.';
  }
  if (status === 429) return ' Rate limited — wait a moment and retry.';
  if (status === 0) {
    return ' Network/CORS error — this provider may block browser calls; try another free provider or a proxy.';
  }
  return '';
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<{ ok: true; json: unknown } | { ok: false; status: number; text: string }> {
  let lastErrorText = '';
  let lastStatus = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      lastStatus = 0;
      lastErrorText = err instanceof Error ? err.message : String(err);
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(500 * 2 ** (attempt - 1));
      continue;
    }

    if (res.ok) {
      return { ok: true, json: await res.json() };
    }

    lastStatus = res.status;
    lastErrorText = await res.text();
    if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) break;
    await sleep(500 * 2 ** (attempt - 1));
  }

  return { ok: false, status: lastStatus, text: lastErrorText };
}

async function callGeminiGenerateContent(args: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<string> {
  const model = args.model.replace(/^models\//, '');
  const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`;
  const result = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': args.apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: args.prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  if (!result.ok) {
    throw new Error(`LLM assist failed (${result.status}): ${result.text}${statusHint(result.status)}`);
  }
  return extractGeminiText(result.json);
}

async function callOpenAiChatCompletions(args: {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<string> {
  const url = `${args.provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (args.provider.auth === 'bearer' && args.apiKey) {
    headers.Authorization = `Bearer ${args.apiKey}`;
  }

  const messages = [
    {
      role: 'user',
      content: args.prompt,
    },
  ];

  const withFormat = {
    model: args.model,
    messages,
    response_format: { type: 'json_object' as const },
  };
  const withoutFormat = { model: args.model, messages };

  let result = await fetchWithRetry(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(withFormat),
  });

  // Some free gateways reject response_format — retry once without it.
  if (!result.ok && result.status === 400) {
    result = await fetchWithRetry(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(withoutFormat),
    });
  }

  if (!result.ok) {
    throw new Error(`LLM assist failed (${result.status}): ${result.text}${statusHint(result.status)}`);
  }
  return extractOpenAiText(result.json);
}

async function callLlmText(args: {
  provider: string;
  model: string;
  apiKey?: string;
  prompt: string;
}): Promise<string> {
  const provider = getProvider(args.provider);
  const model = resolveModelForProvider(provider, args.model);
  const apiKey = args.apiKey?.trim() ?? '';

  if (providerRequiresApiKey(provider) && !apiKey) {
    throw new Error(`${provider.label} API key is not configured`);
  }

  if (provider.auth === 'gemini-header') {
    return callGeminiGenerateContent({ apiKey, model, prompt: args.prompt });
  }

  return callOpenAiChatCompletions({ provider, apiKey, model, prompt: args.prompt });
}

export async function assistDesignFamily(args: {
  provider: string;
  model: string;
  apiKey?: string;
  request: LlmAssistRequest;
}): Promise<DesignFamilyJson> {
  const text = await callLlmText({
    provider: args.provider,
    model: args.model,
    apiKey: args.apiKey,
    prompt: buildUserPrompt(args.request),
  });
  return parseFamilyJson(text);
}

const MATERIAL_SCHEMA_HINT = `{
  "type": "MaterialDefinition",
  "id": "string uuid",
  "name": "short material name e.g. terracotta",
  "seed": 1,
  "periodMeters": 0.3,
  "sdf": {
    "op": "mix | mul | add | union | subtract | intersect | smoothUnion | translate | rotate | scale | repeat | mirror | circle | box | ring | line | noise | voronoi | brick | band | fill",
    "...": "recursive SDF / procedural graph; sampling is periodic over periodMeters so the bake is edge-repeating"
  }
}

SDF node examples:
{ "op": "noise", "scale": 6, "octaves": 4 }
{ "op": "voronoi", "scale": 5, "edgeWidth": 0.08 }
{ "op": "brick", "brickW": 0.15, "brickH": 0.08, "mortar": 0.012, "offset": 0.5 }
{ "op": "mix", "t": 0.5, "a": { "op": "noise", "scale": 4 }, "b": { "op": "voronoi", "scale": 3 } }
{ "op": "fill", "soft": 0.02, "child": { "op": "circle", "radius": 0.05, "center": [0.1, 0.1] } }
{ "op": "repeat", "period": [0.15, 0.15], "child": { "op": "circle", "radius": 0.03 } }`;

export type LlmMaterialAssistRequest = {
  prompt: string;
  currentMaterial?: MaterialDefinitionJson;
};

function unwrapMaterial(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const obj = data as Record<string, unknown>;
  if (obj.type === 'MaterialDefinition') return obj;
  if (obj.material) return obj.material;
  if (typeof obj.content === 'string') {
    try {
      return unwrapMaterial(JSON.parse(obj.content) as unknown);
    } catch {
      return data;
    }
  }
  return data;
}

function parseMaterialJson(text: string): MaterialDefinitionJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(text)) as unknown;
  } catch {
    throw new Error('LLM assist failed: model reply was not valid JSON');
  }
  return MaterialDefinitionJsonSchema.parse(unwrapMaterial(parsed));
}

function buildMaterialPrompt(request: LlmMaterialAssistRequest): string {
  const parts = [
    'You are assisting a reused-tile design tool.',
    'Return ONLY a single MaterialDefinition JSON object matching this schema (no markdown, no commentary):',
    MATERIAL_SCHEMA_HINT,
    '',
    'Designer request:',
    request.prompt.trim(),
  ];
  if (request.currentMaterial) {
    parts.push(
      '',
      'Current material to revise (JSON):',
      JSON.stringify(request.currentMaterial),
    );
  }
  parts.push(
    '',
    'Rules: the SDF must be seamlessly tileable (periodic over periodMeters); prefer noise/voronoi/brick/mix; invent a new uuid for id unless revising; keep periodMeters between 0.1 and 1.0; seed is an integer.',
  );
  return parts.join('\n');
}

export async function assistMaterial(args: {
  provider: string;
  model: string;
  apiKey?: string;
  request: LlmMaterialAssistRequest;
}): Promise<MaterialDefinitionJson> {
  const text = await callLlmText({
    provider: args.provider,
    model: args.model,
    apiKey: args.apiKey,
    prompt: buildMaterialPrompt(args.request),
  });
  return parseMaterialJson(text);
}
