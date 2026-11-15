/**
 * F.E.L.I.C.I.A. Native Bungie 3D Engine (TGXM + Destiny Dye Shader Pipeline)
 * Renders authentic Bungie DestinyGearAssetsDefinition meshes (.tgxm),
 * textures (.tgxm.bin), and shader dyes (/geometry/gear/*.js) in Three.js.
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
const _jsonJsCache = new Map();
const _gearDefCache = new Map();
const _textureCache = new Map();
let _threePromise = null;

export async function loadThreeModules() {
  if (_threePromise) return _threePromise;
  _threePromise = (async () => {
    try {
      const [THREE, controlsMod] = await Promise.all([
        import('https://esm.sh/three@0.170.0'),
        import('https://esm.sh/three@0.170.0/examples/jsm/controls/OrbitControls.js'),
      ]);
      return { THREE, OrbitControls: controlsMod.OrbitControls };
    } catch (primaryErr) {
      console.warn('[TGXM] esm.sh import failed, falling back to jsdelivr:', primaryErr);
      const [THREE, controlsMod] = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js'),
        import('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js'),
      ]);
      return { THREE, OrbitControls: controlsMod.OrbitControls };
    }
  })();
  return _threePromise;
}

/**
 * Parse a binary .tgxm or .tgxm.bin container from Bungie CDN.
 * Header (16 bytes LE): magic "TGXM", version (u32), headerOffset (u32), fileCount (u32)
 * File table entries (272 bytes each): name (256B UTF-8 null-term), offset (u32), type (u32), size (u32)
 */
export function parseTgxm(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.byteLength < 16) {
    throw new Error('TGXM buffer too small');
  }
  const view = new DataView(arrayBuffer);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'TGXM') {
    throw new Error(`Invalid TGXM magic: ${magic}`);
  }
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
    while (nameEnd < entryBase + 256 && bytes[nameEnd] !== 0) {
      nameEnd++;
    }
    const name = decoder.decode(bytes.subarray(entryBase, nameEnd));
    const offset = view.getUint32(entryBase + 256, true);
    const type = view.getUint32(entryBase + 260, true);
    const size = view.getUint32(entryBase + 264, true);

    const end = Math.min(offset + size, bytes.byteLength);
    const slice = arrayBuffer.slice(offset, end);
    const entry = { name, offset, type, size, buffer: slice };
    files[name] = entry;
    fileList.push(entry);
  }

  return { version, fileCount, files, fileList };
}

function buildCdnUrl(basePath, filePath, cdnMap) {
  if (!filePath) return null;
  if (/^https?:\/\//i.test(filePath)) return filePath;
  if (filePath.startsWith('/')) return `${BUNGIE_CDN_BASE}${filePath}`;
  const prefix = (cdnMap && cdnMap[basePath]) || '';
  return `${BUNGIE_CDN_BASE}${prefix}${filePath}`;
}

async function fetchTgxmCached(url) {
  if (!url) return null;
  if (_tgxmCache.has(url)) return _tgxmCache.get(url);
  const p = fetch(url)
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
      const buf = await res.arrayBuffer();
      return parseTgxm(buf);
    })
    .catch((err) => {
      _tgxmCache.delete(url);
      throw err;
    });
  _tgxmCache.set(url, p);
  return p;
}

async function fetchGearJsCached(url) {
  if (!url) return null;
  if (_jsonJsCache.has(url)) return _jsonJsCache.get(url);
  const p = fetch(url)
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
      const text = await res.text();
      return JSON.parse(text);
    })
    .catch((err) => {
      _jsonJsCache.delete(url);
      throw err;
    });
  _jsonJsCache.set(url, p);
  return p;
}

export async function fetchGear3DBatch(hashes) {
  const clean = [...new Set((hashes || []).map((h) => Number(h)).filter((h) => Number.isFinite(h) && h > 0))];
  const missing = clean.filter((h) => !_gearDefCache.has(String(h)));
  let cdn = null;

  if (missing.length > 0) {
    const res = await fetch('/api/bungie/gear-3d/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes: missing }),
    });
    if (!res.ok) {
      throw new Error(`Failed to resolve 3D gear assets (${res.status})`);
    }
    const data = await res.json();
    cdn = data.cdn || null;
    const assets = data.assets || {};
    for (const h of missing) {
      _gearDefCache.set(String(h), {
        cdn: data.cdn,
        asset: assets[String(h)] || null,
      });
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
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.shaders || [];
}

function sniffImageMime(buffer, name) {
  const u8 = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
  if (u8.length >= 4 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
    return 'image/png';
  }
  if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
    return 'image/jpeg';
  }
  const lower = (name || '').toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'image/png';
}

function bufferToImage(buffer, name) {
  return new Promise((resolve, reject) => {
    const mime = sniffImageMime(buffer, name);
    const blob = new Blob([buffer], { type: mime });
    const objUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(objUrl);
      reject(e);
    };
    img.src = objUrl;
  });
}

function classifyTextureSlot(filename) {
  const lower = filename.toLowerCase();
  // Format typically "<id>_<plate>_<slot>.png/jpg" or "..._0.jpg", "..._1.png", "..._2.png", "..._3.png"
  if (/_0\.(jpg|jpeg|png)$/i.test(lower) || /diffuse/i.test(lower)) return 0; // diffuse
  if (/_1\.(jpg|jpeg|png)$/i.test(lower) || /normal/i.test(lower)) return 1; // normal
  if (/_2\.(jpg|jpeg|png)$/i.test(lower) || /gearstack/i.test(lower)) return 2; // gearstack (R=smoothness, G=wear, B=metalness)
  if (/_3\.(jpg|jpeg|png)$/i.test(lower) || /dyeslot/i.test(lower)) return 3; // dyeslot
  return -1;
}

