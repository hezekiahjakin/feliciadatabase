/**
 * F.E.L.I.C.I.A. Native Bungie 3D Engine (TGXM + Destiny Dye Shader Pipeline)
 *
 * Renders the same mobile 3D assets the official Destiny 2 companion app uses
 * (DestinyGearAssetsDefinition -> .tgxm geometry, .tgxm.bin textures, gear/*.js dyes)
 * and adds live shader (dye) swapping on the GPU.
 *
 * Data layout notes (verified against live Bungie CDN files):
 *  - content.male_index_set / female_index_set / region_index_sets hold INTEGER indices
 *    into content.geometry[] and content.textures[]. region_index_sets is an object keyed by region.
 *  - Geometry metadata lives at render_metadata.js -> render_model.render_meshes[] and texture_plates[].
 *  - Each render mesh names its own vertex/index buffer files.
 *  - Vertex element "offset" values in metadata overlap; elements are packed sequentially by "size".
 *  - Textures inside .tgxm.bin are PNG/JPEG blobs named by texture_tag_name (no file extension).
 *  - Texture plates: _0 diffuse (grayscale detail), _1 normal, _2 gearstack, _3 dyeslot.
 *  - Part gear_dye_change_color_index selects the dye group (0 = armor, 1 = weapon, ...);
 *    shader custom_dyes are laid out in groups of 3 (slot_type_index 0/1/2).
 */

const BUNGIE_CDN_BASE = 'https://www.bungie.net';

export const ICONIC_DESTINY_SHADERS = [
  { hash: 2653012761, name: 'Superblack', palette: ['#0a0a0d', '#15151a', '#24242b', '#050507'] },
  { hash: 1422712818, name: "Calus's Selected", palette: ['#f4f2ee', '#d4af37', '#4e2a6e', '#1a1622'] },
  { hash: 3650581589, name: 'Bergusian Night', palette: ['#23123a', '#4a247a', '#b67fff', '#140c21'] },
  { hash: 1046971209, name: 'Jacarina', palette: ['#121417', '#eceff4', '#4a90e2', '#1c2026'] },
  { hash: 2450544934, name: 'Photo Finish', palette: ['#ff3b82', '#33e6ff', '#ffe633', '#22242a'] },
  { hash: 2173837803, name: 'Gambit Jadestone', palette: ['#0e241b', '#00ff9d', '#163f2f', '#07140f'] },
  { hash: 2173688423, name: 'Bitterpearl', palette: ['#eef4ff', '#9ec5ff', '#3a4966', '#d6e4ff'] },
  { hash: 2378905788, name: 'Carminica', palette: ['#9e0b1c', '#18181d', '#d92136', '#2e2e36'] },
  { hash: 3205869472, name: 'Golden Trace', palette: ['#111113', '#c9a227', '#26262a', '#e6c65c'] },
  { hash: 3205869473, name: 'Monochromatic', palette: ['#ffffff', '#d8dbe0', '#181a1f', '#8e94a0'] },
  { hash: 3205869476, name: 'Metro Shift', palette: ['#10131c', '#29488a', '#cfd6e6', '#181c29'] },
  { hash: 3470260969, name: 'Chatterwhite', palette: ['#ffffff', '#f5f6f8', '#e2e5ea', '#d0d5dd'] },
  { hash: 3650581584, name: 'New Age Black Armory', palette: ['#141418', '#b5121b', '#2b2b33', '#e0242f'] },
  { hash: 3668669364, name: 'Dreaming Spectrum', palette: ['#e8dfd1', '#7d4d9e', '#382a4c', '#c9bca8'] },
  { hash: 16277432, name: 'Honors of the Nine', palette: ['#f8f9fa', '#d8dde6', '#69d2e7', '#212529'] },
  { hash: 915277997, name: 'Bloody Tooth', palette: ['#1b1b20', '#96121b', '#383842', '#d6d6de'] },
  { hash: 1363705634, name: 'Amethyst Veil', palette: ['#13121a', '#5f3b8c', '#c7ccd9', '#242230'] },
];

const _tgxmCache = new Map();
const _jsonCache = new Map();
const _gearDefCache = new Map();
const _imageCache = new Map();
let _threePromise = null;

/* --------------------------------------------------------------------------
   THREE.JS LAZY LOADER
   -------------------------------------------------------------------------- */
export async function loadThreeModules() {
  if (_threePromise) return _threePromise;
  _threePromise = (async () => {
    try {
      const [THREE, controlsMod, envMod] = await Promise.all([
        import('three'),
        import('three/addons/controls/OrbitControls.js'),
        import('three/addons/environments/RoomEnvironment.js'),
      ]);
      return { THREE, OrbitControls: controlsMod.OrbitControls, RoomEnvironment: envMod.RoomEnvironment };
    } catch (primaryErr) {
      console.warn('[TGXM] Import-map (jsdelivr) load failed, falling back to esm.sh:', primaryErr);
      const [THREE, controlsMod, envMod] = await Promise.all([
        import('https://esm.sh/three@0.170.0'),
        import('https://esm.sh/three@0.170.0/examples/jsm/controls/OrbitControls.js'),
        import('https://esm.sh/three@0.170.0/examples/jsm/environments/RoomEnvironment.js'),
      ]);
      return { THREE, OrbitControls: controlsMod.OrbitControls, RoomEnvironment: envMod.RoomEnvironment };
    }
  })();
  _threePromise.catch(() => { _threePromise = null; });
  return _threePromise;
}

/* --------------------------------------------------------------------------
   TGXM CONTAINER PARSER
   -------------------------------------------------------------------------- */
export function parseTgxm(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.byteLength < 16) throw new Error('TGXM buffer too small');
  const view = new DataView(arrayBuffer);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'TGXM') throw new Error(`Invalid TGXM magic: ${magic}`);

  const version = view.getUint32(4, true);
  const headerOffset = view.getUint32(8, true);
  const fileCount = view.getUint32(12, true);
  const decoder = new TextDecoder('utf-8');
  const files = {};
  const fileList = [];

  for (let i = 0; i < fileCount; i++) {
    const entryBase = headerOffset + i * 272;
    if (entryBase + 272 > bytes.byteLength) break;
    let nameEnd = entryBase;
    while (nameEnd < entryBase + 256 && bytes[nameEnd] !== 0) nameEnd++;
    const name = decoder.decode(bytes.subarray(entryBase, nameEnd));
    const offset = view.getUint32(entryBase + 256, true);
    const type = view.getUint32(entryBase + 260, true);
    const size = view.getUint32(entryBase + 264, true);
    const end = Math.min(offset + size, bytes.byteLength);
    const entry = { name, offset, type, size: end - offset, buffer: arrayBuffer.slice(offset, end) };
    files[name] = entry;
    fileList.push(entry);
  }
  return { version, fileCount, files, fileList };
}

