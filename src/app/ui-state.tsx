import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { TileSchemaJson } from '@/domain/project';

/**
 * Editor state that lives outside the project document.
 *
 * React Router unmounts a page on navigation, so everything a page held in
 * `useState` was being thrown away the moment you left it — the rapport sliders
 * fell back to their defaults, the in-progress schema draft vanished, an
 * unaccepted LLM proposal (real API spend) was lost. This holds the parts a user
 * actually authored, write-through to localStorage on every change and read back
 * on load.
 *
 * It is deliberately *not* part of `TilingProjectJson`: none of it should travel
 * inside a downloaded project file, and keeping it out avoids a schema
 * migration. Transient status — messages, errors, busy flags, object URLs — is
 * not kept here either; it has no authorship in it and stale status is worse
 * than none.
 */

const STORAGE_KEY = 'vibed-ui-state';

export type SolveStatus =
  | { kind: 'idle' }
  | { kind: 'solving' }
  | { kind: 'error'; reason: string };

export type UiState = {
  /** In-progress tile schema; committed to the project whenever it tiles. */
  schemaDraft: TileSchemaJson | null;
  /** Relative area weights per tile definition, driving the rapport search. */
  shares: Record<string, number>;
  pad: number;
  axesOn: boolean;
  selectedLevelId: string | null;
  paintTileId: string | null;
  schemaRaw: string | null;
  seed: number;
  variants: number[];
  boundaryRaw: string | null;
  drawResolution: number;
  drawMode: 'outer' | 'hole';
  schemaPrompt: string;
  materialPrompt: string;
  /** Selected SDF node in the material graph editor, as a slot path key ('root', 'b.child'). */
  selectedSdfPath: string | null;
};

const DEFAULT_UI_STATE: UiState = {
  schemaDraft: null,
  shares: {},
  pad: 1,
  axesOn: false,
  selectedLevelId: null,
  paintTileId: null,
  schemaRaw: null,
  seed: 42,
  variants: [],
  boundaryRaw: null,
  drawResolution: 0.25,
  drawMode: 'outer',
  schemaPrompt: 'A running bond of the large format with a course of units every fourth row.',
  materialPrompt: 'Worn terracotta with fine grain and subtle speckles, seamlessly tileable.',
  selectedSdfPath: null,
};

function loadUiState(): UiState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_UI_STATE;
    // Merged over the defaults rather than trusted wholesale: a stored blob from
    // an older build is missing whatever has been added since.
    return { ...DEFAULT_UI_STATE, ...(JSON.parse(raw) as Partial<UiState>) };
  } catch {
    return DEFAULT_UI_STATE;
  }
}

function persist(next: UiState): UiState {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A full or blocked store must not take the editor down with it.
  }
  return next;
}

type UiStateContextValue = {
  ui: UiState;
  patchUi: (patch: Partial<UiState>) => void;
  resetUi: () => void;
  /** Live solver status. In memory only — stale status on reload helps nobody. */
  solveStatus: SolveStatus;
  setSolveStatus: (status: SolveStatus) => void;
};

const UiStateContext = createContext<UiStateContextValue | null>(null);

export function UiStateProvider({ children }: { children: ReactNode }) {
  const [ui, setUi] = useState<UiState>(() => loadUiState());
  const [solveStatus, setSolveStatus] = useState<SolveStatus>({ kind: 'idle' });

  const patchUi = useCallback((patch: Partial<UiState>) => {
    setUi((prev) => persist({ ...prev, ...patch }));
  }, []);

  const resetUi = useCallback(() => {
    setUi(persist({ ...DEFAULT_UI_STATE }));
  }, []);

  const value = useMemo(
    () => ({ ui, patchUi, resetUi, solveStatus, setSolveStatus }),
    [ui, patchUi, resetUi, solveStatus],
  );

  return <UiStateContext.Provider value={value}>{children}</UiStateContext.Provider>;
}

export function useUiState(): UiStateContextValue {
  const value = useContext(UiStateContext);
  if (!value) throw new Error('useUiState must be used within UiStateProvider');
  return value;
}
