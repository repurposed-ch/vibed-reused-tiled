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
        <p className="muted" style={{ margin: 0 }}>
          Nothing matches “{query}”.
        </p>
      )}

      {groups.map(({ category, ops }) => (
        <section key={category} className="stack" style={{ gap: '0.5rem' }}>
          <h3
            className="mono muted"
            style={{
              margin: '0.25rem 0 0',
              fontSize: '0.72rem',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {CATEGORY_LABEL[category]}
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
              gap: '0.5rem',
            }}
          >
            {ops.map((op) => {
              const meta = OP_META[op];
              const canWrap = meta.slots.length > 0;
              return (
                <article
                  key={op}
                  style={{
                    border: '1px solid #4a4036',
                    padding: '0.5rem',
                    display: 'flex',
                    gap: '0.5rem',
                    minWidth: 0,
                  }}
                >
                  <SdfThumb node={thumbnailNode(op)} seed={seed} period={period} size={64} />
                  <div className="stack" style={{ gap: '0.3rem', minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: '0.35rem', alignItems: 'center' }}>
                      <span className="mono" style={{ fontSize: '0.82rem' }}>
                        {meta.label}
                      </span>
                      {meta.returns === 'distance' && <span className="pill">dist</span>}
                    </div>
                    <p className="muted" style={{ margin: 0, fontSize: '0.7rem' }}>
                      {meta.summary}
                    </p>
                    <div className="row" style={{ gap: '0.35rem' }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '0.3rem 0.5rem', minHeight: 0, fontSize: '0.75rem' }}
                        title="Replace the selected node with this op"
                        onClick={() => onInsert(op)}
                      >
                        Insert
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '0.3rem 0.5rem', minHeight: 0, fontSize: '0.75rem' }}
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
