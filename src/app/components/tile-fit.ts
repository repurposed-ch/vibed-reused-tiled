import {
  describeFit,
  fitTile,
  formatMm,
  widenedJoint,
  type TileDefinitionJson,
  type TileGridJson,
} from '@/domain/project';

export type FitStatus = {
  kind: 'ok' | 'warning' | 'error';
  /** The full sentence, for the editor. */
  message: string;
  /** A few words, for a card. */
  short: string;
};

/**
 * How a tile fits the tile schema's grid: checked in the orientations the schema actually uses
 * for it (both, when it is unused), because a tile placed turned that is too large turned is
 * broken now even if it would fit upright.
 */
export function tileFitStatus(tile: TileDefinitionJson, grid: TileGridJson | undefined): FitStatus | null {
  if (!grid) return null;
  const used = grid.instances.filter((instance) => instance.tileDefinitionId === tile.id);
  const orientations = used.length > 0 ? [...new Set(used.map((i) => i.rotated))] : [false, true];
  const fits = orientations.map((rotated) => ({ rotated, fit: fitTile(tile, grid.cell, grid.joint, rotated) }));
  const turned = (rotated: boolean) => (rotated ? ' (turned)' : '');

  const bad = fits.filter((f) => f.fit.fit === 'over' || f.fit.fit === 'tooSmall');
  if (used.length > 0 ? bad.length > 0 : bad.length === fits.length) {
    const first = bad[0]!;
    return {
      kind: 'error',
      message: `${describeFit(`${tile.name}${turned(first.rotated)}`, first.fit)}${
        used.length > 0 ? ' The fill leaves it out and uses fallback tiles in its place.' : ''
      }`,
      short: first.fit.fit === 'over' ? 'too large for its footprint' : 'too small for a cell',
    };
  }

  const under = fits.find((f) => f.fit.fit === 'under');
  if (under) {
    const slack = Math.max(under.fit.slack.x, under.fit.slack.y);
    const joint = widenedJoint(grid.joint, slack);
    return {
      kind: 'warning',
      message: `${tile.name}${turned(under.rotated)} is ${formatMm(slack)} under its ${under.fit.iSpan}×${under.fit.jSpan} footprint. It is centred, so the joints beside it widen to ${formatMm(joint.min)}–${formatMm(joint.max)}.`,
      short: `${formatMm(slack)} under its ${under.fit.iSpan}×${under.fit.jSpan} footprint`,
    };
  }

  const exact = fits.find((f) => f.fit.fit === 'exact')!;
  return {
    kind: 'ok',
    message: `Fits its ${exact.fit.iSpan}×${exact.fit.jSpan} footprint.`,
    short: `fits ${exact.fit.iSpan}×${exact.fit.jSpan}`,
  };
}
