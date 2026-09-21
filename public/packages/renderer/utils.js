export const MAX_DIMENSION = 4096;
export const MAX_PIXELS = 8_388_608;
export const SUPPORTED_TYPES = new Set(['Source', 'Constant', 'Grade', 'Blur', 'Transform', 'Merge', 'ChromaKey', 'Roto', 'Glow', 'Noise', 'Vignette', 'Sharpen', 'Invert', 'Crop', 'Premultiply', 'Unpremultiply', 'ColorMatrix', 'Text', 'Viewer']);

export function finite(value, fallback = 0, min = -1e6, max = 1e6) {
  if (value === null || value === undefined || typeof value === 'symbol') return fallback;
  let n; try { n = typeof value === 'number' ? value : Number(value); } catch { return fallback; }
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
export function clamp(n, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, n)); }
export function boundedDimensions(width, height, proxy = 1, limit = MAX_DIMENSION) {
  const w = finite(width, 960, 1, 32768), h = finite(height, 540, 1, 32768);
  const divisor = finite(proxy, 1, 1, 64);
  const scale = Math.min(1 / divisor, limit / w, limit / h, Math.sqrt(MAX_PIXELS / (w * h)));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}
export function parseColor(value, fallback = [0, 0, 0, 1]) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return [0, 1, 2, 3].map(i => finite(value[i], i === 3 ? 1 : (fallback[i] ?? 0), 0, 1));
  }
  if (typeof value !== 'string') return [...fallback];
  let s = value.trim().toLowerCase();
  const names = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', transparent: '#00000000', yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff' };
  s = names[s] || s;
  if (/^#[0-9a-f]{3,4}$/.test(s)) s = '#' + [...s.slice(1)].map(c => c + c).join('');
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(s)) return [1, 3, 5, 7].map((p, i) => i === 3 && s.length === 7 ? 1 : parseInt(s.slice(p, p + 2), 16) / 255);
  const m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/);
  if (m) return [clamp(Number(m[1]) / 255), clamp(Number(m[2]) / 255), clamp(Number(m[3]) / 255), m[4] === undefined ? 1 : clamp(Number(m[4]))];
  return [...fallback];
}
export function vector3(value, fallback) {
  if (Array.isArray(value)) return [0, 1, 2].map(i => finite(value[i], fallback));
  return Array(3).fill(finite(value, fallback));
}
function interpolate(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return finite(a + (b - a) * t, a);
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => interpolate(v, b[i] ?? v, t));
  return t < 1 ? a : b;
}
export function evaluateKeyframes(keys, frame, fallback) {
  if (!Array.isArray(keys)) return fallback;
  const sorted = keys.filter(k => k && Number.isFinite(finite(k.frame, NaN, -1e9, 1e9)) && k.value !== undefined).map(k => ({ ...k, frame: finite(k.frame, 0, -1e9, 1e9) })).sort((a, b) => a.frame - b.frame);
  if (!sorted.length) return fallback;
  if (frame <= sorted[0].frame) return sorted[0].value;
  for (let i = 1; i < sorted.length; i++) {
    if (frame < sorted[i].frame) {
      const a = sorted[i - 1], b = sorted[i];
      if (a.interpolation === 'hold' || a.easing === 'hold') return a.value;
      let t = (frame - a.frame) / Math.max(1e-8, b.frame - a.frame);
      if (a.interpolation === 'smooth' || a.easing === 'smooth') t = t * t * (3 - 2 * t);
      return interpolate(a.value, b.value, t);
    }
  }
  return sorted[sorted.length - 1].value;
}
export function resolveAnimatedParams(node, frame = 0) {
  const params = { ...(node.params || {}) };
  const keys = { ...(params.keyframes || {}), ...(node.keyframes || {}) };
  delete params.keyframes;
  for (const [name, value] of Object.entries(params)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.keyframes)) {
      params[name] = evaluateKeyframes(value.keyframes, frame, value.value);
    }
  }
  for (const [name, frames] of Object.entries(keys)) params[name] = evaluateKeyframes(frames, frame, params[name]);
  return params;
}
export function validateProject(project, viewerNodeId) {
  if (!project || !Array.isArray(project.nodes)) throw new Error('Compositor: project.nodes must be an array.');
  if (project.nodes.length > 1000) throw new Error('Compositor: graphs are limited to 1000 nodes.');
  const nodes = new Map();
  for (const node of project.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id) throw new Error('Compositor: every node needs a nonempty string id.');
    if (nodes.has(node.id)) throw new Error(`Compositor: duplicate node id "${node.id}".`);
    if (!SUPPORTED_TYPES.has(node.type)) throw new Error(`Compositor: unsupported node type "${node.type}".`);
    if (node.inputs != null && !Array.isArray(node.inputs)) throw new Error(`Compositor: inputs for "${node.id}" must be an array.`);
    nodes.set(node.id, node);
  }
  const state = new Map(), order = [];
  function visit(id) {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) throw new Error(`Compositor: cycle detected at "${id}".`);
    const node = nodes.get(id);
    if (!node) throw new Error(`Compositor: input references missing node "${id}".`);
    state.set(id, 1);
    for (const input of node.inputs || []) if (input !== null && input !== undefined && input !== '') visit(input);
    state.set(id, 2); order.push(node);
  }
  for (const id of nodes.keys()) visit(id);
  const target = viewerNodeId ?? project.viewerNodeId ?? [...nodes.values()].find(n => n.type === 'Viewer')?.id ?? project.nodes.at(-1)?.id ?? null;
  if (target && !nodes.has(target)) throw new Error(`Compositor: viewer node "${target}" does not exist.`);
  const required = new Set();
  function requireNode(id) { if (!id || required.has(id)) return; required.add(id); for (const input of nodes.get(id).inputs || []) requireNode(input); }
  requireNode(target);
  return { nodes, order: order.filter(n => required.has(n.id)), target };
}
export function normalizedPoints(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 64).filter(p => (Array.isArray(p) && p.length >= 2) || (p && typeof p === 'object' && 'x' in p && 'y' in p)).map(p => [finite(p[0] ?? p.x, 0, -4, 4), finite(p[1] ?? p.y, 0, -4, 4)]);
}
export function seededNoise(x, y, seed) {
  let h = (Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263) + Math.imul(seed | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
