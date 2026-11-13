import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Scene } from "three/webgpu";
import type { DoorSystem } from "../shared/world/Doors";

/** Draws the hinged doors of a DoorSystem (one pivot group per door, panel offset from the hinge). */
export class DoorView {
  private readonly pivots: Group[] = [];
  private readonly geometry: BoxGeometry;
  private readonly material = new MeshStandardMaterial({ color: 0xb8643a, roughness: 0.7, flatShading: true });

  constructor(
    scene: Scene,
    private readonly doors: DoorSystem,
  ) {
    this.geometry = new BoxGeometry(1, 1, 1);
    doors.defs.forEach((def) => {
      const pivot = new Group();
      pivot.position.set(def.hingeX, def.hingeY, def.hingeZ);
      const panel = new Mesh(this.geometry, this.material);
      panel.scale.set(def.width, def.height, def.thickness);
      panel.position.set(def.width / 2, def.height / 2, 0);
      pivot.add(panel);
      scene.add(pivot);
      this.pivots.push(pivot);
    });
  }

  update(): void {
    this.pivots.forEach((pivot, i) => {
      pivot.rotation.y = this.doors.yawOf(i);
    });
  }

  dispose(): void {
    for (const pivot of this.pivots) pivot.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
