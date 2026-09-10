import { useMemo, useState } from 'react';
import { useProject } from '../project-context';
import {
  addMasterLevelAboveRoot,
  bestSpanForDrag,
  blockStep,
  createMasterGrid,
  createTileGrid,
  createTileGridInstance,
  createTileSchema,
  extentCells,
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
import { fillPolygonWithTileSchema } from '@/workflow/tile-grid-fill';
import { tryResolveSchema, validateLattice } from '@/workflow/tile-grid-lattice';

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
  const { project, setTileSchema } = useProject();
  const [draft, setDraft] = useState<TileSchemaJson | null>(project.tileSchema ?? null);
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  const [paintTileId, setPaintTileId] = useState<string>(project.tileDefinitions[0]?.id ?? '');
  const [pad, setPad] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [shares, setShares] = useState<Record<string, number>>({});
  const [raw, setRaw] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);

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

  const tileGrid = draft ? findTileGrid(draft, chain[chain.length - 1]?.childId ?? '') : undefined;
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

  const preview = useMemo(() => {
    if (!draft || !resolution?.ok || !tileGrid) return null;
    try {
      // Preview with an identity frame: the frame only sets the pattern out in
      // the world, and InstanceSvg's viewBox starts at the origin, so an offset
      // or rotated frame would push the preview out of view.
      const flat: TileSchemaJson = { ...draft, frame: identityFrame2Json() };
      const boundaries = previewBoundary(tileGrid, resolution.resolved.u, resolution.resolved.v);
      const filled = fillPolygonWithTileSchema({ schema: flat, tiles, boundaries });
      const instance: DesignInstanceJson = { type: 'DesignInstance', placements: filled.placements };
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

  const createBlank = () => {
    const first = tiles[0];
    if (!first) return;
    const grid = createTileGrid({
      name: 'Repeat',
      cell: { x: first.width, y: first.width },
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
    const module = findRapportModule({ tiles, targets });
    if (!module) {
      setMessage('No gapless repeat exists for those formats and shares.');
      return;
    }
    const next = rapportToTileSchema(module, { name: 'Rapport' });
    setDraft(next);
    setSelectedLevelId(next.tileGrids[0]?.id ?? null);
    setMessage(
      `Found a ${module.widthUnits}×${module.heightUnits} repeat at ${module.unit.toFixed(3)} m cells, ${module.deviation.toFixed(1)} pts off the requested shares.`,
    );
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
        `${paintTile.name} is ${paintTile.length}×${paintTile.width} m, which is not a whole number of ${tileGrid.cell.x}×${tileGrid.cell.y} m cells.`,
      );
      return;
    }
    const best = bestSpanForDrag(paintTile, tileGrid.cell, tileGrid.joint, rect)!;
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
    setMessage(result.replaced > 0 ? `Replaced ${result.replaced} occurrence(s).` : null);
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

  const save = () => {
    if (!draft) return;
    const parsed = TileSchemaJsonSchema.safeParse(draft);
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? 'Schema is not valid');
      return;
    }
    try {
      setTileSchema(parsed.data);
      setMessage('Saved to project.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save');
    }
  };

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
          <div className="row" style={{ marginTop: '0.75rem' }}>
            <button type="button" className="btn primary" onClick={createBlank} disabled={tiles.length === 0}>
              Create blank
            </button>
            <button type="button" className="btn" onClick={seedFromRapport} disabled={tiles.length === 0}>
              Seed from rapport
            </button>
          </div>
          {tiles.length === 0 && (
            <p className="error" style={{ marginTop: '0.75rem' }}>
              Define at least one tile first.
            </p>
          )}
          {message && <p className="muted" style={{ marginTop: '0.75rem' }}>{message}</p>}
        </section>
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
                <div className="field">
                  <label>Joint (m)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={tileGrid.joint}
                    onChange={(e) => patchGrid({ joint: Math.max(0, Number(e.target.value) || 0) })}
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
                    {tiles.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
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
                          ? 'no whole-cell fit'
                          : options.map((o) => `${o.iSpan}×${o.jSpan}`).join(' or ');
                      return (
                        <option key={t.id} value={t.id} disabled={options.length === 0}>
                          {t.name} — {label}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>
              {paintTile && footprints.length === 0 && (
                <p className="error" style={{ marginTop: '0.5rem' }}>
                  {paintTile.name} is {paintTile.length}×{paintTile.width} m, which is not a whole
                  number of cells. Change the cell size or the joint.
                </p>
              )}

              <div className="canvas-frame" style={{ marginTop: '1rem', padding: '1rem' }}>
                <TileGridCanvas
                  extent={tileGrid.extent}
                  pad={pad}
                  u={chain[chain.length - 1]?.u ?? { i: 1, j: 0 }}
                  v={chain[chain.length - 1]?.v ?? { i: 0, j: 1 }}
                  mode="paint"
                  cellFill={cellFill}
                  unclaimed={unclaimed}
                  unclaimedAreFaults={countMismatch}
                  conflicts={conflicts}
                  resolveFootprint={resolveFootprint}
                  onPaint={paintAt}
                  onCellClick={clickCell}
                />
              </div>
              <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                Drag to lay a tile — the footprint snaps to the format's real size, and the drag's
                shape picks upright or turned. Click an occurrence to remove it.
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
                <div className="field">
                  <label>u.i</label>
                  <input
                    type="number"
                    value={activeMaster.u.i}
                    onChange={(e) =>
                      patchMaster(activeMaster.id, {
                        u: { ...activeMaster.u, i: Math.trunc(Number(e.target.value) || 0) },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>u.j</label>
                  <input
                    type="number"
                    value={activeMaster.u.j}
                    onChange={(e) =>
                      patchMaster(activeMaster.id, {
                        u: { ...activeMaster.u, j: Math.trunc(Number(e.target.value) || 0) },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>v.i</label>
                  <input
                    type="number"
                    value={activeMaster.v.i}
                    onChange={(e) =>
                      patchMaster(activeMaster.id, {
                        v: { ...activeMaster.v, i: Math.trunc(Number(e.target.value) || 0) },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>v.j</label>
                  <input
                    type="number"
                    value={activeMaster.v.j}
                    onChange={(e) =>
                      patchMaster(activeMaster.id, {
                        v: { ...activeMaster.v, j: Math.trunc(Number(e.target.value) || 0) },
                      })
                    }
                  />
                </div>
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

        {preview && (
          <>
            <div className="canvas-frame" style={{ marginTop: '1rem', padding: '1rem' }}>
              <InstanceSvg
                instance={preview.instance}
                tiles={tiles}
                boundaries={preview.boundaries}
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
          <button type="button" className="btn primary" onClick={save} disabled={!valid}>
            Save to project
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft(project.tileSchema ?? null);
              setMessage(null);
            }}
          >
            Reload from project
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
        {!valid && (
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            Saving is blocked while the repeat does not tile — the solver throws on a schema it
            cannot resolve.
          </p>
        )}
        {message && <p className="muted" style={{ marginTop: '0.75rem' }}>{message}</p>}

        <div className="row" style={{ marginTop: '1rem' }}>
          {tiles.map((t) => (
            <div className="field" key={t.id}>
              <label>{t.name} share</label>
              <input
                type="number"
                min={0}
                value={shares[t.id] ?? 50}
                onChange={(e) => setShares({ ...shares, [t.id]: Number(e.target.value) || 0 })}
              />
            </div>
          ))}
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
