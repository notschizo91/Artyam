import * as THREE from 'three';

let nextId = 1;

export class JointManager {
  constructor(viewer) {
    this.viewer = viewer;
    this.joints = []; // array of joint objects
    this.selectedId = null;
  }

  addJoint(surfacePoint, surfaceNormal) {
    const section = this.viewer.measureCrossSection(surfacePoint, surfaceNormal);

    const joint = {
      id: nextId++,
      // Boolean geometry belongs at the interior cross-section center, not on
      // the triangle that happened to be clicked.
      position: section.center.clone(),
      normal: surfaceNormal.clone().normalize(),
      measuredRadius: section.radius,
      scale: 1.0,
      thickness: 2.0,
      tiltAxis: 'x',
      tiltDeg: 0,
    };

    this.joints.push(joint);
    this._refreshRing(joint);
    return joint;
  }

  removeJoint(id) {
    const idx = this.joints.findIndex(j => j.id === id);
    if (idx === -1) return;
    this.viewer.removeJointRing(id);
    this.joints.splice(idx, 1);
    if (this.selectedId === id) this.selectedId = null;
  }

  removeAll() {
    for (const j of this.joints) this.viewer.removeJointRing(j.id);
    this.joints = [];
    this.selectedId = null;
  }

  select(id) {
    const prev = this.selectedId;
    this.selectedId = id;
    if (prev) {
      const j = this.getById(prev);
      if (j) this._refreshRing(j);
    }
    const j = this.getById(id);
    if (j) this._refreshRing(j);
  }

  deselect() {
    if (this.selectedId) {
      const j = this.getById(this.selectedId);
      if (j) this._refreshRing(j);
    }
    this.selectedId = null;
  }

  updateJoint(id, changes) {
    const j = this.getById(id);
    if (!j) return;
    Object.assign(j, changes);
    this._refreshRing(j);
  }

  getById(id) {
    return this.joints.find(j => j.id === id) || null;
  }

  getSelected() {
    return this.selectedId ? this.getById(this.selectedId) : null;
  }

  _refreshRing(joint) {
    const tiltAxisVec = {
      x: new THREE.Vector3(1, 0, 0),
      y: new THREE.Vector3(0, 1, 0),
      z: new THREE.Vector3(0, 0, 1),
    }[joint.tiltAxis] || new THREE.Vector3(1, 0, 0);

    this.viewer.addOrUpdateJointRing(
      joint.id,
      joint.position,
      joint.normal,
      joint.measuredRadius,
      joint.scale,
      joint.thickness,
      tiltAxisVec,
      joint.tiltDeg,
      joint.id === this.selectedId
    );
  }

  /** Build params for manifold-ops processBooleans */
  getManifoldParams() {
    return this.joints.map(j => ({
      position: j.position,
      normal: j.normal,
      measuredRadius: j.measuredRadius,
      scale: j.scale,
      thickness: j.thickness,
      tiltAxis: {
        x: new THREE.Vector3(1, 0, 0),
        y: new THREE.Vector3(0, 1, 0),
        z: new THREE.Vector3(0, 0, 1),
      }[j.tiltAxis] || new THREE.Vector3(1, 0, 0),
      tiltDeg: j.tiltDeg,
    }));
  }
}

