import { BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, type Scene, SphereGeometry } from "three/webgpu";
import type { PhysicsWorld } from "../shared/physics/PhysicsWorld";
import { probeTraversal } from "../shared/sim/LedgeProbe";
import type { PlayerController } from "../shared/sim/PlayerSim";

/**
 * F4 probe visualisation: runs the ledge probe in the player's facing
 * direction every frame and draws the result. Green = mantle target,
 * orange = hurdle landing, grey line = nothing climbable ahead.
 */
export class ProbeView {
  private readonly line: Line;
  private readonly marker: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly positions = new Float32Array(9);
  private enabled = false;
  private lastResult = "off";

  constructor(private readonly scene: Scene) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(this.positions, 3));
    this.line = new Line(geometry, new LineBasicMaterial({ color: 0xffffff, depthTest: false }));
    this.line.renderOrder = 999;
    this.line.frustumCulled = false;
    this.marker = new Mesh(new SphereGeometry(0.12, 12, 8), new MeshBasicMaterial({ color: 0x4ccb4a, depthTest: false }));
    this.marker.renderOrder = 999;
    this.setEnabled(false);
    scene.add(this.line, this.marker);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** One line for the debug overlay. */
  get summary(): string {
    return this.lastResult;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.line.visible = enabled;
    this.marker.visible = false;
    this.lastResult = enabled ? "nothing ahead" : "off";
  }

  update(player: PlayerController, physics: PhysicsWorld): void {
    if (!this.enabled) return;
    const s = player.state;
    const dirX = -Math.sin(s.bodyYaw);
    const dirZ = -Math.cos(s.bodyYaw);
    const plan = probeTraversal(physics, player.config, s, dirX, dirZ, {
      airborne: !s.grounded,
      speed: player.horizontalSpeed,
      exclude: player.collider,
    });
    const p = this.positions;
    p[0] = s.x;
    p[1] = s.y + 1.0;
    p[2] = s.z;
    if (plan === null) {
      const reach = player.config.capsuleRadius + player.config.mantleReach + player.horizontalSpeed * 0.06;
      p[3] = s.x + dirX * reach;
      p[4] = s.y + 1.0;
      p[5] = s.z + dirZ * reach;
      p[6] = p[3];
      p[7] = p[4];
      p[8] = p[5];
      (this.line.material as LineBasicMaterial).color.setHex(0x9aa3a8);
      this.marker.visible = false;
      this.lastResult = "nothing climbable ahead";
    } else {
      p[3] = s.x + dirX * plan.nearFace;
      p[4] = plan.topY + 0.05;
      p[5] = s.z + dirZ * plan.nearFace;
      p[6] = plan.endX;
      p[7] = plan.endY + 0.05;
      p[8] = plan.endZ;
      const color = plan.kind === "mantle" ? 0x4ccb4a : 0xff7a3d;
      (this.line.material as LineBasicMaterial).color.setHex(color);
      this.marker.material.color.setHex(color);
      this.marker.position.set(plan.endX, plan.endY + 0.05, plan.endZ);
      this.marker.visible = true;
      this.lastResult = `${plan.kind} ${plan.height.toFixed(2)} m${plan.endCrouched ? " (crouched)" : ""}`;
    }
    this.line.geometry.getAttribute("position").needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.line, this.marker);
    this.line.geometry.dispose();
    (this.line.material as LineBasicMaterial).dispose();
    this.marker.geometry.dispose();
    this.marker.material.dispose();
  }
}