async function loadTexturesFromContainer(THREE, texUrl, cdn, plateInfo, isSRGBSlots = [0]) {
  const cacheKey = `${texUrl}::${plateInfo ? JSON.stringify(plateInfo) : 'raw'}`;
  if (_textureCache.has(cacheKey)) return _textureCache.get(cacheKey);

  const promise = (async () => {
    const parsed = await fetchTgxmCached(texUrl);
    if (!parsed) return {};

    // Collect images grouped by slot index (0=diffuse, 1=normal, 2=gearstack, 3=dyeslot)
    const slotImages = { 0: [], 1: [], 2: [], 3: [] };
    await Promise.all(
      parsed.fileList.map(async (entry) => {
        if (!/\.(png|jpg|jpeg)$/i.test(entry.name)) return;
        const slot = classifyTextureSlot(entry.name);
        if (slot < 0) return;
        try {
          const img = await bufferToImage(entry.buffer, entry.name);
          slotImages[slot].push({ name: entry.name, img });
        } catch (err) {
          console.warn('[TGXM] Failed decoding texture', entry.name, err);
        }
      })
    );

    // Build Three.js Texture for each slot
    const result = {};
    for (const slot of [0, 1, 2, 3]) {
      const imgs = slotImages[slot];
      if (!imgs.length) continue;

      // Sort deterministically
      imgs.sort((a, b) => a.name.localeCompare(b.name));
      const base = imgs[0].img;

      let tex;
      if (imgs.length === 1) {
        tex = new THREE.Texture(base);
      } else {
        // Composite plate pieces if multiple parts share the slot
        const canvas = document.createElement('canvas');
        canvas.width = base.naturalWidth || base.width || 512;
        canvas.height = base.naturalHeight || base.height || 512;
        const ctx = canvas.getContext('2d');
        for (const item of imgs) {
          ctx.drawImage(item.img, 0, 0, canvas.width, canvas.height);
        }
        tex = new THREE.Texture(canvas);
      }

      tex.flipY = false;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      if (isSRGBSlots.includes(slot)) {
        tex.colorSpace = THREE.SRGBColorSpace;
      }
      tex.needsUpdate = true;
      result[slot] = tex;
    }

    return result;
  })();

  _textureCache.set(cacheKey, promise);
  return promise;
}

/**
 * Decode Bungie vertex buffer streams dynamically using render_metadata.js layout definitions.
 */
