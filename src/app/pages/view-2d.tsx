import { InstanceSvg } from '@/render/svg/instance-svg';
import { useProject } from '../project-context';

export function View2dPage() {
  const { project } = useProject();

  return (
    <div className="page">
      <h1>2D view</h1>
      <p className="lede">SVG rendering of the design instance for screen and PDF print.</p>

      <div className="row no-print" style={{ marginBottom: '1rem' }}>
        <button type="button" className="btn primary" onClick={() => window.print()}>
          Print / Save PDF
        </button>
      </div>

      {!project.instance && <p className="muted">No instance yet — run Solve first.</p>}

      {project.instance && (
        <section className="panel">
          <div className="canvas-frame" style={{ padding: '1rem', background: '#f7f3ec' }}>
            <InstanceSvg
              instance={project.instance}
              tiles={project.tileDefinitions}
              boundaries={project.boundaries}
              scale={70}
            />
          </div>
        </section>
      )}
    </div>
  );
}
