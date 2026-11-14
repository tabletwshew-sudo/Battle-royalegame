import { POIS } from "../data/names";
import type { Vec3 } from "../sim/MathUtil";
import { Rng } from "../sim/Rng";
import {
  Builder,
  buildClockTower,
  buildDockCrane,
  buildGasStation,
  buildGazebo,
  buildGreenhouse,
  buildHouse,
  buildLakeHouse,
  buildLifeguardTower,
  buildPier,
  buildShop,
  buildStacks,
  buildTower,
  buildWarehouse,
  buildWaterTower,
  buildWindmill,
  type BuildOutput,
  emptyBuildOutput,
} from "./Buildings";
import { fbm, lattice, ridged, smoothstep } from "./Noise";
import type { BushInstance, RockInstance, RockPrototype, StaticWorld, TreeInstance, TreeKind } from "./StaticWorld";
import { heightAt, normalAt, type TerrainGrid } from "./Terrain";

/**
 * Driftglass Atoll generator (GAME_SPEC §5 "Island"). Pure and seeded: the
 * same seed gives the same terrain, biomes, buildings and props in the
 * browser and on the server.
 *
 * Coordinates: metres, island centre at the origin, north = -Z. POI anchors
 * come from `POIS` (u, v in 0..1, north-up) scaled to a 2.4 km square.
 */

export const ISLAND = {
  /** Side of the terrain grid (ocean margin included), metres. */
  size: 3072,
  cellSize: 4,
  /** Nominal coast radius before noise warping. */
  radius: 1150,
  /** u/v -> metres scale for POI anchors. */
  poiSpan: 2400,
  seaLevel: 0,
  oceanFloor: -14,
  beachHeight: 1.8,
  /** Highest mountains reach roughly this much above the hills. */
  mountainHeight: 100,
  terraceStep: 9,
} as const;

export const Biome = {
  Seabed: 0,
  Sand: 1,
  Grass: 2,
  Forest: 3,
  Rock: 4,
  Snow: 5,
  Town: 6,
} as const;
export type BiomeId = (typeof Biome)[keyof typeof Biome];

export type PoiStyle =
  | "towers"
  | "suburb"
  | "stores"
  | "village"
  | "lakeside"
  | "lakeIsland"
  | "beach"
  | "farm"
  | "garden"
  | "docks"
  | "factory";

interface PoiStyleDef {
  style: PoiStyle;
  /** Radius of the flattened pad, metres. */
  flatRadius: number;
  /** Lake carved at the POI centre (radius in metres), if any. */
  lakeRadius?: number;
}

const POI_STYLES: Readonly<Record<string, PoiStyleDef>> = {
  tilted: { style: "towers", flatRadius: 125 },
  pleasant: { style: "suburb", flatRadius: 115 },
  retail: { style: "stores", flatRadius: 110 },
  salty: { style: "village", flatRadius: 100 },
  lazy: { style: "lakeside", flatRadius: 125, lakeRadius: 70 },
  lootlake: { style: "lakeIsland", flatRadius: 70, lakeRadius: 165 },
  sweaty: { style: "beach", flatRadius: 100 },
  misty: { style: "farm", flatRadius: 110 },
  holly: { style: "garden", flatRadius: 100 },
  docks: { style: "docks", flatRadius: 115 },
  steamy: { style: "factory", flatRadius: 125 },
};

export interface PoiInfo {
  id: string;
  name: string;
  style: PoiStyle;
  x: number;
  z: number;
  flatRadius: number;
  /** Height of the flattened ground. */
  padHeight: number;
  lakeRadius: number;
}

export interface IslandData {
  seed: number;
  grid: TerrainGrid;
  /** Biome id per grid vertex (same indexing as the heights). */
  biomes: Uint8Array;
  pois: PoiInfo[];
  world: StaticWorld;
  /** Mountain-top launch pad positions (also part of world.launchPads). */
  peaks: Vec3[];
}