function decodeVertexStreams(metadata, mesh, files) {
  const layouts = metadata.stage_part_vertex_stream_layout_definitions || [];
  const layout = layouts[mesh.stage_part_vertex_stream_layout_index || 0] || layouts[0];
  const formats = (layout && layout.formats) || [];

  const scalePos = mesh.position_scale || [1, 1, 1];
  const offsetPos = mesh.position_offset || [0, 0, 0];
  const uvScaleOffset = mesh.texcoord0_scale_offset || [1, 1, 0, 0];

  // Collect all vertex buffers present for this mesh's streams
  const vbEntries = Object.values(files)
    .filter((f) => /\.vertexbuffer\.tgx$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!vbEntries.length) {
    throw new Error('No vertex buffer found in TGXM');
  }

  let vertexCount = 0;
  let positions = null;
  let normals = null;
  let normalW = null;
  let uvs = null;

  // Match format blocks to vertex buffers (usually stream 0 = pos/norm/tan, stream 1 = uv)
  for (let s = 0; s < formats.length; s++) {
    const fmt = formats[s];
    // Find matching vertex buffer (prefix e.g. 0.0.vertexbuffer.tgx or s-th entry)
    const vbEntry =
      files[`0.${s}.vertexbuffer.tgx`] ||
      vbEntries.find((e) => e.name.endsWith(`.${s}.vertexbuffer.tgx`)) ||
      vbEntries[s];
    if (!vbEntry) continue;

    const stride = fmt.stride || 32;
    const vCount = Math.floor(vbEntry.size / stride);
    if (vCount <= 0) continue;
    if (s === 0 || vCount > vertexCount) vertexCount = vCount;

    const dv = new DataView(vbEntry.buffer);
    const elements = fmt.elements || [];

    for (const el of elements) {
      const semantic = el.semantic || '';
      const typeName = el.type || '';
      const elOffset = el.offset || 0;

      if (semantic.includes('position')) {
        positions = new Float32Array(vCount * 3);
        const isFloat4 = typeName.includes('float4') || typeName.includes('float3');
        const isShort4 = typeName.includes('short4');

        for (let i = 0; i < vCount; i++) {
          const base = i * stride + elOffset;
          let xd, yd, zd;
          if (isFloat4) {
            xd = dv.getFloat32(base, true);
            yd = dv.getFloat32(base + 4, true);
            zd = dv.getFloat32(base + 8, true);
          } else if (isShort4) {
            xd = (dv.getInt16(base, true) / 32767.0) * scalePos[0] + offsetPos[0];
            yd = (dv.getInt16(base + 2, true) / 32767.0) * scalePos[1] + offsetPos[1];
            zd = (dv.getInt16(base + 4, true) / 32767.0) * scalePos[2] + offsetPos[2];
          } else {
            xd = dv.getFloat32(base, true);
            yd = dv.getFloat32(base + 4, true);
            zd = dv.getFloat32(base + 8, true);
          }
          // Destiny Z-up/+X-forward -> Three.js Y-up/+Z-forward: (x_d2, y_d2, z_d2) -> (y_d2, z_d2, x_d2)
          // Determinant is +1, preserving triangle winding!
          positions[i * 3 + 0] = yd;
          positions[i * 3 + 1] = zd;
          positions[i * 3 + 2] = xd;
        }
      } else if (semantic.includes('normal')) {
        normals = new Float32Array(vCount * 3);
        normalW = new Float32Array(vCount);
        const isFloat4 = typeName.includes('float4') || typeName.includes('float3');
        const isShort4 = typeName.includes('short4');
        const isByte4 = typeName.includes('byte4');

        for (let i = 0; i < vCount; i++) {
          const base = i * stride + elOffset;
          let nx = 0, ny = 0, nz = 1, nw = 0;
          if (isFloat4) {
            nx = dv.getFloat32(base, true);
            ny = dv.getFloat32(base + 4, true);
            nz = dv.getFloat32(base + 8, true);
            if (typeName.includes('float4')) nw = dv.getFloat32(base + 12, true);
          } else if (isShort4) {
            nx = dv.getInt16(base, true) / 32767.0;
            ny = dv.getInt16(base + 2, true) / 32767.0;
            nz = dv.getInt16(base + 4, true) / 32767.0;
            nw = dv.getInt16(base + 6, true) / 32767.0;
          } else if (isByte4) {
            nx = (dv.getInt8(base) / 127.0);
            ny = (dv.getInt8(base + 1) / 127.0);
            nz = (dv.getInt8(base + 2) / 127.0);
            nw = (dv.getInt8(base + 3) / 127.0);
          }
          const len = Math.hypot(nx, ny, nz) || 1;
          normals[i * 3 + 0] = ny / len;
          normals[i * 3 + 1] = nz / len;
          normals[i * 3 + 2] = nx / len;
          normalW[i] = nw;
        }
      } else if (semantic.includes('texcoord') && (!uvs || semantic.endsWith('texcoord') || semantic.endsWith('texcoord0'))) {
        uvs = new Float32Array(vCount * 2);
        const isShort2 = typeName.includes('short2');
        const isFloat2 = typeName.includes('float2');
        const [sx, sy, ox, oy] = uvScaleOffset;

        for (let i = 0; i < vCount; i++) {
          const base = i * stride + elOffset;
          let u = 0, v = 0;
          if (isShort2) {
            u = (dv.getInt16(base, true) / 32767.0) * sx + ox;
            v = (dv.getInt16(base + 2, true) / 32767.0) * sy + oy;
          } else if (isFloat2) {
            u = dv.getFloat32(base, true);
            v = dv.getFloat32(base + 4, true);
          }
          uvs[i * 2 + 0] = u;
          uvs[i * 2 + 1] = v;
        }
      }
    }
  }

  return { vertexCount, positions, normals, normalW, uvs };
}

/**
 * Decode triangle strip or triangle list indices for Stage 0 lowest-LOD parts.
 * Handles 0xFFFF / 0xFFFFFFFF strip restart markers and skips degenerate triangles.
 */
function buildPartTriangles(part, indexView, indexByteSize, vertexCount) {
  const start = part.start_index || 0;
  const count = part.index_count || 0;
  const primType = part.primitive_type;
  const out = [];

  const readIdx = (idxOffset) =>
    indexByteSize === 4 ? indexView.getUint32(idxOffset * 4, true) : indexView.getUint16(idxOffset * 2, true);

  if (primType === 5) {
    // Triangle strip with 0xFFFF restart sentinel
    let a = -1;
    let b = -1;
    let flip = false;

    for (let i = 0; i < count; i++) {
      const idx = readIdx(start + i);
      if (idx === 0xffff || idx === 0xffffffff || idx >= vertexCount) {
        a = -1;
        b = -1;
        flip = false;
        continue;
      }
      if (a < 0) {
        a = idx;
        continue;
      }
      if (b < 0) {
        b = idx;
        continue;
      }
      const c = idx;
      if (a !== b && b !== c && a !== c) {
        if (!flip) {
          out.push(a, b, c);
        } else {
          out.push(b, a, c);
        }
      }
      flip = !flip;
      a = b;
      b = c;
    }
  } else {
    // Standard triangle list (primitive_type === 3 or fallback)
    for (let i = 0; i + 2 < count; i += 3) {
      const a = readIdx(start + i);
      const b = readIdx(start + i + 1);
      const c = readIdx(start + i + 2);
      if (a < vertexCount && b < vertexCount && c < vertexCount && a !== b && b !== c && a !== c) {
        out.push(a, b, c);
      }
    }
  }

  return out;
}

/**
 * Select matching dye entry from shader/default dye arrays.
 * Each dye slot maps (dyeIndex 0=armor/weapon primary, 1=secondary, 2=tertiary/detail) + cloth flag.
 */
function resolveDyeEntry(dyeList, slotTypeIndex, isCloth) {
  if (!Array.isArray(dyeList) || !dyeList.length) return null;
  // Exact match (slot + cloth)
  const exact = dyeList.find(
    (d) => Number(d.slot_type_index) === slotTypeIndex && Boolean(d.cloth) === Boolean(isCloth)
  );
  if (exact) return exact;
  // Same slot fallback
  const sameSlot = dyeList.find((d) => Number(d.slot_type_index) === slotTypeIndex);
  if (sameSlot) return sameSlot;
  return dyeList[0];
}

