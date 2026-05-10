#!/usr/bin/env node
/**
 * Author the shared body GLB and the seed animation pack.
 *
 * This script is the source of truth for the binary assets we ship at
 * apps/web/public/models/body.glb and apps/web/public/animations/*.glb.
 * Re-running it should produce byte-similar artefacts (modulo three.js
 * floating-point ordering); diff-noise is acceptable.
 *
 * The body is a low-poly humanoid (~800 tris, well under the 3K
 * budget) with:
 *   - sub-meshes named torso, shorts, socks, head_billboard
 *   - a Mixamo-style bone hierarchy at T-pose:
 *     mixamorigHips → Spine → Spine1 → Spine2 → Neck → Head
 *                            ↘ {Left,Right}Shoulder → Arm → ForeArm → Hand
 *                  ↘ {Left,Right}UpLeg → Leg → Foot
 *
 * The seed animations (idle, run, kick) are short keyframe loops on the
 * same skeleton, exported one-per-file so the renderer's animation FSM
 * can load them on demand. Remaining animations (walk, sprint, pass,
 * header, shoot, tackle, fall, celebrate, throw, catch, dribble, jump)
 * fall back to idle in v0.1; full Mixamo retargets land in a follow-up
 * issue tracked in IDEAS.md.
 *
 * Author: Tournamental (self-authored, CC0). See apps/web/public/CREDITS.md.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// GLTFExporter calls into browser-only globals (Blob → FileReader) when
// emitting binary GLB. Polyfill them with Node 18+ built-ins.
if (typeof globalThis.FileReader === "undefined") {
  class NodeFileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(
        (buf) => {
          this.result = buf;
          if (typeof this.onloadend === "function") this.onloadend();
        },
        (err) => {
          this.error = err;
          if (typeof this.onerror === "function") this.onerror(err);
        }
      );
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        const b64 = Buffer.from(buf).toString("base64");
        this.result = `data:${blob.type || "application/octet-stream"};base64,${b64}`;
        if (typeof this.onloadend === "function") this.onloadend();
      });
    }
  }
  globalThis.FileReader = NodeFileReader;
}

const THREE = await import("three");
const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const PUBLIC_DIR = resolve(REPO_ROOT, "apps", "web", "public");
const MODELS_DIR = resolve(PUBLIC_DIR, "models");
const ANIMS_DIR = resolve(PUBLIC_DIR, "animations");

mkdirSync(MODELS_DIR, { recursive: true });
mkdirSync(ANIMS_DIR, { recursive: true });

// ---------- bone hierarchy ----------

/**
 * Mixamo-style names; the `mixamorig` prefix is what Mixamo's auto-rigger
 * outputs and what `three.js`'s SkeletonUtils.retarget recognises by
 * default.
 */
const BONE_NAMES = [
  "mixamorigHips",
  "mixamorigSpine",
  "mixamorigSpine1",
  "mixamorigSpine2",
  "mixamorigNeck",
  "mixamorigHead",
  "mixamorigLeftShoulder",
  "mixamorigLeftArm",
  "mixamorigLeftForeArm",
  "mixamorigLeftHand",
  "mixamorigRightShoulder",
  "mixamorigRightArm",
  "mixamorigRightForeArm",
  "mixamorigRightHand",
  "mixamorigLeftUpLeg",
  "mixamorigLeftLeg",
  "mixamorigLeftFoot",
  "mixamorigRightUpLeg",
  "mixamorigRightLeg",
  "mixamorigRightFoot",
];