export function buildCdnUrl(kind, filePath, cdnMap) {
  if (filePath === undefined || filePath === null || filePath === '') return null;
  const fp = String(filePath);
  if (/^https?:\/\//i.test(fp)) return fp;
  if (fp.startsWith('/')) return `${BUNGIE_CDN_BASE}${fp}`;
  const prefix = String((cdnMap && cdnMap[kind]) || '').replace(/\/+$/, '');
  return `${BUNGIE_CDN_BASE}${prefix}/${fp}`;
}

async function fetchTgxmCached(url) {
  if (!url) return null;
  if (_tgxmCache.has(url)) return _tgxmCache.get(url);
  const p = fetch(url)
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
      return parseTgxm(await res.arrayBuffer());
    })
    .catch((err) => {
      _tgxmCache.delete(url);
      throw err;
    });
  _tgxmCache.set(url, p);
  return p;
}

async function fetchJsonCached(url) {
  if (!url) return null;
  if (_jsonCache.has(url)) return _jsonCache.get(url);
  const p = fetch(url)
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
      return JSON.parse(await res.text());
    })
    .catch((err) => {
      _jsonCache.delete(url);
      throw err;
    });
  _jsonCache.set(url, p);
  return p;
}

/* --------------------------------------------------------------------------
   BACKEND API HELPERS
   -------------------------------------------------------------------------- */
export async function fetchGear3DBatch(hashes) {
  const clean = [...new Set((hashes || []).map(Number).filter((h) => Number.isFinite(h) && h > 0))];
  const missing = clean.filter((h) => !_gearDefCache.has(String(h)));
  let cdn = null;

  if (missing.length > 0) {
    const res = await fetch('/api/bungie/gear-3d/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes: missing }),
    });
    if (!res.ok) throw new Error(`Failed to resolve 3D gear assets (HTTP ${res.status})`);
    const data = await res.json();
    cdn = data.cdn || null;
    const assets = data.assets || {};
    for (const h of missing) {
      const asset = assets[String(h)] || null;
      // Only cache positive results so transient failures can be retried.
      if (asset) _gearDefCache.set(String(h), { cdn: data.cdn, asset });
    }
    if (!cdn && missing.length) {
      throw new Error('3D asset server returned no CDN configuration');
    }
  }

  const out = {};
  for (const h of clean) {
    const cached = _gearDefCache.get(String(h));
    if (cached) {
      if (!cdn && cached.cdn) cdn = cached.cdn;
      out[String(h)] = cached.asset;
    }
  }
  return { cdn, assets: out };
}