/** Blend width outside a POI pad back to natural terrain, metres. */
const PAD_BLEND = 70;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** POI anchors in metres with their style data (pad heights filled in later). */
function poiPlans(): PoiInfo[] {
  return POIS.map((poi) => {
    const def = POI_STYLES[poi.id] ?? { style: "suburb" as const, flatRadius: 100 };
    return {
      id: poi.id,
      name: poi.name,
      style: def.style,
      x: (poi.u - 0.5) * ISLAND.poiSpan,
      z: (poi.v - 0.5) * ISLAND.poiSpan,
      flatRadius: def.flatRadius,
      padHeight: 0,
      lakeRadius: def.lakeRadius ?? 0,
    };
  });
}

/** Seeds for the individual noise layers. */
function layerSeeds(seed: number): Record<string, number> {
  const rng = new Rng(seed).fork("island-layers");
  return {
    warpX: rng.nextU32(),
    warpZ: rng.nextU32(),
    hills: rng.nextU32(),
    mask: rng.nextU32(),
    ridge: rng.nextU32(),
    moisture: rng.nextU32(),
    trees: rng.nextU32(),
    rocks: rng.nextU32(),
    bushes: rng.nextU32(),
  };
}

/** 0 = open ocean, 1 = inland; POIs force land around them. */
function landFactor(x: number, z: number, seeds: Record<string, number>, pois: readonly PoiInfo[]): number {
  // Two warp scales: broad peninsulas and bays, plus smaller coves.
  const wx = x + fbm(x / 560, z / 560, seeds.warpX as number, 4) * 260 + fbm(x / 170, z / 170, (seeds.warpX as number) + 5, 2) * 55;
  const wz = z + fbm(x / 560 + 11, z / 560 - 7, seeds.warpZ as number, 4) * 260 + fbm(x / 170 - 3, z / 170 + 9, (seeds.warpZ as number) + 5, 2) * 55;
  const d = Math.hypot(wx, wz) / ISLAND.radius;
  let land = smoothstep(1.02, 0.86, d);
  for (const poi of pois) {
    const r = poi.flatRadius + PAD_BLEND;
    const dist = Math.hypot(x - poi.x, z - poi.z);
    if (dist < r + 160) land = Math.max(land, smoothstep(r + 160, r + 40, dist));
  }
  return land;
}

/** Terrain height before POI pads and lakes. */
function naturalHeight(x: number, z: number, land: number, seeds: Record<string, number>): number {
  const hills = 4 + 12 * (fbm(x / 520, z / 520, seeds.hills as number, 4) * 0.5 + 0.5);
  let inlandHeight = hills;
  const mask = smoothstep(-0.02, 0.32, fbm(x / 1000, z / 1000, seeds.mask as number, 3));
  if (mask > 0.001) {
    const r = ridged(x / 480, z / 480, seeds.ridge as number, 4);
    const mountain = hills + mask * r * r * ISLAND.mountainHeight;
    // Terraces turn the mountain flanks into cliffs with flat steps on top.
    const t = mountain / ISLAND.terraceStep;
    const base = Math.floor(t);
    const terraced = (base + smoothstep(0.55, 0.85, t - base)) * ISLAND.terraceStep;
    inlandHeight = lerp(mountain, terraced, smoothstep(0.2, 0.6, mask));
  }
  const shore = smoothstep(0, 0.35, land);
  const inland = smoothstep(0.3, 0.75, land);
  return lerp(lerp(ISLAND.oceanFloor, ISLAND.beachHeight, shore), inlandHeight, inland);
}

