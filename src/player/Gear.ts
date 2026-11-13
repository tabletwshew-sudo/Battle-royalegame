import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Procedural gear meshes (original designs): a delta-wing glider and a
 * harvesting pickaxe. Each is one merged mesh with vertex colours, so each
 * costs one draw call.
 */

const GEAR_COLORS = {
  canopyA: 0xff7a3d,
  canopyB: 0xf2e3c6,
  frame: 0x23434b,
  handle: 0x6b4a33,
  grip: 0x0f2a33,
  head: 0xc9d2d6,
  headAccent: 0xff7a3d,
} as const;

/** Paints a geometry with a single vertex colour (converted to non-indexed). */
function painted(geometry: BufferGeometry, hex: number): BufferGeometry {
  const g = geometry.index === null ? geometry : geometry.toNonIndexed();
  if (g !== geometry) geometry.dispose();
  const color = new Color(hex);
  const count = g.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return g;
}

/** A flat triangle (both faces) with uv/normal attributes so it merges with the primitives. */
function triangle(a: [number, number, number], b: [number, number, number], c: [number, number, number]): BufferGeometry {
  const geometry = new BoxGeometry(1, 1, 1).toNonIndexed();
  // Replace the box with two triangles (front and back faces).
  const positions = new Float32Array([...a, ...b, ...c, ...a, ...c, ...b]);
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(new Float32Array(12), 2));
  geometry.deleteAttribute("normal");
  geometry.computeVertexNormals();
  return geometry;
}

function gearMaterial(): MeshStandardNodeMaterial {
  return new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1, flatShading: true });
}

/**
 * Glider: a swept delta canopy in two-tone panels on a keel and crossbar,
 * with a control bar the character holds. Origin = the hand bar; the wing
 * sits above it; forward is -Z.
 */
export function buildGlider(): Mesh {
  const parts: BufferGeometry[] = [];
  const nose: [number, number, number] = [0, 1.25, -1.0];
  const tailY = 1.05;
  // Six canopy panels between the keel and the wing tips, alternating colours.
  const leftTip: [number, number, number] = [-1.7, 1.0, 0.55];
  const rightTip: [number, number, number] = [1.7, 1.0, 0.55];
  const keelTail: [number, number, number] = [0, tailY, 0.7];
  const leftMid: [number, number, number] = [-0.85, 1.2, -0.15];
  const rightMid: [number, number, number] = [0.85, 1.2, -0.15];
  parts.push(painted(triangle(nose, leftMid, keelTail), GEAR_COLORS.canopyA));
  parts.push(painted(triangle(leftMid, leftTip, keelTail), GEAR_COLORS.canopyB));
  parts.push(painted(triangle(nose, leftTip, leftMid), GEAR_COLORS.canopyB));
  parts.push(painted(triangle(nose, keelTail, rightMid), GEAR_COLORS.canopyA));
  parts.push(painted(triangle(rightMid, keelTail, rightTip), GEAR_COLORS.canopyB));
  parts.push(painted(triangle(nose, rightMid, rightTip), GEAR_COLORS.canopyB));
  // Keel and crossbar.
  const keel = new BoxGeometry(0.05, 0.05, 1.75);
  keel.translate(0, 1.18, -0.15);
  parts.push(painted(keel, GEAR_COLORS.frame));
  const cross = new BoxGeometry(2.6, 0.04, 0.04);
  cross.translate(0, 1.12, 0.2);
  parts.push(painted(cross, GEAR_COLORS.frame));
  // Struts down to the hand bar.
  for (const side of [-1, 1]) {
    const strut = new CylinderGeometry(0.018, 0.018, 1.15, 5);
    strut.rotateZ(side * 0.32);
    strut.translate(side * 0.2, 0.57, 0);
    parts.push(painted(strut, GEAR_COLORS.frame));
  }
  const bar = new CylinderGeometry(0.022, 0.022, 0.75, 6);
  bar.rotateZ(Math.PI / 2);
  parts.push(painted(bar, GEAR_COLORS.frame));

  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, gearMaterial());
  mesh.name = "glider";
  return mesh;
}

/** Pickaxe: wrapped handle with a two-sided head. Origin = the grip; the handle runs along +Y. */
export function buildPickaxe(): Mesh {
  const parts: BufferGeometry[] = [];
  const handle = new CylinderGeometry(0.025, 0.03, 0.85, 6);
  handle.translate(0, 0.32, 0);
  parts.push(painted(handle, GEAR_COLORS.handle));
  const grip = new CylinderGeometry(0.034, 0.034, 0.2, 6);
  grip.translate(0, 0.0, 0);
  parts.push(painted(grip, GEAR_COLORS.grip));
  const collar = new BoxGeometry(0.09, 0.1, 0.09);
  collar.translate(0, 0.72, 0);
  parts.push(painted(collar, GEAR_COLORS.headAccent));
  // Head: a long spike forward and a shorter adze back, slightly drooping.
  const spike = new BoxGeometry(0.06, 0.07, 0.42);
  spike.rotateX(0.18);
  spike.translate(0, 0.71, -0.22);
  parts.push(painted(spike, GEAR_COLORS.head));
  const adze = new BoxGeometry(0.11, 0.05, 0.22);
  adze.rotateX(-0.15);
  adze.translate(0, 0.72, 0.13);
  parts.push(painted(adze, GEAR_COLORS.head));

  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, gearMaterial());
  mesh.name = "pickaxe";
  return mesh;
}

/** Pivot group helper: lets a mesh be posed relative to an attachment point. */
export function attachmentPivot(child: Mesh): Group {
  const group = new Group();
  group.add(child);
  return group;
}