export async function searchManifestShaders(query = '', limit = 40) {
  const url = `/api/bungie/shaders?q=${encodeURIComponent(query || '')}&limit=${encodeURIComponent(limit)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.shaders || [];
  } catch {
    return [];
  }
}

/* --------------------------------------------------------------------------
   INDEX SET RESOLUTION (indices -> CDN file names)
   -------------------------------------------------------------------------- */
export function pickMobileContent(asset) {
  const list = (asset && Array.isArray(asset.content)) ? asset.content : [];
  return list.find((c) => c && c.platform === 'mobile') || list[0] || null;
}

export function resolveRenderSets(content, genderType = 0) {
  if (!content) return [];
  const geomList = content.geometry || [];
  const texList = content.textures || [];
  const mapSet = (set) => ({
    geometry: (set?.geometry || []).map((i) => (typeof i === 'number' ? geomList[i] : i)).filter(Boolean),
    textures: (set?.textures || []).map((i) => (typeof i === 'number' ? texList[i] : i)).filter(Boolean),
  });

  const male = content.male_index_set;
  const female = content.female_index_set;
  if ((male && male.geometry?.length) || (female && female.geometry?.length)) {
    const preferred = Number(genderType) === 1 ? (female?.geometry?.length ? female : male) : (male?.geometry?.length ? male : female);
    return [mapSet(preferred)];
  }

  const regions = content.region_index_sets;
  if (regions && typeof regions === 'object') {
    const sets = [];
    const keys = Object.keys(regions).sort((a, b) => Number(a) - Number(b));
    for (const key of keys) {
      const variants = regions[key];
      const first = Array.isArray(variants) ? variants[0] : variants;
      if (first && Array.isArray(first.geometry) && first.geometry.length) {
        sets.push(mapSet(first));
      }
    }
    if (sets.length) return sets;
  }

  if (geomList.length) {
    return [{ geometry: [...geomList], textures: [...texList] }];
  }
  return [];
}

/* --------------------------------------------------------------------------
   GEOMETRY DECODING (pure JS, no THREE dependency)
   -------------------------------------------------------------------------- */
function isLodZeroPart(part) {
  const name = part?.lod_category?.name;
  if (typeof name === 'string' && name.startsWith('_lod_category_')) {
    return name.slice('_lod_category_'.length).includes('0');
  }
  const v = part?.lod_category?.value;
  return typeof v !== 'number' || v <= 3;
}

function readAttribute(dv, base, typeName, normalized) {
  const t = typeName || '';
  if (t.endsWith('float4')) return [dv.getFloat32(base, true), dv.getFloat32(base + 4, true), dv.getFloat32(base + 8, true), dv.getFloat32(base + 12, true)];
  if (t.endsWith('float3')) return [dv.getFloat32(base, true), dv.getFloat32(base + 4, true), dv.getFloat32(base + 8, true), 0];
  if (t.endsWith('float2')) return [dv.getFloat32(base, true), dv.getFloat32(base + 4, true), 0, 0];
  if (t.endsWith('ushort4')) {
    const s = normalized ? 65535 : 1;
    return [dv.getUint16(base, true) / s, dv.getUint16(base + 2, true) / s, dv.getUint16(base + 4, true) / s, dv.getUint16(base + 6, true) / s];
  }
  if (t.endsWith('short4')) {
    const s = normalized ? 32767 : 1;
    return [dv.getInt16(base, true) / s, dv.getInt16(base + 2, true) / s, dv.getInt16(base + 4, true) / s, dv.getInt16(base + 6, true) / s];
  }
  if (t.endsWith('ushort2')) {
    const s = normalized ? 65535 : 1;
    return [dv.getUint16(base, true) / s, dv.getUint16(base + 2, true) / s, 0, 0];
  }
  if (t.endsWith('short2')) {
    const s = normalized ? 32767 : 1;
    return [dv.getInt16(base, true) / s, dv.getInt16(base + 2, true) / s, 0, 0];
  }
  if (t.endsWith('ubyte4')) {
    const s = normalized ? 255 : 1;
    return [dv.getUint8(base) / s, dv.getUint8(base + 1) / s, dv.getUint8(base + 2) / s, dv.getUint8(base + 3) / s];
  }
  if (t.endsWith('byte4')) {
    const s = normalized ? 127 : 1;
    return [dv.getInt8(base) / s, dv.getInt8(base + 1) / s, dv.getInt8(base + 2) / s, dv.getInt8(base + 3) / s];
  }
  return null;
}

function attributeByteSize(el) {
  if (typeof el.size === 'number' && el.size > 0) return el.size;
  const t = el.type || '';
  if (t.endsWith('float4')) return 16;
  if (t.endsWith('float3')) return 12;
  if (t.endsWith('float2') || t.endsWith('short4')) return 8;
  if (t.endsWith('short2') || t.endsWith('byte4')) return 4;
  return 0;
}

/**
 * Decode one render mesh into Y-up positions/normals/uvs + per-dye-group triangle indices.
 * Destiny is Z-up / +X-forward; mapping (x, y, z) -> (y, z, x) is a cyclic permutation
 * (determinant +1), so triangle winding is preserved.
 */
export function decodeRenderMesh(container, mesh) {
  const files = container.files;
  const vbDefs = mesh.vertex_buffers || [];
  const layoutDefs = mesh.stage_part_vertex_stream_layout_definitions || [];
  const formats = (layoutDefs[0] && layoutDefs[0].formats) || [];

  const posScale = mesh.position_scale || [1, 1, 1];
  const posOffset = mesh.position_offset || [0, 0, 0];
  const uvSO = mesh.texcoord0_scale_offset
    || (mesh.texcoord_scale && mesh.texcoord_offset
      ? [mesh.texcoord_scale[0], mesh.texcoord_scale[1], mesh.texcoord_offset[0], mesh.texcoord_offset[1]]
      : [1, 1, 0, 0]);

  let vertexCount = 0;
  let positions = null;
  let normals = null;
  let uvs = null;

  for (let s = 0; s < formats.length; s++) {
    const fmt = formats[s];
    const vbDef = vbDefs[s];
    const entry = vbDef ? files[vbDef.file_name] : null;
    if (!entry) continue;
    const stride = (vbDef && vbDef.stride_byte_size) || fmt.stride;
    if (!stride) continue;
    const vCount = Math.floor(entry.size / stride);
    if (s === 0) vertexCount = vCount;
    const dv = new DataView(entry.buffer);

    let runningOffset = 0;
    for (const el of (fmt.elements || [])) {
      const elOffset = runningOffset;
      runningOffset += attributeByteSize(el);
      const sem = el.semantic || '';
      const typeName = el.type || '';
      const normalized = el.normalized !== false;
      const semIndex = el.semantic_index || 0;

      if (sem.endsWith('_position') && !positions) {
        positions = new Float32Array(vCount * 3);
        const isFloat = typeName.includes('float');
        for (let i = 0; i < vCount; i++) {
          const a = readAttribute(dv, i * stride + elOffset, typeName, isFloat ? false : true);
          if (!a) break;
          let x = a[0], y = a[1], z = a[2];
          if (!isFloat) {
            x = x * posScale[0] + posOffset[0];
            y = y * posScale[1] + posOffset[1];
            z = z * posScale[2] + posOffset[2];
          }
          positions[i * 3] = y;
          positions[i * 3 + 1] = z;
          positions[i * 3 + 2] = x;
        }
      } else if (sem.endsWith('_normal') && !normals) {
        normals = new Float32Array(vCount * 3);
        for (let i = 0; i < vCount; i++) {
          const a = readAttribute(dv, i * stride + elOffset, typeName, normalized);
          if (!a) break;
          const len = Math.hypot(a[0], a[1], a[2]) || 1;
          normals[i * 3] = a[1] / len;
          normals[i * 3 + 1] = a[2] / len;
          normals[i * 3 + 2] = a[0] / len;
        }
      } else if (sem.endsWith('_texcoord') && semIndex === 0 && !uvs) {
        uvs = new Float32Array(vCount * 2);
        const isFloat = typeName.includes('float');
        for (let i = 0; i < vCount; i++) {
          const a = readAttribute(dv, i * stride + elOffset, typeName, normalized);
          if (!a) break;
          uvs[i * 2] = isFloat ? a[0] : a[0] * uvSO[0] + uvSO[2];
          uvs[i * 2 + 1] = isFloat ? a[1] : a[1] * uvSO[1] + uvSO[3];
        }
      }
    }
  }

  // Index buffer for this mesh
  const ibDef = mesh.index_buffer || {};
  const ibEntry = files[ibDef.file_name];
  const groups = new Map(); // changeColorIndex -> number[]
  if (ibEntry && positions && vertexCount > 0) {
    const ibView = new DataView(ibEntry.buffer);
    const valueSize = ibDef.value_byte_size || 2;
    const maxIdxCount = Math.floor(ibEntry.size / valueSize);
    const restart = valueSize === 4 ? 0xffffffff : 0xffff;
    const readIdx = (k) => (valueSize === 4 ? ibView.getUint32(k * 4, true) : ibView.getUint16(k * 2, true));

    const offsets = mesh.stage_part_offsets || [];
    const allParts = mesh.stage_part_list || [];
    const s0Start = offsets.length ? offsets[0] : 0;
    const s0End = offsets.length > 1 ? offsets[1] : allParts.length;
    const stageParts = allParts.slice(s0Start, s0End).filter(isLodZeroPart);

    for (const part of stageParts) {
      const start = part.start_index || 0;
      const count = Math.min(part.index_count || 0, Math.max(0, maxIdxCount - start));
      const groupKey = Number(part.gear_dye_change_color_index || 0);
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      const out = groups.get(groupKey);

      if (part.primitive_type === 5) {
        let a = -1, b = -1, flip = false;
        for (let i = 0; i < count; i++) {
          const idx = readIdx(start + i);
          if (idx === restart || idx >= vertexCount) {
            a = -1; b = -1; flip = false;
            continue;
          }
          if (a < 0) { a = idx; continue; }
          if (b < 0) { b = idx; continue; }
          const c = idx;
          if (a !== b && b !== c && a !== c) {
            if (!flip) out.push(a, b, c);
            else out.push(b, a, c);
          }
          flip = !flip;
          a = b;
          b = c;
        }
      } else {
        for (let i = 0; i + 2 < count; i += 3) {
          const a = readIdx(start + i), b = readIdx(start + i + 1), c = readIdx(start + i + 2);
          if (a < vertexCount && b < vertexCount && c < vertexCount && a !== b && b !== c && a !== c) {
            out.push(a, b, c);
          }
        }
      }
    }
  }

  for (const [k, v] of groups) if (!v.length) groups.delete(k);
  return { vertexCount, positions, normals, uvs, groups };
}

export function readRenderMetadata(container) {
  const metaEntry = container.files['render_metadata.js'];
  if (!metaEntry) return null;
  const meta = JSON.parse(new TextDecoder('utf-8').decode(metaEntry.buffer));
  const meshes = (meta.render_model && meta.render_model.render_meshes) || meta.render_meshes || [];
  return { meta, meshes, plates: meta.texture_plates || [] };
}

/* --------------------------------------------------------------------------
   TEXTURES (plate compositing)
   -------------------------------------------------------------------------- */
function sniffImageMime(buffer) {
  const u8 = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  if (u8[0] === 0x89 && u8[1] === 0x50) return 'image/png';
  if (u8[0] === 0xff && u8[1] === 0xd8) return 'image/jpeg';
  return null;
}

function decodeImage(buffer) {
  const mime = sniffImageMime(buffer);
  if (!mime) return Promise.resolve(null);
  return new Promise((resolve) => {
    const objUrl = URL.createObjectURL(new Blob([buffer], { type: mime }));
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(objUrl); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(null); };
    img.src = objUrl;
  });
}

async function loadImagesFromTextureFiles(textureFiles, cdn) {
  const map = new Map();
  await Promise.all((textureFiles || []).map(async (tf) => {
    const url = buildCdnUrl('Texture', tf, cdn);
    if (!url) return;
    let container;
    try {
      container = await fetchTgxmCached(url);
    } catch (err) {
      console.warn('[TGXM] Texture container failed', tf, err);
      return;
    }
    await Promise.all(container.fileList.map(async (entry) => {
      const key = `${url}#${entry.name}`;
      if (!_imageCache.has(key)) _imageCache.set(key, decodeImage(entry.buffer));
      const img = await _imageCache.get(key);
      if (img) map.set(entry.name, img);
    }));
  }));
  return map;
}

