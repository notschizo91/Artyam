import './style.css';
import * as THREE from 'three';
import { Viewer } from './viewer.js';
import { JointManager } from './joint-manager.js';
import { initManifold, processBooleans } from './manifold-ops.js';
import { exportBinarySTL } from './stl-exporter.js';

// ── DOM refs ─────────────────────────────────────────
const canvas       = document.getElementById('three-canvas');
const fileInput    = document.getElementById('file-input');
const fileNameEl   = document.getElementById('file-name');
const jointList    = document.getElementById('joint-list');
const jointCount   = document.getElementById('joint-count');
const clickHint    = document.getElementById('click-hint');
const exportBtn    = document.getElementById('export-btn');
const statusEl     = document.getElementById('status');
const overlayHint  = document.getElementById('overlay-hint');
const controlsSec  = document.getElementById('joint-controls-section');
const deleteBtn    = document.getElementById('delete-joint-btn');

const ctrlPx    = document.getElementById('ctrl-px');
const ctrlPy    = document.getElementById('ctrl-py');
const ctrlPz    = document.getElementById('ctrl-pz');
const ctrlScale = document.getElementById('ctrl-scale');
const ctrlThick = document.getElementById('ctrl-thick');
const ctrlTilt  = document.getElementById('ctrl-tilt');

const valPx    = document.getElementById('val-px');
const valPy    = document.getElementById('val-py');
const valPz    = document.getElementById('val-pz');
const valScale = document.getElementById('val-scale');
const valThick = document.getElementById('val-thick');
const valTilt  = document.getElementById('val-tilt');

const axisBtns = document.querySelectorAll('.axis-btn');

// ── State ─────────────────────────────────────────────
let viewer = null;
let joints = null;
let loadedGeometry = null;
let manifoldReady = false;

// ── Boot ──────────────────────────────────────────────
async function init() {
  viewer = new Viewer(canvas);
  joints = new JointManager(viewer);

  viewer.onClickMesh = (point, normal, hit) => {
    if (!loadedGeometry) return;
    const joint = joints.addJoint(point, normal);
    joints.select(joint.id);
    refreshJointList();
    populateControls(joint);
    setStatus('');
  };

  // Init manifold in background
  setStatus('<span class="spinner"></span>Loading WASM…');
  initManifold().then(() => {
    manifoldReady = true;
    setStatus('Ready');
    setTimeout(() => setStatus(''), 1500);
  }).catch(err => {
    setStatus('WASM load failed: ' + err.message, 'error');
  });
}

// ── File loading ──────────────────────────────────────
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  fileNameEl.textContent = file.name;

  const buffer = await file.arrayBuffer();
  const result = viewer.loadSTL(buffer);
  loadedGeometry = result.geometry;

  // Set position slider ranges based on mesh size
  const bbox = result.bbox;
  const size = bbox.getSize(new THREE.Vector3());
  const halfMax = Math.ceil(Math.max(size.x, size.y, size.z) * 0.6 + 10);
  for (const sl of [ctrlPx, ctrlPy, ctrlPz]) {
    sl.min = -halfMax;
    sl.max = halfMax;
  }

  joints.removeAll();
  refreshJointList();
  overlayHint.classList.add('hidden');
  exportBtn.disabled = false;
  setStatus('');
  e.target.value = '';
});

// ── Joint list UI ─────────────────────────────────────
function refreshJointList() {
  jointList.innerHTML = '';
  jointCount.textContent = joints.joints.length;

  if (joints.joints.length === 0) {
    clickHint.style.display = '';
  } else {
    clickHint.style.display = 'none';
  }

  for (const j of joints.joints) {
    const item = document.createElement('div');
    item.className = 'joint-item' + (j.id === joints.selectedId ? ' selected' : '');
    item.dataset.id = j.id;
    item.innerHTML = `
      <div class="joint-dot"></div>
      <span class="joint-label">Joint #${j.id}</span>
    `;
    item.addEventListener('click', () => {
      joints.select(j.id);
      refreshJointList();
      populateControls(joints.getById(j.id));
    });
    jointList.appendChild(item);
  }

  const selected = joints.getSelected();
  if (selected) {
    controlsSec.style.display = '';
  } else {
    controlsSec.style.display = 'none';
  }
}

