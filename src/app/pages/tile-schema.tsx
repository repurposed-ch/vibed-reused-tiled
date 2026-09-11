import { useEffect, useMemo, useState } from 'react';
import { useProject } from '../project-context';
import { useUiState } from '../ui-state';
import { JointPanel } from '../components/joint-panel';
import {
  addMasterLevelAboveRoot,
  bestSpanForDrag,
  blockStep,
  createMasterGrid,
  createTileGrid,
  createTileGridInstance,
  createTileSchema,
  describeFit,
  extentCells,
  fitTile,
  formatMm,
  findMasterGrid,
  findTileGrid,
  identityFrame2Json,
  instanceAtCell,
  masterChain,
  overclaimedCells,
  putInstance,
  removeInstanceAt,
  removeRootMasterLevel,
  setLevelExtent,
  sanitizeJoint,
  spanFor,
  spanOptions,
  tileDisplayColor,
  tileGridCells,
  TileSchemaJsonSchema,
  unclaimedCells,
  type BoundaryConditionsJson,
  type DesignInstanceJson,
  type IntVec2,
  type MasterGridJson,
  type MirrorRule,
  type TileDefinitionJson,
  type TileGridJson,
  type TileSchemaJson,
} from '@/domain/project';
import { InstanceSvg } from '@/render/svg/instance-svg';
import { TileGridCanvas, type CellFill } from '@/render/svg/tile-grid-canvas';
import { clampToExtent } from '@/render/svg/tile-grid-geometry';
import { findRapportModule, rapportToTileSchema } from '@/workflow/rapport';
import { patternWithCell, type LibraryPattern } from '@/domain/pattern-library';
import { formatPattern, parsePattern, patternLegend } from '@/domain/pattern-notation';
import { assistTileSchema, patternsForLegend } from '@/llm/assist';
import { DEFAULT_LLM_PROVIDER_ID } from '@/llm/providers';
import { fillPolygonWithTileSchema } from '@/workflow/tile-grid-fill';
import { mirrorAllowed, tryResolveSchema, validateLattice } from '@/workflow/tile-grid-lattice';

/**
 * Authoring surface for the tile schema: draw one repeat unit, set the lattice
 * that repeats it, and watch the cover validate as you go.
 *
 * The draft is held locally rather than written through `updateProject`, which
 * re-parses the whole project on every write and throws — a half-typed extent
 * would take the page down with it. Committing is explicit, and gated on the
 * schema actually tiling, because a schema that does not tile makes the fill
 * throw downstream.
 */

/** Two-letter badge for a tile. Catalogue names share long prefixes ("Reuse A",
 *  "Reuse B"), so initials disambiguate where a prefix slice would not. */
function tileInitials(name: string | undefined): string {
  if (!name) return '?';
  const words = name.split(/\s+/).filter((w) => /^[a-z0-9]/i.test(w));
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/**
 * The two lattice vectors as a 2x2 block: rows are the vectors, columns their i
 * and j components. Four loose fields in a flex row wrapped as `u.i u.j v.i` /
 * `v.j`, which splits a vector across lines. The row labels carry the same
 * colours as the arrows on the canvas so a field ties to the arrow it drives.
 */
function AxisFields({
  u,
  v,
  onChange,
}: {
  u: IntVec2;
  v: IntVec2;
  onChange: (which: 'u' | 'v', value: IntVec2) => void;
}) {
  const heading = {
    fontSize: '0.7rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    textAlign: 'center' as const,
  };

  const component = (which: 'u' | 'v', axis: 'i' | 'j') => {
    const value = which === 'u' ? u : v;
    return (
      <input
        type="number"
        // The visible label is split across a row and a column header, so the
        // field needs its own name for anything not reading the grid.
        aria-label={`${which}.${axis}`}
        value={value[axis]}
        onChange={(e) =>
          onChange(which, { ...value, [axis]: Math.trunc(Number(e.target.value) || 0) })
        }
      />
    );
  };

  const rowLabel = (which: 'u' | 'v') => (
    <span
      className="mono"
      style={{ color: which === 'u' ? '#d9773a' : '#6f8f6a', fontWeight: 600 }}
    >
      {which}
    </span>
  );

  return (
    <div className="field">
      <label>Axes (cells)</label>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.25rem 1fr 1fr',
          gap: '0.35rem',
          alignItems: 'center',
        }}
      >
        <span />
        <span className="muted" style={heading}>
          i
        </span>
        <span className="muted" style={heading}>
          j
        </span>
        {rowLabel('u')}
        {component('u', 'i')}
        {component('u', 'j')}
        {rowLabel('v')}
        {component('v', 'i')}
        {component('v', 'j')}
      </div>
    </div>
  );
}

/**
 * Area shares for the rapport search.
 *
 * These are relative weights, not percentages — `findRapportModule` divides each
 * by their total — so 50/50 and 10/10 ask for the same thing. The slider sets the
 * weight and the figure beside it shows what that normalises to, which is the
 * number the search actually targets.
 *
 * Kept out of a `.field`: `.field input` puts a background, border and padding on
 * its inputs, which render on a range track and look broken. The palette sliders
 * in `tiles.tsx` avoid it the same way.
 */
function ShareSliders({
  tiles,
  shares,
  onChange,
}: {
  tiles: TileDefinitionJson[];
  shares: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}) {
  const weightOf = (id: string) => shares[id] ?? 50;
  const total = tiles.reduce((sum, t) => sum + weightOf(t.id), 0);

  return (
    <div className="stack" style={{ marginTop: '0.75rem' }}>
      {tiles.map((t) => {
        const weight = weightOf(t.id);
        const percent = total > 0 ? Math.round((weight / total) * 100) : 0;
        return (
          <div key={t.id} className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
            <label className="mono" style={{ width: '8rem', margin: 0, fontSize: '0.8rem' }}>
              {t.name}
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={weight}
              // A bare range renders a white track on this dark theme; the
              // accent tints the filled part and the thumb to match the app.
              style={{ flex: 1, accentColor: '#d9773a', background: 'transparent' }}
              onChange={(e) => onChange({ ...shares, [t.id]: Number(e.target.value) })}
            />
            <span className="mono" style={{ width: '3rem', textAlign: 'right', fontSize: '0.8rem' }}>
              {percent}%
            </span>
          </div>
        );
      })}
      <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
        Relative weights — the search normalises them, so 50/50 and 10/10 ask for the same split.
      </p>
    </div>
  );
}

