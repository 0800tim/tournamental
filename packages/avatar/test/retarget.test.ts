/**
 * Bone retargeting helpers.
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  CANONICAL_BONES,
  buildRetargetMap,
  detectBoneStyle,
  retargetClip,
  toCanonicalBoneName,
} from "../src/retarget.js";

describe("detectBoneStyle", () => {
  it("recognises the mixamo prefix style", () => {
    expect(detectBoneStyle(["mixamorig:Hips", "mixamorig:Spine"])).toBe("mixamo_prefix");
  });

  it("recognises the mixamo compact style", () => {
    expect(detectBoneStyle(["mixamorigHips", "mixamorigSpine"])).toBe("mixamo_compact");
  });

  it("recognises the RPM (no prefix) style", () => {
    expect(detectBoneStyle(["Hips", "Spine"])).toBe("rpm");
  });

  it("falls back to raw for unknown rigs", () => {
    expect(detectBoneStyle(["Bone001", "Bone002"])).toBe("raw");
  });
});

describe("toCanonicalBoneName", () => {
  it("strips the mixamorig: prefix", () => {
    expect(toCanonicalBoneName("mixamorig:Hips")).toBe("mixamorigHips");
    expect(toCanonicalBoneName("mixamorig:LeftFoot")).toBe("mixamorigLeftFoot");
  });

  it("passes through a canonical compact name", () => {
    expect(toCanonicalBoneName("mixamorigSpine2")).toBe("mixamorigSpine2");
  });

  it("maps RPM-style names by adding the mixamorig prefix", () => {
    expect(toCanonicalBoneName("Hips")).toBe("mixamorigHips");
    expect(toCanonicalBoneName("RightHand")).toBe("mixamorigRightHand");
  });

  it("returns null for unknown bone names", () => {
    expect(toCanonicalBoneName("ThumbTip")).toBeNull();
    expect(toCanonicalBoneName("")).toBeNull();
  });
});

describe("buildRetargetMap", () => {
  it("builds a map for a fully Mixamo-prefixed skeleton", () => {
    const names = ["mixamorig:Hips", "mixamorig:Spine", "mixamorig:Spine1"];
    const map = buildRetargetMap(names);
    expect(map.size).toBe(3);
    expect(map.get("mixamorig:Hips")).toBe("mixamorigHips");
  });

  it("ignores unknown bones cleanly", () => {
    const map = buildRetargetMap(["mixamorigHips", "ThumbTip", "mixamorigSpine"]);
    expect(map.size).toBe(2);
    expect(map.has("ThumbTip")).toBe(false);
  });

  it("CANONICAL_BONES has 20 entries (full humanoid, no fingers)", () => {
    expect(CANONICAL_BONES.length).toBe(20);
  });
});

describe("retargetClip", () => {
  it("renames .quaternion tracks to canonical compact bones", () => {
    const track = new THREE.QuaternionKeyframeTrack(
      "mixamorig:Hips.quaternion",
      [0, 1],
      [0, 0, 0, 1, 0, 0, 0, 1],
    );
    const clip = new THREE.AnimationClip("test", 1, [track]);
    const retargeted = retargetClip(clip);
    expect(retargeted.tracks[0].name).toBe("mixamorigHips.quaternion");
  });

  it("drops tracks whose bones don't map (default behaviour)", () => {
    const known = new THREE.QuaternionKeyframeTrack(
      "mixamorigSpine.quaternion",
      [0, 1],
      [0, 0, 0, 1, 0, 0, 0, 1],
    );
    const unknown = new THREE.NumberKeyframeTrack("ThumbTip.scale", [0, 1], [1, 1]);
    const clip = new THREE.AnimationClip("test", 1, [known, unknown]);
    const retargeted = retargetClip(clip);
    expect(retargeted.tracks.length).toBe(1);
    expect(retargeted.tracks[0].name).toBe("mixamorigSpine.quaternion");
  });

  it("keeps unknown tracks when keepUnknown=true", () => {
    const known = new THREE.QuaternionKeyframeTrack(
      "Hips.quaternion",
      [0, 1],
      [0, 0, 0, 1, 0, 0, 0, 1],
    );
    const unknown = new THREE.NumberKeyframeTrack("ThumbTip.scale", [0, 1], [1, 1]);
    const clip = new THREE.AnimationClip("test", 1, [known, unknown]);
    const retargeted = retargetClip(clip, { keepUnknown: true });
    expect(retargeted.tracks.length).toBe(2);
    expect(retargeted.tracks[0].name).toBe("mixamorigHips.quaternion");
    expect(retargeted.tracks[1].name).toBe("ThumbTip.scale");
  });

  it("preserves clip name and duration", () => {
    const track = new THREE.QuaternionKeyframeTrack(
      "mixamorig:Hips.quaternion",
      [0, 0.7],
      [0, 0, 0, 1, 0, 0, 0, 1],
    );
    const clip = new THREE.AnimationClip("idle", 0.7, [track]);
    const retargeted = retargetClip(clip);
    expect(retargeted.name).toBe("idle");
    expect(retargeted.duration).toBe(0.7);
  });
});
