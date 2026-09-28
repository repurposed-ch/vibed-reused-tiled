import { useMemo, useState } from 'react';
import type { SdfOp } from '@/domain/material';
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  OP_META,
  opsInCategory,
  thumbnailNode,
  type Vec2,
} from '@/render/materials';
import { SdfThumb } from './sdf-thumb';

/**
 * Reference gallery for the whole op language: every op rendered live, with what it
 * does and how to get it into the graph. This is the only documentation of the op set
 * that exists — the zod schema pins types but says nothing about intent.
 */
export function OpGallery({
  seed,
  period,
  onInsert,
  onWrap,
}: {
  seed: number;
  period: Vec2;
  /** Replace the selected node with this op's example. */
  onInsert: (op: SdfOp) => void;
  /** Put the selected node inside a new node of this op. */
  onWrap: (op: SdfOp) => void;
}) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATEGORY_ORDER.map((category) => ({
      category,
      ops: opsInCategory(category).filter(
        (op) =>
          !q ||
          op.toLowerCase().includes(q) ||
          OP_META[op].summary.toLowerCase().includes(q) ||
          CATEGORY_LABEL[category].toLowerCase().includes(q),
      ),
    })).filter((g) => g.ops.length > 0);
  }, [query]);

  return (
    <div className="stack">
      <div className="field">
        <label>Filter ops</label>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="noise, terrazzo, veining, wear…"
        />
      </div>

      {groups.length === 0 && (
        <p className="muted m-0">
          Nothing matches “{query}”.
        </p>
      )}

      {groups.map(({ category, ops }) => (
        <section key={category} className="stack gap-2">
          <h3 className="muted small m-0">{CATEGORY_LABEL[category]}</h3>
          <div className="op-grid">
            {ops.map((op) => {
              const meta = OP_META[op];
              const canWrap = meta.slots.length > 0;
              return (
                <article key={op} className="op-card">
                  <SdfThumb node={thumbnailNode(op)} seed={seed} period={period} size={64} />
                  <div className="stack gap-1 grow">
                    <div className="row gap-2 center">
                      <span className="mono">{meta.label}</span>
                      {meta.returns === 'distance' && <span className="pill">dist</span>}
                    </div>
                    <p className="muted tiny m-0">
                      {meta.summary}
                    </p>
                    <div className="row gap-2">
                      <button
                        type="button"
                        className="btn xs"
                        title="Replace the selected node with this op"
                        onClick={() => onInsert(op)}
                      >
                        Insert
                      </button>
                      <button
                        type="button"
                        className="btn xs"
                        disabled={!canWrap}
                        title={
                          canWrap
                            ? 'Put the selected node inside this op'
                            : 'This op takes no inputs, so it cannot wrap anything'
                        }
                        onClick={() => onWrap(op)}
                      >
                        Wrap
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