function formatVec(v: IntVec2): string {
  return `(${v.i}, ${v.j})`;
}

/** Preview boundary: three composite repeats square, snapped to whole cells. */
function previewBoundary(grid: TileGridJson, u: IntVec2, v: IntVec2): BoundaryConditionsJson {
  const is = [0, u.i, v.i, u.i + v.i];
  const js = [0, u.j, v.j, u.j + v.j];
  const width = Math.max(1, Math.max(...is) - Math.min(...is)) * 3;
  const height = Math.max(1, Math.max(...js) - Math.min(...js)) * 3;
  const w = width * grid.cell.x;
  const h = height * grid.cell.y;
  return {
    type: 'BoundaryConditions',
    outers: [
      {
        type: 'Polygon2',
        vertices: [
          { type: 'Vec2', x: 0, y: 0 },
          { type: 'Vec2', x: w, y: 0 },
          { type: 'Vec2', x: w, y: h },
          { type: 'Vec2', x: 0, y: h },
        ],
      },
    ],
    holes: [],
    // No guides: the preview is about the pattern, and a guide label would only
    // add chrome to it.
    guides: [],
  };
}

export function TileSchemaPage() {
  const { project, setTileSchema, llmSettings } = useProject();
  const { project: projectForJoint } = useProject();
  const { ui, patchUi } = useUiState();

  // Everything the user authors here lives in the persisted UI state, not in
  // page-local state: React Router unmounts the page on navigation, which used
  // to throw away the whole draft and reset the sliders.
  const draft = ui.schemaDraft ?? project.tileSchema ?? null;
  const setDraft = (next: TileSchemaJson | null) => patchUi({ schemaDraft: next });
  const selectedLevelId = ui.selectedLevelId;
  const setSelectedLevelId = (next: string | null) => patchUi({ selectedLevelId: next });
  const paintTileId = ui.paintTileId ?? project.tileDefinitions[0]?.id ?? '';
  const setPaintTileId = (next: string) => patchUi({ paintTileId: next });
  const pad = ui.pad;
  const setPad = (next: number) => patchUi({ pad: next });
  // The axes live on the same canvas as the tiles; this only switches what a
  // drag does and whether they are drawn.
  const axesOn = ui.axesOn;
  const setAxesOn = (next: boolean) => patchUi({ axesOn: next });
  const shares = ui.shares;
  const setShares = (next: Record<string, number>) => patchUi({ shares: next });
  const raw = ui.schemaRaw;
  const setRaw = (next: string | null) => patchUi({ schemaRaw: next });
  const [message, setMessage] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);

  const tiles = project.tileDefinitions;
  const tileMap = useMemo(() => new Map(tiles.map((t) => [t.id, t])), [tiles]);

  const chain = useMemo(() => {
    if (!draft) return [];
    try {
      return masterChain(draft);
    } catch {
      return [];
    }
  }, [draft]);

  // The innermost master grid is the one whose lattice acts on tile cells, so it
  // is the one the axes on the tile-grid canvas belong to.
  const innerMaster = chain[chain.length - 1];
  const tileGrid = draft ? findTileGrid(draft, innerMaster?.childId ?? '') : undefined;
  const activeLevelId = selectedLevelId ?? tileGrid?.id ?? null;
  const activeMaster = draft && activeLevelId ? findMasterGrid(draft, activeLevelId) : undefined;
  const editingTileGrid = Boolean(tileGrid && activeLevelId === tileGrid.id);

  const resolution = useMemo(() => (draft ? tryResolveSchema(draft) : null), [draft]);
  const valid = resolution?.ok === true;

  // Tile ids the schema names but the project no longer defines. The fill drops
  // these silently — zero placements, no error — so they get a hard row here.
  const missingTileIds = useMemo(() => {
    if (!tileGrid) return [];
    const referenced = new Set(tileGrid.instances.map((i) => i.tileDefinitionId));
    referenced.add(tileGrid.fallbackTileDefinitionId);
    return [...referenced].filter((id) => !tileMap.has(id));
  }, [tileGrid, tileMap]);

  // A fallback is placed one per cell when a larger format is clipped, so it has
  // to cover exactly one cell. Anything bigger would be drawn at its real size
  // on a single cell and overlap its neighbours.
  const coversOneCell = (tile: TileDefinitionJson) => {
    if (!tileGrid) return false;
    const span = spanFor(tile, tileGrid.cell, tileGrid.joint, false);
    return span?.iSpan === 1 && span.jSpan === 1;
  };
  const unitTiles = tileGrid ? tiles.filter(coversOneCell) : [];
  const fallbackTile = tileGrid ? tileMap.get(tileGrid.fallbackTileDefinitionId) : undefined;
  const fallbackIsUnit = fallbackTile ? coversOneCell(fallbackTile) : false;

  const unclaimed = useMemo(() => (tileGrid ? unclaimedCells(tileGrid) : []), [tileGrid]);
  // Blanks are normal in a sheared repeat — a neighbouring copy covers them — so
  // they only read as a fault when the lattice and the claimed cells disagree.
  const countMismatch = resolution?.ok === false && /cells per repeat/.test(resolution.reason);
  const overclaimed = useMemo(() => (tileGrid ? overclaimedCells(tileGrid) : []), [tileGrid]);

  // Cells the canvas paints as faults: claimed twice locally, plus any pair the
  // lattice would land on top of each other. The second set is what names a
  // residue collision — the failure where the counts add up but the pattern
  // still overlaps itself.
  const conflicts = useMemo(
    () => [...overclaimed, ...(resolution?.ok === false ? resolution.collisions : [])],
    [overclaimed, resolution],
  );

  // Per-level check is advisory only: a block that does not tile its own slot
  // space can still be part of a schema that tiles globally, so this is amber
  // while `tryResolveSchema` is what actually gates saving.
  const levelCheck = useMemo(() => {
    if (!draft || !activeMaster) return null;
    const child = findTileGrid(draft, activeMaster.childId);
    const childMaster = findMasterGrid(draft, activeMaster.childId);
    const cells = child
      ? tileGridCells(child)
      : childMaster?.extent
        ? extentCells(childMaster.extent)
        : null;
    if (!cells) return null;
    return validateLattice(cells, activeMaster.u, activeMaster.v);
  }, [draft, activeMaster]);

  // Mirroring reflects the repeat inside its extent, so it only works when the
  // claimed cells are symmetric across that axis — otherwise the reflection
  // moves cells and the cover collapses. Checked per axis, and reported here
  // rather than left to surface as a generic "does not tile".
  const mirrorable = useMemo(() => {
    if (!draft || !activeMaster) return { x: true, y: true };
    const childGrid = findTileGrid(draft, activeMaster.childId);
    const childMaster = findMasterGrid(draft, activeMaster.childId);
    const cells = childGrid
      ? tileGridCells(childGrid)
      : childMaster?.extent
        ? extentCells(childMaster.extent)
        : null;
    const extent = childGrid?.extent ?? childMaster?.extent;
    if (!cells || !extent) return { x: true, y: true };
    return {
      x: mirrorAllowed(cells, extent, 'x'),
      y: mirrorAllowed(cells, extent, 'y'),
    };
  }, [draft, activeMaster]);

  const preview = useMemo(() => {
    if (!draft || !resolution?.ok || !tileGrid) return null;
    try {
      // Preview with an identity frame: the frame only sets the pattern out in
      // the world, and InstanceSvg's viewBox starts at the origin, so an offset
      // or rotated frame would push the preview out of view.
      const flat: TileSchemaJson = { ...draft, frame: identityFrame2Json() };
      const boundaries = previewBoundary(tileGrid, resolution.resolved.u, resolution.resolved.v);
      const filled = fillPolygonWithTileSchema({ schema: flat, tiles, boundaries });
      const instance: DesignInstanceJson = {
        type: 'DesignInstance',
        placements: filled.placements,
        grid: filled.grid ?? undefined,
      };
      return { instance, boundaries, stats: filled.stats };
    } catch {
      return null;
    }
  }, [draft, resolution, tileGrid, tiles]);

  const patchGrid = (patch: Partial<TileGridJson>) => {
    if (!draft || !tileGrid) return;
    setDraft({
      ...draft,
      tileGrids: draft.tileGrids.map((g) => (g.id === tileGrid.id ? { ...g, ...patch } : g)),
    });
  };

  const patchMaster = (id: string, patch: Partial<MasterGridJson>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      masterGrids: draft.masterGrids.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    });
  };

  // A cell is unit + joint. New schemas take the joint from the current grid, or from the
  // "No schema yet" input when there is no grid to hold one yet.
  const newJoint = sanitizeJoint(tileGrid?.joint ?? ui.newSchemaJoint);
  // Rounded to the micrometre, so a cell reads 0.15 rather than 0.15000000000000002.
  const micro = (v: number) => Math.round(v * 1e6) / 1e6;

  const createBlank = () => {
    const first = tiles[0];
    if (!first) return;
    const grid = createTileGrid({
      name: 'Repeat',
      cell: { x: micro(first.width + newJoint), y: micro(first.width + newJoint) },
      joint: newJoint,
      extent: { iCount: 4, jCount: 4 },
      instances: [],
      fallbackTileDefinitionId: first.id,
    });
    const master = createMasterGrid({
      name: 'Master',
      childId: grid.id,
      ...blockStep(grid.extent),
    });
    setDraft(
      createTileSchema({
        name: 'Tile schema',
        tileGrids: [grid],
        masterGrids: [master],
        rootMasterGridId: master.id,
      }),
    );
    setSelectedLevelId(grid.id);
    setMessage(null);
  };

  const seedFromRapport = () => {
    const targets = tiles.map((t) => ({
      tileDefinitionId: t.id,
      areaShare: shares[t.id] ?? 50,
    }));
    const module = findRapportModule({ tiles, targets, joint: newJoint });
    if (!module) {
      setMessage('No gapless repeat exists for those formats and shares.');
      return;
    }
    const next = rapportToTileSchema(module, { name: 'Rapport', joint: newJoint });
    setDraft(next);
    setSelectedLevelId(next.tileGrids[0]?.id ?? null);
    setMessage(
      `Found a ${module.widthUnits}×${module.heightUnits} repeat at ${module.unit.toFixed(3)} m cells, ${module.deviation.toFixed(1)} pts off the requested shares.`,
    );
  };

  // The smallest format sets the cell, the way a repeat is built by hand.
  const smallestTile = useMemo(
    () => [...tiles].sort((a, b) => a.length * a.width - b.length * b.width)[0],
    [tiles],
  );
  const presetCell = smallestTile
    ? { x: micro(smallestTile.length + newJoint), y: micro(smallestTile.width + newJoint) }
    : { x: 0.15, y: 0.15 };
  const legend = useMemo(() => patternLegend(tiles), [tiles]);
  // Only the library entries this catalogue can actually build: a pattern's
  // drawing encodes footprints, so one needing a 2:1 slab is no use without one.
  const presets = useMemo(
    () => patternsForLegend(legend, presetCell, newJoint),
    [legend, presetCell.x, presetCell.y, newJoint],
  );

  const applyPreset = (pattern: LibraryPattern) => {
    const parsed = parsePattern(
      patternWithCell(pattern, presetCell.x, presetCell.y, newJoint),
      legend,
      { joint: newJoint },
    );
    if (!parsed.ok) {
      setMessage(`${pattern.name}: ${parsed.error}`);
      return;
    }
    setDraft(parsed.schema);
    setSelectedLevelId(parsed.schema.tileGrids[0]?.id ?? null);
    setMessage(`Loaded ${pattern.name}.`);
  };

  /** Parse whatever is in the notation box and adopt it. */
  const applyNotation = (text: string) => {
    const parsed = parsePattern(text, legend, { joint: newJoint });
    if (!parsed.ok) {
      setAssistError(parsed.error);
      return;
    }
    setAssistError(null);
    setDraft(parsed.schema);
    setSelectedLevelId(parsed.schema.tileGrids[0]?.id ?? null);
  };

  const runAssist = async () => {
    setAssistBusy(true);
    setAssistError(null);
    try {
      const result = await assistTileSchema({
        provider: llmSettings.provider || DEFAULT_LLM_PROVIDER_ID,
        model: llmSettings.model,
        apiKey: llmSettings.apiKey || undefined,
        request: {
          prompt: ui.schemaPrompt,
          // Textures are stripped: a baked data URL runs to megabytes, says
          // nothing about where a tile goes, and would swamp a small model.
          tileDefinitions: tiles.map((t) => ({ ...t, texture: undefined })),
          current: ui.schemaNotation || undefined,
          joint: newJoint,
        },
      });
      // Keep the raw reply so a near-miss can be corrected in the box rather
      // than thrown away with the error — but only when there *is* one. A
      // transport failure carries no notation, and writing that over the box
      // would destroy whatever had been typed there.
      if (result.notation) patchUi({ schemaNotation: result.notation });
      if (result.ok) {
        setDraft(result.schema);
        setSelectedLevelId(result.schema.tileGrids[0]?.id ?? null);
      } else {
        setAssistError(result.error);
      }
    } finally {
      setAssistBusy(false);
    }
  };

  const paintTile: TileDefinitionJson | undefined = tileMap.get(paintTileId);
  const footprints = useMemo(() => {
    if (!paintTile || !tileGrid) return [];
    return spanOptions(paintTile, tileGrid.cell, tileGrid.joint);
  }, [paintTile, tileGrid]);

  const resolveFootprint = (drag: { i: number; j: number; iSpan: number; jSpan: number }) => {
    if (!paintTile || !tileGrid) return null;
    const best = bestSpanForDrag(paintTile, tileGrid.cell, tileGrid.joint, drag);
    if (!best) return null;
    // The span is fixed by the tile's real size; only the origin moves. A
    // trimmed footprint would claim fewer cells than the tile covers and open a
    // gap that no validator can see.
    const origin = clampToExtent(tileGrid.extent, drag.i, drag.j, best.iSpan, best.jSpan);
    return { ...origin, iSpan: best.iSpan, jSpan: best.jSpan };
  };

  const paintAt = (rect: { i: number; j: number; iSpan: number; jSpan: number }) => {
    if (!tileGrid || !paintTile) return;
    const footprint = resolveFootprint(rect);
    if (!footprint) {
      setMessage(
        `${describeFit(paintTile.name, fitTile(paintTile, tileGrid.cell, tileGrid.joint, false))} Change the cell size or the joint.`,
      );
      return;
    }
    const best = bestSpanForDrag(paintTile, tileGrid.cell, tileGrid.joint, rect)!;
    const bestFit = fitTile(paintTile, tileGrid.cell, tileGrid.joint, best.rotated);
    const instance = createTileGridInstance(
      paintTile.id,
      footprint.i,
      footprint.j,
      footprint.iSpan,
      footprint.jSpan,
      best.rotated,
    );
    const result = putInstance(tileGrid, instance);
    patchGrid({ instances: result.grid.instances });
    const notes = [
      result.replaced > 0 ? `Replaced ${result.replaced} occurrence(s).` : null,
      bestFit.fit === 'under' ? describeFit(paintTile.name, bestFit) : null,
    ].filter(Boolean);
    setMessage(notes.length > 0 ? notes.join(' ') : null);
  };

  const clickCell = (cell: IntVec2) => {
    if (!tileGrid) return;
    if (cell.i < 0 || cell.j < 0 || cell.i >= tileGrid.extent.iCount || cell.j >= tileGrid.extent.jCount)
      return;
    const hit = instanceAtCell(tileGrid, cell.i, cell.j);
    if (hit) {
      patchGrid({ instances: removeInstanceAt(tileGrid, cell.i, cell.j).instances });
      return;
    }
    paintAt({ i: cell.i, j: cell.j, iSpan: 1, jSpan: 1 });
  };

  const cellFill = (cell: IntVec2): CellFill | null => {
    if (!tileGrid) return null;
    const hit = instanceAtCell(tileGrid, cell.i, cell.j);
    if (!hit) return null;
    const tile = tileMap.get(hit.tileDefinitionId);
    const isOrigin = hit.i === cell.i && hit.j === cell.j;
    return {
      fill: tile ? tileDisplayColor(tile.color) : '#c45c5c',
      stroke: '#1a1714',
      label: isOrigin ? tileInitials(tile?.name) : undefined,
    };
  };

  /**
   * Commit the draft the moment it tiles.
   *
   * There is no Save button: every edit already persists to the UI state, and
   * the project takes the schema as soon as it is usable, which re-solves the
   * layout. A draft that does not tile is deliberately withheld — the fill
   * throws on one, so committing it would take the Solve page down with it. The
   * project simply keeps the last version that worked.
   */
  const committed = project.tileSchema ? JSON.stringify(project.tileSchema) : null;
  useEffect(() => {
    if (!draft || !valid) return;
    const parsed = TileSchemaJsonSchema.safeParse(draft);
    if (!parsed.success) return;
    const next = JSON.stringify(parsed.data);
    if (next === committed) return;
    setTileSchema(parsed.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, valid, committed]);

  const addLevel = () => {
    if (!draft) return;
    const next = addMasterLevelAboveRoot(draft);
    setDraft(next);
    setSelectedLevelId(next.rootMasterGridId);
  };

  const removeLevel = () => {
    if (!draft) return;
    try {
      const next = removeRootMasterLevel(draft);
      setDraft(next);
      setSelectedLevelId(next.rootMasterGridId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not remove the level');
    }
  };

  if (!draft) {
    return (
      <div className="page">
        <h1>Tile schema</h1>
        <p className="lede">
          Describe a tiling as a repeat unit on a cell grid plus the lattice that repeats it. The
          solver fills a boundary straight from this.
        </p>
        <section className="panel">
          <h2>No schema yet</h2>
          <p className="muted">
            Start from an empty repeat, or let the rapport search find one that hits your area
            shares.
          </p>
          {tiles.length > 0 && (
            <ShareSliders tiles={tiles} shares={shares} onChange={setShares} />
          )}
          <div className="row" style={{ marginTop: '0.75rem' }}>
            <button type="button" className="btn primary" onClick={createBlank} disabled={tiles.length === 0}>
              Create blank
            </button>
            <button type="button" className="btn" onClick={seedFromRapport} disabled={tiles.length === 0}>
              Seed from rapport
            </button>
          </div>
          {presets.length > 0 && (
            <>
              <h3 style={{ marginTop: '1.25rem', marginBottom: 0, fontSize: '0.9rem' }}>
                Start from a known bond
              </h3>
              <div className="row" style={{ marginTop: '0.5rem' }}>
                {presets.map((pattern) => (
                  <button
                    key={pattern.id}
                    type="button"
                    className="btn"
                    title={pattern.description}
                    onClick={() => applyPreset(pattern)}
                  >
                    {pattern.name}
                  </button>
                ))}
              </div>
            </>
          )}
          {tiles.length === 0 && (
            <p className="error" style={{ marginTop: '0.75rem' }}>
              Define at least one tile first.
            </p>
          )}
          {message && <p className="muted" style={{ marginTop: '0.75rem' }}>{message}</p>}
        </section>
        <JointPanel
          width={ui.newSchemaJoint}
          onWidthChange={(metres) => patchUi({ newSchemaJoint: metres })}
        />
      </div>
    );
  }

  // At a master level the canvas shows the child's slot space, so the block
  // outline is the child's extent — one slot is one child copy, not one block.
  const canvasExtent = editingTileGrid
    ? tileGrid!.extent
    : (() => {
        const childGrid = findTileGrid(draft, activeMaster?.childId ?? '');
        if (childGrid) return childGrid.extent;
        const childMaster = findMasterGrid(draft, activeMaster?.childId ?? '');
        return childMaster?.extent ?? { iCount: 1, jCount: 1 };
      })();

  return (
    <div className="page">
      <h1>Tile schema</h1>
      <p className="lede">
        Draw one repeat unit on the cell grid, then drag the <strong>u</strong> and{' '}
        <strong>v</strong> vectors to say how it repeats. The dashed ring around the block is live —
        lattice vectors usually need to land outside the pattern.
      </p>

      <div className="split split-sidebar">
        <section className="panel">
          <h2>Levels</h2>
          <div className="stack">
            {chain.map((master, index) => (
              <button
                key={master.id}
                type="button"
                className={master.id === activeLevelId ? 'btn primary' : 'btn'}
                onClick={() => setSelectedLevelId(master.id)}
              >
                {index === 0 ? '◆ ' : ''}
                {master.name}
              </button>
            ))}
            {tileGrid && (
              <button
                type="button"
                className={tileGrid.id === activeLevelId ? 'btn primary' : 'btn'}
                onClick={() => setSelectedLevelId(tileGrid.id)}
              >
                ▦ {tileGrid.name}
              </button>
            )}
          </div>
          <div className="row" style={{ marginTop: '0.75rem' }}>
            <button type="button" className="btn" onClick={addLevel}>
              Add level
            </button>
            <button type="button" className="btn danger" onClick={removeLevel} disabled={chain.length < 2}>
              Remove level
            </button>
          </div>
          <p className="muted" style={{ marginTop: '0.75rem', fontSize: '0.8rem' }}>
            ◆ is the root — it tiles the plane and has no extent. Levels below it are finite blocks.
          </p>
        </section>

        <section className="panel">
          <h2>{editingTileGrid ? tileGrid!.name : (activeMaster?.name ?? 'Level')}</h2>

          {editingTileGrid && tileGrid && (
            <>
              <div className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label>Name</label>
                  <input value={tileGrid.name} onChange={(e) => patchGrid({ name: e.target.value || 'Repeat' })} />
                </div>
                <div className="field">
                  <label>Cell x (m)</label>
                  <input
                    type="number"
                    step="0.005"
                    value={tileGrid.cell.x}
                    onChange={(e) =>
                      patchGrid({ cell: { ...tileGrid.cell, x: Number(e.target.value) || tileGrid.cell.x } })
                    }
                  />
                </div>
                <div className="field">
                  <label>Cell y (m)</label>
                  <input
                    type="number"
                    step="0.005"
                    value={tileGrid.cell.y}
                    onChange={(e) =>
                      patchGrid({ cell: { ...tileGrid.cell, y: Number(e.target.value) || tileGrid.cell.y } })
                    }
                  />
                </div>
              </div>

              <div className="row">
                <div className="field">
                  <label>Columns</label>
                  <input
                    type="number"
                    min={1}
                    value={tileGrid.extent.iCount}
                    onChange={(e) =>
                      patchGrid({
                        extent: { ...tileGrid.extent, iCount: Math.max(1, Number(e.target.value) || 1) },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>Rows</label>
                  <input
                    type="number"
                    min={1}
                    value={tileGrid.extent.jCount}
                    onChange={(e) =>
                      patchGrid({
                        extent: { ...tileGrid.extent, jCount: Math.max(1, Number(e.target.value) || 1) },
                      })
                    }
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Fallback tile (fills a clipped large format)</label>
                  <select
                    value={tileGrid.fallbackTileDefinitionId}
                    onChange={(e) => patchGrid({ fallbackTileDefinitionId: e.target.value })}
                  >
                    {tiles.map((t) => {
                      const unit = coversOneCell(t);
                      const fit = fitTile(t, tileGrid.cell, tileGrid.joint, false);
                      return (
                        <option key={t.id} value={t.id} disabled={!unit}>
                          {t.name}
                          {!unit
                            ? ' — no one-cell fit'
                            : fit.fit === 'under'
                              ? ` — ${formatMm(Math.max(fit.slack.x, fit.slack.y))} under`
                              : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label>Paint with</label>
                  <select value={paintTileId} onChange={(e) => setPaintTileId(e.target.value)}>
                    {tiles.map((t) => {
                      const options = spanOptions(t, tileGrid.cell, tileGrid.joint);
                      const label =
                        options.length === 0
                          ? 'does not fit the grid'
                          : options
                              .map(
                                (o) =>
                                  `${o.iSpan}×${o.jSpan}${
                                    o.fit === 'under'
                                      ? ` (${formatMm(Math.max(o.slack.x, o.slack.y))} under)`
                                      : ''
                                  }`,
                              )
                              .join(' or ');
                      return (
                        <option key={t.id} value={t.id} disabled={options.length === 0}>
                          {t.name} — {label}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>
              {!fallbackIsUnit && (
                <p className="error" style={{ marginTop: '0.5rem' }}>
                  {fallbackTile
                    ? `${fallbackTile.name} covers more than one cell, so it cannot break a clipped format down.`
                    : 'The fallback tile is missing from the catalogue.'}{' '}
                  {unitTiles.length > 0
                    ? `Pick a one-cell format — ${unitTiles.map((t) => t.name).join(', ')}.`
                    : 'No format in the catalogue covers exactly one cell at this cell size, so clipped tiles would leave the boundary bare.'}
                </p>
              )}
              {paintTile && footprints.length === 0 && (
                <p className="error" style={{ marginTop: '0.5rem' }}>
                  {describeFit(paintTile.name, fitTile(paintTile, tileGrid.cell, tileGrid.joint, false))}{' '}
                  Change the cell size or the joint.
                </p>
              )}
              {paintTile && footprints.length > 0 && footprints.every((o) => o.fit === 'under') && (
                <p className="muted" style={{ marginTop: '0.5rem', color: '#d9773a' }}>
                  {paintTile.name} is{' '}
                  {formatMm(Math.max(footprints[0]!.slack.x, footprints[0]!.slack.y))} under its{' '}
                  {footprints[0]!.iSpan}×{footprints[0]!.jSpan} footprint. It is centred, so the
                  joints around it widen.
                </p>
              )}

              <div className="row" style={{ marginTop: '0.75rem' }}>
                <label className="field" style={{ minWidth: 'auto' }}>
                  <span>Edit axes</span>
                  <input
                    type="checkbox"
                    checked={axesOn}
                    onChange={(e) => setAxesOn(e.target.checked)}
                  />
                </label>
              </div>

              {axesOn && innerMaster && (
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  <AxisFields
                    u={innerMaster.u}
                    v={innerMaster.v}
                    onChange={(which, value) => patchMaster(innerMaster.id, { [which]: value })}
                  />
                  <div className="field">
                    <label>Ring</label>
                    <div className="row" style={{ gap: '0.25rem' }}>
                      <button type="button" className="btn" onClick={() => setPad(Math.max(1, pad - 1))}>
                        −
                      </button>
                      <span
                        className="mono"
                        style={{ alignSelf: 'center', minWidth: '1.5rem', textAlign: 'center' }}
                      >
                        {pad}
                      </span>
                      <button type="button" className="btn" onClick={() => setPad(Math.min(12, pad + 1))}>
                        +
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div
                className="canvas-frame"
                style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  // The axes deliberately leave the grid, so the frame must stop
                  // clipping while they are on.
                  overflow: axesOn ? 'visible' : 'auto',
                }}
              >
                <TileGridCanvas
                  extent={tileGrid.extent}
                  pad={pad}
                  u={innerMaster?.u ?? { i: 1, j: 0 }}
                  v={innerMaster?.v ?? { i: 0, j: 1 }}
                  mode={axesOn ? 'lattice' : 'paint'}
                  cellFill={cellFill}
                  unclaimed={unclaimed}
                  unclaimedAreFaults={countMismatch}
                  conflicts={conflicts}
                  resolveFootprint={resolveFootprint}
                  onPaint={paintAt}
                  onCellClick={clickCell}
                  onLatticeChange={(which, value) =>
                    innerMaster && patchMaster(innerMaster.id, { [which]: value })
                  }
                />
              </div>
              <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                {axesOn
                  ? 'Drag either arrow tip to a grid corner to set how the repeat steps. An axis that leaves the grid is normal — grow the ring to reach further.'
                  : "Drag to lay a tile — the footprint snaps to the format's real size, and the drag's shape picks upright or turned. Click an occurrence to remove it."}
              </p>
            </>
          )}

          {!editingTileGrid && activeMaster && (
            <>
              <div className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label>Name</label>
                  <input
                    value={activeMaster.name}
                    onChange={(e) => patchMaster(activeMaster.id, { name: e.target.value || 'Level' })}
                  />
                </div>
                <div className="field">
                  <label>Mirror x</label>
                  <select
                    value={activeMaster.mirror.x}
                    disabled={!mirrorable.x}
                    onChange={(e) =>
                      patchMaster(activeMaster.id, {
                        mirror: { ...activeMaster.mirror, x: e.target.value as MirrorRule },
                      })
                    }
                  >
                    <option value="none">none</option>
                    <option value="alternate">alternate</option>
                  </select>
                </div>
                <div className="field">
                  <label>Mirror y</label>
                  <select
                    value={activeMaster.mirror.y}
                    disabled={!mirrorable.y}
                    onChange={(e) =>
                      patchMaster(activeMaster.id, {
                        mirror: { ...activeMaster.mirror, y: e.target.value as MirrorRule },
                      })
                    }
                  >
                    <option value="none">none</option>
                    <option value="alternate">alternate</option>
                  </select>
                </div>
              </div>

              {(!mirrorable.x || !mirrorable.y) && (
                <p className="muted" style={{ marginTop: '0.5rem', color: '#d9773a' }}>
                  Mirroring is unavailable in{' '}
                  {!mirrorable.x && !mirrorable.y ? 'x and y' : !mirrorable.x ? 'x' : 'y'}: the
                  repeat is not symmetric across that axis, so reflecting it would move cells rather
                  than just flip tiles. A lattice with u.j = 0 and v.i = 0 that fills the block is
                  what makes it possible.
                </p>
              )}

              {activeMaster.extent && (
                <div className="row">
                  <div className="field">
                    <label>Block columns</label>
                    <input
                      type="number"
                      min={1}
                      value={activeMaster.extent.iCount}
                      onChange={(e) =>
                        setDraft(
                          setLevelExtent(draft, activeMaster.id, {
                            ...activeMaster.extent!,
                            iCount: Math.max(1, Number(e.target.value) || 1),
                          }),
                        )
                      }
                    />
                  </div>
                  <div className="field">
                    <label>Block rows</label>
                    <input
                      type="number"
                      min={1}
                      value={activeMaster.extent.jCount}
                      onChange={(e) =>
                        setDraft(
                          setLevelExtent(draft, activeMaster.id, {
                            ...activeMaster.extent!,
                            jCount: Math.max(1, Number(e.target.value) || 1),
                          }),
                        )
                      }
                    />
                  </div>
                  <p className="muted" style={{ flex: 1, fontSize: '0.8rem' }}>
                    Changing the block retargets the level above it, unless you have already
                    hand-tuned that level's vectors.
                  </p>
                </div>
              )}

              <div className="row">
                <AxisFields
                  u={activeMaster.u}
                  v={activeMaster.v}
                  onChange={(which, value) => patchMaster(activeMaster.id, { [which]: value })}
                />
                <div className="field">
                  <label>Ring</label>
                  <div className="row" style={{ gap: '0.25rem' }}>
                    <button type="button" className="btn" onClick={() => setPad(Math.max(1, pad - 1))}>
                      −
                    </button>
                    <span className="mono" style={{ alignSelf: 'center', minWidth: '1.5rem', textAlign: 'center' }}>
                      {pad}
                    </span>
                    <button type="button" className="btn" onClick={() => setPad(Math.min(12, pad + 1))}>
                      +
                    </button>
                  </div>
                </div>
              </div>

              <div className="canvas-frame" style={{ marginTop: '1rem', padding: '1rem' }}>
                <TileGridCanvas
                  extent={canvasExtent}
                  pad={pad}
                  u={activeMaster.u}
                  v={activeMaster.v}
                  mode="lattice"
                  onLatticeChange={(which, value) => patchMaster(activeMaster.id, { [which]: value })}
                />
              </div>
              <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                Drag either arrow tip to a grid corner. One cell here is one copy of{' '}
                {findTileGrid(draft, activeMaster.childId)?.name ??
                  findMasterGrid(draft, activeMaster.childId)?.name ??
                  'the child'}
                , and the pale outline is its whole block.
                {!findTileGrid(draft, activeMaster.childId) &&
                  ' Above the tile grid this drawing is schematic — the preview below is the truth.'}
              </p>

              {levelCheck && !levelCheck.ok && (
                <p className="muted" style={{ marginTop: '0.5rem', color: '#d9773a' }}>
                  This level's block does not tile on its own: {levelCheck.reason}. That can still be
                  fine inside a larger schema — the repeat panel below decides.
                </p>
              )}
            </>
          )}
        </section>
      </div>

      <JointPanel
        width={tileGrid?.joint ?? 0}
        onWidthChange={tileGrid ? (metres) => patchGrid({ joint: metres }) : undefined}
      />

      <section className="panel">
        <h2>Repeat</h2>
        {missingTileIds.length > 0 && (
          <p className="error">
            The schema references tiles that no longer exist: {missingTileIds.join(', ')}. Those
            placements would be dropped silently by the solver.
          </p>
        )}
        {resolution?.ok ? (
          <p className="success">
            Tiles the plane. Repeat is {resolution.resolved.cells.length} cells, lattice u ={' '}
            {formatVec(resolution.resolved.u)}, v = {formatVec(resolution.resolved.v)}.
          </p>
        ) : (
          <p className="error">{resolution?.reason ?? 'Schema is incomplete.'}</p>
        )}
        {unclaimed.length > 0 && (
          <p className="muted">
            {unclaimed.length} cell(s) in the block are blank — hatched on the canvas.
            {countMismatch
              ? ' The repeat does not add up, so these are the likely cause: either claim them or shrink the lattice.'
              : ' That is fine when the lattice is sheared: neighbouring copies cover them.'}
          </p>
        )}
        {overclaimed.length > 0 && (
          <p className="muted">{overclaimed.length} cell(s) are claimed twice or sit outside the block.</p>
        )}
        {resolution?.ok === false && resolution.collisions.length > 0 && (
          <p className="muted">
            {resolution.collisions.length} cell(s) marked red would be covered by two copies at
            once. Move a tile, or change the lattice so the copies interlock.
          </p>
        )}

        {preview && preview.stats.fallbackSubstitutedFor && (
          <p className="muted" style={{ color: '#d9773a' }}>
            The declared fallback covers more than one cell, so a one-cell format stood in for it.
            Set the fallback explicitly to control which.
          </p>
        )}
        {preview && preview.stats.unfilled > 0 && (
          <p className="error">
            {preview.stats.unfilled} cell(s) would be left bare: there is no one-cell format to
            break a clipped tile down to.
          </p>
        )}
        {preview && Object.keys(preview.stats.oversized).length > 0 && (
          <p className="error">
            Too large for their footprint, so left out and replaced by fallback tiles:{' '}
            {Object.entries(preview.stats.oversized)
              .map(([id, count]) => `${tileMap.get(id)?.name ?? id} ×${count}`)
              .join(', ')}
            . Check the tile size, the cell and the joint.
          </p>
        )}
        {preview && (
          <>
            <div className="canvas-frame" style={{ marginTop: '1rem', padding: '1rem' }}>
              <InstanceSvg
                instance={preview.instance}
                tiles={tiles}
                boundaries={preview.boundaries}
                joint={projectForJoint.joint}
              />
            </div>
            <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
              {preview.stats.wholeTiles} whole, {preview.stats.fallbackTiles} broken down,{' '}
              {preview.stats.cutTiles} cut across {preview.stats.cells} cells. Drawn through the real
              fill, so this is what the solver will produce.
            </p>
          </>
        )}
      </section>

      <section className="panel no-print">
        <h2>Project</h2>
        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft(project.tileSchema ?? null);
              setMessage(null);
            }}
            disabled={!project.tileSchema}
          >
            Revert to last valid
          </button>
          <button type="button" className="btn" onClick={seedFromRapport}>
            Reseed from rapport
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              setTileSchema(undefined);
              setDraft(null);
              setMessage('Cleared. The solver falls back to design-family modules.');
            }}
          >
            Clear schema
          </button>
        </div>
        <p className="muted" style={{ marginTop: '0.75rem' }}>
          {valid
            ? 'Applied to the project and re-solved automatically — there is nothing to save.'
            : 'This draft is not being applied: the repeat does not tile, and the fill throws on a schema it cannot resolve. The project is still using the last version that worked.'}
        </p>
        {message && <p className="muted" style={{ marginTop: '0.75rem' }}>{message}</p>}

        <h3 style={{ marginTop: '1.25rem', marginBottom: 0, fontSize: '0.9rem' }}>Rapport shares</h3>
        <ShareSliders tiles={tiles} shares={shares} onChange={setShares} />
      </section>

      <section className="panel no-print">
        <h2>Assist with LLM</h2>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          The model replies in the grid notation, not JSON — a tenth the tokens, and a miscounted
          row comes back as a parse error naming the cell instead of a malformed document.
        </p>
        <div className="field">
          <label>Request</label>
          <textarea
            rows={3}
            value={ui.schemaPrompt}
            onChange={(e) => patchUi({ schemaPrompt: e.target.value })}
          />
        </div>
        <div className="row" style={{ marginTop: '0.75rem' }}>
          <button
            type="button"
            className="btn primary"
            onClick={runAssist}
            disabled={assistBusy || tiles.length === 0}
          >
            {assistBusy ? 'Asking…' : 'Propose a pattern'}
          </button>
          {presets.map((pattern) => (
            <button
              key={pattern.id}
              type="button"
              className="btn"
              title={pattern.description}
              onClick={() => applyPreset(pattern)}
            >
              {pattern.name}
            </button>
          ))}
        </div>
        {assistError && <p className="error" style={{ marginTop: '0.75rem' }}>{assistError}</p>}
        <div className="field" style={{ marginTop: '0.75rem' }}>
          <label>Pattern notation</label>
          <textarea
            className="mono"
            rows={10}
            spellCheck={false}
            placeholder={'cell 0.15\nu 4,0\nv 0,4\nb b b b\na a a b\na a a b\na a a b'}
            value={ui.schemaNotation}
            onChange={(e) => patchUi({ schemaNotation: e.target.value })}
          />
        </div>
        <div className="row" style={{ marginTop: '0.75rem' }}>
          <button
            type="button"
            className="btn"
            onClick={() => applyNotation(ui.schemaNotation)}
            disabled={!ui.schemaNotation.trim()}
          >
            Apply notation
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => draft && patchUi({ schemaNotation: formatPattern(draft, legend) })}
            disabled={!draft}
          >
            Read from current
          </button>
        </div>
      </section>

      <section className="panel no-print">
        <h2>JSON</h2>
        <div className="field">
          <label>TileSchema</label>
          <textarea
            className="field-textarea-tall"
            value={raw ?? JSON.stringify(draft, null, 2)}
            onChange={(e) => setRaw(e.target.value)}
          />
        </div>
        <div className="row" style={{ marginTop: '0.75rem' }}>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              try {
                const parsed = TileSchemaJsonSchema.parse(JSON.parse(raw ?? '') as unknown);
                setDraft(parsed);
                setRaw(null);
                setRawError(null);
              } catch (error) {
                setRawError(error instanceof Error ? error.message : 'Invalid JSON');
              }
            }}
            disabled={raw === null}
          >
            Apply JSON
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setRaw(null);
              setRawError(null);
            }}
          >
            Reset editor
          </button>
        </div>
        {rawError && <p className="error" style={{ marginTop: '0.75rem' }}>{rawError}</p>}
      </section>
    </div>
  );
}