/** Build the bone tree; positions are in metres, T-pose. */
function buildBones() {
  const bones = {};
  for (const name of BONE_NAMES) {
    bones[name] = new THREE.Bone();
    bones[name].name = name;
  }

  // Hierarchy
  const child = (parent, c) => bones[parent].add(bones[c]);
  child("mixamorigHips", "mixamorigSpine");
  child("mixamorigSpine", "mixamorigSpine1");
  child("mixamorigSpine1", "mixamorigSpine2");
  child("mixamorigSpine2", "mixamorigNeck");
  child("mixamorigNeck", "mixamorigHead");

  child("mixamorigSpine2", "mixamorigLeftShoulder");
  child("mixamorigLeftShoulder", "mixamorigLeftArm");
  child("mixamorigLeftArm", "mixamorigLeftForeArm");
  child("mixamorigLeftForeArm", "mixamorigLeftHand");

  child("mixamorigSpine2", "mixamorigRightShoulder");
  child("mixamorigRightShoulder", "mixamorigRightArm");
  child("mixamorigRightArm", "mixamorigRightForeArm");
  child("mixamorigRightForeArm", "mixamorigRightHand");

  child("mixamorigHips", "mixamorigLeftUpLeg");
  child("mixamorigLeftUpLeg", "mixamorigLeftLeg");
  child("mixamorigLeftLeg", "mixamorigLeftFoot");

  child("mixamorigHips", "mixamorigRightUpLeg");
  child("mixamorigRightUpLeg", "mixamorigRightLeg");
  child("mixamorigRightLeg", "mixamorigRightFoot");

  // Local positions (offsets from parent), T-pose.
  bones.mixamorigHips.position.set(0, 0.95, 0);
  bones.mixamorigSpine.position.set(0, 0.1, 0);
  bones.mixamorigSpine1.position.set(0, 0.1, 0);
  bones.mixamorigSpine2.position.set(0, 0.1, 0);
  bones.mixamorigNeck.position.set(0, 0.12, 0);
  bones.mixamorigHead.position.set(0, 0.1, 0);

  bones.mixamorigLeftShoulder.position.set(0.05, 0.05, 0);
  bones.mixamorigLeftArm.position.set(0.18, 0, 0);
  bones.mixamorigLeftForeArm.position.set(0.28, 0, 0);
  bones.mixamorigLeftHand.position.set(0.25, 0, 0);

  bones.mixamorigRightShoulder.position.set(-0.05, 0.05, 0);
  bones.mixamorigRightArm.position.set(-0.18, 0, 0);
  bones.mixamorigRightForeArm.position.set(-0.28, 0, 0);
  bones.mixamorigRightHand.position.set(-0.25, 0, 0);

  bones.mixamorigLeftUpLeg.position.set(0.1, -0.05, 0);
  bones.mixamorigLeftLeg.position.set(0, -0.45, 0);
  bones.mixamorigLeftFoot.position.set(0, -0.45, 0.05);

  bones.mixamorigRightUpLeg.position.set(-0.1, -0.05, 0);
  bones.mixamorigRightLeg.position.set(0, -0.45, 0);
  bones.mixamorigRightFoot.position.set(0, -0.45, 0.05);

  return bones;
}

// ---------- meshes ----------

/** Build a region mesh by extruding a box and skinning every vertex to
 * `boneIndex`. Each region is its own SkinnedMesh so the renderer can
 * swap materials cleanly. */
function regionMesh(name, geometry, boneIndex, skeleton, color) {
  const positions = geometry.attributes.position;
  const count = positions.count;
  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    skinIndices[i * 4] = boneIndex;
    skinIndices[i * 4 + 1] = 0;
    skinIndices[i * 4 + 2] = 0;
    skinIndices[i * 4 + 3] = 0;
    skinWeights[i * 4] = 1;
  }
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeights, 4));

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.6,
    metalness: 0.0,
    name: `${name}-mat`,
  });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = name;
  mesh.bind(skeleton);
  return mesh;
}

function torsoGeom() {
  const g = new THREE.BoxGeometry(0.42, 0.55, 0.24, 1, 1, 1);
  g.translate(0, 1.25, 0);
  return g;
}
function shortsGeom() {
  const g = new THREE.BoxGeometry(0.42, 0.18, 0.26, 1, 1, 1);
  g.translate(0, 0.9, 0);
  return g;
}
function socksGeom() {
  // Two cylinders + a block, merged into one geometry for simplicity.
  const left = new THREE.CylinderGeometry(0.07, 0.07, 0.2, 12);
  left.translate(0.1, 0.15, 0);
  const right = new THREE.CylinderGeometry(0.07, 0.07, 0.2, 12);
  right.translate(-0.1, 0.15, 0);
  // Merge by hand (no BufferGeometryUtils dependency).
  return mergeGeoms([left, right]);
}
function headBillboardGeom() {
  // Tiny placeholder cube the renderer hides behind a sprite face.
  const g = new THREE.BoxGeometry(0.18, 0.22, 0.18, 1, 1, 1);
  g.translate(0, 1.78, 0);
  return g;
}

