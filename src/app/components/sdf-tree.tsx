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
    <div className="stack gap-1">
      {entries.map(({ path, node, depth, slot }) => {
        const isSelected = pathsEqual(path, selected);
        const severity = severityAt(issues, path);
        const meta = OP_META[node.op];
        const summary = paramSummary(node);
        return (
          <button
            key={pathKey(path)}
            type="button"
            className={isSelected ? 'btn tree-row primary' : 'btn tree-row'}
            onClick={() => onSelect(path)}
            style={{ marginLeft: `${depth * 1.1}rem` }}
          >
            <SdfThumb node={node} seed={seed} period={period} size={34} />
            <span className="mono muted tiny tree-slot">
              {slot ? SLOT_LABEL[slot] : ''}
            </span>
            <span className="grow">
              <span className="mono">{meta.label}</span>
              {summary && (
                <span className="mono muted tiny truncate">{summary}</span>
              )}
            </span>
            {meta.returns === 'distance' && (
              <span className="pill" title="Returns a signed distance, not a 0..1 shade">
                dist
              </span>
            )}
            {severity && (
              <span
                className={`sev-dot sev-${severity}`}
                title={issues.filter((i) => pathsEqual(i.path, path)).map((i) => i.message).join('\n')}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