/** Builds the height grid: natural terrain, flattened POI pads, carved lakes. */
function buildHeights(seeds: Record<string, number>, pois: PoiInfo[]): { grid: TerrainGrid; land: Float32Array } {
  const cells = ISLAND.size / ISLAND.cellSize;
  const v = cells + 1;
  const originX = -ISLAND.size / 2;
  const originZ = -ISLAND.size / 2;
  const heights = new Float32Array(v * v);
  const land = new Float32Array(v * v);
  for (let iz = 0; iz < v; iz++) {
    const z = originZ + iz * ISLAND.cellSize;
    for (let ix = 0; ix < v; ix++) {
      const x = originX + ix * ISLAND.cellSize;
      const l = landFactor(x, z, seeds, pois);
      land[iz * v + ix] = l;
      heights[iz * v + ix] = naturalHeight(x, z, l, seeds);
    }
  }
  const grid: TerrainGrid = { cells, cellSize: ISLAND.cellSize, originX, originZ, heights };

  // Pad height: average of the natural terrain around the centre, kept above the beach.
  for (const poi of pois) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const r = i === 0 ? 0 : poi.flatRadius * 0.6;
      sum += heightAt(grid, poi.x + Math.cos(a) * r, poi.z + Math.sin(a) * r);
      count++;
    }
    poi.padHeight = Math.round(Math.min(30, Math.max(4, sum / count)) * 4) / 4;
  }

  for (let iz = 0; iz < v; iz++) {
    const z = originZ + iz * ISLAND.cellSize;
    for (let ix = 0; ix < v; ix++) {
      const x = originX + ix * ISLAND.cellSize;
      let h = heights[iz * v + ix] as number;
      for (const poi of pois) {
        const dist = Math.hypot(x - poi.x, z - poi.z);
        const outer = poi.flatRadius + PAD_BLEND;
        if (dist < outer) h = lerp(poi.padHeight, h, smoothstep(poi.flatRadius, outer, dist));
        if (poi.lakeRadius > 0 && dist < poi.lakeRadius) {
          const lakeBed = lerp(-5, poi.padHeight, smoothstep(poi.lakeRadius * 0.45, poi.lakeRadius, dist));
          h = Math.min(h, lakeBed);
          if (poi.style === "lakeIsland") h = Math.max(h, lerp(3.5, -5, smoothstep(20, 34, dist)));
        }
      }
      heights[iz * v + ix] = h;
    }
  }
  return { grid, land };
}

/** Biome per vertex from height, slope, coast and moisture. */
function buildBiomes(grid: TerrainGrid, land: Float32Array, seeds: Record<string, number>, pois: readonly PoiInfo[]): Uint8Array {
  const v = grid.cells + 1;
  const out = new Uint8Array(v * v);
  const n = { x: 0, y: 1, z: 0 };
  const steep = Math.cos((33 * Math.PI) / 180);
  for (let iz = 0; iz < v; iz++) {
    const z = grid.originZ + iz * grid.cellSize;
    for (let ix = 0; ix < v; ix++) {
      const x = grid.originX + ix * grid.cellSize;
      const i = iz * v + ix;
      const h = grid.heights[i] as number;
      let biome: BiomeId;
      if (h < -0.2) biome = Biome.Seabed;
      else if (h < 1.6 || (h < 2.6 && (land[i] as number) < 0.9)) biome = Biome.Sand;
      else if (normalAt(grid, x, z, n).y < steep) biome = Biome.Rock;
      else if (h > 72) biome = Biome.Snow;
      else if (pois.some((poi) => Math.hypot(x - poi.x, z - poi.z) < poi.flatRadius + 8)) biome = Biome.Town;
      else biome = fbm(x / 650, z / 650, seeds.moisture as number, 3) > 0.12 ? Biome.Forest : Biome.Grass;
      out[i] = biome;
    }
  }
  return out;
}

/** Biome of the vertex nearest to (x, z). */
export function biomeAt(island: Pick<IslandData, "grid" | "biomes">, x: number, z: number): BiomeId {
  const g = island.grid;
  const ix = Math.min(g.cells, Math.max(0, Math.round((x - g.originX) / g.cellSize)));
  const iz = Math.min(g.cells, Math.max(0, Math.round((z - g.originZ) / g.cellSize)));
  return (island.biomes[iz * (g.cells + 1) + ix] ?? Biome.Seabed) as BiomeId;
}

