import type { GridPos, Tile, TileKey, Reachability } from "./types";
import type { IsoGrid } from "./IsoGrid";

export function keyOf(p: GridPos): TileKey {
  return `${p.q},${p.r}`;
}

export function parseKey(k: TileKey): GridPos {
  const [q, r] = k.split(",").map(Number);
  return { q, r };
}

export function manhattanLikeDiagDistance(
  a: GridPos, 
  b: GridPos
): number {
  // Chebyshev distance for 8-direction movement where diagonal costs 1
  return Math.max(
    Math.abs(a.q - b.q), 
    Math.abs(a.r - b.r)
  );
}

export function bfsReachable(grid: IsoGrid, tiles: Map<TileKey, Tile>, start: GridPos, maxSteps: number, occupied: Set<TileKey>): Reachability {
  const startKey = keyOf(start);
  const reachable = new Set<TileKey>();
  const cameFrom = new Map<TileKey, TileKey | null>();

  const q: TileKey[] = [];
  const dist = new Map<TileKey, number>();

  q.push(startKey);
  dist.set(startKey, 0);
  cameFrom.set(startKey, null);
  reachable.add(startKey);

  while (q.length > 0) {
    const curKey = q.shift()!;
    const cur = parseKey(curKey);
    const curDist = dist.get(curKey)!;

    if (curDist >= maxSteps) continue;

    for (const n of grid.neighbors8(cur)) {
      const nk = keyOf(n);
      if (dist.has(nk)) continue;

      const tile = tiles.get(nk);
      if (!tile || !tile.walkable) continue;

      // Occupied tiles are not walkable destinations, except the start tile
      if (occupied.has(nk) && nk !== startKey) continue;

      dist.set(nk, curDist + 1);
      cameFrom.set(nk, curKey);
      reachable.add(nk);
      q.push(nk);
    }
  }

  return { reachable, cameFrom };
}

export function reconstructPath(cameFrom: Map<TileKey, TileKey | null>, start: GridPos, goal: GridPos): GridPos[] {
  const startK = keyOf(start);
  const goalK = keyOf(goal);
  if (!cameFrom.has(goalK)) return [];

  const pathKeys: TileKey[] = [];
  let cur: TileKey | null = goalK;
  while (cur) {
    pathKeys.push(cur);
    cur = cameFrom.get(cur) ?? null;
  }
  pathKeys.reverse();
  if (pathKeys[0] !== startK) return [];
  return pathKeys.map(parseKey);
}