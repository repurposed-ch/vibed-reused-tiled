import { describe, expect, it } from 'vitest';
import { SDF_OPS, SdfNodeJsonSchema, type SdfNodeJson, type SdfOp } from '@/domain/material';
import { OP_META, opsInCategory, thumbnailNode, CATEGORY_ORDER } from './op-meta';
import { evalSdfNode, toShade, type Vec2 } from './sdf-cpu';
import { compileSdfExpression } from './sdf-to-glsl';
import {
  changeOp,
  changeOpAt,
  defaultNodeForOp,
  getNodeAt,
  listNodes,
  pathFromKey,
  pathKey,
  paramSummary,
  pathsEqual,
  replaceNodeAt,
  setParamAt,
  unwrapNodeAt,
  wrapNodeAt,
  type SdfPath,
} from './sdf-edit';

const TILE: Vec2 = [0.6, 0.3];
const SEED = 7;

/** Min/max of a node's shade over the tile — used to catch a flat gallery thumbnail. */
function spread(node: SdfNodeJson, samples = 32): number {
  let lo = 1;
  let hi = 0;
  for (let y = 0; y < samples; y += 1) {
    for (let x = 0; x < samples; x += 1) {
      const p: Vec2 = [((x + 0.5) / samples) * TILE[0], ((y + 0.5) / samples) * TILE[1]];
      const v = toShade(evalSdfNode(node, p, SEED, TILE));
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return hi - lo;
}

describe('OP_META registry', () => {
  it('covers every op exactly once', () => {
    expect(Object.keys(OP_META).sort()).toEqual([...SDF_OPS].sort());
  });

  it('assigns every op to a known category', () => {
    const covered = CATEGORY_ORDER.flatMap((c) => opsInCategory(c));
    expect(covered.sort()).toEqual([...SDF_OPS].sort());
  });

  it.each(SDF_OPS.map((op) => [op] as const))('%s example is a valid node of its own op', (op) => {
    const node = OP_META[op].example();
    expect(node.op).toBe(op);
    expect(() => SdfNodeJsonSchema.parse(node)).not.toThrow();
  });

  it.each(SDF_OPS.map((op) => [op] as const))('%s example compiles to GLSL', (op) => {
    const expr = compileSdfExpression(OP_META[op].example());
    expect(expr.length).toBeGreaterThan(0);
    expect(expr).not.toContain('undefined');
    expect(expr).not.toContain('NaN');
  });

  it.each(SDF_OPS.map((op) => [op] as const))('%s declares slots matching its example', (op) => {
    const node = OP_META[op].example() as unknown as Record<string, unknown>;
    for (const slot of OP_META[op].slots) {
      expect(node[slot], `${op} example is missing its ${slot} slot`).toBeDefined();
    }
  });

  // The gallery sweep, automated: a flat thumbnail means a bad example — usually the
  // too-few-cells trap, where a low scale gives a 2x1 lattice and the field degenerates.
  it.each(SDF_OPS.map((op) => [op] as const))('%s thumbnail is not flat', (op) => {
    expect(spread(thumbnailNode(op))).toBeGreaterThan(0.05);
  });

  it('every param fallback is accepted by the schema', () => {
    for (const op of SDF_OPS) {
      for (const param of OP_META[op].params) {
        const node = { ...(OP_META[op].example() as object), [param.key]: param.fallback };
        expect(
          SdfNodeJsonSchema.safeParse(node).success,
          `${op}.${param.key} fallback rejected`,
        ).toBe(true);
      }
    }
  });
});

describe('path addressing', () => {
  const tree: SdfNodeJson = {
    op: 'mix',
    t: 0.5,
    a: { op: 'noise', scale: 10, octaves: 3 },
    b: { op: 'curve', gamma: 2, child: { op: 'checker', scale: 10 } },
  };

  it('reads the root with an empty path', () => {
    expect(getNodeAt(tree, [])?.op).toBe('mix');
  });

  it('reads nested nodes', () => {
    expect(getNodeAt(tree, ['a'])?.op).toBe('noise');
    expect(getNodeAt(tree, ['b', 'child'])?.op).toBe('checker');
  });

  it('returns null for a path that does not exist', () => {
    expect(getNodeAt(tree, ['a', 'child'])).toBeNull();
    expect(getNodeAt(tree, ['child'])).toBeNull();
  });

  it('lists every node with depth and slot', () => {
    const entries = listNodes(tree);
    expect(entries.map((e) => e.node.op)).toEqual(['mix', 'noise', 'curve', 'checker']);
    expect(entries.map((e) => e.depth)).toEqual([0, 1, 1, 2]);
    expect(entries.map((e) => e.slot)).toEqual([null, 'a', 'b', 'child']);
    expect(entries.map((e) => pathKey(e.path))).toEqual(['root', 'a', 'b', 'b.child']);
  });

  it('replaces a nested node without touching siblings', () => {
    const next = replaceNodeAt(tree, ['b', 'child'], { op: 'invert', child: { op: 'noise', scale: 8 } });
    expect(getNodeAt(next, ['b', 'child'])?.op).toBe('invert');
    expect(getNodeAt(next, ['a'])?.op).toBe('noise');
    expect(getNodeAt(tree, ['b', 'child'])?.op).toBe('checker'); // original untouched
  });

  it('replacing the root returns the new node', () => {
    expect(replaceNodeAt(tree, [], { op: 'checker', scale: 4 }).op).toBe('checker');
  });

  it('round-trips a path through its key', () => {
    for (const path of [[], ['a'], ['b', 'child'], ['b', 'a', 'child']] as SdfPath[]) {
      expect(pathsEqual(pathFromKey(pathKey(path)), path)).toBe(true);
    }
  });
});

describe('structural edits', () => {
  const tree: SdfNodeJson = {
    op: 'mix',
    t: 0.5,
    a: { op: 'noise', scale: 10, octaves: 3 },
    b: { op: 'checker', scale: 10 },
  };

  it('wraps a subtree in a new parent, keeping it as the first slot', () => {
    const next = wrapNodeAt(tree, ['a'], 'warp');
    expect(getNodeAt(next, ['a'])?.op).toBe('warp');
    expect(getNodeAt(next, ['a', 'child'])?.op).toBe('noise');
    expect(SdfNodeJsonSchema.safeParse(next).success).toBe(true);
  });

  it('wraps the root', () => {
    const next = wrapNodeAt(tree, [], 'posterize');
    expect(next.op).toBe('posterize');
    expect(getNodeAt(next, ['child'])?.op).toBe('mix');
  });

  it('refuses to wrap with a leaf op', () => {
    expect(wrapNodeAt(tree, ['a'], 'checker')).toBe(tree);
  });

  it('unwraps by promoting the first child', () => {
    const wrapped = wrapNodeAt(tree, ['a'], 'warp');
    const next = unwrapNodeAt(wrapped, ['a']);
    expect(getNodeAt(next, ['a'])?.op).toBe('noise');
  });

  it('replaces an unwrapped leaf with a default rather than leaving a hole', () => {
    const next = unwrapNodeAt(tree, ['a']);
    expect(getNodeAt(next, ['a'])?.op).toBe('noise');
    expect(SdfNodeJsonSchema.safeParse(next).success).toBe(true);
  });

  it('leaves a leaf root alone', () => {
    const leaf: SdfNodeJson = { op: 'checker', scale: 10 };
    expect(unwrapNodeAt(leaf, [])).toBe(leaf);
  });

  it('every op can wrap, swap onto and unwrap from a graph and stay valid', () => {
    for (const op of SDF_OPS) {
      const swapped = changeOpAt(tree, ['a'], op);
      expect(SdfNodeJsonSchema.safeParse(swapped).success, `changeOp to ${op}`).toBe(true);
      if (OP_META[op].slots.length > 0) {
        const wrapped = wrapNodeAt(tree, ['a'], op);
        expect(SdfNodeJsonSchema.safeParse(wrapped).success, `wrap with ${op}`).toBe(true);
        expect(SdfNodeJsonSchema.safeParse(unwrapNodeAt(wrapped, ['a'])).success).toBe(true);
      }
    }
  });
});

describe('changeOp', () => {
  it('carries over a shared numeric parameter', () => {
    const from: SdfNodeJson = { op: 'noise', scale: 17, octaves: 4 };
    const next = changeOp(from, 'checker');
    expect(next).toMatchObject({ op: 'checker', scale: 17 });
  });

  it('clamps a carried value into the new op range', () => {
    // ring.thickness is meters and unbounded-ish; truchet.thickness is cell units, max 0.5.
    const from: SdfNodeJson = { op: 'ring', radius: 0.1, thickness: 0.9 };
    const next = changeOp(from, 'truchet') as Extract<SdfNodeJson, { op: 'truchet' }>;
    expect(next.thickness).toBeLessThanOrEqual(0.5);
    expect(SdfNodeJsonSchema.safeParse(next).success).toBe(true);
  });

  it('does not carry an enum value the new op does not accept', () => {
    const from: SdfNodeJson = { op: 'noise', scale: 10, variant: 'ridged' };
    const next = changeOp(from, 'truchet') as Extract<SdfNodeJson, { op: 'truchet' }>;
    expect(next.variant).toBe('arcs');
  });

  it('carries children slot by slot', () => {
    const from: SdfNodeJson = {
      op: 'mix',
      t: 0.3,
      a: { op: 'checker', scale: 6 },
      b: { op: 'noise', scale: 12 },
    };
    const next = changeOp(from, 'overlay');
    expect(getNodeAt(next, ['a'])?.op).toBe('checker');
    expect(getNodeAt(next, ['b'])?.op).toBe('noise');
  });

  it('maps a single child into the new op first slot', () => {
    const from: SdfNodeJson = { op: 'invert', child: { op: 'checker', scale: 8 } };
    const next = changeOp(from, 'posterize');
    expect(getNodeAt(next, ['child'])?.op).toBe('checker');
  });

  it('is a no-op when the op is unchanged', () => {
    const from: SdfNodeJson = { op: 'checker', scale: 8 };
    expect(changeOp(from, 'checker')).toBe(from);
  });
});

describe('setParamAt', () => {
  const tree: SdfNodeJson = { op: 'curve', gamma: 2, child: { op: 'noise', scale: 10 } };

  it('sets a valid value', () => {
    const next = setParamAt(tree, ['child'], 'scale', 24);
    expect(getNodeAt(next, ['child'])).toMatchObject({ scale: 24 });
  });

  it('rejects a value the schema refuses, leaving the tree untouched', () => {
    expect(setParamAt(tree, ['child'], 'scale', -5)).toBe(tree);
    expect(setParamAt(tree, [], 'gamma', 0)).toBe(tree);
  });
});

describe('helpers', () => {
  it('defaultNodeForOp returns that op', () => {
    for (const op of SDF_OPS) expect(defaultNodeForOp(op as SdfOp).op).toBe(op);
  });

  it('summarises a node parameters for a tree row', () => {
    expect(paramSummary({ op: 'noise', scale: 10, octaves: 4 })).toContain('10');
    expect(paramSummary({ op: 'cells', scale: 9, metric: 'id' })).toContain('id');
    expect(paramSummary({ op: 'mul', a: { op: 'noise', scale: 4 }, b: { op: 'noise', scale: 8 } })).toBe('');
  });
});