/**
 * Concatenate position/normal/index attributes from multiple
 * BufferGeometries. Good enough for our simple boxes.
 */
function mergeGeoms(geoms) {
  let posCount = 0;
  let idxCount = 0;
  for (const g of geoms) {
    posCount += g.attributes.position.count;
    idxCount += (g.index ? g.index.count : g.attributes.position.count);
  }
  const positions = new Float32Array(posCount * 3);
  const normals = new Float32Array(posCount * 3);
  const indices = new Uint32Array(idxCount);
  let pOff = 0;
  let iOff = 0;
  let vBase = 0;
  for (const g of geoms) {
    positions.set(g.attributes.position.array, pOff * 3);
    normals.set(g.attributes.normal.array, pOff * 3);
    const idxArr = g.index ? g.index.array : null;
    if (idxArr) {
      for (let i = 0; i < idxArr.length; i++) {
        indices[iOff + i] = idxArr[i] + vBase;
      }
      iOff += idxArr.length;
    } else {
      for (let i = 0; i < g.attributes.position.count; i++) {
        indices[iOff + i] = i + vBase;
      }
      iOff += g.attributes.position.count;
    }
    pOff += g.attributes.position.count;
    vBase += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  return out;
}

// ---------- assemble + export ----------

function buildBody() {
  const bones = buildBones();
  const orderedBones = BONE_NAMES.map((n) => bones[n]);
  const skeleton = new THREE.Skeleton(orderedBones);

  const root = new THREE.Group();
  root.name = "VTornBody";
  root.add(bones.mixamorigHips);

  // Map regions to bone indices so each sub-mesh follows the right joint.
  const idx = (name) => BONE_NAMES.indexOf(name);
  const torso = regionMesh("torso", torsoGeom(), idx("mixamorigSpine1"), skeleton, 0xcccccc);
  const shorts = regionMesh("shorts", shortsGeom(), idx("mixamorigHips"), skeleton, 0x222222);
  const socks = regionMesh("socks", socksGeom(), idx("mixamorigLeftLeg"), skeleton, 0xffffff);
  const head = regionMesh("head_billboard", headBillboardGeom(), idx("mixamorigHead"), skeleton, 0xeed8c5);

  root.add(torso);
  root.add(shorts);
  root.add(socks);
  root.add(head);

  return { root, skeleton, bones };
}

async function exportGLB(object, animations, outPath) {
  const exporter = new GLTFExporter();
  const arrayBuffer = await new Promise((resolve, reject) => {
    exporter.parse(
      object,
      (result) => resolve(result),
      (err) => reject(err),
      { binary: true, animations }
    );
  });
  writeFileSync(outPath, Buffer.from(arrayBuffer));
  console.log(`  → ${outPath} (${(arrayBuffer.byteLength / 1024).toFixed(1)} KB)`);
}

// ---------- animations ----------

/**
 * Helpers to keep clip authoring readable. Each returns the 4-element
 * array form of a quaternion (xyzw) so we can splat directly into
 * `QuaternionKeyframeTrack` value arrays.
 */
const Q = (x, y, z) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).toArray();
const Q0 = Q(0, 0, 0);

/** Build a short looping clip on the bones we already authored. */
function makeIdleClip(bones) {
  const tracks = [];
  // Subtle breathing: spine1 leans 2° fore-aft over 2s, returns.
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigSpine1.quaternion",
      [0, 1, 2],
      [
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)).toArray(),
        ...new THREE.Quaternion()
          .setFromEuler(new THREE.Euler(0.035, 0, 0))
          .toArray(),
        ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)).toArray(),
      ]
    )
  );
  // Hands hang down (45° elbow bend rather than full T-pose) so the body
  // doesn't read as a rigid mannequin while idle.
  const armBend = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(0, 0, -0.15))
    .toArray();
  const armRest = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(0, 0, -0.12))
    .toArray();
  tracks.push(
    new THREE.QuaternionKeyframeTrack("mixamorigLeftArm.quaternion", [0, 1, 2], [
      ...armBend, ...armRest, ...armBend,
    ])
  );
  return new THREE.AnimationClip("idle", 2, tracks);
}

