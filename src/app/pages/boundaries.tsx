import { useState } from 'react';
import { BoundaryConditionsJsonSchema, type BoundaryConditionsJson } from '@/domain/project';
import { BoundarySvg } from '@/render/svg/boundary-svg';
import { BoundaryDrawCanvas, type LoopSelection } from '@/render/svg/boundary-draw-canvas';
import {
  boundariesFromLoops,
  loopsFromBoundaries,
  orientationOf,
  ORIENTATION_STROKE,
  polygonJsonToLoop,
  reverseLoop,
  signedArea,
  type Loop,
} from '@/render/svg/boundary-draw-geometry';
import { resolveBoundaryRegion } from '@/workflow/boundary-region';
import { useProject } from '../project-context';
import { useUiState } from '../ui-state';

const RESOLUTIONS = [0.05, 0.1, 0.25, 0.5, 1];

/** Stored shapes the editor cannot use: unreadable, or fewer than three vertices. */
function unusableCount(geometries: readonly unknown[]): number {
  return geometries.filter((g) => polygonJsonToLoop(g).length < 3).length;
}

export function BoundariesPage() {
  const { project, updateProject } = useProject();
  const { ui, patchUi } = useUiState();
  const [error, setError] = useState<string | null>(null);
  const [activeLoop, setActiveLoop] = useState(-1);
  const [selection, setSelection] = useState<LoopSelection | null>(null);
  // Bumped to reframe the canvas on the drawing. The view itself lives in the
  // canvas and is not stored, so every visit starts fitted.
  const [fitKey, setFitKey] = useState(0);
  const fit = () => setFitKey((k) => k + 1);

  // One ordered list of loops, orientation being each loop's role. It becomes page
  // state after an edit for two reasons: a loop still being drawn has too few
  // vertices to be stored at all, and reversing a loop moves it between the stored
  // `outers` and `holes` lists — keeping this order is what keeps a selection
  // index pointing at the same polygon.
  const [draft, setDraft] = useState<Loop[] | null>(null);
  const loops = draft ?? loopsFromBoundaries(project.boundaries);

  const raw = ui.boundaryRaw ?? JSON.stringify(project.boundaries, null, 2);
  const setRaw = (next: string | null) => patchUi({ boundaryRaw: next });

  const region = resolveBoundaryRegion(project.boundaries);
  const undrawable =
    unusableCount(project.boundaries.outers) + unusableCount(project.boundaries.holes);

  const writeLoops = (next: Loop[]) => {
    // Filed by orientation — counter-clockwise under `outers`, clockwise under
    // `holes` — so the stored lists always agree with the winding.
    const boundaries = boundariesFromLoops(next, project.boundaries);
    updateProject((p) => ({ ...p, boundaries }));
    setRaw(null);
    setError(null);
    setDraft(next);
  };

  const selectedLoop =
    selection != null && selection.loop < loops.length ? selection.loop : null;
  const drawing = ui.drawTool === 'draw' && activeLoop >= 0;
  const closedLoops = loops.filter((l, i) => l.length >= 3 && !(drawing && i === activeLoop));
  const solids = closedLoops.filter((l) => orientationOf(l) === 'ccw').length;
  const holes = closedLoops.length - solids;

  const reverseAt = (index: number) => {
    writeLoops(loops.map((l, k) => (k === index ? reverseLoop(l) : l)));
    setSelection({ kind: 'loop', loop: index });
  };

  const deleteLoopAt = (index: number) => {
    writeLoops(loops.filter((_, k) => k !== index));
    setSelection(null);
    setActiveLoop((current) => (current === index ? -1 : current > index ? current - 1 : current));
  };

  const deleteVertex = () => {
    if (selection?.kind !== 'vertex') return;
    const next = loops.map((l) => [...l]);
    next[selection.loop]?.splice(selection.index, 1);
    if ((next[selection.loop]?.length ?? 0) === 0) {
      deleteLoopAt(selection.loop);
      return;
    }
    writeLoops(next);
    setSelection({ kind: 'loop', loop: selection.loop });
  };

  const applyJson = () => {
    try {
      const parsed = BoundaryConditionsJsonSchema.parse(JSON.parse(raw) as unknown);
      // The schema is a passthrough over `{ type: string }`, so it accepts
      // geometry no renderer can draw and no solver can use. Catch that here
      // rather than leaving an empty preview and a success message.
      const bad = unusableCount(parsed.outers) + unusableCount(parsed.holes);
      if (bad > 0) {
        setError(
          `${bad} outer/hole entr${bad === 1 ? 'y has' : 'ies have'} fewer than three usable vertices. Only Polygon2 and Aabb2 can be drawn or filled.`,
        );
        return;
      }
      // The list decides the role on read, then loops are re-filed by
      // orientation — so a clockwise loop typed under `outers` is stored as a
      // counter-clockwise solid, as the list said it should be.
      const normalised = boundariesFromLoops(loopsFromBoundaries(parsed), parsed);
      updateProject((p) => ({ ...p, boundaries: normalised }));
      setDraft(null);
      setSelection(null);
      setActiveLoop(-1);
      fit();
      setRaw(null);
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
    setSelection(null);
    setError(null);
    fit();
  };

  const openLoop = drawing ? loops[activeLoop] : undefined;
  const selected = selectedLoop != null ? loops[selectedLoop] : undefined;

  const setTool = (tool: 'draw' | 'select') => {
    patchUi({ drawTool: tool });
    setActiveLoop(-1);
  };

  return (
    <div className="page">
      <h1>Boundaries</h1>
      <p className="lede">
        Draw the outline on a grid, or edit the JSON directly. The direction a polygon is traced
        decides its role: counter-clockwise is solid, clockwise is a hole.
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
          <div className="field" style={{ minWidth: 'auto' }}>
            <label>Tool</label>
            <div className="row" style={{ gap: '0.25rem' }}>
              <button
                type="button"
                className={ui.drawTool === 'draw' ? 'btn primary' : 'btn'}
                onClick={() => setTool('draw')}
              >
                Draw
              </button>
              <button
                type="button"
                className={ui.drawTool === 'select' ? 'btn primary' : 'btn'}
                onClick={() => setTool('select')}
              >
                Select
              </button>
            </div>
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
        </div>

        <div className="row" style={{ marginTop: '0.75rem' }}>
          <button type="button" className="btn" onClick={fit}>
            Fit
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setActiveLoop(-1)}
            disabled={!drawing}
          >
            Finish loop
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => selectedLoop != null && reverseAt(selectedLoop)}
            disabled={selectedLoop == null}
          >
            Reverse orientation
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => selectedLoop != null && deleteLoopAt(selectedLoop)}
            disabled={selectedLoop == null}
          >
            Delete polygon
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={deleteVertex}
            disabled={selection?.kind !== 'vertex'}
          >
            Delete vertex
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              writeLoops([]);
              setActiveLoop(-1);
              setSelection(null);
            }}
            disabled={loops.length === 0}
          >
            Clear all
          </button>
        </div>

        <div className="canvas-frame" style={{ marginTop: '1rem', padding: 0 }}>
          <BoundaryDrawCanvas
            loops={loops}
            resolution={ui.drawResolution}
            tool={ui.drawTool}
            activeLoop={activeLoop}
            selection={selection}
            onChange={writeLoops}
            onActiveLoopChange={setActiveLoop}
            onSelect={setSelection}
            onReverse={reverseAt}
            onDeleteLoop={deleteLoopAt}
            fitKey={fitKey}
          />
        </div>

        <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
          <span style={{ color: ORIENTATION_STROKE.ccw }}>■</span> counter-clockwise is solid ·{' '}
          <span style={{ color: ORIENTATION_STROKE.cw }}>■</span> clockwise is a hole. Scroll to zoom; middle-drag or Space+drag to pan.{' '}
          {ui.drawTool === 'draw'
            ? 'Click the grid to add a vertex and the green first vertex to close — the direction you trace decides the role. Drag a vertex to move it.'
            : 'Click a polygon to select it; clicking the same spot again steps to the next polygon underneath. With one selected, R reverses it and Delete removes it.'}
          {openLoop && openLoop.length < 3
            ? ` This loop has ${openLoop.length} of the 3 vertices a polygon needs, so it is not stored yet.`
            : ''}
        </p>
        {selected && selected.length >= 3 && (
          <p className="mono muted" style={{ marginTop: '0.25rem' }}>
            Selected: {orientationOf(selected) === 'ccw' ? 'solid (counter-clockwise)' : 'hole (clockwise)'}{' '}
            · {Math.abs(signedArea(selected)).toFixed(2)} m² · {selected.length} vertices
          </p>
        )}
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
            Solids: {solids} · Holes: {holes} · Guides: {project.boundaries.guides.length}
          </p>
          {/* The shape that actually gets tiled, as a number as well as a picture. */}
          <p className="mono muted" style={{ marginTop: '0.25rem' }}>
            {region.empty
              ? 'Tiled region: empty — nothing will be laid.'
              : `Tiled region: ${region.area.toFixed(2)} m² across ${region.polygons.length} loop${region.polygons.length === 1 ? '' : 's'}`}
          </p>
          {region.problem && (
            <p className="error" style={{ marginTop: '0.5rem' }}>
              {region.problem}
            </p>
          )}
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
