export type LlmAuth = 'none' | 'bearer' | 'gemini-header';

export type LlmModelOption = {
  id: string;
  label: string;
};

export type LlmProvider = {
  id: string;
  label: string;
  baseUrl: string;
  auth: LlmAuth;
  models: LlmModelOption[];
  /** Link to create / manage an API key (when auth is not none). */
  keyUrl?: string;
};

/** Curated free-tier providers from https://github.com/mnfst/awesome-free-llm-apis */
export const LLM_PROVIDERS: LlmProvider[] = [
  {
    id: 'ovhcloud',
    label: 'OVHcloud AI Endpoints',
    baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
    auth: 'none',
    models: [
      { id: 'Qwen3.5-397B-A17B', label: 'Qwen3.5-397B-A17B' },
      { id: 'gpt-oss-120b', label: 'gpt-oss-120b' },
      { id: 'gpt-oss-20b', label: 'gpt-oss-20b' },
      { id: 'Meta-Llama-3_3-70B-Instruct', label: 'Meta-Llama-3.3-70B-Instruct' },
      { id: 'Qwen3.6-27B', label: 'Qwen3.6-27B' },
      { id: 'Qwen3.5-9B', label: 'Qwen3.5-9B' },
      { id: 'Qwen3-32B', label: 'Qwen3-32B' },
      { id: 'Qwen3-Coder-30B-A3B-Instruct', label: 'Qwen3-Coder-30B-A3B-Instruct' },
      { id: 'Mistral-Small-3.2-24B-Instruct', label: 'Mistral-Small-3.2-24B-Instruct' },
      { id: 'Mistral-Nemo-Instruct-2407', label: 'Mistral-Nemo-Instruct-2407' },
      { id: 'Mistral-7B-Instruct-v0.3', label: 'Mistral-7B-Instruct-v0.3' },
    ],
  },
  {
    id: 'llm7',
    label: 'LLM7.io',
    baseUrl: 'https://api.llm7.io/v1',
    auth: 'none',
    models: [
      { id: 'gpt-oss:20b', label: 'gpt-oss:20b' },
      { id: 'mistral-Nemo-Instruct-2407', label: 'mistral-Nemo-Instruct-2407' },
      { id: 'minimax-m2.7', label: 'minimax-m2.7' },
    ],
  },
  {
    id: 'kilo',
    label: 'Kilo Code',
    baseUrl: 'https://api.kilo.ai/api/gateway',
    auth: 'none',
    models: [
      { id: 'kilo-auto/free', label: 'kilo-auto/free (router)' },
      { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'nemotron-3-ultra:free' },
      { id: 'stepfun/step-3.7-flash:free', label: 'step-3.7-flash:free' },
      { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'nemotron-3-super:free' },
      { id: 'poolside/laguna-s-2.1:free', label: 'laguna-s-2.1:free' },
      { id: 'openrouter/free', label: 'openrouter/free' },
      { id: 'liquid/lfm-2.5-2.6b:free', label: 'lfm-2.5-2.6b:free' },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    auth: 'gemini-header',
    keyUrl: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    auth: 'bearer',
    keyUrl: 'https://console.groq.com/keys',
    models: [
      { id: 'openai/gpt-oss-120b', label: 'openai/gpt-oss-120b' },
      { id: 'openai/gpt-oss-20b', label: 'openai/gpt-oss-20b' },
      { id: 'groq/compound', label: 'groq/compound' },
      { id: 'groq/compound-mini', label: 'groq/compound-mini' },
      { id: 'qwen/qwen3.6-27b', label: 'qwen/qwen3.6-27b' },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    auth: 'bearer',
    keyUrl: 'https://openrouter.ai/keys',
    models: [
      { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'nemotron-3-super:free' },
      { id: 'openai/gpt-oss-20b:free', label: 'gpt-oss-20b:free' },
      { id: 'cohere/north-mini-code:free', label: 'north-mini-code:free' },
      { id: 'google/gemma-4-26b-a4b-it:free', label: 'gemma-4-26b:free' },
      { id: 'google/gemma-4-31b-it:free', label: 'gemma-4-31b:free' },
      { id: 'openrouter/free', label: 'openrouter/free (router)' },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    auth: 'bearer',
    keyUrl: 'https://console.mistral.ai/api-keys',
    models: [
      { id: 'mistral-small-latest', label: 'Mistral Small (latest)' },
      { id: 'mistral-medium-latest', label: 'Mistral Medium (latest)' },
      { id: 'ministral-8b-latest', label: 'Ministral 8B' },
      { id: 'ministral-3b-latest', label: 'Ministral 3B' },
      { id: 'codestral-latest', label: 'Codestral' },
    ],
  },
  {
    id: 'aion',
    label: 'Aion Labs',
    baseUrl: 'https://api.aionlabs.ai/v1',
    auth: 'bearer',
    keyUrl: 'https://www.aionlabs.ai/app/api-keys/',
    models: [
      { id: 'aion-labs/aion-2.0', label: 'aion-2.0' },
      { id: 'aion-labs/aion-3.0', label: 'aion-3.0' },
      { id: 'aion-labs/aion-3.0-mini', label: 'aion-3.0-mini' },
      { id: 'aion-labs/aion-rp-llama-3.1-8b', label: 'aion-rp-llama-3.1-8b' },
    ],
  },
  {
    id: 'zai',
    label: 'Z AI (Zhipu)',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    auth: 'bearer',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    models: [
      { id: 'glm-4.7-flash', label: 'GLM-4.7-Flash' },
      { id: 'glm-4.5-flash', label: 'GLM-4.5-Flash' },
      { id: 'glm-4.6v-flash', label: 'GLM-4.6V-Flash' },
    ],
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    baseUrl: 'https://router.huggingface.co/v1',
    auth: 'bearer',
    keyUrl: 'https://huggingface.co/settings/tokens',
    models: [
      { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct', label: 'Meta-Llama-3.1-8B-Instruct' },
      { id: 'google/gemma-3-4b-it', label: 'gemma-3-4b-it' },
      { id: 'microsoft/phi-4', label: 'phi-4' },
      { id: 'Qwen/Qwen2.5-7B-Instruct', label: 'Qwen2.5-7B-Instruct' },
      { id: 'Qwen/Qwen2.5-Coder-7B-Instruct', label: 'Qwen2.5-Coder-7B-Instruct' },
    ],
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    auth: 'bearer',
    keyUrl: 'https://build.nvidia.com/explore/discover',
    models: [
      { id: 'nvidia/nemotron-3-nano-30b-a3b', label: 'nemotron-3-nano-30b' },
      { id: 'meta/llama-3.3-70b-instruct', label: 'llama-3.3-70b-instruct' },
      { id: 'google/gemma-4-31b-it', label: 'gemma-4-31b-it' },
      { id: 'openai/gpt-oss-120b', label: 'gpt-oss-120b' },
      { id: 'openai/gpt-oss-20b', label: 'gpt-oss-20b' },
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama Cloud',
    baseUrl: 'https://ollama.com/v1',
    auth: 'bearer',
    keyUrl: 'https://ollama.com/settings/keys',
    models: [
      { id: 'gpt-oss:20b', label: 'gpt-oss:20b' },
      { id: 'gpt-oss:120b', label: 'gpt-oss:120b' },
      { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
      { id: 'minimax-m3', label: 'minimax-m3' },
      { id: 'mistral-large-3:675b', label: 'mistral-large-3:675b' },
    ],
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    auth: 'bearer',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    models: [{ id: 'Qwen/Qwen3-8B', label: 'Qwen/Qwen3-8B' }],
  },
  {
    id: 'modelscope',
    label: 'ModelScope',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    auth: 'bearer',
    keyUrl: 'https://modelscope.cn/my/myaccesstoken',
    models: [
      { id: 'Qwen/Qwen3.5-35B-A3B', label: 'Qwen3.5-35B-A3B' },
      { id: 'Qwen/Qwen3.5-27B', label: 'Qwen3.5-27B' },
    ],
  },
];

export const AWESOME_FREE_LLM_APIS_URL = 'https://github.com/mnfst/awesome-free-llm-apis';

export const DEFAULT_LLM_PROVIDER_ID = 'ovhcloud';

export function getProvider(id: string | undefined): LlmProvider {
  return LLM_PROVIDERS.find((p) => p.id === id) ?? LLM_PROVIDERS[0]!;
}

export function defaultModelForProvider(provider: LlmProvider): string {
  return provider.models[0]?.id ?? '';
}

export function resolveModelForProvider(provider: LlmProvider, model: string | undefined): string {
  const trimmed = model?.trim();
  if (trimmed && provider.models.some((m) => m.id === trimmed)) return trimmed;
  return defaultModelForProvider(provider);
}

export function providerRequiresApiKey(provider: LlmProvider): boolean {
  return provider.auth !== 'none';
}
