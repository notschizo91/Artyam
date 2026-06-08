import ManifoldModule from 'manifold-3d';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let manifoldAPI = null;

export async function initManifold() {
  if (manifoldAPI) return manifoldAPI;
  const wasm = await ManifoldModule();
  wasm.setup();
  manifoldAPI = wasm;
  return wasm;
}

export function getManifold() {
  return manifoldAPI;
}

/**
 * Convert a Three.js BufferGeometry (already-indexed) to a Manifold Mesh input.
 */
function geomToManifoldMesh(geometry) {
  const positions = geometry.attributes.position;
  const indices = geometry.index;
  if (!indices) throw new Error('Geometry must be indexed before passing to Manifold');

  const numVerts = positions.count;
  const vertProperties = new Float32Array(numVerts * 3);
  for (let i = 0; i < numVerts; i++) {
    vertProperties[i * 3]     = positions.getX(i);
    vertProperties[i * 3 + 1] = positions.getY(i);
    vertProperties[i * 3 + 2] = positions.getZ(i);
  }

  const triVerts = new Uint32Array(indices.array.length);
  triVerts.set(indices.array);

  return { numProp: 3, vertProperties, triVerts };
}

/**
 * Convert a Manifold back to a Three.js BufferGeometry.
 */
export function manifoldToThreeGeom(manifold) {
  const mesh = manifold.getMesh();
  const positions = mesh.vertProperties; // Float32Array, 3 per vert
  const indices = mesh.triVerts;         // Uint32Array

  const geom = new THREE.BufferGeometry();
  // Make copies since Manifold may reuse the buffers
  geom.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Build a flat washer (hollow cylinder) Manifold.
 * Created in the XY plane, centered at origin, Z-axis is the ring axis.
 */
function createWasherManifold(innerRadius, outerRadius, height, segments = 64) {
  const { Manifold } = manifoldAPI;
  const outer = Manifold.cylinder(height, outerRadius, outerRadius, segments, true);
  if (innerRadius <= 0.001) return outer;
  const inner = Manifold.cylinder(height * 1.01, innerRadius, innerRadius, segments, true);
  const washer = outer.subtract(inner);
  inner.delete();
  outer.delete();
  return washer;
}

/**
 * Build a 4×4 column-major transform array for manifold.
 * Aligns the ring's Z-axis to `normal`, centered at `position`.
 */
function makeRingTransform(position, normal, tiltAxis, tiltDeg) {
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1), normal.clone().normalize()
  );

  if (tiltAxis && Math.abs(tiltDeg) > 0.001) {
    const localAxis = tiltAxis.clone().applyQuaternion(q).normalize();
    const tiltQ = new THREE.Quaternion().setFromAxisAngle(localAxis, tiltDeg * Math.PI / 180);
    q.premultiply(tiltQ);
  }

  const mat = new THREE.Matrix4().makeRotationFromQuaternion(q);
  mat.setPosition(position);
  // Return a plain JS Array (not Float32Array) for compatibility with Manifold's Mat4 type.
  // THREE.Matrix4.elements is column-major, matching Manifold's convention.
  return Array.from(mat.elements);
}

/**
 * Create a joint cutter and a ring insert for one joint.
 * Returns { cutter, ring } — both Manifold objects.
 *
 * The cutter is a solid disk (no inner hole) that cleanly separates the mesh.
 * The ring is a washer (hollow cylinder) that floats in the groove with 0.3mm clearance.
 */
export function createJointManifolds(params) {
  const {
    position,
    normal,
    measuredRadius,
    scale = 1.0,
    thickness = 2.0,
    tiltAxis = new THREE.Vector3(1, 0, 0),
    tiltDeg = 0,
  } = params;

  const CLEARANCE = 0.3;
  const SEGMENTS = 64;

  const R = measuredRadius * scale;

  // Ring: sits inside the groove, captured between the two mesh halves
  const ringOuter = R * 0.88;
  const ringInner = R * 0.28;

  // Cutter: slightly larger than ring + clearance, no inner hole (ensures clean mesh separation)
  const cutOuter  = R + CLEARANCE + 0.5;
  const cutHeight = thickness + CLEARANCE * 2;

  const rawCutter = createWasherManifold(0, cutOuter, cutHeight, SEGMENTS);
  const rawRing   = createWasherManifold(ringInner, ringOuter, thickness, SEGMENTS);

  const transform = makeRingTransform(position, normal, tiltAxis, tiltDeg);

  const cutter = rawCutter.transform(transform);
  const ring   = rawRing.transform(transform);
  rawCutter.delete();
  rawRing.delete();

  return { cutter, ring };
}

/**
 * Ensure a Three.js geometry is indexed (merge duplicate verts).
 */
export function prepareGeometry(geometry) {
  let g = geometry.clone();
  // mergeVertices from BufferGeometryUtils creates an indexed geometry
  // by welding vertices that are within tolerance of each other.
  g = mergeVertices(g, 1e-4);
  if (!g.index) {
    // Fallback: create a trivial index
    const count = g.attributes.position.count;
    const arr = new Uint32Array(count);
    for (let i = 0; i < count; i++) arr[i] = i;
    g.setIndex(new THREE.BufferAttribute(arr, 1));
  }
  return g;
}

/**
 * Run the full boolean subtraction pipeline.
 *
 * mainGeometry: Three.js BufferGeometry (from STL loader)
 * joints:       array of joint param objects (from JointManager.getManifoldParams())
 *
 * Returns an array of Three.js BufferGeometries:
 *   [0] = main body with grooves subtracted
 *   [1..n] = ring solids (one per joint, in print-in-place position)
 */
export async function processBooleans(mainGeometry, joints) {
  const { Manifold } = manifoldAPI;

  const preparedGeom = prepareGeometry(mainGeometry);
  const mainMesh = geomToManifoldMesh(preparedGeom);
  let mainManifold = Manifold.ofMesh(mainMesh);

  // Validate the input mesh
  if (mainManifold.isEmpty()) {
    mainManifold.delete();
    throw new Error(
      'Input mesh is not manifold (not watertight). ' +
      'Try repairing the STL file. Boolean operations require a closed, watertight mesh.'
    );
  }

  // If no joints, return the geometry as-is (no boolean ops needed)
  if (joints.length === 0) {
    const resultGeom = manifoldToThreeGeom(mainManifold);
    mainManifold.delete();
    return [resultGeom];
  }

  const ringManifolds = [];

  for (const joint of joints) {
    const { cutter, ring } = createJointManifolds(joint);
    const newMain = mainManifold.subtract(cutter);
    mainManifold.delete();
    mainManifold = newMain;
    cutter.delete();
    ringManifolds.push(ring);
  }

  const result = [manifoldToThreeGeom(mainManifold)];
  mainManifold.delete();

  for (const ring of ringManifolds) {
    result.push(manifoldToThreeGeom(ring));
    ring.delete();
  }

  return result;
}