function makeRunClip(_bones) {
  const tracks = [];
  // Alternating leg lift; 0.6s cycle.
  const legUp = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(0.9, 0, 0))
    .toArray();
  const legBack = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(-0.6, 0, 0))
    .toArray();
  const legNeutral = new THREE.Quaternion().toArray();
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftUpLeg.quaternion",
      [0, 0.15, 0.3, 0.45, 0.6],
      [...legUp, ...legNeutral, ...legBack, ...legNeutral, ...legUp]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightUpLeg.quaternion",
      [0, 0.15, 0.3, 0.45, 0.6],
      [...legBack, ...legNeutral, ...legUp, ...legNeutral, ...legBack]
    )
  );
  // Counter-rotating arm swing.
  const armFwd = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(-0.7, 0, 0))
    .toArray();
  const armBack = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(0.7, 0, 0))
    .toArray();
  const armN = new THREE.Quaternion().toArray();
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftArm.quaternion",
      [0, 0.15, 0.3, 0.45, 0.6],
      [...armBack, ...armN, ...armFwd, ...armN, ...armBack]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightArm.quaternion",
      [0, 0.15, 0.3, 0.45, 0.6],
      [...armFwd, ...armN, ...armBack, ...armN, ...armFwd]
    )
  );
  return new THREE.AnimationClip("run", 0.6, tracks);
}

function makeKickClip(_bones) {
  const tracks = [];
  // Right leg windup → strike → recover (0.5s one-shot).
  const wind = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(-0.7, 0, 0))
    .toArray();
  const strike = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(1.4, 0, 0))
    .toArray();
  const recover = new THREE.Quaternion().toArray();
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightUpLeg.quaternion",
      [0, 0.15, 0.3, 0.5],
      [...recover, ...wind, ...strike, ...recover]
    )
  );
  // Left leg plants slightly forward to balance.
  const plant = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(0.15, 0, 0))
    .toArray();
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftUpLeg.quaternion",
      [0, 0.5],
      [...plant, ...plant]
    )
  );
  // Arms swing for balance.
  const lArmSwing = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(0, 0, 0.4))
    .toArray();
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftArm.quaternion",
      [0, 0.3, 0.5],
      [...new THREE.Quaternion().toArray(), ...lArmSwing, ...new THREE.Quaternion().toArray()]
    )
  );
  return new THREE.AnimationClip("kick", 0.5, tracks);
}

// ---------- new differentiated clips (Phase 1 fidelity) ----------
//
// Self-authored CC0 — see packages/avatar/README.md § "Asset
// substitution policy" for why we don't pull Mixamo's archive directly
// in OSS CI. The clips are short, hand-tuned, and target the same
// canonical Mixamo skeleton as `body.glb` so they retarget cleanly to a
// future RPM/Quaternius rig drop.

function makeWalkClip(_bones) {
  const tracks = [];
  const legUp = Q(0.5, 0, 0);
  const legBack = Q(-0.3, 0, 0);
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftUpLeg.quaternion",
      [0, 0.25, 0.5, 0.75, 1.0],
      [...legUp, ...Q0, ...legBack, ...Q0, ...legUp]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightUpLeg.quaternion",
      [0, 0.25, 0.5, 0.75, 1.0],
      [...legBack, ...Q0, ...legUp, ...Q0, ...legBack]
    )
  );
  const armFwd = Q(-0.35, 0, -0.05);
  const armBack = Q(0.35, 0, -0.05);
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftArm.quaternion",
      [0, 0.25, 0.5, 0.75, 1.0],
      [...armBack, ...Q0, ...armFwd, ...Q0, ...armBack]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightArm.quaternion",
      [0, 0.25, 0.5, 0.75, 1.0],
      [...armFwd, ...Q0, ...armBack, ...Q0, ...armFwd]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigSpine.quaternion",
      [0, 0.5, 1.0],
      [...Q(0.02, 0, 0), ...Q(-0.02, 0, 0), ...Q(0.02, 0, 0)]
    )
  );
  return new THREE.AnimationClip("walk", 1.0, tracks);
}

