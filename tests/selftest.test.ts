import { beforeAll, describe, expect, it } from "vitest";
import { initPhysics } from "../src/shared/physics/PhysicsWorld";
import { runSelfTest, selfTestNames } from "../src/shared/sim/SelfTest";

/** The F9 movement self-test suite, run as unit tests (same code as the in-game panel). */
beforeAll(async () => {
  await initPhysics();
});

describe("Movement self-test (F9)", () => {
  selfTestNames().forEach((name, index) => {
    it(name, () => {
      const result = runSelfTest(index);
      expect(result.passed, result.detail).toBe(true);
    });
  });
});
