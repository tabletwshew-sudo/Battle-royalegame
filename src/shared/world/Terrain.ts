import type { Vec3 } from "../sim/MathUtil";

/**
 * Regular height grid shared by the physics heightfield, the renderer and
 * world-generation queries. Heights are stored row-major (row = z index,
 * column = x index) starting at the minimum corner.
 *
 * `heightAt` interpolates over the same two triangles per cell that Rapier's
 * heightfield uses (measured in M4): each cell is split along the diagonal
 * from (x1, z0) to (x0, z1). So placement queries, rendering and collision
 * agree exactly.
 */
export interface TerrainGrid {
  /** Cells per side (vertices per side = cells + 1). */
  cells: number;
  cellSize: number;
  /** World x/z of vertex (0, 0). */
  originX: number;
  originZ: number;
  /** (cells + 1)^2 heights, index = iz * (cells + 1) + ix. */
  heights: Float32Array;
}

export function gridSize(grid: TerrainGrid): number {
  return grid.cells * grid.cellSize;
}

/** Height of vertex (ix, iz), clamped to the grid. */
export function vertexHeight(grid: TerrainGrid, ix: number, iz: number): number {
  const n = grid.cells;
  const x = ix < 0 ? 0 : ix > n ? n : ix;
  const z = iz < 0 ? 0 : iz > n ? n : iz;
  return grid.heights[z * (n + 1) + x] as number;
}

/** Terrain height at a world position (outside the grid the edge height continues). */
export function heightAt(grid: TerrainGrid, x: number, z: number): number {
  const gx = (x - grid.originX) / grid.cellSize;
  const gz = (z - grid.originZ) / grid.cellSize;
  const n = grid.cells;
  let ix = Math.floor(gx);
  let iz = Math.floor(gz);
  ix = ix < 0 ? 0 : ix > n - 1 ? n - 1 : ix;
  iz = iz < 0 ? 0 : iz > n - 1 ? n - 1 : iz;
  const u = Math.min(1, Math.max(0, gx - ix));
  const v = Math.min(1, Math.max(0, gz - iz));
  const h00 = vertexHeight(grid, ix, iz);
  const h10 = vertexHeight(grid, ix + 1, iz);
  const h01 = vertexHeight(grid, ix, iz + 1);
  const h11 = vertexHeight(grid, ix + 1, iz + 1);
  if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
  return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}

/** Smooth surface normal from central differences (for slopes and shading). */
export function normalAt(grid: TerrainGrid, x: number, z: number, out: Vec3): Vec3 {
  const e = grid.cellSize;
  const dx = heightAt(grid, x + e, z) - heightAt(grid, x - e, z);
  const dz = heightAt(grid, x, z + e) - heightAt(grid, x, z - e);
  const nx = -dx;
  const ny = 2 * e;
  const nz = -dz;
  const length = Math.hypot(nx, ny, nz);
  out.x = nx / length;
  out.y = ny / length;
  out.z = nz / length;
  return out;
}

/** Slope angle in degrees at a world position. */
export function slopeAt(grid: TerrainGrid, x: number, z: number): number {
  const n = normalAt(grid, x, z, { x: 0, y: 1, z: 0 });
  return (Math.acos(Math.min(1, n.y)) * 180) / Math.PI;
}

/**
 * Heights in Rapier's heightfield layout: column-major with rows along z
 * and columns along x (index = ix * (cells + 1) + iz).
 */
export function rapierHeights(grid: TerrainGrid): Float32Array {
  const v = grid.cells + 1;
  const out = new Float32Array(v * v);
  for (let iz = 0; iz < v; iz++) {
    for (let ix = 0; ix < v; ix++) out[ix * v + iz] = grid.heights[iz * v + ix] as number;
  }
  return out;
}