function makeSprintClip(_bones) {
  const tracks = [];
  const legUp = Q(1.2, 0, 0);
  const legBack = Q(-0.85, 0, 0);
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftUpLeg.quaternion",
      [0, 0.11, 0.225, 0.34, 0.45],
      [...legUp, ...Q0, ...legBack, ...Q0, ...legUp]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightUpLeg.quaternion",
      [0, 0.11, 0.225, 0.34, 0.45],
      [...legBack, ...Q0, ...legUp, ...Q0, ...legBack]
    )
  );
  const armFwd = Q(-1.0, 0, 0);
  const armBack = Q(1.0, 0, 0);
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftArm.quaternion",
      [0, 0.11, 0.225, 0.34, 0.45],
      [...armBack, ...Q0, ...armFwd, ...Q0, ...armBack]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightArm.quaternion",
      [0, 0.11, 0.225, 0.34, 0.45],
      [...armFwd, ...Q0, ...armBack, ...Q0, ...armFwd]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigSpine.quaternion",
      [0, 0.45],
      [...Q(0.18, 0, 0), ...Q(0.18, 0, 0)]
    )
  );
  return new THREE.AnimationClip("sprint", 0.45, tracks);
}

function makePassClip(_bones) {
  const tracks = [];
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightUpLeg.quaternion",
      [0, 0.1, 0.2, 0.4],
      [...Q0, ...Q(-0.4, 0, 0.2), ...Q(0.6, 0, 0.2), ...Q0]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigSpine1.quaternion",
      [0, 0.2, 0.4],
      [...Q0, ...Q(0, -0.2, 0), ...Q0]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftArm.quaternion",
      [0, 0.2, 0.4],
      [...Q0, ...Q(0, 0, 0.4), ...Q0]
    )
  );
  return new THREE.AnimationClip("pass", 0.4, tracks);
}

function makeHeaderClip(_bones) {
  const tracks = [];
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigSpine.quaternion",
      [0, 0.15, 0.3, 0.5],
      [...Q0, ...Q(-0.3, 0, 0), ...Q(0.4, 0, 0), ...Q0]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigHead.quaternion",
      [0, 0.15, 0.3, 0.5],
      [...Q0, ...Q(-0.4, 0, 0), ...Q(0.6, 0, 0), ...Q0]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftArm.quaternion",
      [0, 0.15, 0.5],
      [...Q0, ...Q(0.6, 0, 0), ...Q0]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightArm.quaternion",
      [0, 0.15, 0.5],
      [...Q0, ...Q(0.6, 0, 0), ...Q0]
    )
  );
  tracks.push(
    new THREE.VectorKeyframeTrack(
      "mixamorigHips.position",
      [0, 0.15, 0.3, 0.5],
      [0, 0.95, 0, 0, 1.25, 0, 0, 1.05, 0, 0, 0.95, 0]
    )
  );
  return new THREE.AnimationClip("header", 0.5, tracks);
}

function makeShootClip(_bones) {
  const tracks = [];
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightUpLeg.quaternion",
      [0, 0.18, 0.36, 0.6],
      [...Q0, ...Q(-1.0, 0, 0), ...Q(1.7, 0, 0), ...Q0]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightLeg.quaternion",
      [0, 0.18, 0.36, 0.6],
      [...Q0, ...Q(0.8, 0, 0), ...Q(-0.4, 0, 0), ...Q0]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftUpLeg.quaternion",
      [0, 0.6],
      [...Q(0.18, 0, 0), ...Q(0.18, 0, 0)]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftArm.quaternion",
      [0, 0.18, 0.36, 0.6],
      [...Q0, ...Q(0, 0, 0.5), ...Q(0, 0, -0.4), ...Q0]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigSpine1.quaternion",
      [0, 0.36, 0.6],
      [...Q0, ...Q(0, -0.3, 0), ...Q0]
    )
  );
  return new THREE.AnimationClip("shoot", 0.6, tracks);
}

