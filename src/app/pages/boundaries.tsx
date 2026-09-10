import { useState } from 'react';
import { BoundaryConditionsJsonSchema, type BoundaryConditionsJson } from '@/domain/project';
import { BoundarySvg } from '@/render/svg/boundary-svg';
import { BoundaryDrawCanvas } from '@/render/svg/boundary-draw-canvas';
import {
  loopToPolygonJson,
  polygonJsonToLoop,
  signedArea,
  type Loop,
} from '@/render/svg/boundary-draw-geometry';
import { useProject } from '../project-context';
import { useUiState } from '../ui-state';

const RESOLUTIONS = [0.05, 0.1, 0.25, 0.5, 1];

/** Loops for the two geometry shapes the app can draw, plus what it had to skip. */
function readLoops(geometries: BoundaryConditionsJson['outers']): {
  loops: Loop[];
  skipped: number;
} {
  const loops: Loop[] = [];
  let skipped = 0;
  for (const geometry of geometries) {
    const loop = polygonJsonToLoop(geometry);
    if (loop.length > 0) loops.push(loop);
    else skipped += 1;
  }
  return { loops, skipped };
}

export function BoundariesPage() {
  const { project, updateProject } = useProject();
  const { ui, patchUi } = useUiState();
  const [error, setError] = useState<string | null>(null);
  const [activeLoop, setActiveLoop] = useState(-1);
  const [selected, setSelected] = useState<{ loop: number; index: number } | null>(null);

  const raw = ui.boundaryRaw ?? JSON.stringify(project.boundaries, null, 2);
  const setRaw = (next: string | null) => patchUi({ boundaryRaw: next });

  const outerRead = readLoops(project.boundaries.outers);
  const holeRead = readLoops(project.boundaries.holes);
  const undrawable = outerRead.skipped + holeRead.skipped;

  const writeLoops = (next: { outers: Loop[]; holes: Loop[] }) => {
    // A loop under three vertices is not a polygon, so it is kept on the canvas
    // to carry on drawing but never written as geometry the fill would ignore.
    const outers = next.outers.map(loopToPolygonJson).filter((g) => g != null);
    const holes = next.holes.map(loopToPolygonJson).filter((g) => g != null);
    const boundaries: BoundaryConditionsJson = {
      ...project.boundaries,
      outers: outers as BoundaryConditionsJson['outers'],
      holes: holes as BoundaryConditionsJson['holes'],
    };
    updateProject((p) => ({ ...p, boundaries }));
    setRaw(null);
    setError(null);
    setDraft(next);
  };

  // Loops mid-draw live here, because a one- or two-vertex loop cannot be stored.
  const [draft, setDraft] = useState<{ outers: Loop[]; holes: Loop[] } | null>(null);
  const loops = draft ?? { outers: outerRead.loops, holes: holeRead.loops };

  const applyJson = () => {
    try {
      const parsed = BoundaryConditionsJsonSchema.parse(JSON.parse(raw) as unknown);
      // The schema is a passthrough over `{ type: string }`, so it accepts
      // geometry no renderer can draw and no solver can use. Catch that here
      // rather than leaving an empty preview and a success message.
      const bad =
        readLoops(parsed.outers).skipped + readLoops(parsed.holes).skipped;
      if (bad > 0) {
        setError(
          `${bad} outer/hole entr${bad === 1 ? 'y has' : 'ies have'} no usable vertices. Only Polygon2 and Aabb2 can be drawn or filled.`,
        );
        return;
      }
      updateProject((p) => ({ ...p, boundaries: parsed }));
      setDraft(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const setRect = (width: number, height: number) => {
    const next: BoundaryConditionsJson = {
      type: 'BoundaryConditions',
      outers: [
        {
          type: 'Polygon2',
          vertices: [
            { type: 'Vec2', x: 0, y: 0 },
            { type: 'Vec2', x: width, y: 0 },
            { type: 'Vec2', x: width, y: height },
            { type: 'Vec2', x: 0, y: height },
          ],
        },
      ],
      holes: [],
      guides: [
        {
          id: crypto.randomUUID(),
          name: 'baseline',
          geometry: {
            type: 'Line2',
            from: { type: 'Vec2', x: 0, y: 0 },
            to: { type: 'Vec2', x: width, y: 0 },
          },
        },
      ],
    };
    updateProject((p) => ({ ...p, boundaries: next }));
    setDraft(null);
    setRaw(null);
    setActiveLoop(-1);
    setError(null);
  };

  const editing = ui.drawMode === 'outer' ? loops.outers : loops.holes;
  const openLoop = activeLoop >= 0 ? editing[activeLoop] : undefined;

  const deleteSelected = () => {
    if (!selected) return;
    const next = {
      outers: loops.outers.map((l) => [...l]),
      holes: loops.holes.map((l) => [...l]),
    };
    const list = ui.drawMode === 'outer' ? next.outers : next.holes;
    list[selected.loop]?.splice(selected.index, 1);
    if ((list[selected.loop]?.length ?? 0) === 0) list.splice(selected.loop, 1);
    setSelected(null);
    setActiveLoop(-1);
    writeLoops(next);
  };

  return (
    <div className="page">
      <h1>Boundaries</h1>
      <p className="lede">
        Draw the outline on a grid, or edit the JSON directly. Outer contours and holes are
        Container2 JSON; named guides are Geometry2 JSON.
      </p>

      <section className="panel no-print">
        <h2>Quick rectangle</h2>
        <div className="row">
          <button type="button" className="btn" onClick={() => setRect(4, 3)}>
            4 × 3 m
          </button>
          <button type="button" className="btn" onClick={() => setRect(6, 4)}>
            6 × 4 m
          </button>
          <button type="button" className="btn" onClick={() => setRect(8, 2.5)}>
            8 × 2.5 m
          </button>
        </div>
      </section>

      <section className="panel no-print">
        <h2>Draw</h2>
        <div className="row">
          <div className="field">
            <label>Drawing</label>
            <select
              value={ui.drawMode}
              onChange={(e) => {
                patchUi({ drawMode: e.target.value as 'outer' | 'hole' });
                setActiveLoop(-1);
                setSelected(null);
              }}
            >
              <option value="outer">Outer contour</option>
              <option value="hole">Hole</option>
            </select>
          </div>
          <div className="field">
            <label>Grid resolution (m)</label>
            <select
              value={ui.drawResolution}
              onChange={(e) => patchUi({ drawResolution: Number(e.target.value) })}
            >
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r} m
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Custom (m)</label>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={ui.drawResolution}
              onChange={(e) =>
                patchUi({ drawResolution: Math.max(0.01, Number(e.target.value) || 0.01) })
              }
            />
          </div>
          <div className="field" style={{ minWidth: 'auto' }}>
            <label>&nbsp;</label>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setActiveLoop(-1);
                setSelected(null);
              }}
              disabled={activeLoop < 0}
            >
              Finish loop
            </button>
          </div>
          <div className="field" style={{ minWidth: 'auto' }}>
            <label>&nbsp;</label>
            <button
              type="button"
              className="btn danger"
              onClick={deleteSelected}
              disabled={!selected}
            >
              Delete vertex
            </button>
          </div>
          <div className="field" style={{ minWidth: 'auto' }}>
            <label>&nbsp;</label>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                setActiveLoop(-1);
                setSelected(null);
                // Only the layer being drawn, so clearing holes does not throw
                // away an outline that took a while to trace.
                writeLoops(
                  ui.drawMode === 'outer'
                    ? { outers: [], holes: loops.holes }
                    : { outers: loops.outers, holes: [] },
                );
              }}
              disabled={editing.length === 0}
            >
              Clear {ui.drawMode === 'outer' ? 'outers' : 'holes'}
            </button>
          </div>
        </div>

        <div className="canvas-frame" style={{ marginTop: '1rem', padding: 0 }}>
          <BoundaryDrawCanvas
            outers={loops.outers}
            holes={loops.holes}
            resolution={ui.drawResolution}
            mode={ui.drawMode}
            activeLoop={activeLoop}
            selected={selected}
            onChange={writeLoops}
            onActiveLoopChange={setActiveLoop}
            onSelect={setSelected}
          />
        </div>

        <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
          Click the grid to add a vertex, drag one to move it, click the green first vertex to close
          the loop. +Y is up, matching the 2D view.
          {openLoop && openLoop.length < 3
            ? ` This loop has ${openLoop.length} of the 3 vertices a polygon needs, so it is not stored yet.`
            : ''}
        </p>
        {undrawable > 0 && (
          <p className="error" style={{ marginTop: '0.5rem' }}>
            {undrawable} stored outer/hole shape cannot be drawn or filled — only Polygon2 and Aabb2
            are supported. Edit it in the JSON below.
          </p>
        )}
      </section>

      <div className="split split-2">
        <section className="panel no-print">
          <h2>JSON</h2>
          <div className="field">
            <label>BoundaryConditions</label>
            <textarea
              className="field-textarea-tall"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
          </div>
          <div className="row" style={{ marginTop: '0.75rem' }}>
            <button type="button" className="btn primary" onClick={applyJson}>
              Apply JSON
            </button>
            <button type="button" className="btn" onClick={() => setRaw(null)}>
              Reload from project
            </button>
          </div>
          {error && <p className="error" style={{ marginTop: '0.75rem' }}>{error}</p>}
        </section>

        <section className="panel">
          <h2>Preview</h2>
          <div className="canvas-frame" style={{ padding: '1rem' }}>
            <BoundarySvg boundaries={project.boundaries} />
          </div>
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            Outers: {project.boundaries.outers.length} · Holes: {project.boundaries.holes.length} ·
            Guides: {project.boundaries.guides.length}
            {loops.outers[0] ? ` · outer winding ${signedArea(loops.outers[0]) >= 0 ? 'CCW' : 'CW'}` : ''}
          </p>
          <ul className="muted">
            {project.boundaries.guides.map((g) => (
              <li key={g.id}>
                {g.name} <span className="mono">({String(g.geometry.type)})</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
