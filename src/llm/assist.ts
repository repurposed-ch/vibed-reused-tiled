import {
  DesignFamilyJsonSchema,
  type DesignFamilyJson,
  type StockStateJson,
  type TileDefinitionJson,
} from '@/domain/project';

/** Prefer a concrete model id; aliases like `gemini-flash-latest` often hit capacity 503s. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.7-flash';

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
          "localMat3": [1, 0, 0, 0, 1, 0, "x", "y", 1],
          "role": "optional string"
        }
      ],
      "children": [{"moduleId": "string", "localMat3": [1,0,0,0,1,0,0,0,1]}],
      "repeat": {"count": 2, "offsetMat3": [1,0,0,0,1,0,"dx","dy",1]},
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

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function buildUserPrompt(request: LlmAssistRequest): string {
  const parts = [
    'You are assisting a reused-tile design tool.',
    'Return ONLY a single JSON object matching this DesignFamily schema (no markdown, no commentary):',
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
    'Rules: use only tileDefinitionId values from the tile definitions; keep mat3 as 9-number row-major arrays; invent new uuids for new ids.',
  );
  return parts.join('\n');
}

function extractCandidateText(json: unknown): string {
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeModelId(model: string | undefined): string {
  const raw = (model?.trim() || DEFAULT_GEMINI_MODEL).replace(/^models\//, '');
  // Alias often shares a hot pool; steer new/legacy settings to a concrete id.
  if (raw === 'gemini-flash-latest' || raw === 'gemini-flash') return DEFAULT_GEMINI_MODEL;
  return raw;
}

export async function assistDesignFamily(args: {
  apiKey: string;
  model?: string;
  request: LlmAssistRequest;
}): Promise<DesignFamilyJson> {
  const apiKey = args.apiKey.trim();
  if (!apiKey) throw new Error('Gemini API key is not configured');

  const model = normalizeModelId(args.model);
  const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`;
  const body = JSON.stringify({
    contents: [
      {
        parts: [{ text: buildUserPrompt(args.request) }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
    },
  });

  let lastErrorText = '';
  let lastStatus = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey,
      },
      body,
    });

    if (res.ok) {
      const payload: unknown = await res.json();
      const text = extractCandidateText(payload);
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripCodeFences(text)) as unknown;
      } catch {
        throw new Error('LLM assist failed: model reply was not valid JSON');
      }
      return DesignFamilyJsonSchema.parse(unwrapFamily(parsed));
    }

    lastStatus = res.status;
    lastErrorText = await res.text();
    if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) break;
    await sleep(500 * 2 ** (attempt - 1));
  }

  const hint =
    lastStatus === 503
      ? ' Model is overloaded — try again shortly, or set another model in Settings (e.g. gemini-3.6-flash).'
      : lastStatus === 429
        ? ' Rate limited — wait a moment and retry.'
        : '';
  throw new Error(`LLM assist failed (${lastStatus}): ${lastErrorText}${hint}`);
}