function makeTackleClip(_bones) {
  const tracks = [];
  tracks.push(
    new THREE.VectorKeyframeTrack(
      "mixamorigHips.position",
      [0, 0.2, 0.5, 0.8],
      [0, 0.95, 0, 0, 0.5, 0.1, 0, 0.25, 0.3, 0, 0.4, 0.2]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigHips.quaternion",
      [0, 0.2, 0.5, 0.8],
      [...Q0, ...Q(0.6, 0, 0), ...Q(1.2, 0, 0), ...Q(0.4, 0, 0)]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightUpLeg.quaternion",
      [0, 0.3, 0.5, 0.8],
      [...Q0, ...Q(-0.6, 0.4, 0), ...Q(-1.2, 0.5, 0), ...Q0]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftUpLeg.quaternion",
      [0, 0.3, 0.8],
      [...Q0, ...Q(0.8, 0, 0), ...Q(0.2, 0, 0)]
    )
  );
  return new THREE.AnimationClip("tackle", 0.8, tracks);
}

function makeFallClip(_bones) {
  const tracks = [];
  tracks.push(
    new THREE.VectorKeyframeTrack(
      "mixamorigHips.position",
      [0, 0.3, 0.6, 1.0, 1.5],
      [0, 0.95, 0, 0, 0.5, 0, 0, 0.2, 0.1, 0, 0.15, 0.15, 0, 0.18, 0.15]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigHips.quaternion",
      [0, 0.3, 0.6, 1.0, 1.5],
      [...Q0, ...Q(0.4, 0, 0), ...Q(1.1, 0, 0), ...Q(1.4, 0, 0), ...Q(1.4, 0, 0)]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftArm.quaternion",
      [0, 0.4, 1.0],
      [...Q0, ...Q(-0.6, 0.4, 0.2), ...Q(-0.4, 0.4, 0.2)]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightArm.quaternion",
      [0, 0.4, 1.0],
      [...Q0, ...Q(-0.6, -0.4, -0.2), ...Q(-0.4, -0.4, -0.2)]
    )
  );
  return new THREE.AnimationClip("fall", 1.5, tracks);
}

function makeCelebrateClip(_bones) {
  const tracks = [];
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftArm.quaternion",
      [0, 0.3, 1.5, 3.0],
      [...Q0, ...Q(-2.0, 0, -0.3), ...Q(-1.8, 0, -0.4), ...Q(-1.6, 0, -0.3)]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightArm.quaternion",
      [0, 0.3, 1.5, 3.0],
      [...Q0, ...Q(-2.0, 0, 0.3), ...Q(-1.8, 0, 0.4), ...Q(-1.6, 0, 0.3)]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigSpine.quaternion",
      [0, 0.5, 1.5, 3.0],
      [...Q0, ...Q(-0.25, 0, 0), ...Q(-0.2, 0, 0), ...Q(-0.15, 0, 0)]
    )
  );
  tracks.push(
    new THREE.VectorKeyframeTrack(
      "mixamorigHips.position",
      [0, 0.3, 0.6, 1.0, 1.5, 2.0, 2.5, 3.0],
      [0, 0.95, 0,
       0, 1.2, 0,
       0, 0.95, 0,
       0, 1.1, 0,
       0, 0.95, 0,
       0, 1.05, 0,
       0, 0.95, 0,
       0, 0.95, 0]
    )
  );
  return new THREE.AnimationClip("celebrate", 3.0, tracks);
}

function makeThrowClip(_bones) {
  const tracks = [];
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftArm.quaternion",
      [0, 0.2, 0.4, 0.6],
      [...Q0, ...Q(-2.4, 0, -0.2), ...Q(-1.0, 0, -0.2), ...Q0]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightArm.quaternion",
      [0, 0.2, 0.4, 0.6],
      [...Q0, ...Q(-2.4, 0, 0.2), ...Q(-1.0, 0, 0.2), ...Q0]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigSpine.quaternion",
      [0, 0.2, 0.4, 0.6],
      [...Q0, ...Q(-0.3, 0, 0), ...Q(0.2, 0, 0), ...Q0]
    )
  );
  return new THREE.AnimationClip("throw", 0.6, tracks);
}