function arr4ToVec4(THREE, arr, fallback = [0.5, 0.5, 0.5, 1]) {
  const a = Array.isArray(arr) && arr.length >= 3 ? arr : fallback;
  return new THREE.Vector4(
    a[0] ?? fallback[0],
    a[1] ?? fallback[1],
    a[2] ?? fallback[2],
    a[3] ?? fallback[3]
  );
}

function buildDyeUniforms(THREE, dyeDef, isShaderOverride = false) {
  const customDyes = (dyeDef && dyeDef.custom_dyes) || [];
  const defaultDyes = (dyeDef && dyeDef.default_dyes) || [];
  const lockedDyes = (dyeDef && dyeDef.locked_dyes) || [];

  const pool = isShaderOverride
    ? customDyes.length
      ? customDyes
      : defaultDyes
    : defaultDyes.length
      ? defaultDyes
      : customDyes.length
        ? customDyes
        : lockedDyes;

  // Prepare 6 dye slots: 0,1,2 Armor/Weapon Plate/Metal + 3,4,5 Cloth
  const primColors = [];
  const secColors = [];
  const wornPrimColors = [];
  const wornSecColors = [];
  const matParams = [];

  for (let i = 0; i < 6; i++) {
    const slotType = i % 3;
    const isCloth = i >= 3;
    const d = resolveDyeEntry(pool, slotType, isCloth);
    const props = (d && d.material_properties) || {};

    primColors.push(arr4ToVec4(THREE, props.primary_albedo_tint, [0.42, 0.44, 0.48, 1.0]));
    secColors.push(arr4ToVec4(THREE, props.secondary_albedo_tint, [0.24, 0.26, 0.30, 1.0]));
    wornPrimColors.push(arr4ToVec4(THREE, props.primary_worn_albedo_tint, [0.30, 0.32, 0.35, 1.0]));
    wornSecColors.push(arr4ToVec4(THREE, props.secondary_worn_albedo_tint, [0.20, 0.21, 0.24, 1.0]));
    matParams.push(arr4ToVec4(THREE, props.primary_material_params, [0.5, 0.35, 0.45, 0.0]));
  }

  return {
    uDyePrim: { value: primColors },
    uDyeSec: { value: secColors },
    uDyeWornPrim: { value: wornPrimColors },
    uDyeWornSec: { value: wornSecColors },
    uDyeParams: { value: matParams },
    uDyeEnabled: { value: pool.length > 0 ? 1.0 : 0.0 },
  };
}

/**
 * Create a MeshStandardMaterial augmented via onBeforeCompile with Bungie's
 * diffuse + gearstack + dyeslot channel blending so shaders can be hot-swapped live on the GPU.
 */
