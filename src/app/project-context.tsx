import {
  createDefaultProject,
  parseTilingProject,
  projectFromJsonString,
  projectToJsonString,
  type DesignFamilyJson,
  type DesignInstanceJson,
  type TileSchemaJson,
  type TilingProjectJson,
} from '@/domain/project';
import { bakeInputFromTile, getBakedDataUrl } from '@/render/materials';
import {
  DEFAULT_LLM_PROVIDER_ID,
  getProvider,
  resolveModelForProvider,
} from '@/llm/providers';
import { createContext, useContext, useMemo, useState, useCallback, type ReactNode } from 'react';

const STORAGE_KEY = 'vibed-tiling-project';
const SETTINGS_KEY = 'vibed-llm-settings';

export type LlmSettings = {
  provider: string;
  model: string;
  apiKey: string;
};

type ProjectContextValue = {
  project: TilingProjectJson;
  setProject: (project: TilingProjectJson) => void;
  updateProject: (fn: (prev: TilingProjectJson) => TilingProjectJson) => void;
  setDesignFamily: (family: DesignFamilyJson) => void;
  setInstance: (instance: DesignInstanceJson | undefined) => void;
  setTileSchema: (tileSchema: TileSchemaJson | undefined) => void;
  downloadProject: () => void;
  uploadProject: (file: File) => Promise<void>;
  resetProject: () => void;
  llmSettings: LlmSettings;
  setLlmSettings: (settings: LlmSettings) => void;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

function loadProject(): TilingProjectJson {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return parseTilingProject(JSON.parse(raw) as unknown);
  } catch {
    /* ignore corrupt storage */
  }
  return createDefaultProject();
}

function defaultLlmSettings(): LlmSettings {
  const envProvider = import.meta.env.VITE_LLM_PROVIDER?.trim();
  const provider = getProvider(envProvider || DEFAULT_LLM_PROVIDER_ID);
  const envModel = import.meta.env.VITE_LLM_MODEL?.trim() || import.meta.env.VITE_GEMINI_MODEL?.trim();
  return {
    provider: provider.id,
    model: resolveModelForProvider(provider, envModel),
    apiKey: '',
  };
}

function loadLlmSettings(): LlmSettings {
  const defaults = defaultLlmSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LlmSettings> & { endpoint?: string };
      // Legacy: no provider → treat as gemini if a key/model was saved for Gemini-only settings.
      const providerId =
        parsed.provider?.trim() ||
        (parsed.apiKey || parsed.model ? 'gemini' : defaults.provider);
      const provider = getProvider(providerId);
      return {
        provider: provider.id,
        model: resolveModelForProvider(provider, parsed.model),
        apiKey: parsed.apiKey ?? '',
      };
    }
  } catch {
    /* ignore */
  }
  return defaults;
}

function persist(project: TilingProjectJson) {
  const next = {
    ...project,
    meta: {
      ...project.meta,
      updatedAt: new Date().toISOString(),
    },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProjectState] = useState<TilingProjectJson>(() => loadProject());
  const [llmSettings, setLlmSettingsState] = useState<LlmSettings>(() => loadLlmSettings());

  const setProject = useCallback((next: TilingProjectJson) => {
    setProjectState(persist(parseTilingProject(next)));
  }, []);

  const updateProject = useCallback((fn: (prev: TilingProjectJson) => TilingProjectJson) => {
    setProjectState((prev) => persist(parseTilingProject(fn(prev))));
  }, []);

  const setDesignFamily = useCallback((family: DesignFamilyJson) => {
    updateProject((prev) => ({ ...prev, designFamily: family }));
  }, [updateProject]);

  const setInstance = useCallback((instance: DesignInstanceJson | undefined) => {
    updateProject((prev) => ({ ...prev, instance }));
  }, [updateProject]);

  const setTileSchema = useCallback((tileSchema: TileSchemaJson | undefined) => {
    updateProject((prev) => ({ ...prev, tileSchema }));
  }, [updateProject]);

  const downloadProject = useCallback(() => {
    const materialMap = new Map(project.materials.map((m) => [m.id, m]));
    const withTextures: TilingProjectJson = {
      ...project,
      tileDefinitions: project.tileDefinitions.map((tile) => {
        const material = materialMap.get(tile.materialId);
        if (!material) return tile;
        try {
          const texture = getBakedDataUrl(bakeInputFromTile(tile, material));
          return { ...tile, texture };
        } catch {
          return tile;
        }
      }),
    };
    const blob = new Blob([projectToJsonString(withTextures)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.meta?.name?.replace(/\s+/g, '-') ?? 'tiling-project'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [project]);

  const uploadProject = useCallback(async (file: File) => {
    const text = await file.text();
    setProject(projectFromJsonString(text));
  }, [setProject]);

  const resetProject = useCallback(() => {
    setProject(createDefaultProject());
  }, [setProject]);

  const setLlmSettings = useCallback((settings: LlmSettings) => {
    setLlmSettingsState(settings);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, []);

  const value = useMemo(
    () => ({
      project,
      setProject,
      updateProject,
      setDesignFamily,
      setInstance,
      setTileSchema,
      downloadProject,
      uploadProject,
      resetProject,
      llmSettings,
      setLlmSettings,
    }),
    [
      project,
      setProject,
      updateProject,
      setDesignFamily,
      setInstance,
      setTileSchema,
      downloadProject,
      uploadProject,
      resetProject,
      llmSettings,
      setLlmSettings,
    ],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within ProjectProvider');
  return ctx;
}
