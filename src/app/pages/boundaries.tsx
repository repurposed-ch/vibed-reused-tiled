import { BoundaryConditionsJsonSchema } from '@/domain/project';
import { BoundarySvg } from '@/render/svg/boundary-svg';
import { useState } from 'react';
import { useProject } from '../project-context';

type Vec = { type: 'Vec2'; x: number; y: number };

export function BoundariesPage() {
  const { project, updateProject } = useProject();
  const [raw, setRaw] = useState(() => JSON.stringify(project.boundaries, null, 2));
  const [error, setError] = useState<string | null>(null);

  const applyJson = () => {
    try {
      const parsed = BoundaryConditionsJsonSchema.parse(JSON.parse(raw) as unknown);
      updateProject((p) => ({ ...p, boundaries: parsed }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const setRect = (width: number, height: number) => {
    const vertices: Vec[] = [
      { type: 'Vec2', x: 0, y: 0 },
      { type: 'Vec2', x: width, y: 0 },
      { type: 'Vec2', x: width, y: height },
      { type: 'Vec2', x: 0, y: height },
    ];
    const next = BoundaryConditionsJsonSchema.parse({
      type: 'BoundaryConditions',
      outers: [{ type: 'Polygon2', vertices }],
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
    });
    updateProject((p) => ({ ...p, boundaries: next }));
    setRaw(JSON.stringify(next, null, 2));
    setError(null);
  };

  return (
    <div className="page">
      <h1>Boundaries</h1>
      <p className="lede">
        Outer contours and holes as Container2 JSON; named guides as Geometry2 JSON (Line2,
        Polygon2, …).
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

      <div className="split split-2">
        <section className="panel">
          <h2>JSON</h2>
          <div className="field">
            <label>BoundaryConditions</label>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              style={{ minHeight: '22rem' }}
            />
          </div>
          <div className="row" style={{ marginTop: '0.75rem' }}>
            <button type="button" className="btn primary" onClick={applyJson}>
              Apply JSON
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setRaw(JSON.stringify(project.boundaries, null, 2))}
            >
              Reload from project
            </button>
          </div>
          {error && (
            <p className="error" style={{ marginTop: '0.75rem' }}>
              {error}
            </p>
          )}
        </section>

        <section className="panel">
          <h2>Preview</h2>
          <div className="canvas-frame" style={{ padding: '1rem' }}>
            <BoundarySvg boundaries={project.boundaries} scale={60} />
          </div>
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            Outers: {project.boundaries.outers.length} · Holes: {project.boundaries.holes.length} ·
            Guides: {project.boundaries.guides.length}
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
