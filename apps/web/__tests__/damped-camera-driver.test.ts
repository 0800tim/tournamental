import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  DampedCameraDriver,
} from "@/lib/cameras/damped-driver";

const target = {
  position: new THREE.Vector3(10, 5, 20),
  lookAt: new THREE.Vector3(0, 0, 0),
  fov: 60,
};

function makeCam() {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  cam.position.set(0, 0, 0);
  return cam;
}

describe("DampedCameraDriver", () => {
  it("snaps to target on first update and clears the snap flag", () => {
    const drv = new DampedCameraDriver();
    const cam = makeCam();
    expect(drv.isSnapping()).toBe(true);
    drv.update(cam, target, 1 / 60);
    expect(cam.position.x).toBe(10);
    expect(cam.position.y).toBe(5);
    expect(cam.position.z).toBe(20);
    expect(drv.isSnapping()).toBe(false);
  });

  it("monotonically approaches the target on subsequent updates without overshoot", () => {
    const drv = new DampedCameraDriver();
    const cam = makeCam();
    // First update snaps; reset the camera so we can observe the damp.
    drv.update(cam, target, 1 / 60);
    cam.position.set(0, 0, 0);
    let lastDist = cam.position.distanceTo(target.position);
    for (let i = 0; i < 240; i++) {
      drv.update(cam, target, 1 / 60);
      const dist = cam.position.distanceTo(target.position);
      // Distance should never grow.
      expect(dist).toBeLessThanOrEqual(lastDist + 1e-6);
      // Position should never overshoot the target on any axis along
      // the line from origin to target.
      expect(cam.position.x).toBeGreaterThanOrEqual(0);
      expect(cam.position.x).toBeLessThanOrEqual(target.position.x + 1e-6);
      lastDist = dist;
    }
    // After 4s should be very close to target.
    expect(lastDist).toBeLessThan(0.05);
  });

  it("clamps dt so a stall does not produce a one-frame snap", () => {
    const drv = new DampedCameraDriver();
    const cam = makeCam();
    drv.update(cam, target, 1 / 60); // initial snap
    cam.position.set(0, 0, 0);
    // 5-second dt simulates a tab freeze. With dt clamped, the camera
    // should still be far from the target (not snapped to it).
    drv.update(cam, target, 5);
    const dist = cam.position.distanceTo(target.position);
    // dt clamps to 1/30 → at λ=5, e^(-5/30) ≈ 0.846, so ≈ 15% closure.
    // 23 m initial distance × 0.85 ≈ 19.5 m remaining. Definitely not 0.
    expect(dist).toBeGreaterThan(15);
  });

  it("damps fov on PerspectiveCamera and updates projection matrix", () => {
    const drv = new DampedCameraDriver();
    const cam = makeCam();
    drv.update(cam, target, 1 / 60); // snap → fov 60
    expect(cam.fov).toBe(60);

    // Now request fov 30, observe the damp.
    const t2 = { ...target, fov: 30 };
    let lastFov = cam.fov;
    for (let i = 0; i < 100; i++) {
      drv.update(cam, t2, 1 / 60);
      expect(cam.fov).toBeLessThanOrEqual(lastFov + 0.001);
      expect(cam.fov).toBeGreaterThanOrEqual(30 - 0.001);
      lastFov = cam.fov;
    }
    expect(Math.abs(cam.fov - 30)).toBeLessThan(0.5);
  });

  it("reset() forces the next update to snap", () => {
    const drv = new DampedCameraDriver();
    const cam = makeCam();
    drv.update(cam, target, 1 / 60); // initial snap
    cam.position.set(0, 0, 0);
    // A few damp ticks, won't reach target.
    for (let i = 0; i < 10; i++) drv.update(cam, target, 1 / 60);
    expect(cam.position.distanceTo(target.position)).toBeGreaterThan(1);
    // Now reset and update, should snap.
    drv.reset();
    drv.update(cam, target, 1 / 60);
    expect(cam.position.x).toBe(10);
    expect(cam.position.y).toBe(5);
    expect(cam.position.z).toBe(20);
  });

  it("getCurrentLookAt tracks the damped lookAt", () => {
    const drv = new DampedCameraDriver();
    const cam = makeCam();
    drv.update(cam, target, 1 / 60); // snap
    expect(drv.getCurrentLookAt().toArray()).toEqual([0, 0, 0]);

    const t2 = { ...target, lookAt: new THREE.Vector3(20, 0, 0) };
    for (let i = 0; i < 100; i++) drv.update(cam, t2, 1 / 60);
    const la = drv.getCurrentLookAt();
    expect(la.x).toBeGreaterThan(15);
    expect(la.x).toBeLessThanOrEqual(20);
  });
});
