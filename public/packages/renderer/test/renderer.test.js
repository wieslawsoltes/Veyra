import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedDimensions, evaluateKeyframes, finite, normalizedPoints, parseColor, resolveAnimatedParams, validateProject } from '../utils.js';
import { applyCPU, blank, blurCPU, mergeCPU, viewCPU } from '../cpu.js';
import { Compositor } from '../renderer.js';

const pixel = (...values) => new Uint8ClampedArray(values);
const constant = (color, width = 1, height = 1) => applyCPU('Constant', null, null, { color }, width, height, 1, false);
test('resolution preserves aspect and honors proxy, dimension and pixel limits', () => {
  assert.deepEqual(boundedDimensions(960, 540, 2), { width: 480, height: 270, scale: 0.5 });
  const huge = boundedDimensions(16000, 16000); assert.ok(huge.width <= 4096); assert.ok(huge.width * huge.height < 8_400_000);
  const bad = boundedDimensions(NaN, Infinity, 0); assert.equal(bad.width, 960); assert.equal(bad.height, 540);
});
test('finite sanitizes malformed and nonfinite values', () => {
  assert.equal(finite(NaN, 3), 3); assert.equal(finite(Symbol(), 3), 3); assert.equal(finite(Infinity, 3), 3); assert.equal(finite(100, 0, 0, 10), 10);
});
test('colors parse alpha hex and normalized arrays', () => {
  assert.deepEqual(parseColor('#f008'), [1, 0, 0, 136 / 255]); assert.deepEqual(parseColor([1, 0.5, 0]), [1, 0.5, 0, 1]); assert.deepEqual(parseColor('invalid'), [0, 0, 0, 1]);
});
test('keyframe interpolation handles sorted, held, smooth and vector keys', () => {
  assert.equal(evaluateKeyframes([{ frame: 10, value: 10 }, { frame: 0, value: 0 }], 5), 5);
  assert.equal(evaluateKeyframes([{ frame: 0, value: 0, interpolation: 'hold' }, { frame: 10, value: 10 }], 9), 0);
  assert.deepEqual(evaluateKeyframes([{ frame: 0, value: [0, 1] }, { frame: 10, value: [1, 0] }], 5), [0.5, 0.5]);
  assert.equal(evaluateKeyframes([{ frame: 0, value: 0, interpolation: 'smooth' }, { frame: 10, value: 1 }], 2.5), 0.15625);
});
test('node and embedded animation resolve without changing the document', () => {
  const node = { params: { exposure: { value: 1, keyframes: [{ frame: 0, value: 0 }, { frame: 10, value: 2 }] } }, keyframes: { gamma: [{ frame: 0, value: 1 }, { frame: 10, value: 3 }] } };
  assert.deepEqual(resolveAnimatedParams(node, 5), { exposure: 1, gamma: 2 }); assert.equal(typeof node.params.exposure, 'object');
});
test('DAG rejects cycles, missing edges, duplicate IDs and unknown operations', () => {
  assert.throws(() => validateProject({ nodes: [{ id: 'a', type: 'Grade', inputs: ['b'] }, { id: 'b', type: 'Grade', inputs: ['a'] }] }), /cycle/);
  assert.throws(() => validateProject({ nodes: [{ id: 'a', type: 'Grade', inputs: ['missing'] }] }), /missing node/);
  assert.throws(() => validateProject({ nodes: [{ id: 'a', type: 'Viewer' }, { id: 'a', type: 'Viewer' }] }), /duplicate/);
  assert.throws(() => validateProject({ nodes: [{ id: 'a', type: 'NotAnEffect' }] }), /unsupported/);
});
test('DAG evaluates shared ancestors once and only the selected branch', () => {
  const graph = validateProject({ nodes: [{ id: 'off', type: 'Constant' }, { id: 'source', type: 'Constant' }, { id: 'a', type: 'Grade', inputs: ['source'] }, { id: 'b', type: 'Invert', inputs: ['source'] }, { id: 'merge', type: 'Merge', inputs: ['a', 'b'] }], viewerNodeId: 'merge' });
  assert.deepEqual(graph.order.map(n => n.id), ['source', 'a', 'b', 'merge']);
});
test('Constant alpha and one-stop exposure alter actual pixels', () => {
  assert.deepEqual([...applyCPU('Constant', null, null, { color: '#ff0000', alpha: 0.5 }, 1, 1)], [255, 0, 0, 128]);
  assert.deepEqual([...applyCPU('Grade', pixel(64, 32, 16, 255), null, { exposure: 1 }, 1, 1)], [128, 64, 32, 255]);
});
test('Grade zero saturation produces equal channels and preserves alpha', () => {
  const result = applyCPU('Grade', pixel(255, 20, 10, 71), null, { saturation: 0 }, 1, 1); assert.equal(result[0], result[1]); assert.equal(result[1], result[2]); assert.equal(result[3], 71);
});
test('over uses straight alpha and mask alpha controls foreground coverage', () => {
  assert.deepEqual([...mergeCPU(pixel(0, 0, 255, 255), pixel(255, 0, 0, 128))], [128, 0, 127, 255]);
  assert.deepEqual([...mergeCPU(pixel(0, 0, 255, 255), pixel(255, 0, 0, 255), 'over', 1, pixel(255, 255, 255, 0))], [0, 0, 255, 255]);
});
test('screen, multiply and add have distinct known results', () => {
  const gray = pixel(128, 128, 128, 255);
  assert.ok(Math.abs(mergeCPU(gray, gray, 'screen')[0] - 192) <= 1); assert.ok(Math.abs(mergeCPU(gray, gray, 'multiply')[0] - 64) <= 1); assert.equal(mergeCPU(gray, gray, 'add')[0], 255);
});
test('ChromaKey removes green and keeps red opaque', () => {
  const result = applyCPU('ChromaKey', pixel(0, 255, 0, 255, 255, 0, 0, 255), null, {}, 2, 1); assert.equal(result[3], 0); assert.equal(result[7], 255);
});
test('Roto clips polygon and supports inversion', () => {
  const p = { points: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] };
  const result = applyCPU('Roto', null, null, p, 2, 1, 1, false); assert.equal(result[3], 255); assert.equal(result[7], 0);
  const inverse = applyCPU('Roto', null, null, { ...p, invert: true }, 2, 1, 1, false); assert.equal(inverse[3], 0); assert.equal(inverse[7], 255);
  assert.deepEqual(normalizedPoints([1, null, [0, 1]]), [[0, 1]]);
});
test('Transform translates pixel coverage and applies opacity', () => {
  const source = pixel(255, 0, 0, 255, 0, 0, 0, 0);
  const result = applyCPU('Transform', source, null, { x: 0.5, opacity: 0.5 }, 2, 1); assert.equal(result[3], 0); assert.equal(result[4], 255); assert.equal(result[7], 128);
});
test('Blur spreads coverage without producing dark alpha fringes', () => {
  const source = blank(7, 1); source.set([255, 0, 0, 255], 12);
  const blurred = blurCPU(source, 7, 1, 4); assert.ok(blurred[3] > 0); assert.ok(blurred[15] < 255); assert.equal(blurred[12], 255);
});
test('Noise is deterministic by seed and has real pixel variance', () => {
  const first = applyCPU('Noise', null, null, { seed: 7, amount: 1 }, 10, 1, 1, false), again = applyCPU('Noise', null, null, { seed: 7, amount: 1 }, 10, 1, 1, false), other = applyCPU('Noise', null, null, { seed: 8, amount: 1 }, 10, 1, 1, false);
  assert.deepEqual(first, again); assert.notDeepEqual(first, other); assert.ok(new Set(first).size > 5);
});
test('Crop preserves dimensions and clears pixels outside rectangle', () => {
  const result = applyCPU('Crop', constant('#ffffff', 2, 1), null, { x: 0.5, y: 0, width: 0.5, height: 1 }, 2, 1); assert.deepEqual([...result], [0, 0, 0, 0, 255, 255, 255, 255]);
});
test('Premultiply and Unpremultiply approximately round-trip nonzero alpha', () => {
  const p = pixel(128, 64, 32, 128), premul = applyCPU('Premultiply', p, null, {}, 1, 1), result = applyCPU('Unpremultiply', premul, null, {}, 1, 1);
  result.forEach((v, i) => assert.ok(Math.abs(v - p[i]) <= 1));
});
test('ColorMatrix accepts row-major affine RGBA coefficients', () => {
  const matrix = [0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
  assert.deepEqual([...applyCPU('ColorMatrix', pixel(10, 20, 30, 40), null, { matrix }, 1, 1)], [20, 10, 30, 40]);
});
test('Viewer alpha inspection is opaque grayscale and gamma changes RGB', () => {
  assert.deepEqual([...viewCPU(pixel(10, 20, 30, 100), 0, 1, 'a')], [100, 100, 100, 255]);
  assert.ok(viewCPU(pixel(64, 64, 64, 255), 0, 2)[0] > 64);
});
test('public API serializes frames, exports copies, reports CPU truthfully and disposes', async () => {
  const previous = globalThis.ImageData;
  globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
  try {
    let rendered;
    const canvas = { width: 0, height: 0, getContext: type => type === '2d' ? { putImageData: value => { rendered = value; } } : null };
    const compositor = new Compositor(canvas, { preferGPU: false }); assert.equal(await compositor.init(), 'Canvas 2D');
    const project = { width: 2, height: 1, nodes: [{ id: 'red', type: 'Constant', params: { color: '#f00' } }, { id: 'invert', type: 'Invert', inputs: ['red'], params: { amount: 1 } }], viewerNodeId: 'invert' };
    const stats = await compositor.render(project); assert.equal(stats.backend, 'Canvas 2D'); assert.equal(stats.width, 2); assert.ok(stats.ms >= 0); assert.equal(rendered.data[0], 0); assert.equal(rendered.data[1], 255);
    const copy = await compositor.readPixels(); copy.data[0] = 99; assert.equal((await compositor.readPixels()).data[0], 0);
    const cachedVersion = compositor._cacheVersion; await compositor.render(project); assert.equal(compositor._cacheVersion, cachedVersion);
    project.nodes[0].params.color = '#00f'; await compositor.render(project); const changed = await compositor.readPixels(); assert.deepEqual([...changed.data.slice(0, 4)], [255, 255, 0, 255]); assert.ok(compositor._cacheVersion > cachedVersion);
    compositor.dispose(); await assert.rejects(compositor.render(project), /disposed/);
  } finally { globalThis.ImageData = previous; }
});
test('Source nodes apply independent frame offsets for a shared video asset', async () => {
  const previous = globalThis.ImageData;
  globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
  try {
    const canvas = { width: 0, height: 0, getContext: type => type === '2d' ? { putImageData() {} } : null }, compositor = new Compositor(canvas, { preferGPU: false }), sought = [];
    compositor._loadAsset = async (asset, sourceId) => ({ type: 'video', sourceId, url: asset.url, element: { currentTime: 0 } });
    compositor._seekVideo = async (entry, time) => { sought.push([entry.sourceId, time]); entry.element.currentTime = time; };
    compositor._sourceCanvas = () => ({}); compositor._canvasPixels = () => pixel(0, 0, 0, 255);
    const project = { width: 1, height: 1, fps: 24, assets: [{ id: 'movie', type: 'video', url: 'fixture.webm' }], nodes: [{ id: 'a', type: 'Source', params: { assetId: 'movie', timeOffset: -24 } }, { id: 'b', type: 'Source', params: { assetId: 'movie', timeOffset: 48 } }, { id: 'merge', type: 'Merge', inputs: ['a', 'b'], params: {} }], viewerNodeId: 'merge' };
    await compositor.render(project, { frame: 72 }); assert.deepEqual(sought, [['a', 2], ['b', 5]]); compositor.dispose();
  } finally { globalThis.ImageData = previous; }
});