const PLATE_KEYS = [
  ['diffuse', 0, [128, 128, 128, 255]],
  ['normal', 1, [128, 128, 255, 255]],
  ['gearstack', 2, [160, 128, 32, 200]],
  ['dyeslot', 3, [0, 0, 0, 255]],
];

function composePlateImage(plate, refPlate, imageMap, bg) {
  const placements = (plate && plate.texture_placements) || [];
  if (!placements.length) return null;

  // Single placement covering its whole plate -> use the image directly.
  const imgs = placements.map((p) => imageMap.get(p.texture_tag_name) || null);
  if (!imgs.some(Boolean)) return null;

  // Bungie sometimes declares a plate size larger than the placement coordinate space
  // (e.g. dyeslot 64px placement in a "256" plate). Normalise against the diffuse plate.
  let k = 1;
  const refPl = refPlate && refPlate.texture_placements && refPlate.texture_placements[0];
  if (refPl && refPlate.plate_size && plate.plate_size) {
    const refFrac = refPl.texture_size_x / refPlate.plate_size[0];
    const myFrac = placements[0].texture_size_x / plate.plate_size[0];
    if (refFrac > 0 && myFrac > 0) k = myFrac / refFrac;
  }
  const plateW = Math.max(1, Math.round(plate.plate_size[0] * k));
  const plateH = Math.max(1, Math.round(plate.plate_size[1] * k));

  if (placements.length === 1 && imgs[0]) {
    const p = placements[0];
    if (p.position_x === 0 && p.position_y === 0 && p.texture_size_x >= plateW && p.texture_size_y >= plateH) {
      return imgs[0];
    }
  }

  // Composite at the native resolution of the largest placed image.
  let res = 1;
  placements.forEach((p, i) => {
    const img = imgs[i];
    if (img && p.texture_size_x) res = Math.max(res, (img.naturalWidth || img.width) / p.texture_size_x);
  });
  res = Math.min(res, 4);
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(2048, Math.round(plateW * res));
  canvas.height = Math.min(2048, Math.round(plateH * res));
  const sx = canvas.width / plateW;
  const sy = canvas.height / plateH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = `rgba(${bg[0]},${bg[1]},${bg[2]},${bg[3] / 255})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  placements.forEach((p, i) => {
    const img = imgs[i];
    if (!img) return;
    ctx.drawImage(img, p.position_x * sx, p.position_y * sy, p.texture_size_x * sx, p.texture_size_y * sy);
  });
  return canvas;
}

function makeSolidTexture(THREE, rgba) {
  const tex = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

function buildPlateTextures(THREE, plates, imageMap) {
  const plate = (plates || []).find((p) => p && p.plate_set && p.plate_set.diffuse && (p.plate_set.diffuse.texture_placements || []).length)
    || (plates || []).find((p) => p && p.plate_set);
  const result = {};
  if (!plate) return result;
  const set = plate.plate_set;
  for (const [key, slot, bg] of PLATE_KEYS) {
    const source = composePlateImage(set[key], set.diffuse, imageMap, bg);
    if (!source) continue;
    const tex = new THREE.Texture(source);
    tex.flipY = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    if (slot === 0) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    result[slot] = tex;
  }
  return result;
}

/* --------------------------------------------------------------------------
   DYE (SHADER) RESOLUTION
   -------------------------------------------------------------------------- */
function pickBySlot(list, slot) {
  if (!Array.isArray(list) || !list.length) return null;
  return list.find((d) => Number(d.slot_type_index) === slot) || null;
}

/**
 * Resolve 3 dye slots for a dye group (0 armor, 1 weapon, ...).
 * Precedence: item locked_dyes > applied shader custom_dyes > item default_dyes.
 */
export function resolveDyeSlots(itemDyeData, shaderDyeData, changeColorIndex = 0) {
  const slots = [];
  const locked = (itemDyeData && itemDyeData.locked_dyes) || [];
  const defaults = (itemDyeData && itemDyeData.default_dyes) || [];
  let shaderGroup = [];
  if (shaderDyeData) {
    const pool = (shaderDyeData.custom_dyes && shaderDyeData.custom_dyes.length)
      ? shaderDyeData.custom_dyes
      : (shaderDyeData.default_dyes || []);
    if (pool.length > 3) {
      const g = Math.max(0, Number(changeColorIndex) || 0);
      const startIdx = g * 3 < pool.length ? g * 3 : 0;
      shaderGroup = pool.slice(startIdx, startIdx + 3);
    } else {
      shaderGroup = pool;
    }
  }
  for (let slot = 0; slot < 3; slot++) {
    const d = pickBySlot(locked, slot)
      || (shaderGroup.length ? (pickBySlot(shaderGroup, slot) || shaderGroup[slot]) : null)
      || pickBySlot(defaults, slot)
      || defaults[slot]
      || null;
    slots.push(d);
  }
  return slots;
}

const FALLBACK_TINTS = [
  { p: [0.35, 0.36, 0.38], s: [0.12, 0.12, 0.13] },
  { p: [0.10, 0.10, 0.11], s: [0.20, 0.20, 0.22] },
  { p: [0.25, 0.25, 0.26], s: [0.08, 0.08, 0.09] },
];

function writeDyeUniforms(uniforms, slots) {
  for (let i = 0; i < 3; i++) {
    const props = (slots[i] && slots[i].material_properties) || null;
    const fb = FALLBACK_TINTS[i];
    const p = props?.primary_albedo_tint || fb.p;
    const s = props?.secondary_albedo_tint || fb.s;
    const wp = props?.primary_worn_albedo_tint || props?.worn_albedo_tint || p;
    const e = props?.primary_emissive_tint_color || [0, 0, 0];
    uniforms.uDyePrim.value[i].set(p[0], p[1], p[2]);
    uniforms.uDyeSec.value[i].set(s[0], s[1], s[2]);
    uniforms.uDyeWorn.value[i].set(wp[0], wp[1], wp[2]);
    uniforms.uDyeEmis.value[i].set(e[0], e[1], e[2]);
  }
}

/* --------------------------------------------------------------------------
   MATERIAL (MeshStandardMaterial + Destiny dye injection)
   -------------------------------------------------------------------------- */
function createDestinyGearMaterial(THREE, textures, itemDyeData, changeColorIndex, placeholders) {
  const uniforms = {
    uDyePrim: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uDyeSec: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uDyeWorn: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uDyeEmis: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uGearstackMap: { value: textures[2] || placeholders.gearstack },
    uDyeslotMap: { value: textures[3] || placeholders.dyeslot },
    uHasGearstack: { value: textures[2] ? 1.0 : 0.0 },
  };
  writeDyeUniforms(uniforms, resolveDyeSlots(itemDyeData, null, changeColorIndex));

  const mat = new THREE.MeshStandardMaterial({
    map: textures[0] || placeholders.diffuse,
    normalMap: textures[1] || null,
    roughness: 0.55,
    metalness: 0.35,
    side: THREE.DoubleSide,
  });
  mat.userData.dyeUniforms = uniforms;
  mat.userData.itemDyeData = itemDyeData;
  mat.userData.changeColorIndex = changeColorIndex;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uGearstackMap;
        uniform sampler2D uDyeslotMap;
        uniform float uHasGearstack;
        uniform vec3 uDyePrim[3];
        uniform vec3 uDyeSec[3];
        uniform vec3 uDyeWorn[3];
        uniform vec3 uDyeEmis[3];
        vec4 d2Gst;
        vec4 d2Dsl;
        vec3 d2Emis;
        `
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        d2Gst = texture2D(uGearstackMap, vMapUv);
        d2Dsl = texture2D(uDyeslotMap, vMapUv);
        {
          // Dyeslot plate colour-codes slots: black = slot 0, red = slot 1, yellow = slot 2.
          float w2 = d2Dsl.r * d2Dsl.g;
          float w1 = d2Dsl.r * (1.0 - d2Dsl.g);
          float w0 = 1.0 - d2Dsl.r;
          vec3 prim = uDyePrim[0] * w0 + uDyePrim[1] * w1 + uDyePrim[2] * w2;
          vec3 sec = uDyeSec[0] * w0 + uDyeSec[1] * w1 + uDyeSec[2] * w2;
          vec3 worn = uDyeWorn[0] * w0 + uDyeWorn[1] * w1 + uDyeWorn[2] * w2;
          d2Emis = uDyeEmis[0] * w0 + uDyeEmis[1] * w1 + uDyeEmis[2] * w2;
          vec3 tint = mix(prim, sec, clamp(1.0 - d2Dsl.a, 0.0, 1.0));
          // Edge wear from gearstack alpha (low alpha = worn edges).
          float wear = uHasGearstack > 0.5 ? smoothstep(0.42, 0.18, d2Gst.a) * 0.55 : 0.0;
          tint = mix(tint, worn, wear);
          // Diffuse plate is a grayscale detail map centred on mid-grey.
          float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          float detail = pow(max(lum, 0.0), 0.4545) * 2.0;
          diffuseColor.rgb = clamp(tint * detail, 0.0, 1.0);
        }
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        if (uHasGearstack > 0.5) {
          roughnessFactor = clamp(1.0 - d2Gst.a * 0.72, 0.18, 0.95);
        }
        `
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        if (uHasGearstack > 0.5) {
          metalnessFactor = clamp(d2Gst.r * 0.8, 0.0, 0.9);
        }
        `
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (uHasGearstack > 0.5) {
          totalEmissiveRadiance += d2Emis * smoothstep(0.22, 0.65, d2Gst.b) * 2.5;
        }
        `
      );
  };
  return mat;
}

function applyShaderDyeToMaterial(mat, shaderDyeData) {
  if (!mat || !mat.userData || !mat.userData.dyeUniforms) return;
  writeDyeUniforms(
    mat.userData.dyeUniforms,
    resolveDyeSlots(mat.userData.itemDyeData, shaderDyeData || null, mat.userData.changeColorIndex)
  );
}

/* --------------------------------------------------------------------------
   ITEM -> THREE.Group BUILDER
   -------------------------------------------------------------------------- */
function getPlaceholders(THREE) {
  if (!getPlaceholders._cache) {
    getPlaceholders._cache = {
      diffuse: makeSolidTexture(THREE, [128, 128, 128, 255]),
      gearstack: makeSolidTexture(THREE, [160, 128, 32, 200]),
      dyeslot: makeSolidTexture(THREE, [0, 0, 0, 255]),
    };
  }
  return getPlaceholders._cache;
}

async function buildItemGroup(THREE, itemHash, asset, cdn, genderType = 0) {
  const content = pickMobileContent(asset);
  if (!content) return { group: null, reason: 'no mobile content entry' };
  const renderSets = resolveRenderSets(content, genderType);
  if (!renderSets.length) return { group: null, reason: 'no geometry index sets' };

  let itemDyeData = null;
  if (Array.isArray(asset.gear) && asset.gear.length) {
    try {
      itemDyeData = await fetchJsonCached(buildCdnUrl('Gear', asset.gear[0], cdn));
    } catch (err) {
      console.warn('[TGXM] Gear dye file unavailable for', itemHash, err);
    }
  }

  const placeholders = getPlaceholders(THREE);
  const itemGroup = new THREE.Group();
  itemGroup.name = `gear_${itemHash}`;
  const materials = [];
  let triangleCount = 0;

  await Promise.all(renderSets.map(async (set) => {
    const imageMap = await loadImagesFromTextureFiles(set.textures, cdn);

    await Promise.all(set.geometry.map(async (geomFile) => {
      let container;
      try {
        container = await fetchTgxmCached(buildCdnUrl('Geometry', geomFile, cdn));
      } catch (err) {
        console.warn('[TGXM] Geometry fetch failed', geomFile, err);
        return;
      }
      const md = readRenderMetadata(container);
      if (!md || !md.meshes.length) return;
      const textures = buildPlateTextures(THREE, md.plates, imageMap);

      for (const rMesh of md.meshes) {
        let decoded;
        try {
          decoded = decodeRenderMesh(container, rMesh);
        } catch (err) {
          console.warn('[TGXM] Mesh decode failed', geomFile, err);
          continue;
        }
        if (!decoded.positions || !decoded.groups.size) continue;

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(decoded.positions, 3));
        if (decoded.normals) geo.setAttribute('normal', new THREE.BufferAttribute(decoded.normals, 3));
        if (decoded.uvs) geo.setAttribute('uv', new THREE.BufferAttribute(decoded.uvs, 2));

        const allIdx = [];
        const meshMaterials = [];
        for (const [changeColorIndex, idx] of decoded.groups) {
          geo.addGroup(allIdx.length, idx.length, meshMaterials.length);
          for (let k = 0; k < idx.length; k++) allIdx.push(idx[k]);
          const mat = createDestinyGearMaterial(THREE, textures, itemDyeData, changeColorIndex, placeholders);
          meshMaterials.push(mat);
          materials.push(mat);
        }
        geo.setIndex(allIdx);
        if (!decoded.normals) geo.computeVertexNormals();
        geo.computeBoundingSphere();
        triangleCount += allIdx.length / 3;

        const mesh = new THREE.Mesh(geo, meshMaterials);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        itemGroup.add(mesh);
      }
    }));
  }));

  if (!itemGroup.children.length) return { group: null, reason: 'geometry contained no renderable LOD0 parts' };
  itemGroup.userData.materials = materials;
  itemGroup.userData.itemDyeData = itemDyeData;
  itemGroup.userData.triangleCount = triangleCount;
  return { group: itemGroup, reason: null };
}

/* --------------------------------------------------------------------------
   STAGE CONTROLLER
   -------------------------------------------------------------------------- */
const SUBCLASS_AURA_COLORS = {
  solar: 0xff6a1a,
  arc: 0x3ad7ff,
  void: 0xa44dff,
  stasis: 0x4b8bff,
  strand: 0x2cff92,
  prismatic: 0xff7be5,
  default: 0x8b6eff,
};

function disposeObjectTree(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
    }
  });
}

export class Destiny3DStage {
  constructor(containerEl, options = {}) {
    this.container = containerEl;
    this.options = options;
    this.THREE = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.rootGroup = null;
    this.weaponGroup = null;
    this.pedestal = null;
    this.auraRing = null;
    this.rimLight = null;
    this.slotGroups = new Map();
    this.autoRotate = options.autoRotate !== undefined ? Boolean(options.autoRotate) : true;
    this.auraEnabled = true;
    this.disposed = false;
    this.lastError = null;
    this._rafId = null;
    this._resizeObserver = null;
    this._clockTime = 0;
    this._envTarget = null;
  }

  async init() {
    if (this.scene) return;
    const { THREE, OrbitControls, RoomEnvironment } = await loadThreeModules();
    if (this.disposed) return;
    this.THREE = THREE;

    const width = Math.max(this.container.clientWidth || 640, 200);
    const height = Math.max(this.container.clientHeight || 480, 200);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d14);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(34, width / height, 0.01, 60);
    camera.position.set(0.35, 1.15, 2.75);
    this.camera = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.innerHTML = '';
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;

    // Image-based lighting so metallic Destiny surfaces read correctly.
    if (RoomEnvironment) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      this._envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
      scene.environment = this._envTarget.texture;
      scene.environmentIntensity = 0.55;
      pmrem.dispose();
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.08;
    controls.maxDistance = 8;
    controls.target.set(0, 0.96, 0);
    controls.autoRotate = this.autoRotate;
    controls.autoRotateSpeed = 1.1;
    this.controls = controls;

    scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x1a1d29, 0.9));
    const keyLight = new THREE.DirectionalLight(0xfff3e4, 2.0);
    keyLight.position.set(2.4, 3.6, 3.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x8fb3ff, 0.8);
    fillLight.position.set(-2.6, 1.8, 1.4);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xa44dff, 1.4);
    rimLight.position.set(-0.5, 2.6, -2.8);
    scene.add(rimLight);
    this.rimLight = rimLight;

    // Pedestal (only shown in full-Guardian mode)
    const pedestal = new THREE.Group();
    const floorGeo = new THREE.CircleGeometry(1.45, 64);
    floorGeo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: 0x111521, roughness: 0.75, metalness: 0.3 }));
    floor.receiveShadow = true;
    pedestal.add(floor);
    const ringGeo = new THREE.RingGeometry(0.68, 0.715, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xa44dff, transparent: true, opacity: 0.58, side: THREE.DoubleSide }));
    ring.position.y = 0.004;
    pedestal.add(ring);
    scene.add(pedestal);
    this.pedestal = pedestal;
    this.auraRing = ring;

    this.rootGroup = new THREE.Group();
    scene.add(this.rootGroup);
    this.weaponGroup = new THREE.Group();
    this.rootGroup.add(this.weaponGroup);

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this.resize());
      this._resizeObserver.observe(this.container);
    }

    const animate = () => {
      if (this.disposed) return;
      this._rafId = requestAnimationFrame(animate);
      this._clockTime += 0.016;
      if (this.rootGroup && this.pedestal && this.pedestal.visible) {
        this.rootGroup.position.y = Math.sin(this._clockTime * 1.6) * 0.004;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
  }

  resize() {
    if (!this.renderer || !this.camera || !this.container) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  setAutoRotate(enabled) {
    this.autoRotate = Boolean(enabled);
    if (this.controls) this.controls.autoRotate = this.autoRotate;
  }

  setSubclassAura(elementName = 'default', enabled = true) {
    this.auraEnabled = Boolean(enabled);
    const hex = SUBCLASS_AURA_COLORS[String(elementName || 'default').toLowerCase()] || SUBCLASS_AURA_COLORS.default;
    if (this.auraRing) {
      this.auraRing.visible = this.auraEnabled;
      this.auraRing.material.color.setHex(hex);
    }
    if (this.rimLight) {
      this.rimLight.color.setHex(hex);
      this.rimLight.intensity = this.auraEnabled ? 1.5 : 0.6;
    }
  }

  setCameraPreset(preset) {
    if (!this.camera || !this.controls) return;
    if (preset === 'upper') {
      this.camera.position.set(0.3, 1.5, 1.35);
      this.controls.target.set(0, 1.4, 0);
    } else if (preset === 'weapon') {
      const w = this.slotGroups.get('weapon');
      if (w && w.group) {
        this.frameObject(w.group, 'side');
        return;
      }
      this.camera.position.set(0.55, 1.05, 1.45);
      this.controls.target.set(0.18, 0.98, 0.12);
    } else {
      this.camera.position.set(0.38, 1.12, 2.75);
      this.controls.target.set(0, 0.96, 0);
    }
    this.controls.update();
  }

  /** Frame an object. mode 'side' looks perpendicular to its longest horizontal axis (weapons). */
  frameObject(obj, mode = 'auto') {
    const THREE = this.THREE;
    if (!THREE || !obj) return;
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.05);
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (radius / Math.sin(fov / 2)) * 1.05;

    let dir;
    if (mode === 'side' || size.z > size.x * 1.4) {
      // Long along Z (weapon barrels after Destiny->Three mapping): view from +X side.
      dir = size.z >= size.x ? new THREE.Vector3(1, 0.22, 0.18) : new THREE.Vector3(0.18, 0.22, 1);
    } else {
      dir = new THREE.Vector3(0.35, 0.18, 1);
    }
    dir.normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.005, dist / 100);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = radius * 0.4;
    this.controls.maxDistance = dist * 4;
    this.controls.update();
  }

  clearModels() {
    if (!this.rootGroup || !this.THREE) return;
    disposeObjectTree(this.rootGroup);
    while (this.rootGroup.children.length) this.rootGroup.remove(this.rootGroup.children[0]);
    this.weaponGroup = new this.THREE.Group();
    this.rootGroup.add(this.weaponGroup);
    this.slotGroups.clear();
  }

  async _buildFromCandidates(candidateHashes, assets, cdn, genderType) {
    let lastReason = 'no 3D asset published for this item';
    for (const h of candidateHashes) {
      if (!h) continue;
      const asset = assets[String(h)];
      if (!asset) continue;
      const { group, reason } = await buildItemGroup(this.THREE, h, asset, cdn, genderType);
      if (group) return { group, usedHash: h, reason: null };
      lastReason = reason || lastReason;
    }
    return { group: null, usedHash: null, reason: lastReason };
  }

  /**
   * Full Guardian armor assembly (+ optional showcase weapon).
   * slots: [{ slotKey, label, itemHash, overrideStyleItemHash, shaderHash }]
   */
  async loadGuardianAssembly({ slots, genderType = 0, subclass = 'default', showcaseWeapon = null, onProgress }) {
    await this.init();
    if (this.disposed) return { loaded: [], failed: [] };
    this.clearModels();
    if (this.pedestal) this.pedestal.visible = true;
    this.setSubclassAura(subclass, this.auraEnabled);

    const hashes = [];
    for (const s of slots) hashes.push(s.overrideStyleItemHash, s.itemHash, s.shaderHash);
    if (showcaseWeapon) hashes.push(showcaseWeapon.overrideStyleItemHash, showcaseWeapon.itemHash, showcaseWeapon.shaderHash);

    if (onProgress) onProgress('Fetching Destiny 3D manifest pointers…');
    const { cdn, assets } = await fetchGear3DBatch(hashes.filter(Boolean));
    if (this.disposed) return { loaded: [], failed: [] };

    const loaded = [];
    const failed = [];
    if (onProgress) onProgress('Downloading armor meshes & textures from Bungie…');

    const results = await Promise.all(slots.map(async (slot) => {
      try {
        const r = await this._buildFromCandidates([slot.overrideStyleItemHash, slot.itemHash], assets, cdn, genderType);
        return { slot, ...r };
      } catch (err) {
        console.warn('[TGXM] Slot build error:', slot.slotKey, err);
        return { slot, group: null, reason: err.message };
      }
    }));
    if (this.disposed) return { loaded: [], failed: [] };

    for (const { slot, group, usedHash, reason } of results) {
      if (group) {
        this.rootGroup.add(group);
        this.slotGroups.set(slot.slotKey, { group, itemHash: usedHash, shaderHash: null });
        loaded.push(slot.slotKey);
      } else {
        failed.push(slot.slotKey);
        console.warn('[TGXM] No 3D for', slot.slotKey, reason);
      }
    }

    if (onProgress) onProgress('Applying equipped shaders…');
    await Promise.all(results.filter((r) => r.group && r.slot.shaderHash).map((r) =>
      this.applyShaderToSlot(r.slot.slotKey, r.slot.shaderHash, cdn, assets).catch(() => {})
    ));

    if (showcaseWeapon && (showcaseWeapon.overrideStyleItemHash || showcaseWeapon.itemHash)) {
      if (onProgress) onProgress(`Loading ${showcaseWeapon.name || 'weapon'}…`);
      await this.setShowcaseWeapon(showcaseWeapon, { cdn, assets });
    }

    this.setCameraPreset('full');
    return { loaded, failed };
  }

  async setShowcaseWeapon(weaponItem, prefetched = null) {
    if (!this.THREE || !this.weaponGroup) return false;
    disposeObjectTree(this.weaponGroup);
    while (this.weaponGroup.children.length) this.weaponGroup.remove(this.weaponGroup.children[0]);
    this.slotGroups.delete('weapon');
    if (!weaponItem) return false;

    const hashes = [weaponItem.overrideStyleItemHash, weaponItem.itemHash, weaponItem.shaderHash].filter(Boolean);
    const { cdn, assets } = prefetched && hashes.every((h) => prefetched.assets[String(h)] || h === weaponItem.shaderHash)
      ? prefetched
      : await fetchGear3DBatch(hashes);

    const { group, usedHash } = await this._buildFromCandidates([weaponItem.overrideStyleItemHash, weaponItem.itemHash], assets, cdn, 0);
    if (!group || this.disposed) return false;

    // Hold beside the Guardian: barrel pointing forward, scaled to a believable size.
    const THREE = this.THREE;
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z, 0.01);
    const scale = longest > 1.4 ? 1.0 / longest : 1.0;
    const holder = new THREE.Group();
    group.position.sub(center);
    holder.add(group);
    holder.scale.setScalar(scale);
    holder.position.set(-0.42, 1.0, 0.22);
    holder.rotation.set(0, 0, 0.05);
    this.weaponGroup.add(holder);
    this.slotGroups.set('weapon', { group, itemHash: usedHash, shaderHash: null });

    if (weaponItem.shaderHash) {
      await this.applyShaderToSlot('weapon', weaponItem.shaderHash, cdn, assets).catch(() => {});
    }
    return true;
  }

  /** Single weapon / armor piece centred on stage (companion-app style inspect). */
  async loadSingleItem(item, genderType = 0, onProgress = null) {
    await this.init();
    if (this.disposed) return false;
    this.clearModels();
    if (this.pedestal) this.pedestal.visible = false;
    this.lastError = null;

    const hashes = [item.overrideStyleItemHash, item.itemHash, item.shaderHash].filter(Boolean);
    if (onProgress) onProgress('Fetching 3D asset pointers from Bungie…');
    const { cdn, assets } = await fetchGear3DBatch(hashes);
    if (this.disposed) return false;

    if (onProgress) onProgress('Downloading mesh & textures…');
    const { group, usedHash, reason } = await this._buildFromCandidates([item.overrideStyleItemHash, item.itemHash], assets, cdn, genderType);
    if (!group || this.disposed) {
      this.lastError = reason;
      return false;
    }

    this.rootGroup.add(group);
    this.slotGroups.set('single', { group, itemHash: usedHash, shaderHash: null });
    if (item.shaderHash) {
      if (onProgress) onProgress('Applying shader…');
      await this.applyShaderToSlot('single', item.shaderHash, cdn, assets).catch(() => {});
    }
    const isWeapon = String(item.category || '').toLowerCase() === 'weapon';
    this.frameObject(group, isWeapon ? 'side' : 'auto');
    return true;
  }

  async applyShaderToSlot(slotKey, shaderHash, prefetchedCdn = null, prefetchedAssets = null) {
    const entry = this.slotGroups.get(slotKey);
    if (!entry || !entry.group) return;
    const mats = entry.group.userData.materials || [];

    if (!shaderHash) {
      mats.forEach((m) => applyShaderDyeToMaterial(m, null));
      entry.shaderHash = null;
      return;
    }

    let cdn = prefetchedCdn;
    let assets = prefetchedAssets;
    if (!assets || !assets[String(shaderHash)]) {
      ({ cdn, assets } = await fetchGear3DBatch([shaderHash]));
    }
    const shaderAsset = assets[String(shaderHash)];
    if (!shaderAsset || !Array.isArray(shaderAsset.gear) || !shaderAsset.gear.length) return;
    const shaderDyeData = await fetchJsonCached(buildCdnUrl('Gear', shaderAsset.gear[0], cdn));
    mats.forEach((m) => applyShaderDyeToMaterial(m, shaderDyeData));
    entry.shaderHash = Number(shaderHash);
  }

  async applyShaderToSlots(slotKeys, shaderHash) {
    const keys = (slotKeys || []).filter((k) => this.slotGroups.has(k));
    if (!keys.length) return;
    const { cdn, assets } = shaderHash ? await fetchGear3DBatch([shaderHash]) : { cdn: null, assets: {} };
    await Promise.all(keys.map((k) => this.applyShaderToSlot(k, shaderHash, cdn, assets)));
  }

  dispose() {
    this.disposed = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this.clearModels();
    if (this.controls) this.controls.dispose();
    if (this._envTarget) this._envTarget.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      const el = this.renderer.domElement;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    this.scene = null;
    this.renderer = null;
    this.controls = null;
  }
}
