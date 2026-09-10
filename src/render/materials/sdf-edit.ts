import {
  SdfNodeJsonSchema,
  type SdfNodeJson,
  type SdfOp,
} from '@/domain/material';
import { OP_META, type ParamMeta, type SdfSlot } from './op-meta';

/**
 * Path-addressed edits on an SDF graph.
 *
 * The graph is a strict tree — every node owns its children, nothing is shared — so a
 * node is addressed by the sequence of slots taken from the root, e.g. ['b','child','a'].
 * All functions are pure and return a new tree.
 */

export type SdfPath = readonly SdfSlot[];

export type TreeEntry = {
  path: SdfPath;
  node: SdfNodeJson;
  depth: number;
  /** Which slot of its parent this node sits in; null for the root. */
  slot: SdfSlot | null;
};

/** Stable string id for a path, for React keys and persisted selection. */
export function pathKey(path: SdfPath): string {
  return path.length === 0 ? 'root' : path.join('.');
}

export function pathFromKey(key: string): SdfPath {
  if (!key || key === 'root') return [];
  return key.split('.').filter((s): s is SdfSlot => s === 'child' || s === 'a' || s === 'b');
}

export function pathsEqual(a: SdfPath, b: SdfPath): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

function slotOf(node: SdfNodeJson, slot: SdfSlot): SdfNodeJson | undefined {
  return (node as unknown as Record<string, SdfNodeJson | undefined>)[slot];
}

export function getNodeAt(root: SdfNodeJson, path: SdfPath): SdfNodeJson | null {
  let node: SdfNodeJson = root;
  for (const slot of path) {
    const next = slotOf(node, slot);
    if (!next) return null;
    node = next;
  }
  return node;
}

export function replaceNodeAt(
  root: SdfNodeJson,
  path: SdfPath,
  next: SdfNodeJson,
): SdfNodeJson {
  if (path.length === 0) return next;
  const [slot, ...rest] = path;
  const child = slotOf(root, slot!);
  if (!child) return root;
  return {
    ...root,
    [slot!]: replaceNodeAt(child, rest, next),
  } as SdfNodeJson;
}

/** Flatten the tree in render order (parent before children). */
export function listNodes(root: SdfNodeJson): TreeEntry[] {
  const out: TreeEntry[] = [];
  const walk = (node: SdfNodeJson, path: SdfPath, depth: number, slot: SdfSlot | null) => {
    out.push({ path, node, depth, slot });
    for (const s of OP_META[node.op].slots) {
      const child = slotOf(node, s);
      if (child) walk(child, [...path, s], depth + 1, s);
    }
  };
  walk(root, [], 0, null);
  return out;
}

function clampParam(param: ParamMeta, value: unknown): unknown | undefined {
  switch (param.kind) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? Math.min(Math.max(value, param.min), param.max)
        : undefined;
    case 'int':
      return typeof value === 'number' && Number.isFinite(value)
        ? Math.min(Math.max(Math.round(value), param.min), param.max)
        : undefined;
    case 'enum':
      // Two ops can share a param name with different option sets (`noise.variant` is
      // fbm|ridged|…, `truchet.variant` is arcs|diagonals), so only carry a legal value.
      return typeof value === 'string' && param.options.includes(value) ? value : undefined;
    case 'bool':
      return typeof value === 'boolean' ? value : undefined;
    case 'vec2':
      return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number')
        ? value
        : undefined;
    case 'scaleFactor':
      return typeof value === 'number' ||
        (Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number'))
        ? value
        : undefined;
    case 'quarterTurn':
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    default:
      return undefined;
  }
}

/** A fresh, valid node for `op`. */
export function defaultNodeForOp(op: SdfOp): SdfNodeJson {
  return OP_META[op].example();
}

/**
 * Swap a node's op, carrying over whatever still fits: parameters that both ops declare
 * (with a legal value), and children matched slot-by-slot in order. Falls back to the
 * plain example if the carried-over result does not validate.
 */
export function changeOp(base: SdfNodeJson, op: SdfOp): SdfNodeJson {
  if (base.op === op) return base;
  const meta = OP_META[op];
  const next = meta.example() as Record<string, unknown>;
  const from = base as unknown as Record<string, unknown>;

  for (const param of meta.params) {
    const carried = clampParam(param, from[param.key]);
    if (carried !== undefined) next[param.key] = carried;
  }

  const fromSlots = OP_META[base.op].slots;
  meta.slots.forEach((slot, i) => {
    const source = fromSlots[i];
    if (source) {
      const child = slotOf(base, source);
      if (child) next[slot] = child;
    }
  });

  const parsed = SdfNodeJsonSchema.safeParse(next);
  return parsed.success ? parsed.data : meta.example();
}

export function changeOpAt(root: SdfNodeJson, path: SdfPath, op: SdfOp): SdfNodeJson {
  const target = getNodeAt(root, path);
  if (!target) return root;
  return replaceNodeAt(root, path, changeOp(target, op));
}

/** Put the subtree at `path` inside a new parent of type `op`, in that op's first slot. */
export function wrapNodeAt(root: SdfNodeJson, path: SdfPath, op: SdfOp): SdfNodeJson {
  const target = getNodeAt(root, path);
  if (!target) return root;
  const meta = OP_META[op];
  const slot = meta.slots[0];
  if (!slot) return root; // a leaf op cannot wrap anything
  const wrapper = { ...(meta.example() as Record<string, unknown>), [slot]: target };
  return replaceNodeAt(root, path, wrapper as SdfNodeJson);
}

/**
 * Remove the node at `path`, promoting its first child into its place.
 * A leaf becomes a default noise, except at the root where there is nothing to promote.
 */
export function unwrapNodeAt(root: SdfNodeJson, path: SdfPath): SdfNodeJson {
  const target = getNodeAt(root, path);
  if (!target) return root;
  const firstChild = OP_META[target.op].slots
    .map((s) => slotOf(target, s))
    .find((c): c is SdfNodeJson => Boolean(c));
  if (firstChild) return replaceNodeAt(root, path, firstChild);
  if (path.length === 0) return root;
  return replaceNodeAt(root, path, defaultNodeForOp('noise'));
}

/** Set one parameter on the node at `path`. */
export function setParamAt(
  root: SdfNodeJson,
  path: SdfPath,
  key: string,
  value: unknown,
): SdfNodeJson {
  const target = getNodeAt(root, path);
  if (!target) return root;
  const next = { ...(target as unknown as Record<string, unknown>), [key]: value };
  const parsed = SdfNodeJsonSchema.safeParse(next);
  return parsed.success ? replaceNodeAt(root, path, parsed.data) : root;
}

/** Short one-line parameter summary for a tree row, e.g. `scale 10 · oct 4`. */
export function paramSummary(node: SdfNodeJson): string {
  const raw = node as unknown as Record<string, unknown>;
  const parts: string[] = [];
  for (const param of OP_META[node.op].params) {
    const value = raw[param.key];
    if (value === undefined) continue;
    if (typeof value === 'number') {
      parts.push(`${param.label.split(' ')[0]!.toLowerCase()} ${Number(value.toFixed(3))}`);
    } else if (typeof value === 'string') {
      parts.push(value);
    } else if (typeof value === 'boolean') {
      if (value) parts.push(param.label.toLowerCase());
    } else if (Array.isArray(value)) {
      parts.push(`[${value.map((n) => Number(Number(n).toFixed(3))).join(', ')}]`);
    }
    if (parts.length >= 3) break;
  }
  return parts.join(' · ');
}