/** Four convex rock shapes: jittered, slightly flattened icosahedra. */
function rockPrototypes(seed: number): RockPrototype[] {
  const t = (1 + Math.sqrt(5)) / 2;
  const base = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const out: RockPrototype[] = [];
  for (let p = 0; p < 4; p++) {
    const rng = new Rng(seed).fork("rock-prototype", p);
    const points = new Float32Array(base.length * 3);
    base.forEach((vertex, i) => {
      const length = Math.hypot(vertex[0] as number, vertex[1] as number, vertex[2] as number);
      const r = rng.range(0.72, 1.12);
      points[i * 3] = ((vertex[0] as number) / length) * r * rng.range(0.9, 1.25);
      points[i * 3 + 1] = ((vertex[1] as number) / length) * r * rng.range(0.55, 0.85);
      points[i * 3 + 2] = ((vertex[2] as number) / length) * r * rng.range(0.9, 1.25);
    });
    out.push({ points });
  }
  return out;
}

interface Footprint {
  x: number;
  z: number;
  radius: number;
}

/** True when a circle overlaps any recorded footprint (plus spacing). */
function overlaps(footprints: readonly Footprint[], x: number, z: number, radius: number, spacing: number): boolean {
  return footprints.some((f) => Math.hypot(f.x - x, f.z - z) < f.radius + radius + spacing);
}

type BuildingType = "house" | "house2" | "shop" | "warehouse" | "tower";

const FOOTPRINT: Readonly<Record<BuildingType, number>> = { house: 7, house2: 7, shop: 10.5, warehouse: 14, tower: 9 };

/** Buildings each POI style gets (besides its landmark). */
const STYLE_BUILDINGS: Readonly<Record<PoiStyle, readonly [BuildingType, number][]>> = {
  towers: [["tower", 7], ["shop", 3]],
  suburb: [["house2", 6], ["house", 4]],
  stores: [["shop", 5], ["house2", 3]],
  village: [["house2", 4], ["house", 3], ["shop", 1]],
  lakeside: [["house2", 4], ["house", 3]],
  lakeIsland: [["house", 3]],
  beach: [["house", 4], ["house2", 2]],
  farm: [["warehouse", 2], ["house2", 3]],
  garden: [["house2", 3], ["shop", 1]],
  docks: [["warehouse", 3]],
  factory: [["warehouse", 2]],
};

/** Landmark footprint radius per style (placed at the POI centre). */
const LANDMARK_RADIUS: Readonly<Record<PoiStyle, number>> = {
  towers: 10,
  suburb: 8,
  stores: 6,
  village: 20,
  lakeside: 0,
  lakeIsland: 0,
  beach: 6,
  farm: 7,
  garden: 17,
  docks: 34,
  factory: 38,
};

function buildLandmark(b: Builder, rng: Rng, style: PoiStyle): void {
  switch (style) {
    case "towers":
      buildClockTower(b, rng);
      break;
    case "suburb":
      buildGazebo(b);
      break;
    case "stores":
      buildWaterTower(b);
      break;
    case "village":
      buildGasStation(b, rng);
      break;
    case "beach":
      buildLifeguardTower(b);
      break;
    case "farm":
      buildWindmill(b);
      break;
    case "garden":
      buildGreenhouse(b);
      break;
    case "docks":
      buildDockCrane(b, rng);
      break;
    case "factory":
      buildStacks(b, rng);
      break;
    case "lakeside":
    case "lakeIsland":
      // Their landmarks sit on the water (built in buildPoi).
      break;
  }
}