// ── Per-joint controls ────────────────────────────────
function populateControls(joint) {
  if (!joint) {
    controlsSec.style.display = 'none';
    return;
  }
  controlsSec.style.display = '';

  // Clamp range sliders to geometry bounds
  const p = joint.position;
  ctrlPx.value = p.x.toFixed(1);
  ctrlPy.value = p.y.toFixed(1);
  ctrlPz.value = p.z.toFixed(1);
  ctrlScale.value = joint.scale;
  ctrlThick.value = joint.thickness;
  ctrlTilt.value = joint.tiltDeg;

  valPx.textContent = (+ctrlPx.value).toFixed(1);
  valPy.textContent = (+ctrlPy.value).toFixed(1);
  valPz.textContent = (+ctrlPz.value).toFixed(1);
  valScale.textContent = (+ctrlScale.value).toFixed(2);
  valThick.textContent = (+ctrlThick.value).toFixed(1);
  valTilt.textContent = ctrlTilt.value;

  axisBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.axis === joint.tiltAxis);
  });
}

function getSelectedJoint() {
  return joints.getSelected();
}

// Position sliders
ctrlPx.addEventListener('input', () => {
  const j = getSelectedJoint(); if (!j) return;
  j.position.x = parseFloat(ctrlPx.value);
  valPx.textContent = parseFloat(ctrlPx.value).toFixed(1);
  joints.updateJoint(j.id, { position: j.position });
});
ctrlPy.addEventListener('input', () => {
  const j = getSelectedJoint(); if (!j) return;
  j.position.y = parseFloat(ctrlPy.value);
  valPy.textContent = parseFloat(ctrlPy.value).toFixed(1);
  joints.updateJoint(j.id, { position: j.position });
});
ctrlPz.addEventListener('input', () => {
  const j = getSelectedJoint(); if (!j) return;
  j.position.z = parseFloat(ctrlPz.value);
  valPz.textContent = parseFloat(ctrlPz.value).toFixed(1);
  joints.updateJoint(j.id, { position: j.position });
});

ctrlScale.addEventListener('input', () => {
  const j = getSelectedJoint(); if (!j) return;
  const val = parseFloat(ctrlScale.value);
  valScale.textContent = val.toFixed(2);
  joints.updateJoint(j.id, { scale: val });
});

ctrlThick.addEventListener('input', () => {
  const j = getSelectedJoint(); if (!j) return;
  const val = parseFloat(ctrlThick.value);
  valThick.textContent = val.toFixed(1);
  joints.updateJoint(j.id, { thickness: val });
});

ctrlTilt.addEventListener('input', () => {
  const j = getSelectedJoint(); if (!j) return;
  const val = parseInt(ctrlTilt.value, 10);
  valTilt.textContent = val;
  joints.updateJoint(j.id, { tiltDeg: val });
});

axisBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const j = getSelectedJoint(); if (!j) return;
    axisBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    joints.updateJoint(j.id, { tiltAxis: btn.dataset.axis });
  });
});

deleteBtn.addEventListener('click', () => {
  const j = getSelectedJoint(); if (!j) return;
  joints.removeJoint(j.id);
  refreshJointList();
  controlsSec.style.display = 'none';
});

// ── Export ────────────────────────────────────────────
exportBtn.addEventListener('click', async () => {
  if (!loadedGeometry) return;
  if (!manifoldReady) {
    setStatus('WASM not ready yet…', 'error');
    return;
  }

  exportBtn.disabled = true;
  setStatus('<span class="spinner"></span>Running boolean ops…');

  try {
    const params = joints.getManifoldParams();
    const geometries = await processBooleans(loadedGeometry, params);
    exportBinarySTL(geometries, 'articulated.stl');
    setStatus('Exported successfully!', 'success');
  } catch (err) {
    console.error(err);
    setStatus('Export failed: ' + err.message, 'error');
  } finally {
    exportBtn.disabled = false;
  }
});

// ── Helpers ────────────────────────────────────────────
function setStatus(html, type = '') {
  statusEl.innerHTML = html;
  statusEl.className = 'status' + (type ? ' ' + type : '');
}

// ── Start ──────────────────────────────────────────────
init();
