import { describe, expect, it } from "vitest";
import { createFighterRenderState, updateFighterRenderState } from "./fighterAnimation";
import type { FighterRuntime } from "../../game/simulation/battle";

const groundY = 430;

describe("fighter render animation", () => {
  it("plays a slow knocked-out fall with decaying bounces", () => {
    const runtime = createRuntime({ health: 0, pose: "hit", facing: 1 });
    const renderState = createFighterRenderState(createRuntime(), 0);

    const start = updateFighterRenderState(renderState, runtime, 0, groundY);
    expect(renderState.currentPose).toBe("hit");
    expect(start.current.rotation).toBeCloseTo(0);

    const impact = updateFighterRenderState(renderState, runtime, 0.92, groundY);
    expect(impact.current.x).toBeLessThan(runtime.x);
    expect(impact.current.y).toBeLessThan(runtime.y - 50);
    expect(impact.current.rotation).toBeLessThan(-1.3);

    const bouncePeak = updateFighterRenderState(renderState, runtime, 0.195, groundY);
    expect(bouncePeak.current.y).toBeLessThan(impact.current.y);

    const settled = updateFighterRenderState(renderState, runtime, 1, groundY);
    expect(settled.current.rotation).toBeLessThan(-1.4);
  });

  it("falls away from the opponent based on fighter facing", () => {
    const runtime = createRuntime({ health: 0, pose: "hit", facing: -1 });
    const renderState = createFighterRenderState(createRuntime({ facing: -1 }), 0);

    const settled = updateFighterRenderState(renderState, runtime, 1.7, groundY);

    expect(settled.current.x).toBeGreaterThan(runtime.x);
    expect(settled.current.rotation).toBeGreaterThan(1.4);
  });
});

function createRuntime(overrides: Partial<FighterRuntime> = {}): FighterRuntime {
  return {
    slot: "p1",
    id: "p1",
    name: "One",
    x: 320,
    z: 210,
    y: groundY,
    velocityY: 0,
    facing: 1,
    health: 100,
    superMeter: 0,
    roundsWon: 0,
    pose: "idle",
    blocking: false,
    attackElapsed: 0,
    cooldown: 0,
    hasHitThisAttack: false,
    superHitsDelivered: 0,
    hitStun: 0,
    ...overrides,
  };
}