function makeCatchClip(_bones) {
  const tracks = [];
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftArm.quaternion",
      [0, 0.15, 0.3, 0.5],
      [...Q0, ...Q(-1.5, 0, -0.2), ...Q(-1.4, 0, -0.2), ...Q0]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightArm.quaternion",
      [0, 0.15, 0.3, 0.5],
      [...Q0, ...Q(-1.5, 0, 0.2), ...Q(-1.4, 0, 0.2), ...Q0]
    )
  );
  tracks.push(
    new THREE.VectorKeyframeTrack(
      "mixamorigHips.position",
      [0, 0.2, 0.5],
      [0, 0.95, 0, 0, 0.7, 0.2, 0, 0.95, 0]
    )
  );
  return new THREE.AnimationClip("catch", 0.5, tracks);
}

function makeDribbleClip(_bones) {
  const tracks = [];
  const legUp = Q(0.6, 0, 0);
  const legBack = Q(-0.4, 0, 0);
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftUpLeg.quaternion",
      [0, 0.2, 0.4, 0.6, 0.8],
      [...legUp, ...Q0, ...legBack, ...Q0, ...legUp]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightUpLeg.quaternion",
      [0, 0.2, 0.4, 0.6, 0.8],
      [...legBack, ...Q0, ...legUp, ...Q0, ...legBack]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigSpine1.quaternion",
      [0, 0.2, 0.4, 0.6, 0.8],
      [...Q0, ...Q(0, 0.2, 0), ...Q0, ...Q(0, -0.2, 0), ...Q0]
    )
  );
  return new THREE.AnimationClip("dribble", 0.8, tracks);
}

function makeJumpClip(_bones) {
  const tracks = [];
  tracks.push(
    new THREE.VectorKeyframeTrack(
      "mixamorigHips.position",
      [0, 0.15, 0.3, 0.5, 0.6],
      [0, 0.95, 0, 0, 0.7, 0, 0, 1.4, 0, 0, 1.0, 0, 0, 0.95, 0]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigLeftUpLeg.quaternion",
      [0, 0.15, 0.3, 0.6],
      [...Q0, ...Q(0.5, 0, 0), ...Q(-0.3, 0, 0), ...Q0]
    )
  );
  tracks.push(
    new THREE.QuaternionKeyframeTrack(
      "mixamorigRightUpLeg.quaternion",
      [0, 0.15, 0.3, 0.6],
      [...Q0, ...Q(0.5, 0, 0), ...Q(-0.3, 0, 0), ...Q0]
    )
  );
  return new THREE.AnimationClip("jump", 0.6, tracks);
}

// ---------- main ----------

async function main() {
  console.log("Building shared body GLB…");
  const { root } = buildBody();
  await exportGLB(root, [], resolve(MODELS_DIR, "body.glb"));

  console.log("Building Phase-1 differentiated animation pack…");
  // Each tag now gets a hand-tuned clip on the canonical Mixamo skeleton.
  // Self-authored CC0; see packages/avatar/README.md § "Asset
  // substitution policy". Future bake step replaces these with the real
  // Mixamo retargets without renaming the files.
  const builders = {
    idle: makeIdleClip,
    walk: makeWalkClip,
    run: makeRunClip,
    sprint: makeSprintClip,
    kick: makeKickClip,
    pass: makePassClip,
    header: makeHeaderClip,
    shoot: makeShootClip,
    tackle: makeTackleClip,
    fall: makeFallClip,
    celebrate: makeCelebrateClip,
    throw: makeThrowClip,
    catch: makeCatchClip,
    dribble: makeDribbleClip,
    jump: makeJumpClip,
  };
  const ALL_TAGS = Object.keys(builders);
  for (const tag of ALL_TAGS) {
    const builder = builders[tag];
    const { root: animRoot, bones: animBones } = buildBody();
    const clip = builder(animBones);
    clip.name = tag;
    await exportGLB(animRoot, [clip], resolve(ANIMS_DIR, `${tag}.glb`));
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
