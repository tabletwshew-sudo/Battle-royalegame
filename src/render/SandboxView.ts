import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
} from "three/webgpu";
import { abs, cameraPosition, color, float, fract, fwidth, length, min, mix, positionWorld, smoothstep } from "three/tsl";
import { lerp } from "../shared/sim/MathUtil";
import { Rng } from "../shared/sim/Rng";
import { SANDBOX_DEFAULTS, type SandboxSim, TRANSFORM_STRIDE } from "../shared/sim/SandboxSim";
import type { BlockKind } from "../shared/world/Playground";
import { PLAYGROUND } from "../shared/world/Playground";

/** Brand palette used for the sandbox props. */
const PALETTE = {
  teal: 0x0f2a33,
  ground: 0x17414e,
  sand: 0xf2e3c6,
  orange: 0xff7a3d,
  violet: 0x8a4bff,
  sky: 0x9fd4e6,
} as const;

const BLOCK_COLORS: Record<BlockKind, number> = {
  course: 0x6d5bd0,
  ramp: 0xe0874f,
  step: 0xd9c49b,
  wall: 0x2f5560,
  scenery: 0x1d3a43,
};

const CRATE_COLORS = [PALETTE.sand, PALETTE.orange, PALETTE.violet, 0x4cc9b0] as const;
const KICK_MARKER_SECONDS = 0.45;
const KICK_MARKER_POOL = 6;

interface KickMarker {
  mesh: Mesh<SphereGeometry, MeshBasicMaterial>;
  age: number;
}

/**
 * Draws the SandboxSim's world: grid ground, playground blocks, instanced
 * crates and short-lived kick markers. Characters are drawn by PlayerView.
 * All state is read from the sim; nothing here feeds back into it.
 */
export class SandboxView {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  private readonly crates: InstancedMesh;
  private readonly markers: KickMarker[] = [];
  private nextMarker = 0;
  // Scratch objects reused every frame to avoid garbage.
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly rotationB = new Quaternion();
  private readonly unitScale = new Vector3(1, 1, 1);

