/**
 * Export an array of Three.js BufferGeometries as a single binary STL.
 * Each geometry becomes a solid in the file (multiple shells = print-in-place).
 */
export function exportBinarySTL(geometries, filename = 'articulated.stl') {
  // Count total triangles across all geometries
  let totalTris = 0;
  for (const geom of geometries) {
    if (geom.index) {
      totalTris += geom.index.count / 3;
    } else {
      totalTris += geom.attributes.position.count / 3;
    }
  }

  // Binary STL: 80-byte header + 4-byte tri count + (50 bytes × tri count)
  const bufferSize = 80 + 4 + totalTris * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // Header (80 bytes) — ASCII text
  const header = 'Artyam STL articulation export — print-in-place flexi joints';
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  }

  // Triangle count
  view.setUint32(80, totalTris, true);

  let offset = 84;

  for (const geom of geometries) {
    const pos = geom.attributes.position;
    const nrm = geom.attributes.normal;

    const getVert = (i, out) => {
      out.x = pos.getX(i);
      out.y = pos.getY(i);
      out.z = pos.getZ(i);
    };

    const getNorm = (i, out) => {
      if (nrm) {
        out.x = nrm.getX(i);
        out.y = nrm.getY(i);
        out.z = nrm.getZ(i);
      } else {
        out.x = 0; out.y = 0; out.z = 1;
      }
    };

    if (geom.index) {
      const idx = geom.index;
      const triCount = idx.count / 3;

      for (let t = 0; t < triCount; t++) {
        const a = idx.getX(t * 3);
        const b = idx.getX(t * 3 + 1);
        const c = idx.getX(t * 3 + 2);

        // Face normal = average of vertex normals
        let nx = 0, ny = 0, nz = 0;
        if (nrm) {
          nx = (nrm.getX(a) + nrm.getX(b) + nrm.getX(c)) / 3;
          ny = (nrm.getY(a) + nrm.getY(b) + nrm.getY(c)) / 3;
          nz = (nrm.getZ(a) + nrm.getZ(b) + nrm.getZ(c)) / 3;
        }

        view.setFloat32(offset,      nx, true); offset += 4;
        view.setFloat32(offset,      ny, true); offset += 4;
        view.setFloat32(offset,      nz, true); offset += 4;

        for (const vi of [a, b, c]) {
          view.setFloat32(offset,      pos.getX(vi), true); offset += 4;
          view.setFloat32(offset,      pos.getY(vi), true); offset += 4;
          view.setFloat32(offset,      pos.getZ(vi), true); offset += 4;
        }
        view.setUint16(offset, 0, true); offset += 2;
      }
    } else {
      const vertCount = pos.count;
      const triCount = vertCount / 3;

      for (let t = 0; t < triCount; t++) {
        const a = t * 3, b = t * 3 + 1, c = t * 3 + 2;

        let nx = 0, ny = 0, nz = 0;
        if (nrm) {
          nx = (nrm.getX(a) + nrm.getX(b) + nrm.getX(c)) / 3;
          ny = (nrm.getY(a) + nrm.getY(b) + nrm.getY(c)) / 3;
          nz = (nrm.getZ(a) + nrm.getZ(b) + nrm.getZ(c)) / 3;
        }

        view.setFloat32(offset, nx, true); offset += 4;
        view.setFloat32(offset, ny, true); offset += 4;
        view.setFloat32(offset, nz, true); offset += 4;

        for (const vi of [a, b, c]) {
          view.setFloat32(offset, pos.getX(vi), true); offset += 4;
          view.setFloat32(offset, pos.getY(vi), true); offset += 4;
          view.setFloat32(offset, pos.getZ(vi), true); offset += 4;
        }
        view.setUint16(offset, 0, true); offset += 2;
      }
    }
  }

  // Trigger download
  const blob = new Blob([buffer], { type: 'model/stl' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
