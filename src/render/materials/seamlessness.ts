import type { SdfNodeJson } from '@/domain/material';

export type SeamSeverity = 'error' | 'warning' | 'info';

export type SeamIssue = {
  severity: SeamSeverity;
  /** The op the issue was found on, or 'tile' for whole-tile problems. */
  op: string;
  /**
   * Slot path from the root to the offending node, e.g. ['b','child'].
   * Without this a tree view cannot tell which of several `noise` nodes is meant.
   */
  path: SdfSlotKey[];
  message: string;
};

export type SdfSlotKey = 'child' | 'a' | 'b';

export type TileSize = { length: number; width: number };

const EPS = 1e-3;

function isNearInteger(v: number, eps = EPS): boolean {
  return Math.abs(v - Math.round(v)) <= eps;
}

/** True when `f` is 1/m for a positive integer m. */
function isUnitFraction(f: number): boolean {
  if (!(f > 0)) return false;
  return isNearInteger(1 / f, 1e-6);
}

const SLOT_KEYS: readonly SdfSlotKey[] = ['child', 'a', 'b'];

function children(node: SdfNodeJson): Array<[SdfSlotKey, SdfNodeJson]> {
  const n = node as unknown as Record<string, SdfNodeJson | undefined>;
  return SLOT_KEYS.flatMap((slot) => {
    const child = n[slot];
    return child ? [[slot, child] as [SdfSlotKey, SdfNodeJson]] : [];
  });
}

/**
 * Static seamlessness audit of an SDF graph against a tile size.
 *
 * Most lattice constraints are enforced by snapping in GLSL (cellCount / latticeP
 * round to an integer cell count), so this reports what snapping CANNOT fix —
 * chiefly `rotate` and `scale`, which would change the design — plus `info`
 * notices where an authored value was silently adjusted.
 */
export function seamlessnessReport(sdf: SdfNodeJson, tile: TileSize): SeamIssue[] {
  const issues: SeamIssue[] = [];
  const P: [number, number] = [Math.max(tile.length, 1e-6), Math.max(tile.width, 1e-6)];
  const isSquare = Math.abs(P[0] - P[1]) <= EPS * Math.max(P[0], P[1]);

  // `p >= 0` everywhere at the root, so abs(p) == p and a root-level mirror is dead.
  // `folded` tracks whether an ancestor can push coords negative.
  const visit = (node: SdfNodeJson, folded: boolean, path: SdfSlotKey[]) => {
    switch (node.op) {
      case 'rotate': {
        const quarters = node.angle / (Math.PI / 2);
        if (!isNearInteger(quarters, 1e-6)) {
          issues.push({
            severity: 'error',
            op: 'rotate',
            path,
            message:
              `angle ${node.angle.toFixed(4)} rad is not a multiple of 90°. Rotating a ` +
              `periodic field off the tile lattice breaks seamlessness.`,
          });
        } else if (Math.abs(Math.round(quarters)) % 2 === 1 && !isSquare) {
          // 90/270 map (Px,0) to (0,Px), which is only a lattice vector on a square tile —
          // and the per-axis cell counts differ on a rectangle, so the field swaps axes too.
          issues.push({
            severity: 'error',
            op: 'rotate',
            path,
            message:
              `90°/270° rotation needs a square tile; this one is ` +
              `${P[0].toFixed(3)} × ${P[1].toFixed(3)}. Rotating swaps the axes, but the ` +
              `per-axis periods (and cell counts) differ. Use 0° or 180°.`,
          });
        }
        break;
      }
      case 'scale': {
        const fx = typeof node.factor === 'number' ? node.factor : node.factor[0];
        const fy = typeof node.factor === 'number' ? node.factor : node.factor[1];
        for (const [axis, f] of [
          ['x', fx],
          ['y', fy],
        ] as const) {
          if (!isUnitFraction(f)) {
            issues.push({
              severity: 'error',
              op: 'scale',
              path,
              message:
                `factor.${axis} = ${f} is not 1/integer. g(p/s) has period s·P, which ` +
                `only divides P when s = 1/m for a positive integer m.`,
            });
          }
        }
        break;
      }
      case 'repeat': {
        node.period.forEach((per, i) => {
          const ratio = P[i]! / Math.max(per, 1e-6);
          if (!isNearInteger(ratio)) {
            issues.push({
              severity: 'error',
              op: 'repeat',
              path,
              message:
                `period[${i}] = ${per} does not divide the tile period ${P[i]!.toFixed(3)} ` +
                `(ratio ${ratio.toFixed(3)}). The repeat phase mismatches at the wrap. ` +
                `Nearest safe value: ${(P[i]! / Math.max(1, Math.round(ratio))).toFixed(4)}.`,
            });
          }
        });
        break;
      }
      case 'mirror': {
        if (!folded) {
          issues.push({
            severity: 'warning',
            op: 'mirror',
            path,
            message:
              `mirror has no effect here — p is non-negative at the root, so abs(p) == p. ` +
              `It is only meaningful beneath a translate or repeat.`,
          });
        }
        break;
      }
      case 'noise':
      case 'cells':
      case 'truchet':
      case 'scratches':
      case 'checker':
      case 'voronoi': {
        // cellCount() rounds to an integer cell count, so this always closes —
        // but the authored scale is silently adjusted, which is worth surfacing.
        const raw = P.map((p) => p * node.scale);
        if (raw.some((r) => !isNearInteger(r, 0.01))) {
          const snapped = raw.map((r) => Math.max(1, Math.round(r)));
          issues.push({
            severity: 'info',
            op: node.op,
            path,
            message:
              `scale ${node.scale} gives ${raw.map((r) => r.toFixed(2)).join(' × ')} cells; ` +
              `snapped to ${snapped.join(' × ')} to close the lattice.`,
          });
        }
        break;
      }
      case 'stripe': {
        const per = node.axis === 'x' ? P[0]! : P[1]!;
        const bands = per / Math.max(node.spacing, 1e-6);
        if (!isNearInteger(bands, 0.01)) {
          issues.push({
            severity: 'info',
            op: 'stripe',
            path,
            message:
              `spacing ${node.spacing} gives ${bands.toFixed(2)} bands across ` +
              `${per.toFixed(3)}; snapped to ${Math.max(1, Math.round(bands))}.`,
          });
        }
        break;
      }
      case 'warp': {
        if (Math.abs(node.amount) > 0.5 * Math.min(P[0]!, P[1]!)) {
          issues.push({
            severity: 'warning',
            op: 'warp',
            path,
            message:
              `amount ${node.amount} is large relative to the tile (${P[0]!.toFixed(2)} × ` +
              `${P[1]!.toFixed(2)}). Still seamless, but the field is heavily smeared and ` +
              `any band/fill below it will breathe in width.`,
          });
        }
        break;
      }
      default:
        break;
    }

    // translate and repeat can push coords negative, making a mirror below them live.
    const foldsBelow = folded || node.op === 'translate' || node.op === 'repeat';
    for (const [slot, child] of children(node)) visit(child, foldsBelow, [...path, slot]);
  };

  visit(sdf, false, []);
  return issues;
}

/** Highest severity present, or null when the graph is clean. */
export function worstSeverity(issues: SeamIssue[]): SeamSeverity | null {
  if (issues.some((i) => i.severity === 'error')) return 'error';
  if (issues.some((i) => i.severity === 'warning')) return 'warning';
  if (issues.length > 0) return 'info';
  return null;
}
