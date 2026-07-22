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
 * Build a 4Ã—4 column-major transform array for manifold.
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
 * Returns { cutter, ring } â€” both Manifold objects.
 *
 * The cutter is a solid disk (no inner hole) that cleanly separates the mesh.
 * The ring is a washer (hollow cylinder) that floats in the groove with 0.3mm clearance.
 */
export function createJointManifolds(params, modelExtent) {
  const {
    position,
    normal,
    measuredRadius,
    scale = 1.0,
    thickness = 2.0,
    tiltAxis = new THREE.Vector3(1, 0, 0),
    tiltDeg = 0,
  } = params;

  const { Manifold } = manifoldAPI;
  const clearance = 0.4;
  const segments = 64;
  const localRadius = Math.max(2.5, measuredRadius * scale);
  const ballRadius = Math.max(1.8, Math.min(localRadius * 0.34, 12));
  const wall = Math.max(1.2, Math.min(thickness, ballRadius * 0.55));
  const cavityRadius = ballRadius + clearance;
  const socketRadius = cavityRadius + wall;
  const stemRadius = Math.max(1.2, ballRadius * 0.38);
  const halfDepth = Math.max(modelExtent, socketRadius * 4);

  const transformAt = (z) => {
    const p = position.clone().add(normal.clone().normalize().multiplyScalar(z));
    return makeRingTransform(p, normal, tiltAxis, tiltDeg);
  };

  // Two clipping volumes split the source into independently moving bodies,
  // leaving a real printable gap at the chosen plane.
  const boxSize = halfDepth * 2;
  const negativeBoxRaw = Manifold.cube([boxSize, boxSize, halfDepth], true);
  const positiveBoxRaw = Manifold.cube([boxSize, boxSize, halfDepth], true);
  const negativeBox = negativeBoxRaw.transform(transformAt(-(halfDepth + clearance) / 2));
  const positiveBox = positiveBoxRaw.transform(transformAt((halfDepth + clearance) / 2));
  negativeBoxRaw.delete();
  positiveBoxRaw.delete();

  const ballRaw = Manifold.sphere(ballRadius, segments);
  const cavityRaw = Manifold.sphere(cavityRadius, segments);
  const socketOuterRaw = Manifold.sphere(socketRadius, segments);
  const ball = ballRaw.transform(transformAt(0));
  const cavity = cavityRaw.transform(transformAt(0));
  const socketOuter = socketOuterRaw.transform(transformAt(0));
  ballRaw.delete();
  cavityRaw.delete();
  socketOuterRaw.delete();

  // The male stem is fused to the negative body; the socket neck is fused to
  // the positive body.  The opening gives the stem room to swing.
  const stemLength = socketRadius * 2.4;
  const maleStemRaw = Manifold.cylinder(stemLength, stemRadius, stemRadius, segments, true);
  const socketStemRaw = Manifold.cylinder(stemLength, socketRadius * 0.72, socketRadius * 0.72, segments, true);
  const openingRaw = Manifold.cylinder(
    socketRadius * 2.2,
    stemRadius + clearance * 1.5,
    stemRadius + clearance * 1.5,
    segments,
    true
  );
  const maleStem = maleStemRaw.transform(transformAt(-stemLength / 2));
  const socketStem = socketStemRaw.transform(transformAt(stemLength / 2));
  const opening = openingRaw.transform(transformAt(-socketRadius * 0.85));
  maleStemRaw.delete();
  socketStemRaw.delete();
  openingRaw.delete();

  return {
    negativeBox,
    positiveBox,
    ball,
    cavity,
    socketOuter,
    maleStem,
    socketStem,
    opening,
  };
}

/**
 * Ensure a Three.js geometry is indexed (merge duplicate verts).
 */
export function prepareGeometry(geometry) {
  let g = geometry.clone();
  // STL/Three geometries often duplicate vertices at hard-normal or UV seams.
  // mergeVertices hashes every attribute, so those extra attributes prevent a
  // watertight index from being produced.  Boolean input only needs positions.
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position') g.deleteAttribute(name);
  }
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

  if (joints.length > 1) {
    mainManifold.delete();
    throw new Error('This prototype supports one captured ball joint per export. Delete extra joints and export again.');
  }

  preparedGeom.computeBoundingBox();
  const size = preparedGeom.boundingBox.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z) * 2 + 10;
  const parts = createJointManifolds(joints[0], extent);

  let negativeBody = mainManifold.intersect(parts.negativeBox);
  let positiveBody = mainManifold.intersect(parts.positiveBox);

  // Clear the socket envelope from the male half so the two exported shells
  // cannot accidentally fuse where the socket wraps around the ball.
  const clearedNegative = negativeBody.subtract(parts.socketOuter);
  negativeBody.delete();
  negativeBody = clearedNegative;

  const maleWithStem = parts.ball.add(parts.maleStem);
  const maleSide = negativeBody.add(maleWithStem);

  const socketWithStem = parts.socketOuter.add(parts.socketStem);
  const hollowSocket = socketWithStem.subtract(parts.cavity);
  const socketAttached = positiveBody.add(hollowSocket);
  const socketSide = socketAttached.subtract(parts.opening);

  const result = [manifoldToThreeGeom(maleSide), manifoldToThreeGeom(socketSide)];

  mainManifold.delete();
  negativeBody.delete();
  positiveBody.delete();
  maleWithStem.delete();
  maleSide.delete();
  socketWithStem.delete();
  hollowSocket.delete();
  socketAttached.delete();
  socketSide.delete();
  for (const value of Object.values(parts)) value.delete();

  return result;
}

