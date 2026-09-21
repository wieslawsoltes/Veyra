/** Veyra document core. Time values are integer frames unless stated otherwise. */
export const PROJECT_VERSION = 1;
export const LIMITS = Object.freeze({ bytes: 10_000_000, nodes: 1000, assets: 500, tracks: 64, clips: 20_000, keyframes: 50_000, duration: 10_000_000, dimension: 16_384, history: 100 });

const number = (key, label, min, max, step = 0.01) => ({ key, label, type: 'range', min, max, step });
const color = (key, label) => ({ key, label, type: 'color' });
const select = (key, label, options) => ({ key, label, type: 'select', options });
const field = (key, label) => ({ key, label, type: 'text' });
const define = (type, category, tint, inputs, defaults, controls) => ({ type, label: type === 'ChromaKey' ? 'Chroma Key' : type === 'ColorMatrix' ? 'Color Matrix' : type, category, color: tint, inputs, defaults, controls });

export const NODE_DEFINITIONS = [
  define('Source', 'Input', '#8c9fff', 0, { assetId: '', fit: 'cover' }, [field('assetId', 'Media asset'), select('fit', 'Fit', ['contain', 'cover', 'stretch'])]),
  define('Constant', 'Input', '#8c9fff', 0, { color: '#131521', alpha: 1 }, [color('color', 'Color'), number('alpha', 'Alpha', 0, 1)]),
  define('Grade', 'Color', '#b49aff', 1, { exposure: 0, contrast: 1, saturation: 1, gamma: 1, lift: 0, gain: 1 }, [number('exposure', 'Exposure', -5, 5), number('contrast', 'Contrast', 0, 3), number('saturation', 'Saturation', 0, 3), number('gamma', 'Gamma', 0.1, 3), number('lift', 'Lift', -1, 1), number('gain', 'Gain', 0, 3)]),
  define('Blur', 'Filter', '#f1a66c', 1, { radius: 8 }, [number('radius', 'Radius', 0, 100, 0.5)]),
  define('Transform', 'Transform', '#70cdb4', 1, { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, [number('x', 'Position X', -2, 2), number('y', 'Position Y', -2, 2), number('scale', 'Scale', 0.01, 5), number('rotation', 'Rotation', -180, 180, 1), number('opacity', 'Opacity', 0, 1)]),
  define('Merge', 'Composite', '#e0c373', 3, { mode: 'over', mix: 1 }, [select('mode', 'Blend mode', ['over', 'add', 'screen', 'multiply']), number('mix', 'Mix', 0, 1)]),
  define('ChromaKey', 'Keying', '#73cf91', 1, { color: '#00ff00', tolerance: 0.25, softness: 0.1 }, [color('color', 'Key color'), number('tolerance', 'Tolerance', 0, 1), number('softness', 'Softness', 0, 1)]),
  define('Roto', 'Mask', '#dc97c6', 0, { points: [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]], feather: 0.03 }, [number('feather', 'Feather', 0, 0.5)]),
  define('Glow', 'Filter', '#f1a66c', 1, { threshold: 0.6, intensity: 0.45, radius: 14 }, [number('threshold', 'Threshold', 0, 1), number('intensity', 'Intensity', 0, 3), number('radius', 'Radius', 0, 100, 0.5)]),
  define('Noise', 'Filter', '#f1a66c', 1, { seed: 7, amount: 0.03 }, [number('amount', 'Amount', 0, 0.5, 0.001), { key: 'seed', label: 'Seed', type: 'number', min: 0, max: 999999, step: 1 }]),
  define('Vignette', 'Filter', '#f1a66c', 1, { amount: 0.35 }, [number('amount', 'Amount', 0, 1)]),
  define('Sharpen', 'Filter', '#f1a66c', 1, { amount: 0.4 }, [number('amount', 'Amount', 0, 3)]),
  define('Invert', 'Color', '#b49aff', 1, { amount: 1 }, [number('amount', 'Amount', 0, 1)]),
  define('Crop', 'Transform', '#70cdb4', 1, { x: 0, y: 0, width: 1, height: 1 }, [number('x', 'Position X', 0, 1), number('y', 'Position Y', 0, 1), number('width', 'Width', 0, 1), number('height', 'Height', 0, 1)]),
  define('Premultiply', 'Composite', '#e0c373', 1, {}, []),
  define('Unpremultiply', 'Composite', '#e0c373', 1, {}, []),
  define('ColorMatrix', 'Color', '#b49aff', 1, { matrix: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0] }, []),
  define('Text', 'Input', '#8c9fff', 0, { text: 'NEON HORIZON', color: '#ffffff', fontSize: 48, x: 0.5, y: 0.78, opacity: 1, align: 'center', fontFamily: 'sans-serif' }, [field('text', 'Text'), color('color', 'Color'), number('fontSize', 'Size', 8, 240, 1), number('x', 'Position X', 0, 1), number('y', 'Position Y', 0, 1), number('opacity', 'Opacity', 0, 1), select('align', 'Alignment', ['left', 'center', 'right']), field('fontFamily', 'Font')]),
  define('Viewer', 'Output', '#7cc4df', 1, {}, []),
].map((definition) => Object.freeze({ ...definition, defaults: Object.freeze(definition.defaults), controls: Object.freeze(definition.controls) }));

