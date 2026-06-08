import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.meshObject = null;
    this.jointMeshes = [];
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.onClickMesh = null; // callback(point, normal, faceIndex)
    this._orbitActive = false;
    this._init();
  }

  _init() {
    const { canvas } = this;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x0e0f14);
    this.renderer.shadowMap.enabled = true;

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
    this.camera.position.set(0, 0, 150);

    // Orbit controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.7;
    this.controls.addEventListener('start', () => {
      this._orbitActive = true;
      canvas.classList.add('orbit-mode');
    });
    this.controls.addEventListener('end', () => {
      this._orbitActive = false;
      canvas.classList.remove('orbit-mode');
    });

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(1, 2, 3);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x8899ff, 0.3);
    fill.position.set(-2, -1, -1);
    this.scene.add(fill);

    // Grid helper (subtle)
    const grid = new THREE.GridHelper(200, 20, 0x2a2d3e, 0x1e2030);
    grid.position.y = -0.5;
    this.scene.add(grid);

    // Click handler
    canvas.addEventListener('pointerdown', this._onPointerDown.bind(this));
    canvas.addEventListener('pointerup', this._onPointerUp.bind(this));
    this._downPos = null;

    // Resize
    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
    this._resize();

    // Animation loop
    this._animate();
  }

  _resize() {
    const w = this.canvas.parentElement.clientWidth;
    const h = this.canvas.parentElement.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    requestAnimationFrame(this._animate.bind(this));
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  _onPointerDown(e) {
    this._downPos = { x: e.clientX, y: e.clientY };
  }

  _onPointerUp(e) {
    if (!this._downPos) return;
    const dx = e.clientX - this._downPos.x;
    const dy = e.clientY - this._downPos.y;
    this._downPos = null;

    // Treat as click only if pointer barely moved (not a drag)
    if (Math.sqrt(dx * dx + dy * dy) > 5) return;
    if (!this.meshObject || !this.onClickMesh) return;

    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.meshObject, false);
    if (!hits.length) return;

    const hit = hits[0];
    // Transform face normal from object space to world space
    const worldNormal = hit.face.normal.clone()
      .transformDirection(this.meshObject.matrixWorld)
      .normalize();
    this.onClickMesh(hit.point.clone(), worldNormal, hit);
  }

  /** Load STL from ArrayBuffer, display it, return geometry */
  loadSTL(buffer) {
    if (this.meshObject) {
      this.scene.remove(this.meshObject);
      this.meshObject.geometry.dispose();
      this.meshObject.material.dispose();
      this.meshObject = null;
    }

    const loader = new STLLoader();
    const geometry = loader.parse(buffer);
    geometry.computeVertexNormals();

    // Center the geometry
    geometry.computeBoundingBox();
    const center = new THREE.Vector3();
    geometry.boundingBox.getCenter(center);
    geometry.translate(-center.x, -center.y, -center.z);

    const material = new THREE.MeshStandardMaterial({
      color: 0x6880c8,
      roughness: 0.55,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    this.meshObject = new THREE.Mesh(geometry, material);
    this.scene.add(this.meshObject);

    // Fit camera
    this._fitCamera(geometry.boundingBox);

    return { geometry, bbox: geometry.boundingBox };
  }

  _fitCamera(bbox) {
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = this.camera.fov * (Math.PI / 180);
    const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.5;
    this.camera.position.set(dist * 0.6, dist * 0.4, dist);
    this.camera.near = maxDim * 0.001;
    this.camera.far = maxDim * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /** Create/update a visual ring for a joint */
  addOrUpdateJointRing(id, position, normal, measuredRadius, scale, thickness, tiltAxis, tiltDeg, selected) {
    // Remove old
    this.removeJointRing(id);

    const R = measuredRadius * scale;
    const outerR = R * 0.88;
    const innerR = R * 0.28;
    const t = thickness;

    // Build washer shape using ExtrudeGeometry
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
    shape.holes.push(hole);

    const extrudeSettings = {
      depth: t,
      bevelEnabled: false,
      curveSegments: 48,
    };
    const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    // Center on Z
    geom.translate(0, 0, -t / 2);

    const mat = new THREE.MeshStandardMaterial({
      color: selected ? 0xff9944 : 0xf57c32,
      roughness: 0.4,
      metalness: 0.2,
      transparent: true,
      opacity: selected ? 0.85 : 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geom, mat);

    // Orient ring: Z-axis → normal
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1), normal.clone().normalize()
    );

    if (tiltAxis && Math.abs(tiltDeg) > 0.001) {
      const localAxis = tiltAxis.clone().applyQuaternion(q).normalize();
      const tiltQ = new THREE.Quaternion().setFromAxisAngle(localAxis, tiltDeg * Math.PI / 180);
      q.premultiply(tiltQ);
    }

    mesh.quaternion.copy(q);
    mesh.position.copy(position);
    mesh.userData.jointId = id;
    this.scene.add(mesh);
    this.jointMeshes.push(mesh);

    return mesh;
  }

  removeJointRing(id) {
    const idx = this.jointMeshes.findIndex(m => m.userData.jointId === id);
    if (idx !== -1) {
      const m = this.jointMeshes[idx];
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
      this.jointMeshes.splice(idx, 1);
    }
  }

  removeAllJointRings() {
    for (const m of this.jointMeshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.jointMeshes = [];
  }

  /**
   * Measure cross-section radius at a surface point.
   * Casts rays from slightly inside the mesh outward in the perpendicular plane.
   */
  measureCrossSection(surfacePoint, surfaceNormal) {
    if (!this.meshObject) return 10;

    const N = surfaceNormal.clone().normalize();

    // Build two perpendicular axes in the joint plane
    const up = Math.abs(N.dot(new THREE.Vector3(0, 1, 0))) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    const perp1 = new THREE.Vector3().crossVectors(N, up).normalize();
    const perp2 = new THREE.Vector3().crossVectors(N, perp1).normalize();

    // Step inward along -N to find the opposite face
    const inwardRay = new THREE.Raycaster();
    const inDir = N.clone().negate();
    inwardRay.set(surfacePoint.clone().add(inDir.clone().multiplyScalar(0.01)), inDir);
    const inHits = inwardRay.intersectObject(this.meshObject, false);

    let center = surfacePoint.clone();
    if (inHits.length > 0) {
      // Use midpoint between surface and opposite face
      center.lerpVectors(surfacePoint, inHits[0].point, 0.5);
    }

    // Cast 8 radial rays from center in the perpendicular plane
    const distances = [];
    const RAY_SAMPLES = 8;
    const rc = new THREE.Raycaster();

    for (let i = 0; i < RAY_SAMPLES; i++) {
      const angle = (i / RAY_SAMPLES) * Math.PI * 2;
      const dir = new THREE.Vector3()
        .addScaledVector(perp1, Math.cos(angle))
        .addScaledVector(perp2, Math.sin(angle))
        .normalize();

      rc.set(center.clone().addScaledVector(dir, 0.01), dir);
      const hits = rc.intersectObject(this.meshObject, false);
      if (hits.length > 0) {
        distances.push(hits[0].distance);
      }
    }

    if (distances.length === 0) return 5;
    const minDist = Math.min(...distances);
    // Clamp to reasonable range (0.5mm – 200mm)
    return Math.max(0.5, Math.min(200, minDist * 0.95));
  }
}
