import { GridCell2 } from '../../grid/core/grid-cell2';

const AXIS_DELTAS: readonly GridCell2[] = [
  new GridCell2(1, 0),
  new GridCell2(0, 1),
  new GridCell2(-1, 0),
  new GridCell2(0, -1),
];

/** True when every step changes only `i` or only `j`, never both. */
export function isAxisAlignedPolygonPath(cells: readonly GridCell2[]): boolean {
  if (cells.length < 2) {
    return true;
  }

  for (let index = 1; index < cells.length; index++) {
    const delta = cells[index]!.subtract(cells[index - 1]!);
    if (delta.i !== 0 && delta.j !== 0) {
      return false;
    }
  }

  const closing = cells[0]!.subtract(cells[cells.length - 1]!);
  return closing.i === 0 || closing.j === 0;
}

/** Insert axis-aligned corner cells so consecutive vertices differ in only one index. */
export function ensureAxisAlignedPolygonPath(cells: readonly GridCell2[]): GridCell2[] {
  if (cells.length === 0) {
    return [];
  }

  const result: GridCell2[] = [cells[0]!.clone()];

  for (let index = 1; index < cells.length; index++) {
    appendAxisAlignedSteps(result, cells[index]!);
  }

  return dedupeConsecutiveCells(result);
}

function appendAxisAlignedSteps(path: GridCell2[], target: GridCell2): void {
  let current = path[path.length - 1]!;

  while (!current.equals(target)) {
    const delta = target.subtract(current);
    const step =
      delta.i !== 0 && delta.j !== 0
        ? Math.abs(delta.i) >= Math.abs(delta.j)
          ? new GridCell2(Math.sign(delta.i), 0)
          : new GridCell2(0, Math.sign(delta.j))
        : new GridCell2(Math.sign(delta.i), Math.sign(delta.j));

    current = current.add(step);
    path.push(current.clone());
  }
}

function dedupeConsecutiveCells(cells: readonly GridCell2[]): GridCell2[] {
  const result: GridCell2[] = [];

  for (const cell of cells) {
    const previous = result[result.length - 1];
    if (previous && previous.equals(cell)) {
      continue;
    }
    result.push(cell.clone());
  }

  return result;
}

export function axisDirection(from: GridCell2, to: GridCell2): number | null {
  const delta = to.subtract(from);
  const index = AXIS_DELTAS.findIndex((step) => step.equals(delta));
  return index >= 0 ? index : null;
}

export function directionDelta(direction: number): GridCell2 {
  return AXIS_DELTAS[direction & 3]!;
}
