import {
  Bone,
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  MeshStandardNodeMaterial,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Uint16BufferAttribute,
  Vector3,
} from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Procedural low-poly humanoid (original design: a generic suited figure with
 * a rounded helmet, visor strip, chest rig and backpack). All parts are merged
 * into ONE skinned mesh and each part is rigidly bound to one bone, so a
 * character costs a single draw call.
 *
 * Space: metres, feet at the origin, facing -Z, character's right is +X.
 */

export const BONE_NAMES = [
  "root",
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "upperArmL",
  "lowerArmL",
  "handL",
  "upperArmR",
  "lowerArmR",
  "handR",
  "upperLegL",
  "lowerLegL",
  "footL",
  "upperLegR",
  "lowerLegR",
  "footR",
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

/** Bind-pose bone offsets relative to the parent bone. */
const BONE_LAYOUT: Record<BoneName, { parent: BoneName | null; offset: [number, number, number] }> = {
  root: { parent: null, offset: [0, 0, 0] },
  hips: { parent: "root", offset: [0, 0.95, 0] },
  spine: { parent: "hips", offset: [0, 0.12, 0] },
  chest: { parent: "spine", offset: [0, 0.22, 0] },
  neck: { parent: "chest", offset: [0, 0.27, 0] },
  head: { parent: "neck", offset: [0, 0.08, 0] },
  upperArmL: { parent: "chest", offset: [-0.25, 0.22, 0] },
  lowerArmL: { parent: "upperArmL", offset: [0, -0.29, 0] },
  handL: { parent: "lowerArmL", offset: [0, -0.26, 0] },
  upperArmR: { parent: "chest", offset: [0.25, 0.22, 0] },
  lowerArmR: { parent: "upperArmR", offset: [0, -0.29, 0] },
  handR: { parent: "lowerArmR", offset: [0, -0.26, 0] },
  upperLegL: { parent: "hips", offset: [-0.11, -0.04, 0] },
  lowerLegL: { parent: "upperLegL", offset: [0, -0.43, 0] },
  footL: { parent: "lowerLegL", offset: [0, -0.42, 0] },
  upperLegR: { parent: "hips", offset: [0.11, -0.04, 0] },
  lowerLegR: { parent: "upperLegR", offset: [0, -0.43, 0] },
  footR: { parent: "lowerLegR", offset: [0, -0.42, 0] },
};

export interface CharacterPalette {
  suit: number;
  suitDark: number;
  accent: number;
  skin: number;
  visor: number;
  gear: number;
}

/** Default look; `accent` is the per-player/team colour. */
export function defaultPalette(accent = 0xff7a3d): CharacterPalette {
  return { suit: 0x3c6e78, suitDark: 0x23434b, accent, skin: 0xe9cfa6, visor: 0x0f2a33, gear: 0x2b2f36 };
}

export interface CharacterRig {
  mesh: SkinnedMesh;
  /** 0 = invisible .. 1 = opaque (used when the camera is squeezed into the character). */
  setOpacity(opacity: number): void;
  bones: Record<BoneName, Bone>;
  /** Bind-pose local positions, so animation can offset from them. */
  rest: Record<BoneName, Vector3>;
  dispose(): void;
}

type PaletteKey = keyof CharacterPalette;

interface Part {
  geometry: BufferGeometry;
  bone: BoneName;
  color: PaletteKey;
  /** Position of the part centre relative to its bone, in bind pose. */
  at: [number, number, number];
}

/** World-space bind position of every bone. */
function bindPositions(): Record<BoneName, Vector3> {
  const out = {} as Record<BoneName, Vector3>;
  for (const name of BONE_NAMES) {
    const { parent, offset } = BONE_LAYOUT[name];
    const base = parent === null ? new Vector3() : out[parent].clone();
    out[name] = base.add(new Vector3(...offset));
  }
  return out;
}

/** Capsule hanging down from its bone (limbs). */
function limb(radius: number, length: number): BufferGeometry {
  return new CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 2, 7);
}

