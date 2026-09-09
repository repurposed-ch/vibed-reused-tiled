import {
  DesignFamilyJsonSchema,
  type DesignFamilyJson,
  type StockStateJson,
  type TileDefinitionJson,
} from '@/domain/project';

export type LlmAssistRequest = {
  prompt: string;
  tileDefinitions: TileDefinitionJson[];
  stock?: StockStateJson;
  currentFamily?: DesignFamilyJson;
};

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

export async function assistDesignFamily(args: {
  endpoint: string;
  apiKey?: string;
  request: LlmAssistRequest;
}): Promise<DesignFamilyJson> {
  const endpoint = args.endpoint.trim();
  if (!endpoint) throw new Error('LLM endpoint is not configured');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (args.apiKey?.trim()) {
    headers.Authorization = `Bearer ${args.apiKey.trim()}`;
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(args.request),
  });

  if (!res.ok) {
    throw new Error(`LLM assist failed (${res.status}): ${await res.text()}`);
  }

  const json: unknown = await res.json();
  return DesignFamilyJsonSchema.parse(unwrapFamily(json));
}