export const NODE_DEFINITION_MAP = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(NODE_DEFINITIONS.map((definition) => [definition.type, definition]))));
const clone = (value) => JSON.parse(JSON.stringify(value));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const plain = (value) => !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const sameNumericShape = (value, fallback) => Array.isArray(value) && value.length === fallback.length && value.every((item, index) => Array.isArray(fallback[index]) ? sameNumericShape(item, fallback[index]) : Number.isFinite(item));
let counter = 0;
export function makeId(prefix = 'item') {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${(++counter).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${suffix}`;
}

export class ProjectValidationError extends Error {
  constructor(errors) { super(`Invalid project: ${errors.slice(0, 4).join('; ')}`); this.name = 'ProjectValidationError'; this.errors = errors; }
}

/** Returns a fresh, editable demonstration project. Set demo:false for an empty composition. */
export function createProject(options = {}) {
  const project = { version: PROJECT_VERSION, id: makeId('project'), name: 'Neon horizon', width: 960, height: 540, fps: 24, duration: 240, frame: 72, nodes: [], assets: [], timeline: { tracks: [] }, viewerNodeId: null };
  for (const key of ['id', 'name', 'width', 'height', 'fps', 'duration', 'frame']) if (own(options, key)) project[key] = options[key];
  project.frame = clamp(project.frame, 0, project.duration - 1);
  if (options.demo !== false) {
    project.assets = [{ id: 'asset-neon-city', name: 'Neon city · original plate', url: '/assets/neon-city.jpg', type: 'image', width: 1672, height: 941, duration: project.duration }];
    const node = (id, type, name, x, y, inputs = [], params = {}, keyframes = {}) => ({ id, type, name, x, y, inputs: Array.from({ length: NODE_DEFINITION_MAP[type].inputs }, (_, index) => inputs[index] ?? null), params: { ...clone(NODE_DEFINITION_MAP[type].defaults), ...params }, disabled: false, keyframes });
    project.nodes = [
      node('node-source', 'Source', 'Neon city', 80, 60, [], { assetId: 'asset-neon-city' }),
      node('node-grade', 'Grade', 'Midnight grade', 260, 60, ['node-source'], { exposure: 0.2, contrast: 1.15, saturation: 0.82 }),
      node('node-glow', 'Glow', 'Neon bloom', 440, 60, ['node-grade'], { intensity: 0.38, radius: 16, threshold: 0.58 }),
      node('node-vignette', 'Vignette', 'Lens vignette', 620, 60, ['node-glow'], { amount: 0.32 }),
      node('node-text', 'Text', 'Opening title', 620, 220, [], { text: 'NEON HORIZON', fontSize: 43, x: 0.5, y: 0.78, opacity: 0 }, { opacity: [{ frame: 0, value: 0, interpolation: 'linear' }, { frame: Math.min(23, project.duration - 1), value: 0, interpolation: 'smooth' }, { frame: Math.min(47, project.duration - 1), value: 1, interpolation: 'linear' }] }),
      node('node-merge', 'Merge', 'Title composite', 800, 60, ['node-vignette', 'node-text']),
      node('node-viewer', 'Viewer', 'Final output', 980, 60, ['node-merge']),
    ];
    // Very short custom compositions still have unique, ordered keys.
    project.nodes.find((n) => n.type === 'Text').keyframes.opacity = [...new Map(project.nodes.find((n) => n.type === 'Text').keyframes.opacity.map((key) => [key.frame, key])).values()];
    project.viewerNodeId = 'node-viewer';
    const first = Math.max(1, Math.round(project.duration * 0.4));
    const second = Math.max(0, Math.round(project.duration * 0.3));
    const segments = [{ start: 0, duration: first, name: '01 · Neon arrival' }, { start: first, duration: second, name: '02 · Night drive' }, { start: first + second, duration: Math.max(0, project.duration - first - second), name: '03 · Last light' }].filter((part) => part.duration > 0 && part.start < project.duration);
    project.timeline.tracks = [
      { id: 'track-title', name: 'Titles', kind: 'video', muted: false, locked: false, clips: [{ id: 'clip-title', name: 'NEON HORIZON', assetId: null, nodeId: 'node-text', start: 0, duration: project.duration, in: 0, opacity: 1 }] },
      { id: 'track-picture', name: 'Picture', kind: 'video', muted: false, locked: false, clips: segments.map((part, index) => ({ id: `clip-shot-${index + 1}`, ...part, duration: Math.min(part.duration, project.duration - part.start), assetId: 'asset-neon-city', nodeId: 'node-vignette', in: part.start, opacity: 1 })) },
      { id: 'track-audio', name: 'Audio', kind: 'audio', muted: false, locked: false, clips: [] },
    ];
  }
  const check = validateProject(project);
  if (!check.valid) throw new ProjectValidationError(check.errors);
  return project;
}

/** Validate without mutation. Never follows URLs or creates executable code. */
export function validateProject(project) {
  const errors = [], warnings = [];
  const fail = (path, reason) => { if (errors.length < 100) errors.push(`${path}: ${reason}`); };
  if (!plain(project)) return { valid: false, errors: ['project: expected an object'], warnings };
  let walked = 0;
  const seen = new WeakSet();
  const inspect = (value, path, depth) => {
    if (++walked > 500_000) { fail(path, 'document is too complex'); return; }
    if (depth > 32) { fail(path, 'nesting limit exceeded'); return; }
    if (typeof value === 'number' && !Number.isFinite(value)) fail(path, 'numbers must be finite');
    if (typeof value === 'string' && value.length > 1_000_000) fail(path, 'string is too long');
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || value === undefined) fail(path, 'value is not JSON compatible');
    if (value && typeof value === 'object') {
      if (seen.has(value)) { fail(path, 'repeated or cyclic object reference'); return; }
      seen.add(value);
      if (!Array.isArray(value) && !plain(value)) { fail(path, 'expected a plain JSON object'); return; }
      for (const key of Object.keys(value)) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') fail(`${path}.${key}`, 'unsafe property name');
        if (walked > 500_000) break;
        inspect(value[key], `${path}.${key}`, depth + 1);
      }
    }
  };
  inspect(project, 'project', 0);
  // Structural failures must not reach deeper schema walkers (cyclic arrays,
  // for example, could otherwise recur while comparing animation shapes).
  if (errors.length) return { valid: false, errors, warnings };
  if (project.version !== undefined && project.version !== PROJECT_VERSION) fail('version', `unsupported version ${project.version}`);
  if (!validId(project.id)) fail('id', 'expected a valid identifier');
  if (typeof project.name !== 'string' || project.name.length > 256) fail('name', 'expected a name up to 256 characters');
  for (const key of ['width', 'height']) if (!integer(project[key], 1, LIMITS.dimension)) fail(key, `expected an integer from 1 to ${LIMITS.dimension}`);
  if (typeof project.fps !== 'number' || project.fps < 1 || project.fps > 240 || !Number.isFinite(project.fps)) fail('fps', 'expected a finite rate from 1 to 240');
  if (!integer(project.duration, 1, LIMITS.duration)) fail('duration', 'expected a positive integer frame count within limits');
  if (!integer(project.frame, 0, project.duration - 1)) fail('frame', 'must be a frame inside the project');
  const list = (value, path, max) => { if (!Array.isArray(value) || value.length > max) { fail(path, `expected an array with at most ${max} entries`); return []; } return value; };
  const nodes = list(project.nodes, 'nodes', LIMITS.nodes);
  const assets = list(project.assets, 'assets', LIMITS.assets);
  const nodeIds = new Set(), assetIds = new Set(), trackIds = new Set(), clipIds = new Set();
  let keysCount = 0, clipsCount = 0;
  const identify = (id, set, path) => { if (!validId(id)) fail(path, 'invalid identifier'); else if (set.has(id)) fail(path, 'duplicate identifier'); else set.add(id); };
  assets.forEach((asset, index) => {
    const path = `assets[${index}]`;
    if (!plain(asset)) { fail(path, 'expected an object'); return; }
    identify(asset.id, assetIds, `${path}.id`);
    if (typeof asset.name !== 'string' || asset.name.length > 512) fail(`${path}.name`, 'invalid name');
    if (!['image', 'video', 'audio'].includes(asset.type)) fail(`${path}.type`, 'expected image, video, or audio');
    if (!isSafeAssetURL(asset.url)) fail(`${path}.url`, 'expected a safe relative, http(s), blob, or image data URL');
    for (const key of ['width', 'height']) if (asset[key] !== undefined && !integer(asset[key], 0, 100_000)) fail(`${path}.${key}`, 'invalid media dimension');
    if (asset.duration !== undefined && (!Number.isFinite(asset.duration) || asset.duration < 0 || asset.duration > LIMITS.duration)) fail(`${path}.duration`, 'invalid source frame duration');
  });
  nodes.forEach((node, index) => {
    const path = `nodes[${index}]`;
    if (!plain(node)) { fail(path, 'expected an object'); return; }
    identify(node.id, nodeIds, `${path}.id`);
    const definition = NODE_DEFINITION_MAP[node.type];
    if (!definition) fail(`${path}.type`, 'unknown node type');
    if (typeof node.name !== 'string' || node.name.length > 256) fail(`${path}.name`, 'invalid node name');
    for (const key of ['x', 'y']) if (!Number.isFinite(node[key]) || Math.abs(node[key]) > 1_000_000) fail(`${path}.${key}`, 'invalid graph position');
    if (!Array.isArray(node.inputs) || node.inputs.length !== definition?.inputs) fail(`${path}.inputs`, 'input count must match the node definition');
    if (typeof node.disabled !== 'boolean') fail(`${path}.disabled`, 'expected a boolean');
    if (!plain(node.params)) fail(`${path}.params`, 'expected an object');
    else if (definition) {
      for (const [key, fallback] of Object.entries(definition.defaults)) {
        const value = node.params[key];
        if (value === undefined) continue;
        if (Array.isArray(fallback)) {
          if (node.type === 'Roto' && key === 'points') {
            if (!Array.isArray(value) || value.length < 3 || value.length > 10000 || value.some((point) => !Array.isArray(point) || point.length !== 2 || point.some((item) => !Number.isFinite(item)))) fail(`${path}.params.${key}`, 'expected 3 to 10000 finite x/y points');
          } else if (!sameNumericShape(value, fallback)) fail(`${path}.params.${key}`, `expected ${fallback.length} finite coefficients`);
        }
        else if (typeof value !== typeof fallback || (typeof value === 'number' && !Number.isFinite(value))) fail(`${path}.params.${key}`, `expected ${typeof fallback}`);
      }
      for (const control of definition.controls) {
        const value = node.params[control.key];
        if (value === undefined) continue;
        if (control.type === 'select' && !control.options.includes(value)) fail(`${path}.params.${control.key}`, 'unsupported selection');
        if (control.type === 'color' && !/^#[\da-f]{6}([\da-f]{2})?$/i.test(value)) fail(`${path}.params.${control.key}`, 'expected a hex color');
        if (control.type === 'text' && value.length > 16_384) fail(`${path}.params.${control.key}`, 'text is too long');
        if (typeof value === 'number' && (value < control.min || value > control.max)) fail(`${path}.params.${control.key}`, `must be between ${control.min} and ${control.max}`);
      }
      if (node.type === 'Source' && node.params.assetId && !assetIds.has(node.params.assetId)) fail(`${path}.params.assetId`, 'references an unknown asset');
    }
    if (!plain(node.keyframes)) fail(`${path}.keyframes`, 'expected an object');
    else for (const [key, values] of Object.entries(node.keyframes)) {
      if (!Array.isArray(values)) { fail(`${path}.keyframes.${key}`, 'expected an array'); continue; }
      keysCount += values.length;
      let previous = -1;
      values.forEach((keyframe, keyIndex) => {
        const keyPath = `${path}.keyframes.${key}[${keyIndex}]`;
        if (!plain(keyframe)) { fail(keyPath, 'expected a keyframe object'); return; }
        if (!integer(keyframe.frame, 0, project.duration - 1) || keyframe.frame <= previous) fail(`${keyPath}.frame`, 'keyframes must be unique, increasing, and inside the project');
        previous = keyframe.frame;
        if (!['linear', 'hold', 'smooth'].includes(keyframe.interpolation)) fail(`${keyPath}.interpolation`, 'unsupported interpolation');
        const fallback = node.params?.[key] ?? definition?.defaults?.[key];
        if (fallback === undefined) fail(keyPath, 'keyframe references an unknown parameter');
        else if (Array.isArray(fallback) ? !sameNumericShape(keyframe.value, fallback) : typeof keyframe.value !== typeof fallback) fail(`${keyPath}.value`, 'must match the parameter type');
        const control = definition?.controls.find((item) => item.key === key);
        if (control && typeof keyframe.value === 'number' && (keyframe.value < control.min || keyframe.value > control.max)) fail(`${keyPath}.value`, `must be between ${control.min} and ${control.max}`);
        if (control?.type === 'color' && !/^#[\da-f]{6}([\da-f]{2})?$/i.test(keyframe.value)) fail(`${keyPath}.value`, 'expected a hex color');
        if (control?.type === 'select' && !control.options.includes(keyframe.value)) fail(`${keyPath}.value`, 'unsupported selection');
        if (node.type === 'Source' && key === 'assetId' && keyframe.value && !assetIds.has(keyframe.value)) fail(`${keyPath}.value`, 'references an unknown asset');
      });
    }
  });
  if (keysCount > LIMITS.keyframes) fail('nodes.keyframes', 'total keyframe limit exceeded');
  const byId = new Map(nodes.filter(plain).map((node) => [node.id, node]));
  nodes.filter(plain).forEach((node) => {
    if (Array.isArray(node.inputs)) node.inputs.forEach((id, index) => { if (id !== null && !nodeIds.has(id)) fail(`nodes.${node.id}.inputs[${index}]`, 'references an unknown node'); });
  });
  // Kahn's algorithm prevents both cycles and recursive stack exhaustion.
  const incoming = new Map(), children = new Map();
  for (const node of byId.values()) {
    const parents = Array.isArray(node.inputs) ? node.inputs.filter((id) => id !== null && byId.has(id)) : [];
    incoming.set(node.id, parents.length);
    for (const id of parents) { if (!children.has(id)) children.set(id, []); children.get(id).push(node.id); }
  }
  const queue = [...incoming].filter(([, degree]) => degree === 0).map(([id]) => id);
  for (let index = 0; index < queue.length; index++) for (const child of children.get(queue[index]) ?? []) { incoming.set(child, incoming.get(child) - 1); if (incoming.get(child) === 0) queue.push(child); }
  if (queue.length !== byId.size) fail('nodes', 'graph contains a cycle');
  if (project.viewerNodeId !== null && !nodeIds.has(project.viewerNodeId)) fail('viewerNodeId', 'references an unknown node');
  if (!plain(project.timeline)) fail('timeline', 'expected an object');
  const tracks = list(project.timeline?.tracks, 'timeline.tracks', LIMITS.tracks);
  tracks.forEach((track, index) => {
    const path = `timeline.tracks[${index}]`;
    if (!plain(track)) { fail(path, 'expected a track object'); return; }
    identify(track.id, trackIds, `${path}.id`);
    if (typeof track.name !== 'string' || track.name.length > 256) fail(`${path}.name`, 'invalid track name');
    if (!['video', 'audio'].includes(track.kind)) fail(`${path}.kind`, 'expected video or audio');
    if (typeof track.muted !== 'boolean' || typeof track.locked !== 'boolean') fail(path, 'muted and locked must be booleans');
    const clips = list(track.clips, `${path}.clips`, LIMITS.clips); clipsCount += clips.length;
    clips.forEach((clip, clipIndex) => {
      const clipPath = `${path}.clips[${clipIndex}]`;
      if (!plain(clip)) { fail(clipPath, 'expected a clip object'); return; }
      identify(clip.id, clipIds, `${clipPath}.id`);
      if (typeof clip.name !== 'string' || clip.name.length > 512) fail(`${clipPath}.name`, 'invalid clip name');
      if (clip.assetId !== null && !assetIds.has(clip.assetId)) fail(`${clipPath}.assetId`, 'references an unknown asset');
      if (clip.nodeId !== null && !nodeIds.has(clip.nodeId)) fail(`${clipPath}.nodeId`, 'references an unknown node');
      if (clip.assetId === null && clip.nodeId === null) fail(clipPath, 'requires an asset or a node');
      if (!integer(clip.start, 0, project.duration - 1)) fail(`${clipPath}.start`, 'must be inside the project');
      if (!integer(clip.duration, 1, project.duration)) fail(`${clipPath}.duration`, 'must be a positive integer');
      if (clip.start + clip.duration > project.duration) fail(clipPath, 'clip extends beyond project duration');
      if (!integer(clip.in, 0, LIMITS.duration)) fail(`${clipPath}.in`, 'must be a nonnegative source frame');
      if (!Number.isFinite(clip.opacity) || clip.opacity < 0 || clip.opacity > 1) fail(`${clipPath}.opacity`, 'must be between zero and one');
      const asset = assets.find((item) => item?.id === clip.assetId);
      if (asset && asset.type !== 'image' && asset.duration > 0 && clip.in + clip.duration > asset.duration) fail(clipPath, 'clip extends beyond its source media');
    });
    const sorted = clips.filter(plain).slice().sort((a, b) => a.start - b.start);
    let latestEnd = -1;
    for (const clip of sorted) { if (clip.start < latestEnd) { warnings.push(`${path}: contains overlapping clips; OTIO exports overlaps as parallel lanes`); break; } latestEnd = Math.max(latestEnd, clip.start + clip.duration); }
  });
  if (clipsCount > LIMITS.clips) fail('timeline.clips', 'total clip limit exceeded');
  return { valid: errors.length === 0, errors, warnings };
}

export function isSafeAssetURL(value) {
  if (typeof value !== 'string' || value.length > 4_000_000 || /[\u0000-\u001f\u007f\\]/.test(value)) return false;
  if (/^https?:\/\//i.test(value) || /^blob:https?:\/\//i.test(value)) return true;
  if (/^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/i.test(value)) return true;
  return /^(?:\/(?!\/)|\.\.?\/|[a-zA-Z0-9_-])/.test(value) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) && !value.includes('://');
}

export function importProject(input) {
  let project;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).length > LIMITS.bytes) throw new ProjectValidationError(['file exceeds the 10 MB limit']);
    try { project = JSON.parse(input); } catch { throw new ProjectValidationError(['file is not valid JSON']); }
  } else project = input;
  const check = validateProject(project);
  if (!check.valid) throw new ProjectValidationError(check.errors);
  const serialized = JSON.stringify(project);
  if (new TextEncoder().encode(serialized).length > LIMITS.bytes) throw new ProjectValidationError(['file exceeds the 10 MB limit']);
  return JSON.parse(serialized);
}

export function serializeProject(project, space = 2) { return JSON.stringify(importProject(project), null, space); }

/** A mutable document with atomic validation, undo/redo, and change subscriptions. */
export class GraphDocument {
  constructor(project = createProject(), { historyLimit = LIMITS.history } = {}) {
    this.project = importProject(project);
    this.historyLimit = clamp(Math.floor(historyLimit) || LIMITS.history, 1, 1000);
    this._undo = []; this._redo = []; this._listeners = new Map(); this._depth = 0;
  }
  get canUndo() { return this._undo.length > 0; }
  get canRedo() { return this._redo.length > 0; }
  get history() { return { undo: this._undo.map((entry) => entry.label), redo: this._redo.map((entry) => entry.label) }; }
  on(type, callback) { if (typeof callback !== 'function') throw new TypeError('Listener must be a function'); if (!this._listeners.has(type)) this._listeners.set(type, new Set()); this._listeners.get(type).add(callback); return () => this.off(type, callback); }
  off(type, callback) { this._listeners.get(type)?.delete(callback); }
  subscribe(callback) { return this.on('change', callback); }
  addEventListener(type, callback) { this.on(type, callback); }
  removeEventListener(type, callback) { this.off(type, callback); }
  _emit(type, label) {
    const detail = { label, project: this.project, canUndo: this.canUndo, canRedo: this.canRedo };
    const event = { type, ...detail, detail };
    for (const callback of [...(this._listeners.get(type) ?? [])]) { try { callback(event); } catch (error) { globalThis.console?.error?.('Document listener failed:', error); } }
  }
  transaction(label, fn) {
    if (typeof fn !== 'function') throw new TypeError('Transaction requires a function');
    const before = clone(this.project), outer = this._depth === 0;
    this._depth++;
    let result;
    try {
      result = fn(this);
      if (result && typeof result.then === 'function') throw new TypeError('Transactions must be synchronous');
      if (outer) {
        const check = validateProject(this.project);
        if (!check.valid) throw new ProjectValidationError(check.errors);
      }
    } catch (error) { this.project = before; throw error; }
    finally { this._depth--; }
    if (outer && JSON.stringify(before) !== JSON.stringify(this.project)) {
      this._undo.push({ label: String(label || 'Edit'), before, after: clone(this.project) });
      if (this._undo.length > this.historyLimit) this._undo.shift();
      this._redo = [];
      this._emit('change', String(label || 'Edit'));
      this._emit('history', String(label || 'Edit'));
    }
    return result;
  }
  getNode(id) { const node = this.project.nodes.find((item) => item.id === id); if (!node) throw new RangeError(`Unknown node: ${id}`); return node; }
  addNode(type, { x = 100, y = 100, params = {}, name, id } = {}) {
    const definition = NODE_DEFINITION_MAP[type];
    if (!definition) throw new RangeError(`Unknown node type: ${type}`);
    return this.transaction(`Add ${definition.label}`, () => {
      const node = { id: id ?? makeId('node'), type, name: name ?? definition.label, x, y, inputs: Array(definition.inputs).fill(null), params: { ...clone(definition.defaults), ...clone(params) }, disabled: false, keyframes: {} };
      this.project.nodes.push(node);
      if (type === 'Viewer') this.project.viewerNodeId = node.id;
      return node;
    });
  }
  removeNodes(ids) {
    const removing = new Set(ids);
    return this.transaction('Delete nodes', () => {
      const removed = this.project.nodes.filter((node) => removing.has(node.id));
      this.project.nodes = this.project.nodes.filter((node) => !removing.has(node.id));
      for (const node of this.project.nodes) node.inputs = node.inputs.map((id) => removing.has(id) ? null : id);
      for (const track of this.project.timeline.tracks) track.clips = track.clips.filter((clip) => {
        if (!removing.has(clip.nodeId)) return true;
        clip.nodeId = null;
        return clip.assetId !== null;
      });
      if (removing.has(this.project.viewerNodeId)) this.project.viewerNodeId = null;
      return removed;
    });
  }
  connect(sourceId, targetId, inputIndex = 0) {
    this.getNode(sourceId);
    const target = this.getNode(targetId);
    if (!integer(inputIndex, 0, target.inputs.length - 1)) throw new RangeError('Invalid input index');
    return this.transaction('Connect nodes', () => { this.getNode(targetId).inputs[inputIndex] = sourceId; });
  }
  disconnect(targetId, inputIndex = 0) {
    const target = this.getNode(targetId);
    if (!integer(inputIndex, 0, target.inputs.length - 1)) throw new RangeError('Invalid input index');
    return this.transaction('Disconnect nodes', () => { this.getNode(targetId).inputs[inputIndex] = null; });
  }
  updateNode(id, patch) {
    if (!plain(patch)) throw new TypeError('Node update must be an object');
    const supported = ['name', 'x', 'y', 'params', 'disabled', 'keyframes'];
    for (const key of Object.keys(patch)) if (!supported.includes(key)) throw new RangeError(`Cannot update node field: ${key}`);
    return this.transaction('Update node', () => {
      const node = this.getNode(id);
      for (const [key, value] of Object.entries(patch)) node[key] = key === 'params' ? { ...node.params, ...clone(value) } : clone(value);
      return node;
    });
  }
  setParam(id, key, value) {
    if (!own(NODE_DEFINITION_MAP[this.getNode(id).type].defaults, key)) throw new RangeError(`Unknown parameter: ${key}`);
    return this.transaction(`Set ${key}`, () => { this.getNode(id).params[key] = clone(value); });
  }
  setKeyframe(id, key, frame, value, interpolation = 'linear') {
    if (!own(NODE_DEFINITION_MAP[this.getNode(id).type].defaults, key)) throw new RangeError(`Unknown parameter: ${key}`);
    return this.transaction(`Keyframe ${key}`, () => {
      const node = this.getNode(id);
      const values = node.keyframes[key] ?? [];
      node.keyframes[key] = [...values.filter((item) => item.frame !== frame), { frame, value: clone(value), interpolation }].sort((a, b) => a.frame - b.frame);
    });
  }
  removeKeyframe(id, key, frame) { return this.transaction(`Remove ${key} keyframe`, () => { const node = this.getNode(id); if (node.keyframes[key]) { node.keyframes[key] = node.keyframes[key].filter((item) => item.frame !== frame); if (!node.keyframes[key].length) delete node.keyframes[key]; } }); }
  setFrame(frame) { if (!Number.isFinite(frame)) throw new TypeError('Frame must be finite'); const next = clamp(Math.round(frame), 0, this.project.duration - 1); if (next !== this.project.frame) { this.project.frame = next; this._emit('frame', 'Seek'); this._emit('change', 'Seek'); } return next; }
  setViewer(id) { if (id !== null) this.getNode(id); return this.transaction('Set viewer', () => { this.project.viewerNodeId = id; }); }
  updateProject(patch) { const supported = ['name', 'width', 'height', 'fps', 'duration']; for (const key of Object.keys(patch)) if (!supported.includes(key)) throw new RangeError(`Cannot update project field: ${key}`); return this.transaction('Project settings', () => { Object.assign(this.project, clone(patch)); this.project.frame = Math.min(this.project.frame, this.project.duration - 1); }); }
  addAsset(asset) { return this.transaction('Import media', () => { const added = { id: makeId('asset'), ...clone(asset) }; this.project.assets.push(added); return added; }); }
  removeAsset(id) {
    return this.transaction('Remove media', () => {
      this.project.assets = this.project.assets.filter((asset) => asset.id !== id);
      for (const node of this.project.nodes) if (node.type === 'Source') {
        if (node.params.assetId === id) node.params.assetId = '';
        if (node.keyframes.assetId) node.keyframes.assetId = node.keyframes.assetId.map((key) => key.value === id ? { ...key, value: '' } : key);
      }
      for (const track of this.project.timeline.tracks) track.clips = track.clips.filter((clip) => { if (clip.assetId !== id) return true; clip.assetId = null; return clip.nodeId !== null; });
    });
  }
  replaceProject(project, { undoable = true } = {}) { const loaded = importProject(project); if (undoable) return this.transaction('Open project', () => { this.project = loaded; }); this.project = loaded; this._undo = []; this._redo = []; this._emit('change', 'Open project'); this._emit('history', 'Open project'); }
  setData(project, options) { return this.replaceProject(project, options); }
  undo() { if (this._depth) throw new Error('Cannot undo inside a transaction'); const entry = this._undo.pop(); if (!entry) return false; this._redo.push(entry); this.project = clone(entry.before); this._emit('change', `Undo ${entry.label}`); this._emit('history', `Undo ${entry.label}`); return true; }
  redo() { if (this._depth) throw new Error('Cannot redo inside a transaction'); const entry = this._redo.pop(); if (!entry) return false; this._undo.push(entry); this.project = clone(entry.after); this._emit('change', `Redo ${entry.label}`); this._emit('history', `Redo ${entry.label}`); return true; }
  clearHistory() { this._undo = []; this._redo = []; this._emit('history', 'Clear history'); }
  toJSON() { return clone(this.project); }
  serialize(space = 2) { return serializeProject(this.project, space); }
}

const interpolateValue = (from, to, amount) => {
  if (typeof from === 'number' && typeof to === 'number') return from + (to - from) * amount;
  if (Array.isArray(from) && Array.isArray(to) && from.length === to.length) return from.map((value, index) => interpolateValue(value, to[index], amount));
  if (typeof from === 'string' && typeof to === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(from) && from.length === to.length && /^#[\da-f]{6}([\da-f]{2})?$/i.test(to)) {
    let result = '#'; for (let index = 1; index < from.length; index += 2) result += Math.round(parseInt(from.slice(index, index + 2), 16) + (parseInt(to.slice(index, index + 2), 16) - parseInt(from.slice(index, index + 2), 16)) * amount).toString(16).padStart(2, '0'); return result;
  }
  return amount < 1 ? from : to;
};

/** Interpolation belongs to the outgoing segment of each keyframe. */
export function evaluateKeyframes(keyframes, frame, fallback) {
  if (!Array.isArray(keyframes) || keyframes.length === 0) return fallback;
  if (frame <= keyframes[0].frame) return keyframes[0].value;
  if (frame >= keyframes[keyframes.length - 1].frame) return keyframes[keyframes.length - 1].value;
  let low = 0, high = keyframes.length - 1;
  while (high - low > 1) { const mid = Math.floor((low + high) / 2); if (keyframes[mid].frame <= frame) low = mid; else high = mid; }
  const from = keyframes[low], to = keyframes[high];
  if (from.interpolation === 'hold') return from.value;
  let amount = (frame - from.frame) / (to.frame - from.frame);
  if (from.interpolation === 'smooth') amount = amount * amount * (3 - 2 * amount);
  return interpolateValue(from.value, to.value, amount);
}

export function evaluateNodeParams(node, frame) {
  const params = { ...clone(NODE_DEFINITION_MAP[node.type]?.defaults ?? {}), ...clone(node.params) };
  for (const [key, keyframes] of Object.entries(node.keyframes ?? {})) {
    const value = evaluateKeyframes(keyframes, frame, params[key]);
    params[key] = value && typeof value === 'object' ? clone(value) : value;
  }
  return params;
}

export function topologicalNodes(project, targetId = project.viewerNodeId) {
  const nodes = new Map(project.nodes.map((node) => [node.id, node])), seen = new Set(), active = new Set(), result = [];
  const visit = (id) => {
    if (id === null || seen.has(id)) return;
    if (active.has(id)) throw new ProjectValidationError(['graph contains a cycle']);
    const node = nodes.get(id); if (!node) throw new ProjectValidationError([`unknown node: ${id}`]);
    active.add(id); for (const input of node.inputs) visit(input); active.delete(id); seen.add(id); result.push(node);
  };
  if (targetId !== null) visit(targetId); else for (const id of nodes.keys()) visit(id);
  return result;
}

/** Non-drop-frame by default. dropFrame:true supports 29.97 and 59.94. */
export function formatSMPTE(frame, fps = 24, { dropFrame = false } = {}) {
  if (!Number.isFinite(frame) || !Number.isFinite(fps) || fps < 1 || fps > 240) throw new RangeError('Invalid frame or frame rate');
  const negative = frame < 0 ? '-' : '', nominal = Math.round(fps);
  let count = Math.floor(Math.abs(frame));
  if (dropFrame) {
    if (Math.abs(fps - 30000 / 1001) > 0.01 && Math.abs(fps - 60000 / 1001) > 0.01) throw new RangeError('Drop-frame timecode requires 29.97 or 59.94 fps');
    const drop = nominal === 60 ? 4 : 2, tenMinutes = nominal * 600 - drop * 9;
    const blocks = Math.floor(count / tenMinutes), remainder = count % tenMinutes;
    count += drop * 9 * blocks + drop * Math.max(0, Math.floor((remainder - drop) / (nominal * 60 - drop)));
  }
  const ff = count % nominal, seconds = Math.floor(count / nominal), ss = seconds % 60, mm = Math.floor(seconds / 60) % 60, hh = Math.floor(seconds / 3600);
  return `${negative}${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}${dropFrame ? ';' : ':'}${String(ff).padStart(2, '0')}`;
}

export function parseSMPTE(value, fps = 24, options = {}) {
  if (typeof value !== 'string' || !Number.isFinite(fps) || fps < 1 || fps > 240) throw new RangeError('Invalid timecode or frame rate');
  const dropFrame = options.dropFrame ?? value.includes(';');
  const match = /^(-)?(\d{2,}):([0-5]\d):([0-5]\d)[:;](\d{2,3})$/.exec(value);
  if (!match) throw new RangeError('Use HH:MM:SS:FF timecode');
  const [, minus, h, m, s, f] = match, nominal = Math.round(fps), hours = Number(h), minutes = Number(m), seconds = Number(s), frames = Number(f);
  if (frames >= nominal) throw new RangeError('Timecode frame field exceeds the frame rate');
  let result = ((hours * 60 + minutes) * 60 + seconds) * nominal + frames;
  if (dropFrame) {
    if (Math.abs(fps - 30000 / 1001) > 0.01 && Math.abs(fps - 60000 / 1001) > 0.01) throw new RangeError('Drop-frame timecode requires 29.97 or 59.94 fps');
    const drop = nominal === 60 ? 4 : 2, totalMinutes = hours * 60 + minutes;
    if (minutes % 10 !== 0 && seconds === 0 && frames < drop) throw new RangeError('This frame number is skipped by drop-frame timecode');
    result -= drop * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  if (!Number.isSafeInteger(result)) throw new RangeError('Timecode exceeds safe frame precision');
  return minus ? -result : result;
}

/** Timeline edits share the graph document's undo/redo history. */
export class TimelineModel {
  constructor(document) { if (!(document instanceof GraphDocument)) throw new TypeError('TimelineModel requires a GraphDocument'); this.document = document; }
  get project() { return this.document.project; }
  get tracks() { return this.project.timeline.tracks; }
  getTrack(id) { const track = this.tracks.find((item) => item.id === id); if (!track) throw new RangeError(`Unknown track: ${id}`); return track; }
  findClip(id) { for (const track of this.tracks) { const clip = track.clips.find((item) => item.id === id); if (clip) return { track, clip }; } throw new RangeError(`Unknown clip: ${id}`); }
  _editable(track) { if (track.locked) throw new Error(`Track is locked: ${track.name}`); }
  _sourceLimit(clip) { const asset = this.project.assets.find((item) => item.id === clip.assetId); return asset && asset.type !== 'image' && asset.duration > 0 ? asset.duration : LIMITS.duration; }
  addTrack({ name = 'Video', kind = 'video', id = makeId('track') } = {}) { return this.document.transaction('Add track', () => { const track = { id, name, kind, muted: false, locked: false, clips: [] }; this.tracks.push(track); return track; }); }
  updateTrack(id, patch) { for (const key of Object.keys(patch)) if (!['name', 'muted', 'locked'].includes(key)) throw new RangeError(`Cannot update track field: ${key}`); return this.document.transaction('Update track', () => Object.assign(this.getTrack(id), clone(patch))); }
  removeTrack(id) { this._editable(this.getTrack(id)); return this.document.transaction('Delete track', () => { this.project.timeline.tracks = this.tracks.filter((track) => track.id !== id); }); }
  addClip(trackId, options) {
    this._editable(this.getTrack(trackId));
    return this.document.transaction('Add clip', () => { const clip = { id: makeId('clip'), name: 'New clip', assetId: null, nodeId: null, start: 0, duration: Math.min(48, this.project.duration), in: 0, opacity: 1, ...clone(options) }; this.getTrack(trackId).clips.push(clip); return clip; });
  }
  updateClip(id, patch) {
    for (const key of Object.keys(patch)) if (!['name', 'assetId', 'nodeId', 'start', 'duration', 'in', 'opacity'].includes(key)) throw new RangeError(`Cannot update clip field: ${key}`);
    this._editable(this.findClip(id).track);
    return this.document.transaction('Update clip', () => Object.assign(this.findClip(id).clip, clone(patch)));
  }
  moveClip(id, start, trackId) {
    const found = this.findClip(id), target = trackId ? this.getTrack(trackId) : found.track;
    this._editable(found.track); this._editable(target);
    if (found.track.kind !== target.kind) throw new Error('Cannot move clips between audio and video tracks');
    return this.document.transaction('Move clip', () => {
      const { track, clip } = this.findClip(id), destination = this.getTrack(target.id);
      clip.start = start;
      if (track.id !== destination.id) { track.clips = track.clips.filter((item) => item.id !== id); destination.clips.push(clip); }
      return clip;
    });
  }
  /** Trim uses an absolute timeline boundary, preserving source alignment. */
  trimClip(id, edge, frame, { ripple = false } = {}) {
    const { track } = this.findClip(id); this._editable(track);
    if (!['start', 'end'].includes(edge) || !Number.isSafeInteger(frame)) throw new RangeError('Trim requires start/end and an integer timeline frame');
    return this.document.transaction(ripple ? 'Ripple trim' : 'Trim clip', () => {
      const { track: current, clip } = this.findClip(id), oldEnd = clip.start + clip.duration;
      if (edge === 'start') {
        const delta = frame - clip.start;
        if (frame < 0 || frame >= oldEnd || clip.in + delta < 0) throw new RangeError('Start trim exceeds clip or source bounds');
        clip.in += delta; clip.duration -= delta;
        if (ripple) this._ripple(current, oldEnd, -delta, id); else clip.start = frame;
      } else {
        const delta = frame - oldEnd;
        if (frame <= clip.start || clip.in + clip.duration + delta > this._sourceLimit(clip)) throw new RangeError('End trim exceeds clip or source bounds');
        clip.duration += delta;
        if (ripple) this._ripple(current, oldEnd, delta, id);
      }
      return clip;
    });
  }
  splitClip(id, frame) {
    this._editable(this.findClip(id).track);
    if (!Number.isSafeInteger(frame)) throw new RangeError('Split frame must be an integer');
    return this.document.transaction('Split clip', () => {
      const { track, clip } = this.findClip(id), leftDuration = frame - clip.start;
      if (leftDuration <= 0 || leftDuration >= clip.duration) throw new RangeError('Split must be strictly inside the clip');
      const right = { ...clone(clip), id: makeId('clip'), start: frame, duration: clip.duration - leftDuration, in: clip.in + leftDuration };
      clip.duration = leftDuration; track.clips.splice(track.clips.indexOf(clip) + 1, 0, right);
      return { left: clip, right };
    });
  }
  slipClip(id, delta) {
    this._editable(this.findClip(id).track);
    if (!Number.isSafeInteger(delta)) throw new RangeError('Slip delta must be an integer');
    return this.document.transaction('Slip clip', () => { const { clip } = this.findClip(id); if (clip.in + delta < 0 || clip.in + delta + clip.duration > this._sourceLimit(clip)) throw new RangeError('Slip exceeds source bounds'); clip.in += delta; return clip; });
  }
  _ripple(track, fromFrame, delta, excludeId) {
    for (const clip of track.clips) if (clip.id !== excludeId && clip.start >= fromFrame) { clip.start += delta; if (clip.start < 0 || clip.start + clip.duration > this.project.duration) throw new RangeError('Ripple exceeds project bounds'); }
  }
  ripple(trackId, fromFrame, delta) { this._editable(this.getTrack(trackId)); if (!Number.isSafeInteger(fromFrame) || !Number.isSafeInteger(delta)) throw new RangeError('Ripple positions must be integer frames'); return this.document.transaction('Ripple clips', () => this._ripple(this.getTrack(trackId), fromFrame, delta)); }
  removeClip(id, { ripple = false } = {}) {
    this._editable(this.findClip(id).track);
    return this.document.transaction(ripple ? 'Ripple delete' : 'Delete clip', () => { const { track, clip } = this.findClip(id); track.clips = track.clips.filter((item) => item.id !== id); if (ripple) this._ripple(track, clip.start + clip.duration, -clip.duration); return clip; });
  }
  duplicateClip(id, { start, trackId } = {}) { const { track, clip } = this.findClip(id); return this.addClip(trackId ?? track.id, { ...clone(clip), id: makeId('clip'), start: start ?? clip.start + clip.duration, name: `${clip.name} copy` }); }
  clipsAt(frame = this.project.frame, { includeMuted = false } = {}) { return this.tracks.flatMap((track) => (!includeMuted && track.muted) ? [] : track.clips.filter((clip) => clip.start <= frame && frame < clip.start + clip.duration).map((clip) => ({ track, clip, sourceFrame: clip.in + frame - clip.start }))); }
  trim(...args) { return this.trimClip(...args); }
  split(...args) { return this.splitClip(...args); }
  slip(...args) { return this.slipClip(...args); }
}

const sanitizeLine = (text) => String(text).replace(/[\r\n\u0000-\u001f]/g, ' ').trim();
/** CMX 3600 cut list; effects remain project-specific comments. */
export function exportEDL(project, { trackId, dropFrame = false } = {}) {
  const data = importProject(project), assets = new Map(data.assets.map((asset) => [asset.id, asset]));
  const track = trackId ? data.timeline.tracks.find((item) => item.id === trackId) : data.timeline.tracks.find((item) => item.kind === 'video' && item.clips.some((clip) => clip.assetId));
  if (trackId && !track) throw new RangeError(`Unknown track: ${trackId}`);
  const clips = (track?.clips ?? []).slice().sort((a, b) => a.start - b.start);
  if (clips.length > 999) throw new RangeError('CMX 3600 supports at most 999 events in this exporter');
  if (clips.some((clip, index) => index > 0 && clip.start < clips[index - 1].start + clips[index - 1].duration)) throw new Error('EDL cannot represent overlapping clips on one track; use OTIO');
  const tc = (frame) => formatSMPTE(frame, data.fps, { dropFrame });
  const lines = [`TITLE: ${sanitizeLine(data.name)}`, `FCM: ${dropFrame ? 'DROP FRAME' : 'NON-DROP FRAME'}`, `* FRAME RATE: ${data.fps}`, '* Veyra export: cuts only; compositing and node effects are not baked.', ''];
  clips.forEach((clip, index) => {
    const asset = assets.get(clip.assetId), reel = sanitizeLine(asset?.id ?? 'GENERATE').replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase().padEnd(8, ' ');
    lines.push(`${String(index + 1).padStart(3, '0')}  ${reel} ${track.kind === 'audio' ? 'A' : 'V'}     C        ${tc(clip.in)} ${tc(clip.in + clip.duration)} ${tc(clip.start)} ${tc(clip.start + clip.duration)}`, `* FROM CLIP NAME: ${sanitizeLine(clip.name)}`);
    if (asset) lines.push(`* SOURCE FILE: ${sanitizeLine(asset.url)}`);
    if (clip.nodeId) lines.push(`* VEYRA NODE: ${sanitizeLine(clip.nodeId)}`);
    lines.push('');
  });
  return lines.join('\n');
}

const rational = (value, rate) => ({ OTIO_SCHEMA: 'RationalTime.1', value, rate });
const timeRange = (start, duration, rate) => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: rational(start, rate), duration: rational(duration, rate) });

/** Serializable OpenTimelineIO object. Overlaps become parallel lanes. */
export function exportOTIO(project) {
  const data = importProject(project), assets = new Map(data.assets.map((asset) => [asset.id, asset]));
  const children = [];
  for (const track of data.timeline.tracks) {
    const lanes = [[]];
    for (const clip of track.clips.slice().sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))) {
      let lane = lanes.find((items) => !items.length || items[items.length - 1].start + items[items.length - 1].duration <= clip.start);
      if (!lane) { lane = []; lanes.push(lane); } lane.push(clip);
    }
    lanes.forEach((clips, laneIndex) => {
      const items = []; let cursor = 0;
      for (const clip of clips) {
        if (clip.start > cursor) items.push({ OTIO_SCHEMA: 'Gap.1', name: 'Gap', metadata: {}, effects: [], markers: [], source_range: timeRange(0, clip.start - cursor, data.fps) });
        const asset = assets.get(clip.assetId);
        const reference = asset ? { OTIO_SCHEMA: 'ExternalReference.1', name: asset.name, metadata: { veyra: { assetId: asset.id, type: asset.type } }, target_url: asset.url, available_range: timeRange(0, asset.type === 'image' ? Math.max(data.duration, clip.in + clip.duration) : (asset.duration || clip.in + clip.duration), data.fps) } : { OTIO_SCHEMA: 'MissingReference.1', name: clip.name, metadata: { veyra: { nodeId: clip.nodeId } }, available_range: null };
        items.push({ OTIO_SCHEMA: 'Clip.2', name: clip.name, metadata: { veyra: { clipId: clip.id, nodeId: clip.nodeId, opacity: clip.opacity } }, effects: [], markers: [], source_range: timeRange(clip.in, clip.duration, data.fps), media_references: { DEFAULT_MEDIA: reference }, active_media_reference_key: 'DEFAULT_MEDIA' });
        cursor = clip.start + clip.duration;
      }
      if (cursor < data.duration) items.push({ OTIO_SCHEMA: 'Gap.1', name: 'Gap', metadata: {}, effects: [], markers: [], source_range: timeRange(0, data.duration - cursor, data.fps) });
      children.push({ OTIO_SCHEMA: 'Track.1', name: lanes.length > 1 ? `${track.name} · lane ${laneIndex + 1}` : track.name, kind: track.kind === 'video' ? 'Video' : 'Audio', metadata: { veyra: { trackId: track.id, muted: track.muted, locked: track.locked, lane: laneIndex } }, source_range: null, effects: [], markers: [], children: items });
    });
  }
  return { OTIO_SCHEMA: 'Timeline.1', name: data.name, global_start_time: rational(0, data.fps), metadata: { veyra: { projectId: data.id, width: data.width, height: data.height, duration: data.duration, warning: 'Node effects and mute state are metadata; render from Veyra to bake appearance.' } }, tracks: { OTIO_SCHEMA: 'Stack.1', name: 'Tracks', metadata: {}, source_range: timeRange(0, data.duration, data.fps), effects: [], markers: [], children } };
}

export function serializeOTIO(project, space = 2) { return JSON.stringify(exportOTIO(project), null, space); }
