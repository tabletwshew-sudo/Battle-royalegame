/**
 * Determinism harness CLI.
 *   npm run sim:determinism -- --seed 7 --ticks 1200 --runs 3
 * Exits with code 1 if any run diverges.
 */
import { initPhysics, physicsVersion } from "../src/shared/physics/PhysicsWorld";
import { checkDeterminism } from "../src/shared/sim/Determinism";
import { hashToHex } from "../src/shared/sim/Hash";
import { SANDBOX_DEFAULTS, SandboxSim } from "../src/shared/sim/SandboxSim";

/** Reads "--name value" from argv, falling back to a default. */
function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const value = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const firstSeed = arg("seed", 1);
const ticks = arg("ticks", 900);
const runs = arg("runs", 3);

await initPhysics();
console.log(`Rapier ${physicsVersion()} | ${runs} seed(s) x ${ticks} ticks`);

let failed = false;
for (let i = 0; i < runs; i++) {
  const seed = firstSeed + i;
  const create = (): SandboxSim =>
    new SandboxSim({ seed, crateCount: SANDBOX_DEFAULTS.crateCount, obstacleCount: SANDBOX_DEFAULTS.obstacleCount });
  const started = performance.now();
  const report = checkDeterminism(create, seed, ticks);
  const ms = performance.now() - started;
  const ok = report.rerunDivergence === -1 && report.restoreDivergence === -1;
  failed ||= !ok;
  console.log(
    `seed ${seed}: ${ok ? "OK  " : "FAIL"} final=${hashToHex(report.finalHash)} ` +
      `rerun=${report.rerunDivergence} restore=${report.restoreDivergence} (${ms.toFixed(0)} ms)`,
  );
}
process.exit(failed ? 1 : 0);