/** Places a POI's landmark and buildings on its pad. */
function buildPoi(out: BuildOutput, poi: PoiInfo, seed: number): Footprint[] {
  const rng = new Rng(seed).fork(`poi-${poi.id}`);
  const footprints: Footprint[] = [];
  const base = poi.padHeight;
  const landmarkRadius = LANDMARK_RADIUS[poi.style];
  if (landmarkRadius > 0) {
    buildLandmark(new Builder(out, { x: poi.x, y: base, z: poi.z }, 0, poi.id), rng, poi.style);
    footprints.push({ x: poi.x, z: poi.z, radius: landmarkRadius });
  }
  if (poi.style === "lakeIsland") {
    buildLakeHouse(new Builder(out, { x: poi.x, y: 3.5, z: poi.z }, 0, poi.id), rng);
  }
  // Ring placement keeps buildings out of lakes; others fill the pad.
  const innerRadius = poi.lakeRadius > 0 ? poi.lakeRadius + 12 : landmarkRadius + 8;
  const outerRadius = poi.lakeRadius > 0 && poi.style === "lakeIsland" ? poi.lakeRadius + 60 : poi.flatRadius;
  if (poi.style === "lakeside") {
    const angle = rng.range(0, Math.PI * 2);
    const start = { x: poi.x + Math.cos(angle) * (poi.lakeRadius + 6), z: poi.z + Math.sin(angle) * (poi.lakeRadius + 6) };
    // The pier points from the shore toward the lake centre.
    const yaw = Math.atan2(start.x - poi.x, start.z - poi.z);
    buildPier(new Builder(out, { x: start.x, y: base - 1.2, z: start.z }, yaw, poi.id), 34);
  }
  for (const [type, count] of STYLE_BUILDINGS[poi.style]) {
    for (let n = 0; n < count; n++) {
      const radius = FOOTPRINT[type];
      for (let attempt = 0; attempt < 40; attempt++) {
        const a = rng.range(0, Math.PI * 2);
        const r = rng.range(innerRadius + radius, Math.max(innerRadius + radius + 1, outerRadius - radius - 4));
        const x = poi.x + Math.cos(a) * r;
        const z = poi.z + Math.sin(a) * r;
        if (overlaps(footprints, x, z, radius, 5)) continue;
        // Face the POI centre, snapped to 90 degrees for a street-grid feel.
        const facing = Math.atan2(x - poi.x, z - poi.z);
        const yaw = Math.round(facing / (Math.PI / 2)) * (Math.PI / 2);
        const b = new Builder(out, { x, y: base, z }, yaw, poi.id);
        switch (type) {
          case "house":
            buildHouse(b, rng, { floors: 1, pitched: rng.chance(0.6) });
            break;
          case "house2":
            buildHouse(b, rng, { floors: 2, pitched: rng.chance(0.6) });
            break;
          case "shop":
            buildShop(b, rng);
            break;
          case "warehouse":
            buildWarehouse(b, rng);
            break;
          case "tower":
            buildTower(b, rng, rng.int(3, 7));
            break;
        }
        footprints.push({ x, z, radius });
        break;
      }
    }
  }
  return footprints;
}

/** Mountain-top launch pads: the highest flat spots, well apart and away from POIs. */
function placePeakPads(out: BuildOutput, grid: TerrainGrid, pois: readonly PoiInfo[]): Vec3[] {
  const candidates: Vec3[] = [];
  const n = { x: 0, y: 1, z: 0 };
  for (let z = -1100; z <= 1100; z += 48) {
    for (let x = -1100; x <= 1100; x += 48) {
      const h = heightAt(grid, x, z);
      if (h < 28) continue;
      if (normalAt(grid, x, z, n).y < 0.97) continue;
      if (pois.some((poi) => Math.hypot(x - poi.x, z - poi.z) < poi.flatRadius + 120)) continue;
      candidates.push({ x, y: h, z });
    }
  }
  candidates.sort((a, b) => b.y - a.y || a.x - b.x || a.z - b.z);
  const chosen: Vec3[] = [];
  for (const c of candidates) {
    if (chosen.length >= 6) break;
    if (chosen.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 320)) continue;
    chosen.push(c);
    // Corner heights differ a little on a not-quite-flat spot: sit on the highest one.
    const top = Math.max(heightAt(grid, c.x - 1.5, c.z - 1.5), heightAt(grid, c.x + 1.5, c.z - 1.5), heightAt(grid, c.x - 1.5, c.z + 1.5), heightAt(grid, c.x + 1.5, c.z + 1.5));
    new Builder(out, { x: c.x, y: top, z: c.z }, 0, "peaks").launchPad(0, 0, 0);
  }
  return chosen;
}