  constructor(private readonly sim: SandboxSim) {
    this.scene.background = new Color(PALETTE.sky);
    this.scene.fog = new Fog(PALETTE.sky, 90, 260);

    this.camera = new PerspectiveCamera(80, 1, 0.05, 600);

    this.scene.add(new HemisphereLight(0xd7f0ff, 0x1c3038, 1.4));
    const sun = new DirectionalLight(0xfff1d6, 2.6);
    sun.position.set(30, 50, 20);
    this.scene.add(sun);

    this.scene.add(this.buildGround());
    this.scene.add(this.buildBlocks());
    this.crates = this.buildCrates();
    this.scene.add(this.crates);
    this.buildMarkers();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Starts an expanding marker where a kick landed. */
  showKick(x: number, y: number, z: number): void {
    const marker = this.markers[this.nextMarker] as KickMarker;
    this.nextMarker = (this.nextMarker + 1) % this.markers.length;
    marker.age = 0;
    marker.mesh.position.set(x, y, z);
    marker.mesh.visible = true;
  }

  /**
   * Updates instances for one rendered frame.
   * @param alpha blend factor between the previous and the current sim tick
   */
  update(alpha: number, frameSeconds: number): void {
    this.updateCrates(alpha);
    this.updateMarkers(frameSeconds);
  }

  dispose(): void {
    this.scene.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        const material = object.material as MeshBasicMaterial | MeshBasicMaterial[];
        for (const m of Array.isArray(material) ? material : [material]) m.dispose();
      }
    });
  }

  /** Ground plane with a procedural anti-aliased 1 m / 10 m grid (TSL). */
  private buildGround(): Mesh {
    const size = PLAYGROUND.groundHalf * 2;
    const material = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
    const xz = positionWorld.xz;
    // Returns 1 on a grid line of the given cell size and 0 elsewhere, one pixel wide.
    const gridLine = (cell: number) => {
      const coord = xz.div(cell);
      const distance = abs(fract(coord.sub(0.5)).sub(0.5)).div(fwidth(coord));
      return float(1).sub(min(min(distance.x, distance.y), 1));
    };
    // Fine lines fade with distance so the far field does not shimmer.
    const fineFade = float(1).sub(smoothstep(25, 70, length(xz.sub(cameraPosition.xz))));
    const withFine = mix(color(PALETTE.ground), color(PALETTE.sand), gridLine(1).mul(0.22).mul(fineFade));
    material.colorNode = mix(withFine, color(PALETTE.orange), gridLine(10).mul(0.55));

    const ground = new Mesh(new PlaneGeometry(size, size), material);
    ground.rotation.x = -Math.PI / 2;
    return ground;
  }

  /** Every playground block except the ground slab, in one instanced draw. */
  private buildBlocks(): InstancedMesh {
    const blocks = this.sim.blocks.filter((block) => block.name !== "ground");
    const mesh = new InstancedMesh(
      new BoxGeometry(2, 2, 2),
      new MeshStandardMaterial({ roughness: 0.85, flatShading: true }),
      blocks.length,
    );
    const scale = new Vector3();
    const tint = new Color();
    blocks.forEach((block, i) => {
      this.position.set(block.center.x, block.center.y, block.center.z);
      this.rotation.set(block.rotation.x, block.rotation.y, block.rotation.z, block.rotation.w);
      scale.set(block.half.x, block.half.y, block.half.z);
      mesh.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, scale));
      mesh.setColorAt(i, tint.setHex(BLOCK_COLORS[block.kind]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  private buildCrates(): InstancedMesh {
    const edge = SANDBOX_DEFAULTS.crateHalf * 2;
    const count = Math.max(1, this.sim.crateCount);
    const mesh = new InstancedMesh(new BoxGeometry(edge, edge, edge), new MeshStandardMaterial({ roughness: 0.65 }), count);
    mesh.count = this.sim.crateCount;
    // Colours are cosmetic, but seeded so the same seed always looks the same.
    const rng = new Rng(this.sim.seed).fork("crate-colors");
    const tint = new Color();
    for (let i = 0; i < count; i++) mesh.setColorAt(i, tint.setHex(rng.pick(CRATE_COLORS)));
    // Crates travel far from the mesh origin, so the default bounds would cull them wrongly.
    mesh.frustumCulled = false;
    return mesh;
  }

  private buildMarkers(): void {
    const geometry = new SphereGeometry(1, 20, 12);
    for (let i = 0; i < KICK_MARKER_POOL; i++) {
      const material = new MeshBasicMaterial({ color: PALETTE.orange, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new Mesh(geometry, material);
      mesh.visible = false;
      this.scene.add(mesh);
      this.markers.push({ mesh, age: 0 });
    }
  }

  private updateCrates(alpha: number): void {
    const prev = this.sim.previousTransforms;
    const curr = this.sim.transforms;
    const count = this.sim.crateCount;
    for (let i = 0; i < count; i++) {
      const o = i * TRANSFORM_STRIDE;
      this.position.set(
        lerp(prev[o] as number, curr[o] as number, alpha),
        lerp(prev[o + 1] as number, curr[o + 1] as number, alpha),
        lerp(prev[o + 2] as number, curr[o + 2] as number, alpha),
      );
      this.rotation.set(prev[o + 3] as number, prev[o + 4] as number, prev[o + 5] as number, prev[o + 6] as number);
      this.rotationB.set(curr[o + 3] as number, curr[o + 4] as number, curr[o + 5] as number, curr[o + 6] as number);
      this.rotation.slerp(this.rotationB, alpha);
      this.crates.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.unitScale));
    }
    this.crates.instanceMatrix.needsUpdate = true;
  }

  private updateMarkers(frameSeconds: number): void {
    for (const marker of this.markers) {
      if (!marker.mesh.visible) continue;
      marker.age += frameSeconds;
      const t = marker.age / KICK_MARKER_SECONDS;
      if (t >= 1) {
        marker.mesh.visible = false;
        continue;
      }
      marker.mesh.scale.setScalar(0.3 + t * SANDBOX_DEFAULTS.kickRadius);
      marker.mesh.material.opacity = 0.45 * (1 - t);
    }
  }
}