function createDestinyGearMaterial(THREE, textures, defaultDyeData) {
  const uniforms = buildDyeUniforms(THREE, defaultDyeData, false);

  const mat = new THREE.MeshStandardMaterial({
    map: textures[0] || null,
    normalMap: textures[1] || null,
    roughness: 0.52,
    metalness: 0.45,
    side: THREE.DoubleSide,
  });

  uniforms.uGearstackMap = { value: textures[2] || null };
  uniforms.uHasGearstack = { value: textures[2] ? 1.0 : 0.0 };
  uniforms.uDyeslotMap = { value: textures[3] || null };
  uniforms.uHasDyeslot = { value: textures[3] ? 1.0 : 0.0 };

  mat.userData.dyeUniforms = uniforms;
  mat.userData.defaultDyeData = defaultDyeData;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      uniform sampler2D uGearstackMap;
      uniform float uHasGearstack;
      uniform sampler2D uDyeslotMap;
      uniform float uHasDyeslot;
      uniform vec4 uDyePrim[6];
      uniform vec4 uDyeSec[6];
      uniform vec4 uDyeWornPrim[6];
      uniform vec4 uDyeWornSec[6];
      uniform vec4 uDyeParams[6];
      uniform float uDyeEnabled;
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      #ifdef USE_MAP
      if (uDyeEnabled > 0.5 && uHasDyeslot > 0.5) {
        vec4 dSlot = texture2D(uDyeslotMap, vMapUv);
        vec4 gStack = uHasGearstack > 0.5 ? texture2D(uGearstackMap, vMapUv) : vec4(0.5, 1.0, 0.35, 0.0);

        // Select dye channel based on dyeslot green/blue/alpha encoding
        int sIdx = 0;
        float chanVal = dSlot.g;
        if (chanVal > 0.66) sIdx = 2;
        else if (chanVal > 0.33) sIdx = 1;
        // Cloth shift when blue > 0.5 or high cloth mask
        if (dSlot.b > 0.5) sIdx += 3;

        vec4 cPrim = uDyePrim[0];
        vec4 cSec = uDyeSec[0];
        vec4 cWPrim = uDyeWornPrim[0];
        vec4 cWSec = uDyeWornSec[0];
        if (sIdx == 1) { cPrim = uDyePrim[1]; cSec = uDyeSec[1]; cWPrim = uDyeWornPrim[1]; cWSec = uDyeWornSec[1]; }
        else if (sIdx == 2) { cPrim = uDyePrim[2]; cSec = uDyeSec[2]; cWPrim = uDyeWornPrim[2]; cWSec = uDyeWornSec[2]; }
        else if (sIdx == 3) { cPrim = uDyePrim[3]; cSec = uDyeSec[3]; cWPrim = uDyeWornPrim[3]; cWSec = uDyeWornSec[3]; }
        else if (sIdx == 4) { cPrim = uDyePrim[4]; cSec = uDyeSec[4]; cWPrim = uDyeWornPrim[4]; cWSec = uDyeWornSec[4]; }
        else if (sIdx == 5) { cPrim = uDyePrim[5]; cSec = uDyeSec[5]; cWPrim = uDyeWornPrim[5]; cWSec = uDyeWornSec[5]; }

        float secMask = smoothstep(0.15, 0.85, dSlot.r);
        float wear = 1.0 - clamp(gStack.g, 0.0, 1.0);
        vec3 baseTint = mix(cPrim.rgb, cSec.rgb, secMask);
        vec3 wornTint = mix(cWPrim.rgb, cWSec.rgb, secMask);
        vec3 dyeRgb = mix(baseTint, wornTint, wear * 0.65);

        float dyeMask = smoothstep(0.05, 0.45, dSlot.a);
        vec3 detailBase = diffuseColor.rgb;
        // Preserve grayscale surface contrast while applying Destiny shader tint
        vec3 tinted = detailBase * dyeRgb * 1.85;
        diffuseColor.rgb = mix(detailBase, clamp(tinted, 0.0, 1.0), dyeMask);
      }
      #endif
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
      if (uHasGearstack > 0.5) {
        vec4 gsR = texture2D(uGearstackMap, vMapUv);
        roughnessFactor = clamp(1.0 - gsR.r * 0.85, 0.14, 0.94);
      }
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
      if (uHasGearstack > 0.5) {
        vec4 gsM = texture2D(uGearstackMap, vMapUv);
        metalnessFactor = clamp(gsM.b * 0.92, 0.05, 0.96);
      }
      `
    );
  };

  return mat;
}

function applyDyeToMaterial(THREE, mat, dyeDef, isShaderOverride) {
  if (!mat || !mat.userData || !mat.userData.dyeUniforms) return;
  const uniforms = mat.userData.dyeUniforms;
  const effectiveDef = dyeDef || mat.userData.defaultDyeData;
  const updated = buildDyeUniforms(THREE, effectiveDef, isShaderOverride && Boolean(dyeDef));

  for (const key of ['uDyePrim', 'uDyeSec', 'uDyeWornPrim', 'uDyeWornSec', 'uDyeParams']) {
    for (let i = 0; i < 6; i++) {
      uniforms[key].value[i].copy(updated[key].value[i]);
    }
  }
  uniforms.uDyeEnabled.value = updated.uDyeEnabled.value;
}

/**
 * Load & construct Three.js meshes for one Destiny item hash from resolved gear assets.
 */
async function buildItemGroup(THREE, itemHash, assetEntry, cdn, genderType = 0) {
  if (!assetEntry || !Array.isArray(assetEntry.content) || !assetEntry.content.length) {
    return null;
  }
  const content = assetEntry.content[0];

  // Fetch gear shader/dye JS definition
  let defaultDyeData = null;
  const gearFiles = assetEntry.gear || [];
  if (gearFiles.length) {
    const gearUrl = buildCdnUrl('Gear', gearFiles[0], cdn);
    try {
      defaultDyeData = await fetchGearJsCached(gearUrl);
    } catch (err) {
      console.warn('[TGXM] Gear JS fetch skipped for', itemHash, err);
    }
  }

  // Pick index set: female_index_set (genderType === 1), male_index_set (0), or region_index_sets (weapons)
  const candidates = [];
  const femaleSet = content.female_index_set;
  const maleSet = content.male_index_set;
  const primarySet = genderType === 1 && femaleSet && femaleSet.geometry?.length ? femaleSet : maleSet;

  if (primarySet && Array.isArray(primarySet.geometry) && primarySet.geometry.length) {
    candidates.push({
      geometry: primarySet.geometry,
      textures: primarySet.textures || [],
    });
  } else if (Array.isArray(content.region_index_sets) && content.region_index_sets.length) {
    for (const regionObj of content.region_index_sets) {
      if (!regionObj || typeof regionObj !== 'object') continue;
      for (const regionKey of Object.keys(regionObj)) {
        const list = regionObj[regionKey];
        if (Array.isArray(list) && list.length && Array.isArray(list[0].geometry) && list[0].geometry.length) {
          candidates.push({
            geometry: list[0].geometry,
            textures: list[0].textures || [],
          });
        }
      }
    }
  }

  if (!candidates.length) {
    return null;
  }

  const platePlacements = (defaultDyeData && defaultDyeData.plate_placements) || null;
  const itemGroup = new THREE.Group();
  itemGroup.name = `gear_${itemHash}`;
  const materials = [];

  for (const cand of candidates) {
    // Load textures for this candidate
    let mergedTextures = {};
    for (const texFile of cand.textures) {
      const texUrl = buildCdnUrl('Texture', texFile, cdn);
      try {
        const loaded = await loadTexturesFromContainer(THREE, texUrl, cdn, platePlacements);
        mergedTextures = { ...mergedTextures, ...loaded };
      } catch (err) {
        console.warn('[TGXM] Texture container error:', texFile, err);
      }
    }

    const material = createDestinyGearMaterial(THREE, mergedTextures, defaultDyeData);
    materials.push(material);

    // Load geometry containers
    for (const geomFile of cand.geometry) {
      const geomUrl = buildCdnUrl('Geometry', geomFile, cdn);
      let geomContainer;
      try {
        geomContainer = await fetchTgxmCached(geomUrl);
      } catch (err) {
        console.warn('[TGXM] Geometry fetch error:', geomFile, err);
        continue;
      }

      const metaEntry = geomContainer.files['render_metadata.js'];
      if (!metaEntry) continue;
      const metadata = JSON.parse(new TextDecoder('utf-8').decode(metaEntry.buffer));
      const renderMeshes = metadata.render_meshes || [];

      const indexEntry =
        geomContainer.files['0.indexbuffer.tgx'] ||
        geomContainer.fileList.find((f) => /\.indexbuffer\.tgx$/i.test(f.name));
      if (!indexEntry) continue;
      const indexView = new DataView(indexEntry.buffer);

      for (const rMesh of renderMeshes) {
        const decoded = decodeVertexStreams(metadata, rMesh, geomContainer.files);
        if (!decoded.positions || !decoded.vertexCount) continue;

        const stageOffsets = rMesh.stage_part_offsets || [];
        const s0Start = stageOffsets[0] ?? 0;
        const s0End = stageOffsets[1] ?? (rMesh.stage_part_list ? rMesh.stage_part_list.length : 0);
        const parts = (rMesh.stage_part_list || []).slice(s0Start, s0End);
        if (!parts.length) continue;

        // Only draw lowest LOD category inside Stage 0 so we don't duplicate shadow/LOD meshes
        let minLod = Infinity;
        for (const p of parts) {
          const val = p.lod_category && typeof p.lod_category.value === 'number' ? p.lod_category.value : 0;
          if (val < minLod) minLod = val;
        }

        const idxByteSize = (rMesh.index_buffer_metadata && rMesh.index_buffer_metadata.value_byte_size) || 2;
        const triIndices = [];
        for (const p of parts) {
          const lodVal = p.lod_category && typeof p.lod_category.value === 'number' ? p.lod_category.value : 0;
          if (lodVal !== minLod) continue;
          // Skip physics/collision/invisible overlay flags if shader_type indicates non-visual
          const partTris = buildPartTriangles(p, indexView, idxByteSize, decoded.vertexCount);
          for (let k = 0; k < partTris.length; k++) {
            triIndices.push(partTris[k]);
          }
        }

        if (!triIndices.length) continue;

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(decoded.positions, 3));
        if (decoded.normals) {
          geo.setAttribute('normal', new THREE.BufferAttribute(decoded.normals, 3));
        }
        if (decoded.uvs) {
          geo.setAttribute('uv', new THREE.BufferAttribute(decoded.uvs, 2));
        }
        geo.setIndex(triIndices);
        if (!decoded.normals) {
          geo.computeVertexNormals();
        }
        geo.computeBoundingSphere();

        const mesh = new THREE.Mesh(geo, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        itemGroup.add(mesh);
      }
    }
  }

  if (itemGroup.children.length === 0) {
    return null;
  }

  itemGroup.userData.materials = materials;
  itemGroup.userData.defaultDyeData = defaultDyeData;
  return itemGroup;
}

const SUBCLASS_AURA_COLORS = {
  solar: 0xff6a1a,
  arc: 0x3ad7ff,
  void: 0xa44dff,
  stasis: 0x4b8bff,
  strand: 0x2cff92,
  prismatic: 0xff7be5,
  default: 0x8b6eff,
};

/**
 * Reusable interactive Three.js 3D Viewport Controller for single gear OR full-body Guardian.
 */
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
    this.auraRing = null;
    this.keyLight = null;
    this.rimLight = null;
    this.slotGroups = new Map(); // slotKey -> { group, itemHash, shaderHash }
    this.autoRotate = options.autoRotate !== undefined ? Boolean(options.autoRotate) : true;
    this.auraEnabled = true;
    this.disposed = false;
    this._rafId = null;
    this._resizeObserver = null;
    this._clockTime = 0;
  }

  async init() {
    if (this.scene) return;
    const { THREE, OrbitControls } = await loadThreeModules();
    if (this.disposed) return;

    this.THREE = THREE;
    const width = Math.max(this.container.clientWidth || 640, 200);
    const height = Math.max(this.container.clientHeight || 480, 200);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d14);
    scene.fog = new THREE.FogExp2(0x0b0d14, 0.08);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(34, width / height, 0.05, 50);
    camera.position.set(0.35, 1.15, 2.75);
    this.camera = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.container.innerHTML = '';
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 0.35;
    controls.maxDistance = 6.5;
    controls.target.set(0, 0.96, 0);
    controls.autoRotate = this.autoRotate;
    controls.autoRotateSpeed = 0.85;
    this.controls = controls;

    // Bungie Destiny-style 3-point tactical studio lighting
    const hemi = new THREE.HemisphereLight(0xcdd9ff, 0x161926, 1.05);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff5e8, 2.2);
    keyLight.position.set(2.4, 3.6, 3.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    scene.add(keyLight);
    this.keyLight = keyLight;

    const fillLight = new THREE.DirectionalLight(0x6e9eff, 1.05);
    fillLight.position.set(-2.6, 1.8, 1.4);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xa44dff, 1.65);
    rimLight.position.set(-0.5, 2.6, -2.8);
    scene.add(rimLight);
    this.rimLight = rimLight;

    // Pedestal floor & tactical ring
    const floorGeo = new THREE.CircleGeometry(1.45, 64);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x111521,
      roughness: 0.72,
      metalness: 0.35,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    const ringGeo = new THREE.RingGeometry(0.68, 0.715, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xa44dff,
      transparent: true,
      opacity: 0.58,
      side: THREE.DoubleSide,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.y = 0.004;
    scene.add(ringMesh);
    this.auraRing = ringMesh;

    this.rootGroup = new THREE.Group();
    scene.add(this.rootGroup);

    this.weaponGroup = new THREE.Group();
    this.rootGroup.add(this.weaponGroup);

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.container);

    const animate = () => {
      if (this.disposed) return;
      this._rafId = requestAnimationFrame(animate);
      this._clockTime += 0.016;
      if (this.rootGroup && this.slotGroups.size > 1) {
        // Subtle Destiny Character Screen idle breath
        this.rootGroup.position.y = Math.sin(this._clockTime * 1.6) * 0.006;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
  }

  resize() {
    if (!this.renderer || !this.camera || !this.container) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  setAutoRotate(enabled) {
    this.autoRotate = Boolean(enabled);
    if (this.controls) {
      this.controls.autoRotate = this.autoRotate;
    }
  }

  setSubclassAura(elementName = 'default', enabled = true) {
    this.auraEnabled = Boolean(enabled);
    const key = String(elementName || 'default').toLowerCase();
    const hex = SUBCLASS_AURA_COLORS[key] || SUBCLASS_AURA_COLORS.default;
    if (this.auraRing) {
      this.auraRing.visible = this.auraEnabled;
      this.auraRing.material.color.setHex(hex);
    }
    if (this.rimLight) {
      this.rimLight.color.setHex(hex);
      this.rimLight.intensity = this.auraEnabled ? 1.75 : 0.75;
    }
  }

  setCameraPreset(preset) {
    if (!this.camera || !this.controls) return;
    if (preset === 'upper') {
      this.camera.position.set(0.28, 1.48, 1.42);
      this.controls.target.set(0, 1.38, 0);
    } else if (preset === 'weapon') {
      this.camera.position.set(0.55, 1.05, 1.45);
      this.controls.target.set(0.18, 0.98, 0.12);
    } else if (preset === 'single') {
      // Computed dynamically from bounds
      this.frameGroup(this.rootGroup);
    } else {
      // 'full'
      this.camera.position.set(0.38, 1.12, 2.75);
      this.controls.target.set(0, 0.96, 0);
    }
    this.controls.update();
  }

  frameGroup(group) {
    if (!this.THREE || !this.camera || !this.controls || !group) return;
    const box = new this.THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return;
    const size = new this.THREE.Vector3();
    const center = new this.THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z, 0.25);
    const dist = maxDim * 1.85;
    this.controls.target.copy(center);
    this.camera.position.set(center.x + dist * 0.45, center.y + dist * 0.18, center.z + dist * 0.9);
    this.controls.update();
  }

  clearModels() {
    if (!this.rootGroup) return;
    const disposeNode = (obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    };
    this.rootGroup.traverse(disposeNode);
    while (this.rootGroup.children.length > 0) {
      this.rootGroup.remove(this.rootGroup.children[0]);
    }
    this.weaponGroup = new this.THREE.Group();
    this.rootGroup.add(this.weaponGroup);
    this.slotGroups.clear();
  }

  /**
   * Load full Guardian armor assembly (+ optional showcase weapon beside/in hand).
   * slots: [{ slotKey, label, itemHash, overrideStyleItemHash, shaderHash }]
   */
  async loadGuardianAssembly({ slots, genderType = 0, subclass = 'default', showcaseWeapon = null, onProgress }) {
    await this.init();
    if (this.disposed) return { loaded: [], failed: [] };
    this.clearModels();
    this.setSubclassAura(subclass, this.auraEnabled);

    if (this.auraRing) this.auraRing.visible = this.auraEnabled;

    const hashes = [];
    for (const s of slots) {
      if (s.overrideStyleItemHash) hashes.push(s.overrideStyleItemHash);
      if (s.itemHash) hashes.push(s.itemHash);
      if (s.shaderHash) hashes.push(s.shaderHash);
    }
    if (showcaseWeapon) {
      if (showcaseWeapon.overrideStyleItemHash) hashes.push(showcaseWeapon.overrideStyleItemHash);
      if (showcaseWeapon.itemHash) hashes.push(showcaseWeapon.itemHash);
      if (showcaseWeapon.shaderHash) hashes.push(showcaseWeapon.shaderHash);
    }

    if (onProgress) onProgress('Fetching Destiny 3D manifest pointers…');
    const { cdn, assets } = await fetchGear3DBatch(hashes);
    if (this.disposed) return { loaded: [], failed: [] };

    const loaded = [];
    const failed = [];

    for (const slot of slots) {
      if (this.disposed) break;
      const primaryHash = slot.overrideStyleItemHash || slot.itemHash;
      const fallbackHash = slot.itemHash;
      if (onProgress) onProgress(`Loading ${slot.label || slot.slotKey} 3D mesh…`);

      let group = null;
      let usedHash = primaryHash;
      try {
        if (primaryHash && assets[String(primaryHash)]) {
          group = await buildItemGroup(this.THREE, primaryHash, assets[String(primaryHash)], cdn, genderType);
        }
        if (!group && fallbackHash && fallbackHash !== primaryHash && assets[String(fallbackHash)]) {
          usedHash = fallbackHash;
          group = await buildItemGroup(this.THREE, fallbackHash, assets[String(fallbackHash)], cdn, genderType);
        }
      } catch (err) {
        console.warn('[TGXM] Slot build error:', slot.slotKey, err);
      }

      if (group) {
        this.rootGroup.add(group);
        this.slotGroups.set(slot.slotKey, { group, itemHash: usedHash, shaderHash: slot.shaderHash || null });
        if (slot.shaderHash) {
          await this.applyShaderToSlot(slot.slotKey, slot.shaderHash, cdn, assets);
        }
        loaded.push(slot.slotKey);
      } else {
        failed.push(slot.slotKey);
      }
    }

    if (showcaseWeapon && (showcaseWeapon.overrideStyleItemHash || showcaseWeapon.itemHash)) {
      if (onProgress) onProgress(`Loading ${showcaseWeapon.name || 'Weapon'}…`);
      await this.setShowcaseWeapon(showcaseWeapon, { cdn, assets });
    }

    this.setCameraPreset('full');
    return { loaded, failed };
  }

  async setShowcaseWeapon(weaponItem, prefetched = null) {
    if (!this.THREE || !this.weaponGroup) return false;
    // Clear existing showcase weapon
    this.weaponGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    while (this.weaponGroup.children.length > 0) {
      this.weaponGroup.remove(this.weaponGroup.children[0]);
    }
    this.slotGroups.delete('weapon');

    if (!weaponItem) return false;
    const hashes = [weaponItem.overrideStyleItemHash, weaponItem.itemHash, weaponItem.shaderHash].filter(Boolean);
    const { cdn, assets } = prefetched || (await fetchGear3DBatch(hashes));

    const primaryHash = weaponItem.overrideStyleItemHash || weaponItem.itemHash;
    let group = null;
    let usedHash = primaryHash;

    if (primaryHash && assets[String(primaryHash)]) {
      group = await buildItemGroup(this.THREE, primaryHash, assets[String(primaryHash)], cdn, 0);
    }
    if (!group && weaponItem.itemHash && weaponItem.itemHash !== primaryHash && assets[String(weaponItem.itemHash)]) {
      usedHash = weaponItem.itemHash;
      group = await buildItemGroup(this.THREE, weaponItem.itemHash, assets[String(weaponItem.itemHash)], cdn, 0);
    }
    if (!group) return false;

    // Position weapon beside right hip/hand like Destiny inspection pose
    const box = new this.THREE.Box3().setFromObject(group);
    const size = new this.THREE.Vector3();
    box.getSize(size);
    const targetScale = size.length() > 1.6 ? 0.88 / size.length() : 0.85;
    group.scale.setScalar(targetScale);
    group.position.set(-0.34, 1.02, 0.14);
    group.rotation.set(0.18, Math.PI * 0.42, -0.35);

    this.weaponGroup.add(group);
    this.slotGroups.set('weapon', { group, itemHash: usedHash, shaderHash: weaponItem.shaderHash || null });

    if (weaponItem.shaderHash) {
      await this.applyShaderToSlot('weapon', weaponItem.shaderHash, cdn, assets);
    }
    return true;
  }

  /**
   * Load a single weapon, exotic armor piece, sparrow, etc. centered on stage.
   */
  async loadSingleItem(item, genderType = 0, onProgress = null) {
    await this.init();
    if (this.disposed) return false;
    this.clearModels();
    if (this.auraRing) this.auraRing.visible = false;

    const hashes = [item.overrideStyleItemHash, item.itemHash, item.shaderHash].filter(Boolean);
    if (onProgress) onProgress('Fetching 3D model geometry from Bungie…');
    const { cdn, assets } = await fetchGear3DBatch(hashes);
    if (this.disposed) return false;

    const primaryHash = item.overrideStyleItemHash || item.itemHash;
    let group = null;
    let usedHash = primaryHash;

    if (primaryHash && assets[String(primaryHash)]) {
      group = await buildItemGroup(this.THREE, primaryHash, assets[String(primaryHash)], cdn, genderType);
    }
    if (!group && item.itemHash && item.itemHash !== primaryHash && assets[String(item.itemHash)]) {
      usedHash = item.itemHash;
      group = await buildItemGroup(this.THREE, item.itemHash, assets[String(item.itemHash)], cdn, genderType);
    }
    if (!group) return false;

    this.rootGroup.add(group);
    this.slotGroups.set('single', { group, itemHash: usedHash, shaderHash: item.shaderHash || null });

    if (item.shaderHash) {
      await this.applyShaderToSlot('single', item.shaderHash, cdn, assets);
    }

    this.frameGroup(group);
    return true;
  }

  async applyShaderToSlot(slotKey, shaderHash, prefetchedCdn = null, prefetchedAssets = null) {
    if (!this.THREE) return;
    const entry = this.slotGroups.get(slotKey);
    if (!entry || !entry.group) return;

    if (!shaderHash) {
      // Revert to item's default dye
      for (const m of entry.group.userData.materials || []) {
        applyDyeToMaterial(this.THREE, m, null, false);
      }
      entry.shaderHash = null;
      return;
    }

    const { cdn, assets } =
      prefetchedAssets && prefetchedAssets[String(shaderHash)]
        ? { cdn: prefetchedCdn, assets: prefetchedAssets }
        : await fetchGear3DBatch([shaderHash]);

    const shaderAsset = assets[String(shaderHash)];
    if (!shaderAsset || !shaderAsset.gear || !shaderAsset.gear.length) return;

    const gearUrl = buildCdnUrl('Gear', shaderAsset.gear[0], cdn);
    const shaderDyeData = await fetchGearJsCached(gearUrl);
    for (const m of entry.group.userData.materials || []) {
      applyDyeToMaterial(this.THREE, m, shaderDyeData, true);
    }
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
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }
    this.scene = null;
    this.renderer = null;
    this.controls = null;
  }
}