/**
 * Jittered-grid scatter of trees, rocks and bushes by biome, away from POI
 * pads, water and steep slopes. Each grid cell decides independently from a
 * lattice hash, so the result does not depend on iteration order.
 */
function scatterProps(
  grid: TerrainGrid,
  island: Pick<IslandData, "grid" | "biomes">,
  pois: readonly PoiInfo[],
  seeds: Record<string, number>,
): { trees: TreeInstance[]; rocks: RockInstance[]; bushes: BushInstance[] } {
  const trees: TreeInstance[] = [];
  const rocks: RockInstance[] = [];
  const bushes: BushInstance[] = [];
  const n = { x: 0, y: 1, z: 0 };
  const half = ISLAND.radius + 200;
  const nearPoi = (x: number, z: number, margin: number): boolean =>
    pois.some((poi) => Math.hypot(x - poi.x, z - poi.z) < poi.flatRadius + margin);

  const treeChance: Record<number, number> = { [Biome.Forest]: 0.45, [Biome.Grass]: 0.07, [Biome.Sand]: 0.05, [Biome.Rock]: 0.04, [Biome.Snow]: 0.02 };
  const step = 11;
  for (let gz = Math.floor(-half / step); gz <= half / step; gz++) {
    for (let gx = Math.floor(-half / step); gx <= half / step; gx++) {
      const s = seeds.trees as number;
      const roll = lattice(gx, gz, s);
      const x = (gx + lattice(gx, gz, s + 1)) * step;
      const z = (gz + lattice(gx, gz, s + 2)) * step;
      const biome = biomeAt(island, x, z);
      if (roll >= (treeChance[biome] ?? 0)) continue;
      const y = heightAt(grid, x, z);
      if (y < 1.0 || nearPoi(x, z, 6) || normalAt(grid, x, z, n).y < 0.87) continue;
      let kind: TreeKind = "round";
      if (biome === Biome.Sand) kind = "palm";
      else if (biome === Biome.Forest) kind = lattice(gx, gz, s + 3) < 0.7 ? "pine" : "round";
      else if (biome === Biome.Rock || biome === Biome.Snow) kind = "pine";
      trees.push({ kind, x, y, z, yaw: lattice(gx, gz, s + 4) * Math.PI * 2, scale: 0.8 + lattice(gx, gz, s + 5) * 0.5 });
    }
  }

  const rockChance: Record<number, number> = { [Biome.Rock]: 0.45, [Biome.Grass]: 0.05, [Biome.Forest]: 0.06, [Biome.Sand]: 0.03, [Biome.Snow]: 0.2 };
  const rockStep = 34;
  for (let gz = Math.floor(-half / rockStep); gz <= half / rockStep; gz++) {
    for (let gx = Math.floor(-half / rockStep); gx <= half / rockStep; gx++) {
      const s = seeds.rocks as number;
      const x = (gx + lattice(gx, gz, s + 1)) * rockStep;
      const z = (gz + lattice(gx, gz, s + 2)) * rockStep;
      const biome = biomeAt(island, x, z);
      if (lattice(gx, gz, s) >= (rockChance[biome] ?? 0)) continue;
      const y = heightAt(grid, x, z);
      if (y < 0.5 || nearPoi(x, z, 4)) continue;
      const big = biome === Biome.Rock || biome === Biome.Snow;
      const scale = (big ? 1.6 : 0.8) + lattice(gx, gz, s + 3) * (big ? 1.8 : 1.0);
      rocks.push({ prototype: Math.floor(lattice(gx, gz, s + 4) * 4), x, y: y - 0.25 * scale, z, yaw: lattice(gx, gz, s + 5) * Math.PI * 2, scale });
    }
  }

  const bushChance: Record<number, number> = { [Biome.Grass]: 0.09, [Biome.Forest]: 0.16, [Biome.Sand]: 0.02 };
  const bushStep = 10;
  for (let gz = Math.floor(-half / bushStep); gz <= half / bushStep; gz++) {
    for (let gx = Math.floor(-half / bushStep); gx <= half / bushStep; gx++) {
      const s = seeds.bushes as number;
      const x = (gx + lattice(gx, gz, s + 1)) * bushStep;
      const z = (gz + lattice(gx, gz, s + 2)) * bushStep;
      if (lattice(gx, gz, s) >= (bushChance[biomeAt(island, x, z)] ?? 0)) continue;
      const y = heightAt(grid, x, z);
      if (y < 1.0 || nearPoi(x, z, 2)) continue;
      bushes.push({ x, y, z, scale: 0.7 + lattice(gx, gz, s + 3) * 0.7 });
    }
  }
  return { trees, rocks, bushes };
}