function partList(): Part[] {
  const helmet = new SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  return [
    // Torso.
    { geometry: new BoxGeometry(0.34, 0.17, 0.22), bone: "hips", color: "suitDark", at: [0, 0.02, 0] },
    { geometry: new BoxGeometry(0.3, 0.2, 0.2), bone: "spine", color: "suit", at: [0, 0.1, 0] },
    { geometry: new BoxGeometry(0.42, 0.3, 0.25), bone: "chest", color: "suit", at: [0, 0.13, 0] },
    // Chest rig (accent) and backpack.
    { geometry: new BoxGeometry(0.36, 0.2, 0.06), bone: "chest", color: "accent", at: [0, 0.12, -0.14] },
    { geometry: new BoxGeometry(0.3, 0.32, 0.14), bone: "chest", color: "gear", at: [0, 0.12, 0.19] },
    { geometry: new BoxGeometry(0.46, 0.06, 0.27), bone: "chest", color: "accent", at: [0, 0.27, 0] },
    // Neck, head, helmet, visor.
    { geometry: new CylinderGeometry(0.06, 0.07, 0.1, 7), bone: "neck", color: "skin", at: [0, 0.03, 0] },
    { geometry: new IcosahedronGeometry(0.125, 1), bone: "head", color: "skin", at: [0, 0.1, 0] },
    { geometry: helmet, bone: "head", color: "suitDark", at: [0, 0.12, 0.01] },
    { geometry: new BoxGeometry(0.2, 0.055, 0.06), bone: "head", color: "visor", at: [0, 0.12, -0.105] },
    // Arms.
    { geometry: limb(0.06, 0.29), bone: "upperArmL", color: "suit", at: [0, -0.145, 0] },
    { geometry: limb(0.052, 0.26), bone: "lowerArmL", color: "suitDark", at: [0, -0.13, 0] },
    { geometry: new BoxGeometry(0.08, 0.1, 0.09), bone: "handL", color: "gear", at: [0, -0.05, 0] },
    { geometry: limb(0.06, 0.29), bone: "upperArmR", color: "suit", at: [0, -0.145, 0] },
    { geometry: limb(0.052, 0.26), bone: "lowerArmR", color: "suitDark", at: [0, -0.13, 0] },
    { geometry: new BoxGeometry(0.08, 0.1, 0.09), bone: "handR", color: "gear", at: [0, -0.05, 0] },
    // Shoulder pads (accent).
    { geometry: new BoxGeometry(0.13, 0.07, 0.15), bone: "upperArmL", color: "accent", at: [-0.01, 0.0, 0] },
    { geometry: new BoxGeometry(0.13, 0.07, 0.15), bone: "upperArmR", color: "accent", at: [0.01, 0.0, 0] },
    // Legs and boots.
    { geometry: limb(0.08, 0.43), bone: "upperLegL", color: "suit", at: [0, -0.215, 0] },
    { geometry: limb(0.068, 0.42), bone: "lowerLegL", color: "suitDark", at: [0, -0.21, 0] },
    { geometry: new BoxGeometry(0.12, 0.1, 0.24), bone: "footL", color: "gear", at: [0, 0.0, -0.04] },
    { geometry: limb(0.08, 0.43), bone: "upperLegR", color: "suit", at: [0, -0.215, 0] },
    { geometry: limb(0.068, 0.42), bone: "lowerLegR", color: "suitDark", at: [0, -0.21, 0] },
    { geometry: new BoxGeometry(0.12, 0.1, 0.24), bone: "footR", color: "gear", at: [0, 0.0, -0.04] },
  ];
}

/** Moves a part into bind space and tags every vertex with its colour and bone. */
function preparePart(part: Part, boneIndex: number, bindPos: Vector3, palette: CharacterPalette): BufferGeometry {
  const geometry = part.geometry.index === null ? part.geometry : part.geometry.toNonIndexed();
  geometry.translate(bindPos.x + part.at[0], bindPos.y + part.at[1], bindPos.z + part.at[2]);
  const count = geometry.getAttribute("position").count;
  const color = new Color(palette[part.color]);
  const colors = new Float32Array(count * 3);
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    skinIndex[i * 4] = boneIndex;
    skinWeight[i * 4] = 1;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(skinWeight, 4));
  if (geometry !== part.geometry) part.geometry.dispose();
  return geometry;
}

export function buildCharacterRig(palette: CharacterPalette = defaultPalette()): CharacterRig {
  const bind = bindPositions();
  const bones = {} as Record<BoneName, Bone>;
  const rest = {} as Record<BoneName, Vector3>;
  for (const name of BONE_NAMES) {
    const bone = new Bone();
    bone.name = name;
    const { parent, offset } = BONE_LAYOUT[name];
    bone.position.set(...offset);
    rest[name] = bone.position.clone();
    if (parent !== null) bones[parent].add(bone);
    bones[name] = bone;
  }

  const geometries = partList().map((part) =>
    preparePart(part, BONE_NAMES.indexOf(part.bone), bind[part.bone], palette),
  );
  const geometry = mergeGeometries(geometries, false);
  for (const g of geometries) g.dispose();
  geometry.computeBoundingSphere();

  const material = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05, flatShading: true });
  const mesh = new SkinnedMesh(geometry, material);
  mesh.add(bones.root);
  mesh.bind(new Skeleton(BONE_NAMES.map((name) => bones[name])));
  // Animation moves the limbs outside the bind-pose bounds; skip culling (one mesh per player).
  mesh.frustumCulled = false;

  const setOpacity = (opacity: number): void => {
    const o = Math.min(1, Math.max(0, opacity));
    mesh.visible = o > 0.02;
    const transparent = o < 0.999;
    if (material.transparent !== transparent) {
      material.transparent = transparent;
      material.depthWrite = !transparent;
      material.needsUpdate = true;
    }
    material.opacity = o;
  };

  return {
    mesh,
    bones,
    rest,
    setOpacity,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
