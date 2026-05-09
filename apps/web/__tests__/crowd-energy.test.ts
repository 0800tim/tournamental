/**
 * Unit tests for the crowd-energy reactor.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CrowdEnergyReactor,
  crowdEnergyBus,
  useCrowdEnergy,
} from "@/lib/crowd-energy";

describe("CrowdEnergyReactor", () => {
  it("starts at zero", () => {
    const r = new CrowdEnergyReactor();
    expect(r.value()).toBe(0);
  });

  it("ramps up on goal pulse", () => {
    const r = new CrowdEnergyReactor();
    r.pulse("goal");
    // Tick the right amount to ramp without overshoot.
    // rampRate is 4/sec, so 0.25s should reach 1.0.
    r.tick(0.25);
    expect(r.value()).toBeCloseTo(1.0, 5);
  });

  it("decays after reaching peak", () => {
    const r = new CrowdEnergyReactor();
    r.pulse("goal");
    r.tick(0.5); // ramp
    const peak = r.value();
    r.tick(1.0); // decay
    expect(r.value()).toBeLessThan(peak);
  });

  it("eventually returns to zero", () => {
    const r = new CrowdEnergyReactor();
    r.pulse("goal");
    for (let i = 0; i < 50; i++) r.tick(0.2);
    expect(r.value()).toBeCloseTo(0, 5);
  });

  it("tackle pulse only reaches 0.35", () => {
    const r = new CrowdEnergyReactor();
    r.pulse("tackle");
    for (let i = 0; i < 5; i++) r.tick(0.1);
    expect(r.value()).toBeLessThanOrEqual(0.36);
  });

  it("a goal pulse during tackle decay raises target", () => {
    const r = new CrowdEnergyReactor();
    r.pulse("tackle");
    r.tick(0.5);
    expect(r.value()).toBeLessThanOrEqual(0.36);
    r.pulse("goal");
    r.tick(0.5);
    expect(r.value()).toBeGreaterThan(0.5);
  });

  it("ignores zero-or-negative deltas", () => {
    const r = new CrowdEnergyReactor();
    r.pulse("goal");
    r.tick(0.5); // ramp up
    const v = r.value();
    r.tick(0);
    r.tick(-1);
    expect(r.value()).toBe(v);
  });

  it("reset zeros the state", () => {
    const r = new CrowdEnergyReactor();
    r.pulse("goal");
    r.tick(0.5);
    r.reset();
    expect(r.value()).toBe(0);
  });
});

describe("crowdEnergyBus singleton", () => {
  beforeEach(() => crowdEnergyBus.reset());
  afterEach(() => crowdEnergyBus.reset());

  it("pulses the shared reactor", () => {
    const reactor = useCrowdEnergy();
    crowdEnergyBus.pulse("goal");
    reactor.tick(0.5);
    expect(crowdEnergyBus.value()).toBeGreaterThan(0.5);
  });

  it("reset clears the singleton", () => {
    crowdEnergyBus.pulse("goal");
    useCrowdEnergy().tick(0.5);
    crowdEnergyBus.reset();
    expect(crowdEnergyBus.value()).toBe(0);
  });
});
