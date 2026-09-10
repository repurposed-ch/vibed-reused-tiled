import type { SdfNodeJson } from '@/domain/material';
import {
  listNodes,
  OP_META,
  paramSummary,
  pathKey,
  pathsEqual,
  type SdfPath,
  type SeamIssue,
  type SeamSeverity,
  type Vec2,
} from '@/render/materials';
import { SdfThumb } from './sdf-thumb';

const SEVERITY_COLOR: Record<SeamSeverity, string> = {
  error: '#c45c5c',
  warning: '#d9773a',
  info: '#b5a89a',
};

const SLOT_LABEL: Record<string, string> = { child: '↳', a: 'A', b: 'B' };

/** Worst severity among issues attached to exactly this node. */
function severityAt(issues: SeamIssue[], path: SdfPath): SeamSeverity | null {
  const mine = issues.filter((i) => pathsEqual(i.path, path));
  if (mine.some((i) => i.severity === 'error')) return 'error';
  if (mine.some((i) => i.severity === 'warning')) return 'warning';
  return mine.length > 0 ? 'info' : null;
}

/**
 * Indented outline of the SDF graph.
 *
 * The graph is a strict tree — each node owns its children — so indentation carries the
 * whole structure and there is nothing a node-and-wire canvas would add.
 */
export function SdfTree({
  root,
  seed,
  period,
  issues,
  selected,
  onSelect,
}: {
  root: SdfNodeJson;
  seed: number;
  period: Vec2;
  issues: SeamIssue[];
  selected: SdfPath;
  onSelect: (path: SdfPath) => void;
}) {
  const entries = listNodes(root);

  return (
    <div className="stack" style={{ gap: '0.25rem' }}>
      {entries.map(({ path, node, depth, slot }) => {
        const isSelected = pathsEqual(path, selected);
        const severity = severityAt(issues, path);
        const meta = OP_META[node.op];
        const summary = paramSummary(node);
        return (
          <button
            key={pathKey(path)}
            type="button"
            className={isSelected ? 'btn primary' : 'btn'}
            onClick={() => onSelect(path)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              textAlign: 'left',
              padding: '0.3rem 0.5rem',
              minHeight: 0,
              marginLeft: `${depth * 1.1}rem`,
            }}
          >
            <SdfThumb node={node} seed={seed} period={period} size={34} />
            <span
              className="mono muted"
              style={{ width: '1.1rem', flex: '0 0 1.1rem', fontSize: '0.75rem' }}
            >
              {slot ? SLOT_LABEL[slot] : ''}
            </span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="mono" style={{ fontSize: '0.82rem' }}>
                {meta.label}
              </span>
              {summary && (
                <span
                  className="mono muted"
                  style={{
                    fontSize: '0.72rem',
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {summary}
                </span>
              )}
            </span>
            {meta.returns === 'distance' && (
              <span className="pill" title="Returns a signed distance, not a 0..1 shade">
                dist
              </span>
            )}
            {severity && (
              <span
                title={issues.filter((i) => pathsEqual(i.path, path)).map((i) => i.message).join('\n')}
                style={{
                  width: '0.5rem',
                  height: '0.5rem',
                  flex: '0 0 0.5rem',
                  borderRadius: '50%',
                  background: SEVERITY_COLOR[severity],
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