/** Keeps props out of building footprints (POIs are already excluded; landmarks may stick out). */
function clearFootprints<T extends { x: number; z: number }>(items: T[], footprints: readonly Footprint[]): T[] {
  return items.filter((item) => !footprints.some((f) => Math.hypot(f.x - item.x, f.z - item.z) < f.radius + 3));
}

/** A free spot south of a POI centre to start on, facing north toward it. */
function spawnPoint(poi: PoiInfo, footprints: readonly Footprint[]): Vec3 {
  for (let r = 30; r < poi.flatRadius; r += 4) {
    if (!overlaps(footprints, poi.x, poi.z + r, 1, 3)) return { x: poi.x, y: poi.padHeight + 0.2, z: poi.z + r };
  }
  return { x: poi.x, y: poi.padHeight + 0.2, z: poi.z + poi.flatRadius };
}

const cache = new Map<number, IslandData>();

/** Generates (or returns the cached) island for a seed. */
export function generateIsland(seed: number): IslandData {
  const key = seed >>> 0;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const seeds = layerSeeds(key);
  const pois = poiPlans();
  const { grid, land } = buildHeights(seeds, pois);
  const biomes = buildBiomes(grid, land, seeds, pois);
  const out = emptyBuildOutput();
  const footprints: Footprint[] = [];
  for (const poi of pois) footprints.push(...buildPoi(out, poi, key));
  const peaks = placePeakPads(out, grid, pois);
  const props = scatterProps(grid, { grid, biomes }, pois, seeds);

  const tilted = pois.find((poi) => poi.id === "tilted") ?? (pois[0] as PoiInfo);
  const world: StaticWorld = {
    kind: "island",
    boxes: out.boxes,
    cylinders: out.cylinders,
    terrain: grid,
    trees: clearFootprints(props.trees, footprints),
    rockPrototypes: rockPrototypes(key),
    rocks: clearFootprints(props.rocks, footprints),
    bushes: clearFootprints(props.bushes, footprints),
    doors: out.doors,
    launchPads: out.launchPads,
    waterLevel: ISLAND.seaLevel,
    spawn: spawnPoint(tilted, footprints),
    spawnYaw: 0,
  };
  const island: IslandData = { seed: key, grid, biomes, pois, world, peaks };
  if (cache.size >= 2) cache.clear();
  cache.set(key, island);
  return island;
}
